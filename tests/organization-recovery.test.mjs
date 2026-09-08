import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { CATALOG } from '../src/fixtures.mjs';
import { emptyState } from '../src/store.mjs';
import { createOrganizationManager } from '../src/organizations/index.mjs';
import { stateDigest, createWorkspaceBackup, retentionPreview } from '../src/backup/workspace.mjs';
import { emptyImportState, previewImport } from '../src/import/index.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = '2026-09-08T12:00:00.000Z';
const SAMPLE = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const sampleDigest = previewImport(SAMPLE, emptyImportState(), { now: NOW }).digest;
const owned = new WeakMap();
function cleanup(t) {
  if (!owned.has(t)) {
    const resources = { managers: [], dirs: [] }; owned.set(t, resources);
    t.after(async () => {
      for (const manager of resources.managers.reverse()) await manager.close();
      for (const dir of resources.dirs.reverse()) {
        const inside = relative(resolve(tmpdir()), resolve(dir));
        assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  return owned.get(t);
}
async function folder(t) { const dir = await mkdtemp(join(tmpdir(), 'omniscout-recovery-test-')); cleanup(t).dirs.push(dir); return dir; }
async function manager(t, options = {}) {
  const m = await createOrganizationManager({ now: () => NOW, ...options }); cleanup(t).managers.push(m); return m;
}
function addNote(state, note = 'FICTIEVE bewaarde notitie') {
  const id = `synthetic-decision-${state.decisions.length + 1}`;
  state.decisions.push({ id, playerId: CATALOG.players[0].id, action: 'follow', reason: 'positive', note, at: NOW });
  state.audit.push({ id: `synthetic-audit-${state.audit.length + 1}`, action: 'decision.created', objectId: id, detail: 'FICTIEVE wijziging', at: NOW, actor: ACTOR });
}
async function restore(m, state, extras = {}) {
  return m.restore(A, { state, expectedDigest: (await m.capture(A)).digest, backupDigest: stateDigest(state), actor: ACTOR, ...extras });
}
async function inject(method, operation, run) {
  const original = fs[method];
  fs[method] = (...args) => operation(original, ...args);
  syncBuiltinESMExports();
  try { return await run(); }
  finally { fs[method] = original; syncBuiltinESMExports(); }
}

test('capture drains queued imports, returns isolated copies, and strips only known manager receipts', async t => {
  const m = await manager(t), a = await m.get(A), b = await m.get(B);
  await a.importQueue.enqueue(SAMPLE, sampleDigest);
  const captured = await m.capture(A);
  assert.equal(captured.state.importJobs[0].status, 'succeeded');
  assert.equal(captured.state.imports.snapshots.length, 1);
  assert.equal(captured.digest, stateDigest(captured.state));
  captured.state.importJobs.length = 0;
  assert.equal((await a.importQueue.list()).length, 1);
  assert.equal((await b.importQueue.list()).length, 0);
  await a.store.update(state => { state._legacyMigration = { version: 1, organizationId: A, digest: 'a'.repeat(64), importedAt: NOW }; state._workspaceRestore = { private: true }; });
  const clean = await m.capture(A);
  assert.equal(clean.state._legacyMigration, undefined); assert.equal(clean.state._workspaceRestore, undefined);
  await a.store.update(state => { state.credentials = 'synthetic-invalid'; });
  await assert.rejects(m.capture(A), e => e.status === 400);
});

test('retention capture reads persisted pending jobs without starting queue or rewriting source state', async t => {
  const dir = await folder(t), path = join(dir, 'organizations', A, 'state.json');
  const state = { ...emptyState(), imports: emptyImportState(), importJobs: [{ id: 'pending', snapshotId: SAMPLE.snapshotId, digest: sampleDigest,
    status: 'queued', attempts: 0, maxAttempts: 3, error: null, result: null, createdAt: NOW, updatedAt: NOW, payload: SAMPLE }] };
  await mkdir(join(dir, 'organizations', A), { recursive: true });
  const bytes = JSON.stringify(state); await writeFile(path, bytes);
  const m = await manager(t, { dataDir: dir });
  const snapshot = await m.capture(A, { drain: false }), report = retentionPreview(snapshot.state, { now: NOW });
  assert.equal(report.counts.pendingJobs, 1);
  assert.equal(snapshot.state.importJobs[0].status, 'queued');
  assert.equal(await readFile(path, 'utf8'), bytes);
  const drained = await m.capture(A);
  assert.equal(drained.state.importJobs[0].status, 'succeeded');
  assert.equal(drained.state.imports.snapshots.length, 1);
});

test('restore saves durable prior state, preserves legacy receipt and keeps old store/queue handles working after restart', async t => {
  const dir = await folder(t), source = join(dir, 'state.json'), legacy = emptyState(); addNote(legacy, 'FICTIEVE legacy');
  const original = JSON.stringify(legacy); await writeFile(source, original);
  let m = await manager(t, { dataDir: dir, legacyStatePath: source });
  await m.claimLegacy(A);
  const a = await m.get(A), snapshot = await m.capture(A), receipt = (await a.store.read())._legacyMigration;
  await a.store.update(state => addNote(state, 'FICTIEVE verandering na back-up'));
  const before = await a.store.read(), result = await restore(m, snapshot.state);
  assert.equal(result.restored, true); assert.match(result.recoveryId, /^[a-f0-9-]{36}$/);
  assert.equal(result.recoveryId.includes('/'), false);
  const recovered = await a.store.read();
  assert.deepEqual(recovered._legacyMigration, receipt);
  assert.equal(recovered.decisions.length, 1);
  assert.equal(recovered.audit.at(-1).action, 'workspace.restored');
  assert.equal(recovered.audit.at(-1).actor, ACTOR);
  assert.equal((await m.capture(A)).digest, result.digest);
  const file = join(dir, 'organizations', A, 'recovery', `${result.recoveryId}.json`), saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(saved.state, before);
  assert.equal(saved.previousDigest, stateDigest((({ _legacyMigration, ...rest }) => rest)(before)));
  await a.store.update(state => { state.brief.task = 'New write through old handle'; });
  await a.importQueue.enqueue(SAMPLE, sampleDigest); await m.idle();
  assert.equal((await a.importQueue.list())[0].status, 'succeeded');
  await m.close();
  m = await manager(t, { dataDir: dir, legacyStatePath: source });
  const restarted = await m.capture(A);
  assert.equal(restarted.state.brief.task, 'New write through old handle');
  assert.equal(restarted.state.imports.snapshots.length, 1);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 1);
  assert.equal(await readFile(source, 'utf8'), original);
});

test('stale previews, wrong backup digests and invalid actors cannot replace current state or make copies', async t => {
  const m = await manager(t), a = await m.get(A), snapshot = await m.capture(A);
  await a.store.update(state => addNote(state));
  const before = await a.store.read();
  await assert.rejects(m.restore(A, { state: snapshot.state, expectedDigest: snapshot.digest, backupDigest: snapshot.digest, actor: ACTOR }), e => e.status === 409);
  await assert.rejects(restore(m, snapshot.state, { backupDigest: '0'.repeat(64) }), e => e.status === 400);
  await assert.rejects(restore(m, snapshot.state, { actor: '../intruder' }), e => e.status === 400);
  assert.deepEqual(await a.store.read(), before);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 0);
});

test('restore serializes concurrent mutations and reauthorizes after queues drain and before commit', async t => {
  const m = await manager(t), a = await m.get(A), snapshot = await m.capture(A);
  let release, entered;
  const blocked = new Promise(resolve => { release = resolve; }), authorized = new Promise(resolve => { entered = resolve; });
  let checks = 0;
  const restored = m.restore(A, { state: snapshot.state, expectedDigest: snapshot.digest, backupDigest: snapshot.digest, actor: ACTOR,
    authorize: async () => { if (++checks === 1) { entered(); await blocked; } } });
  await authorized;
  const changed = a.store.update(state => addNote(state, 'FICTIEVE gelijktijdige wijziging'));
  release();
  await restored; await changed;
  assert.equal(checks, 2);
  assert.equal((await a.store.read()).decisions.length, 1);
  const before = await a.store.read(), current = await m.capture(A); let attempts = 0;
  await assert.rejects(m.restore(A, { state: snapshot.state, expectedDigest: current.digest, backupDigest: snapshot.digest, actor: ACTOR,
    authorize: async () => { if (++attempts === 2) throw Object.assign(new Error('synthetic revoked owner'), { status: 403 }); } }), e => e.status === 403);
  assert.deepEqual(await a.store.read(), before);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 2);
});

test('pending incoming jobs and pending legacy migration block restore without executing imported work', async t => {
  const m = await manager(t), empty = (await m.capture(A)).state;
  const pending = structuredClone(empty);
  pending.importJobs.push({ id: 'pending', snapshotId: SAMPLE.snapshotId, digest: sampleDigest, status: 'queued', attempts: 0, maxAttempts: 3,
    error: null, result: null, createdAt: NOW, updatedAt: NOW, payload: SAMPLE });
  await assert.rejects(restore(m, pending), e => e.status === 409);
  assert.deepEqual((await m.capture(A)).state, empty);
  const dir = await folder(t), source = join(dir, 'state.json'); await writeFile(source, '{invalid');
  const broken = await manager(t, { dataDir: dir, legacyStatePath: source });
  await assert.rejects(broken.claimLegacy(A), e => e.status === 409);
  await assert.rejects(broken.capture(A), e => e.status === 409);
  await assert.rejects(broken.restore(A, { state: empty, expectedDigest: stateDigest(empty), backupDigest: stateDigest(empty), actor: ACTOR }), e => e.status === 409);
});

test('full recovery history refuses the eleventh copy without silent deletion in memory and file mode', async t => {
  for (const dataDir of [null, await folder(t)]) {
    const m = await manager(t, { dataDir }), snapshot = (await m.capture(A)).state;
    for (let index = 0; index < 10; index += 1) await restore(m, snapshot);
    const before = await m.capture(A);
    await assert.rejects(restore(m, snapshot), e => e.status === 409);
    assert.deepEqual(await m.capture(A), before);
    assert.equal((await m.stats(A)).counts.recoveryCopies, 10);
    if (dataDir) assert.equal((await readdir(join(dataDir, 'organizations', A, 'recovery'))).length, 10);
  }
});

test('recovery copy ENOSPC and final state-write ENOSPC leave old disk and memory intact', async t => {
  const dir = await folder(t), m = await manager(t, { dataDir: dir }), a = await m.get(A);
  await a.store.update(state => addNote(state)); const before = await a.store.read(), path = join(dir, 'organizations', A, 'state.json'), bytes = await readFile(path, 'utf8');
  const incoming = emptyState();
  await inject('writeFile', (original, target, ...args) => String(target).includes('recovery') ? Promise.reject(Object.assign(new Error('synthetic disk full while copying'), { code: 'ENOSPC' })) : original(target, ...args), async () => {
    await assert.rejects(restore(m, incoming), e => e.code === 'ENOSPC');
  });
  assert.deepEqual(await a.store.read(), before); assert.equal(await readFile(path, 'utf8'), bytes);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 0);
  await inject('writeFile', (original, target, ...args) => String(target).startsWith(path + '.') ? Promise.reject(Object.assign(new Error('synthetic disk full replacing state'), { code: 'ENOSPC' })) : original(target, ...args), async () => {
    await assert.rejects(restore(m, incoming), e => e.code === 'ENOSPC');
  });
  assert.deepEqual(await a.store.read(), before); assert.equal(await readFile(path, 'utf8'), bytes);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 1);
  await restore(m, incoming);
  assert.equal((await a.store.read()).decisions.length, 0);
  assert.deepEqual(await a.importQueue.list(), []);
  await a.importQueue.enqueue(SAMPLE, sampleDigest); await m.idle();
  assert.equal((await a.importQueue.list())[0].status, 'succeeded');
});

