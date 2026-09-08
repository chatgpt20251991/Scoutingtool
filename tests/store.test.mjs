import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { createStore, replaceFileAtomically } from '../src/store.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-atomic-store-'));
  const locks = [];
  t.after(async () => {
    for (const lock of locks) await lock.release();
    const inside = relative(resolve(tmpdir()), resolve(dir));
    assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
    await rm(dir, { recursive: true, force: true });
  });
  const path = join(dir, 'state.json'), store = await createStore(path);
  await store.update(state => { state.audit.push({ id: 'synthetic-before' }); });
  return { dir, path, store, async lock() { const lock = await holdWindowsFile(path); locks.push(lock); return lock; } };
}

async function holdWindowsFile(path) {
  // FileShare.ReadWrite permits readers/writers but deliberately withholds DELETE,
  // reproducing the native replacement failure without altering the destination.
  const command = "$stream = [System.IO.File]::Open($env:OMNISCOUT_TEST_LOCK_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::ReadLine() | Out-Null } finally { $stream.Dispose() }";
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, env: { ...process.env, OMNISCOUT_TEST_LOCK_PATH: path }, stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '', errors = '', releasePromise;
  child.stderr.on('data', bytes => { errors += bytes; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows lock helper timed out.')); }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); if (!output.includes('LOCKED')) reject(new Error(`Windows lock helper exited ${code}: ${errors}`)); });
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.includes('LOCKED')) { clearTimeout(timer); resolve(); }
    });
  });
  return {
    release() {
      return releasePromise ||= (async () => {
        if (child.exitCode !== null) return;
        const exited = once(child, 'exit');
        child.stdin.end('\n');
        const [code] = await exited;
        assert.equal(code, 0, errors);
      })();
    }
  };
}

test('atomic replacement retries transient Windows errors using exactly the same source and destination', async () => {
  const calls = [], delays = [];
  await replaceFileAtomically('synthetic.tmp', 'synthetic.json', {
    platform: 'win32',
    renameFile: async (...paths) => {
      calls.push(paths);
      if (calls.length <= 3) throw Object.assign(new Error('synthetic sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][calls.length - 1] });
    },
    delay: async milliseconds => { delays.push(milliseconds); }
  });
  assert.deepEqual(calls, Array.from({ length: 4 }, () => ['synthetic.tmp', 'synthetic.json']));
  assert.deepEqual(delays, [20, 40, 80]);
});

test('persistent Windows rename denial stops after six attempts and preserves the original error', async () => {
  const original = Object.assign(new Error('synthetic persistent denial'), { code: 'EPERM' });
  let attempts = 0; const delays = [];
  await assert.rejects(replaceFileAtomically('synthetic.tmp', 'synthetic.json', {
    platform: 'win32', renameFile: async () => { attempts += 1; throw original; }, delay: async ms => { delays.push(ms); }
  }), error => error === original);
  assert.equal(attempts, 6);
  assert.deepEqual(delays, [20, 40, 80, 160, 320]);
  assert.equal(delays.reduce((sum, delay) => sum + delay, 0), 620);
});

test('unrelated errors and non-Windows errors never retry or delete a destination', async () => {
  for (const [platform, code] of [['win32', 'ENOSPC'], ['win32', 'ENOENT'], ['win32', 'EISDIR'], ['linux', 'EPERM']]) {
    let attempts = 0, delays = 0;
    await assert.rejects(replaceFileAtomically('synthetic.tmp', 'synthetic.json', {
      platform, renameFile: async () => { attempts += 1; throw Object.assign(new Error(code), { code }); }, delay: async () => { delays += 1; }
    }), error => error.code === code);
    assert.equal(attempts, 1); assert.equal(delays, 0);
  }
});

test('real Windows sharing lock releases within the retry window and the store commits once', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), lock = await f.lock();
  const probe = join(f.dir, 'synthetic-probe.tmp');
  await writeFile(probe, '{}');
  await assert.rejects(rename(probe, f.path), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
  await rm(probe);
  const before = await readFile(f.path, 'utf8');
  let callbacks = 0;
  const update = f.store.update(state => { callbacks += 1; state.audit.push({ id: 'synthetic-after' }); return 'saved'; });
  const unlock = (async () => {
    await pause(80);
    assert.equal(await readFile(f.path, 'utf8'), before);
    await lock.release();
  })();
  const [result] = await Promise.all([update, unlock]);
  assert.equal(result, 'saved');
  assert.equal(callbacks, 1);
  assert.deepEqual((await f.store.read()).audit.map(item => item.id), ['synthetic-before', 'synthetic-after']);
  assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), await f.store.read());
  assert.deepEqual((await readdir(f.dir)).filter(name => name.endsWith('.tmp')), []);
});

test('real persistent Windows sharing lock preserves disk and memory, then later mutation recovers', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), before = await f.store.read(), beforeBytes = await readFile(f.path, 'utf8'), lock = await f.lock();
  let callbacks = 0;
  await assert.rejects(f.store.update(state => { callbacks += 1; state.audit.push({ id: 'must-not-commit' }); }), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
  assert.equal(callbacks, 1);
  assert.deepEqual(await f.store.read(), before);
  assert.equal(await readFile(f.path, 'utf8'), beforeBytes);
  assert.deepEqual((await readdir(f.dir)).filter(name => name.endsWith('.tmp')), []);
  await lock.release();
  await f.store.update(state => { state.audit.push({ id: 'synthetic-recovered' }); });
  assert.deepEqual((await f.store.read()).audit.map(item => item.id), ['synthetic-before', 'synthetic-recovered']);
});

test('parallel stores preserve exactly successful commits under external read contention and recover afterward', async t => {
  const f = await fixture(t), otherPath = join(f.dir, 'second.json'), other = await createStore(otherPath);
  await other.update(state => { state.audit.push({ id: 'other-initial' }); });
  let reading = true, observed = 0;
  const readers = [f.path, otherPath].map(path => (async () => {
    while (reading) {
      const state = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(state.version, 1);
      assert.ok(Array.isArray(state.audit));
      observed += 1;
      // External inspection must relinquish sharing handles between reads. An
      // unbroken external lock is covered above and intentionally fails boundedly.
      await pause(4);
    }
  })());
  const work = Array.from({ length: 80 }, (_, index) => [
    { store: f.store, id: `synthetic-A-${index}` }, { store: other, id: `synthetic-B-${index}` }
  ]).flat();
  let outcomes;
  try {
    // Heavy external readers may legitimately exhaust bounded retry. Every failure
    // must stay observable and absent from the persisted/in-memory state.
    outcomes = await Promise.allSettled(work.map(({ store, id }) => store.update(state => { state.audit.push({ id }); return id; })));
  } finally { reading = false; await Promise.all(readers); }
  assert.ok(observed > 0);
  const saved = outcomes.filter(outcome => outcome.status === 'fulfilled').map(outcome => outcome.value);
  const failed = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.ok(saved.length > 0);
  for (const failure of failed) assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.reason.code), String(failure.reason));
  assert.deepEqual((await f.store.read()).audit.map(item => item.id), ['synthetic-before', ...saved.filter(id => id.startsWith('synthetic-A-'))]);
  assert.deepEqual((await other.read()).audit.map(item => item.id), ['other-initial', ...saved.filter(id => id.startsWith('synthetic-B-'))]);
  assert.deepEqual(JSON.parse(await readFile(f.path, 'utf8')), await f.store.read());
  assert.deepEqual(JSON.parse(await readFile(otherPath, 'utf8')), await other.read());
  await f.store.update(state => { state.audit.push({ id: 'synthetic-after-contention' }); });
  assert.equal((await f.store.read()).audit.at(-1).id, 'synthetic-after-contention');
  t.diagnostic(`${saved.length}/160 committed; ${failed.length} visible bounded sharing failures; disk and memory match exactly; recovery succeeded.`);
});