test('recovery directory symlinks and unsafe organization paths cannot redirect private copies', async t => {
  const dir = await folder(t), outside = await folder(t), m = await manager(t, { dataDir: dir }), snapshot = (await m.capture(A)).state;
  await symlink(outside, join(dir, 'organizations', A, 'recovery'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restore(m, snapshot), e => e.status === 409);
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(m.capture('../escape'), e => e.status === 400);
  await assert.rejects(m.restore('../escape', {}), e => e.status === 400);
});

test('source rights are rechecked at final commit and denied old state cannot be copied through restore', async t => {
  let now = NOW;
  const m = await manager(t, { now: () => now }), a = await m.get(A);
  const payload = structuredClone(SAMPLE); payload.source.expiresAt = '2026-09-09T00:00:00.000Z';
  await a.importQueue.enqueue(payload, previewImport(payload, emptyImportState(), { now }).digest); await m.idle();
  const current = await m.capture(A), bundle = createWorkspaceBackup({ organizationId: A, organizationName: 'FICTIEF', state: current.state, now });
  let checks = 0;
  await assert.rejects(m.restore(A, { state: bundle.state, expectedDigest: current.digest, backupDigest: bundle.digest, actor: ACTOR,
    authorize: async () => { if (++checks === 2) now = '2026-09-10T00:00:00.000Z'; } }), e => e.status === 403);
  assert.equal((await m.capture(A)).digest, current.digest);
  await assert.rejects(restore(m, emptyState()), e => e.status === 403);
  assert.equal((await m.stats(A)).counts.recoveryCopies, 1);
});
