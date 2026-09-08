import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createOrganizationManager } from '../src/organizations/index.mjs';
import { emptyState } from '../src/store.mjs';
import { applyImport, emptyImportState, previewImport } from '../src/import/index.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-09-08T12:00:00.000Z';
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const hash = payload => previewImport(payload, emptyImportState(), { now: NOW }).digest;
const cleanups = new WeakMap();
function cleanup(t) {
  if (!cleanups.has(t)) {
    const values = { managers: [], directories: [] };
    cleanups.set(t, values);
    t.after(async () => {
      for (const m of values.managers.reverse()) await m.close();
      for (const dir of values.directories.reverse()) {
        const within = relative(resolve(tmpdir()), resolve(dir));
        assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  return cleanups.get(t);
}
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-organizations-'));
  cleanup(t).directories.push(dir);
  return dir;
}
async function manager(t, options = {}) {
  const instance = await createOrganizationManager({ now: () => NOW, ...options });
  cleanup(t).managers.push(instance);
  return instance;
}
function stateWithNotes(note = 'FICTIEVE notitie van club A') {
  return { ...emptyState(), decisions: [{ id: 'same-decision', playerId: 'same-player', note }],
    tasks: [{ id: 'same-task', requestId: 'same-request', playerId: 'same-player', question: note }],
    audit: [{ id: 'same-audit', actor: 'synthetic-local-user', action: 'decision.created', detail: note }] };
}

test('memory organizations isolate notes, requests, audit, briefs, imports and identical retained job IDs', async t => {
  const m = await manager(t), a = await m.get(A), b = await m.get(B);
  assert.equal(await m.get(A.toUpperCase()), a);
  assert.equal((await b.store.read()).decisions.length, 0);
  await a.store.update(state => { Object.assign(state, stateWithNotes()); state.brief.task = 'A'; state.importWorkspace = stateWithNotes('import A'); });
  await b.store.update(state => { Object.assign(state, stateWithNotes('FICTIEVE notitie B')); state.brief.task = 'B'; });
  const aJob = await a.importQueue.enqueue(sample, hash(sample));
  await m.idle();
  assert.deepEqual(await b.importQueue.list(), []);
  await assert.rejects(b.importQueue.retry(aJob.id), e => e.status === 404);
  const bJob = await b.importQueue.enqueue(sample, hash(sample));
  await m.idle();
  assert.notEqual(aJob.id, bJob.id);
  assert.equal((await a.importQueue.enqueue(sample, hash(sample))).id, aJob.id);
  assert.equal((await b.importQueue.enqueue(sample, hash(sample))).id, bJob.id);
  await a.store.update(state => { state.importJobs[0].id = 'same-retained-job'; });
  await b.store.update(state => { state.importJobs[0].id = 'same-retained-job'; });
  await m.idle();
  const sa = await a.store.read(), sb = await b.store.read();
  assert.equal(sa.importJobs[0].id, sb.importJobs[0].id);
  assert.equal(sa.imports.snapshots.length, 1);
  assert.equal(sb.imports.snapshots.length, 1);
  assert.equal(sa.decisions[0].note, 'FICTIEVE notitie van club A');
  assert.equal(sb.decisions[0].note, 'FICTIEVE notitie B');
  assert.equal(sa.tasks[0].requestId, sb.tasks[0].requestId);
  assert.notEqual(sa.audit[0].detail, sb.audit[0].detail);
  assert.equal(sa.brief.task, 'A');
  assert.equal(sb.brief.task, 'B');
  assert.equal(sb.importWorkspace, undefined);
});

test('concurrent opens reuse one queue and durable directories survive manager restart', async t => {
  const dir = await temporary(t);
  let m = await manager(t, { dataDir: dir });
  const [a, same] = await Promise.all([m.get(A), m.get(A)]);
  assert.equal(a, same);
  const b = await m.get(B);
  await a.store.update(state => Object.assign(state, stateWithNotes('saved A')));
  await b.store.update(state => Object.assign(state, stateWithNotes('saved B')));
  await m.close();
  m = await manager(t, { dataDir: dir });
  assert.equal((await (await m.get(A)).store.read()).decisions[0].note, 'saved A');
  assert.equal((await (await m.get(B)).store.read()).decisions[0].note, 'saved B');
  const textA = await readFile(join(dir, 'organizations', A, 'state.json'), 'utf8');
  const textB = await readFile(join(dir, 'organizations', B, 'state.json'), 'utf8');
  assert.ok(textA.includes('saved A') && !textA.includes('saved B'));
  assert.ok(textB.includes('saved B') && !textB.includes('saved A'));
});

test('invalid IDs, path traversal, arrays, nil UUID and UUID aliases never create a workspace', async t => {
  const m = await manager(t);
  for (const id of ['../state', '../' + A, A + '/..', A + '\\..', A + '.json', '%2e%2e', '00000000-0000-0000-0000-000000000000', '', null, [], {}, A + ' ']) {
    await assert.rejects(m.get(id), e => e.status === 400);
    await assert.rejects(m.stats(id), e => e.status === 400);
    await assert.rejects(m.claimLegacy(id), e => e.status === 400);
  }
});

test('manager lock excludes both same-process and child-process access and close releases it', async t => {
  const dir = await temporary(t), m = await manager(t, { dataDir: dir });
  await assert.rejects(createOrganizationManager({ dataDir: dir }), e => e.status === 409);
  const moduleURL = new URL('../src/organizations/index.mjs', import.meta.url).href;
  const code = `import {createOrganizationManager} from ${JSON.stringify(moduleURL)}; try { await createOrganizationManager({dataDir:${JSON.stringify(dir)}}); process.exitCode=2; } catch(e) { console.log(e.status); }`;
  const child = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code]);
  assert.equal(child.stdout.trim(), '409');
  await m.close();
  const next = await manager(t, { dataDir: dir });
  await next.get(A);
});

test('ambiguous crash locks are preserved until explicit recovery; invalid journals release own acquired lock', async t => {
  const dir = await temporary(t), path = join(dir, '.organization-manager.lock');
  const stale = JSON.stringify({ version: 1, pid: 2147483647, nonce: 'synthetic-crash', createdAt: NOW });
  await writeFile(path, stale);
  await assert.rejects(createOrganizationManager({ dataDir: dir }), e => e.status === 409);
  assert.equal(await readFile(path, 'utf8'), stale);
  await rm(path);
  await writeFile(join(dir, 'legacy-claim.json'), '{broken');
  await assert.rejects(createOrganizationManager({ dataDir: dir }));
  await assert.rejects(readFile(path), e => e.code === 'ENOENT');
  await rm(join(dir, 'legacy-claim.json'));
  await manager(t, { dataDir: dir });
});

test('close drains already accepted jobs, is idempotent and rejects stale public handles', async t => {
  const dir = await temporary(t), m = await manager(t, { dataDir: dir }), a = await m.get(A);
  await a.importQueue.enqueue(sample, hash(sample));
  const closing = m.close();
  assert.equal(m.close(), closing);
  await assert.rejects(m.get(B), e => e.status === 503);
  await assert.rejects(a.store.update(state => { state.audit.push({ id: 'late' }); }), e => e.status === 503);
  await assert.rejects(a.importQueue.enqueue(sample, hash(sample)), e => e.status === 503);
  await closing;
  const state = JSON.parse(await readFile(join(dir, 'organizations', A, 'state.json'), 'utf8'));
  assert.equal(state.importJobs[0].status, 'succeeded');
  assert.equal(state.imports.snapshots.length, 1);
  assert.equal(state.audit.length, 0);
});

test('first legacy claim preserves original bytes and migrates isolated demo/import/history once', async t => {
  const dir = await temporary(t), path = join(dir, 'state.json');
  const legacy = stateWithNotes();
  legacy.importWorkspace = stateWithNotes('FICTIEVE importnotitie');
  legacy.imports = applyImport(sample, emptyImportState(), { now: NOW }).state;
  legacy.password = 'synthetic-password-never-copy';
  legacy.accounts = [{ username: 'synthetic-account-never-copy' }];
  legacy.decisions[0].api_key = 'synthetic-key-never-copy';
  const bytes = JSON.stringify(legacy, null, 3) + '\n';
  await writeFile(path, bytes);
  let m = await manager(t, { dataDir: dir, legacyStatePath: path });
  assert.deepEqual(await m.claimLegacy(A), { claimed: true, organizationId: A, reason: 'migrated' });
  await m.idle();
  const target = await (await m.get(A)).store.read();
  assert.equal(target.decisions[0].note, legacy.decisions[0].note);
  assert.equal(target.importWorkspace.tasks.length, 1);
  assert.deepEqual(target.imports, legacy.imports);
  assert.equal(target.password, undefined);
  assert.equal(target.accounts, undefined);
  assert.equal(target.decisions[0].api_key, undefined);
  assert.ok(!JSON.stringify(target).includes('never-copy'));
  assert.equal(await readFile(path, 'utf8'), bytes);
  assert.equal((await m.claimLegacy(A)).reason, 'already_claimed');
  await assert.rejects(m.claimLegacy(B), e => e.status === 409);
  assert.equal((await (await m.get(B)).store.read()).decisions.length, 0);
  await m.close();
  m = await manager(t, { dataDir: dir, legacyStatePath: path });
  assert.equal((await m.claimLegacy(A)).reason, 'already_claimed');
  assert.equal((await (await m.get(A)).store.read()).decisions.length, 1);
  assert.equal(await readFile(path, 'utf8'), bytes);
});

test('existing nonempty target is preserved, including a brief-only workspace', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  await writeFile(source, JSON.stringify(stateWithNotes()));
  const m = await manager(t, { dataDir: dir, legacyStatePath: source }), a = await m.get(A);
  await a.store.update(state => { state.brief.task = 'Existing club requirement'; });
  await assert.rejects(m.claimLegacy(A), e => e.status === 409);
  assert.equal((await a.store.read()).brief.task, 'Existing club requirement');
  assert.equal((await a.store.read()).decisions.length, 0);
  await assert.rejects(readFile(join(dir, 'legacy-claim.json')), e => e.code === 'ENOENT');
});

test('competing legacy claims serialize and copy old data into exactly one organization', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  await writeFile(source, JSON.stringify(stateWithNotes()));
  const m = await manager(t, { dataDir: dir, legacyStatePath: source });
  const [first, second] = await Promise.allSettled([m.claimLegacy(A), m.claimLegacy(B)]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.equal(second.reason.status, 409);
  assert.equal((await (await m.get(A)).store.read()).decisions.length, 1);
  assert.equal((await (await m.get(B)).store.read()).decisions.length, 0);
});

test('migrated interrupted import job recovers once and preserves original legacy queue bytes', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  const legacy = emptyState();
  legacy.importJobs = [{ id: 'synthetic-interrupted-job', snapshotId: sample.snapshotId, digest: hash(sample), status: 'running',
    attempts: 1, maxAttempts: 3, error: null, result: null, payload: sample, createdAt: NOW, updatedAt: NOW }];
  const bytes = JSON.stringify(legacy);
  await writeFile(source, bytes);
  const m = await manager(t, { dataDir: dir, legacyStatePath: source });
  await m.claimLegacy(A);
  await m.idle();
  const state = await (await m.get(A)).store.read();
  assert.equal(state.importJobs[0].status, 'succeeded');
  assert.equal(state.importJobs[0].attempts, 2);
  assert.equal(state.imports.snapshots.length, 1);
  await m.claimLegacy(A);
  assert.equal((await (await m.get(A)).store.read()).importJobs[0].attempts, 2);
  assert.equal(await readFile(source, 'utf8'), bytes);
});

test('no source is a durable first-organization decision; later source cannot leak into another club', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  let m = await manager(t, { dataDir: dir, legacyStatePath: source });
  assert.equal((await m.claimLegacy(A)).reason, 'no_legacy_state');
  await m.close();
  await writeFile(source, JSON.stringify(stateWithNotes()));
  m = await manager(t, { dataDir: dir, legacyStatePath: source });
  assert.equal((await m.claimLegacy(A)).reason, 'no_legacy_state');
  await assert.rejects(m.claimLegacy(B), e => e.status === 409);
  assert.equal((await (await m.get(A)).store.read()).decisions.length, 0);
});

test('malformed legacy state and invalid snapshot digest leave source and target unchanged', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  const invalid = [null, { ...emptyState(), version: 2 }, { ...emptyState(), decisions: {} },
    { ...emptyState(), importWorkspace: {} }, { ...emptyState(), imports: { schemaVersion: 1, snapshots: [{}], history: [] } },
    { ...emptyState(), importJobs: [{ id: 'wrong', status: 'running' }] }];
  const withDigest = stateWithNotes();
  withDigest.imports = applyImport(sample, emptyImportState(), { now: NOW }).state;
  withDigest.imports.snapshots[0].digest = '0'.repeat(64);
  invalid.push(withDigest);
  for (const item of invalid) {
    const bytes = JSON.stringify(item);
    await writeFile(source, bytes);
    const m = await createOrganizationManager({ dataDir: dir, legacyStatePath: source, now: () => NOW });
    try {
      await assert.rejects(m.claimLegacy(A), e => e.status === 409);
      assert.equal(await readFile(source, 'utf8'), bytes);
      await assert.rejects(m.get(A), e => e.status === 409);
      assert.equal(JSON.parse(await readFile(join(dir, 'legacy-claim.json'), 'utf8')).digest, null);
    } finally { await m.close(); }
  }
});

test('malformed first source reserves its organization durably and repaired source cannot be claimed by another', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json');
  await writeFile(source, '{invalid legacy');
  let m = await manager(t, { dataDir: dir, legacyStatePath: source });
  await assert.rejects(m.claimLegacy(A), e => e.status === 409);
  await assert.rejects(m.get(A), e => e.status === 409);
  await assert.rejects(m.stats(A), e => e.status === 409);
  await m.close();
  await writeFile(source, JSON.stringify(stateWithNotes()));
  m = await manager(t, { dataDir: dir, legacyStatePath: source });
  await assert.rejects(m.claimLegacy(B), e => e.status === 409);
  assert.equal((await m.claimLegacy(A)).claimed, true);
  assert.equal((await (await m.get(A)).store.read()).decisions.length, 1);
  assert.equal((await (await m.get(B)).store.read()).decisions.length, 0);
});

test('target-write failure retains pending claim and retries without partial in-memory data', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json'), target = join(dir, 'organizations', A, 'state.json');
  const bytes = JSON.stringify(stateWithNotes());
  await writeFile(source, bytes);
  let ticks = 0;
  const m = await manager(t, { dataDir: dir, legacyStatePath: source, now: () => {
    ticks += 1;
    // acquire, claim prepared, then receipt in the atomic store callback.
    if (ticks === 3) mkdirSync(target);
    return NOW;
  } });
  await assert.rejects(m.claimLegacy(A));
  assert.equal(JSON.parse(await readFile(join(dir, 'legacy-claim.json'), 'utf8')).status, 'pending');
  await assert.rejects(m.get(A), e => e.status === 409);
  assert.equal(await readFile(source, 'utf8'), bytes);
  await rmdir(target);
  assert.equal((await m.claimLegacy(A)).claimed, true);
  const state = await (await m.get(A)).store.read();
  assert.equal(state.decisions.length, 1);
  assert.equal(state.tasks.length, 1);
});

test('restart recovers target commit whose completion-marker write failed, without rereading source', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json'), journal = join(dir, 'legacy-claim.json'), backup = join(dir, 'pending-claim.json');
  const bytes = JSON.stringify(stateWithNotes());
  await writeFile(source, bytes);
  let ticks = 0;
  let m = await manager(t, { dataDir: dir, legacyStatePath: source, now: () => {
    ticks += 1;
    if (ticks === 4) { renameSync(journal, backup); mkdirSync(journal); }
    return NOW;
  } });
  await assert.rejects(m.claimLegacy(A));
  const committed = JSON.parse(await readFile(join(dir, 'organizations', A, 'state.json'), 'utf8'));
  assert.equal(committed.decisions.length, 1);
  assert.equal(committed._legacyMigration.organizationId, A);
  await rmdir(journal);
  await rename(backup, journal);
  await m.close();
  // Missing legacy cannot prevent recognizing the already-committed durable receipt.
  await rename(source, join(dir, 'preserved-original.json'));
  m = await manager(t, { dataDir: dir, legacyStatePath: source });
  assert.equal((await m.claimLegacy(A)).reason, 'recovered_completed_claim');
  assert.equal((await (await m.get(A)).store.read()).decisions.length, 1);
  assert.equal(await readFile(join(dir, 'preserved-original.json'), 'utf8'), bytes);
  assert.equal(JSON.parse(await readFile(journal, 'utf8')).status, 'complete');
});

test('changed pending source is refused and cannot redirect claim to another organization', async t => {
  const dir = await temporary(t), source = join(dir, 'state.json'), target = join(dir, 'organizations', A, 'state.json');
  await writeFile(source, JSON.stringify(stateWithNotes()));
  let ticks = 0;
  const m = await manager(t, { dataDir: dir, legacyStatePath: source, now: () => {
    if (++ticks === 3) mkdirSync(target);
    return NOW;
  } });
  await assert.rejects(m.claimLegacy(A));
  await rmdir(target);
  await writeFile(source, JSON.stringify(stateWithNotes('changed source')));
  await assert.rejects(m.claimLegacy(A), e => e.status === 409 && /gewijzigd/.test(e.message));
  await assert.rejects(m.claimLegacy(B), e => e.status === 409);
});

test('normal failed persistence preserves organization state and later writes can recover', async t => {
  const dir = await temporary(t), m = await manager(t, { dataDir: dir }), a = await m.get(A);
  await m.idle();
  await a.store.update(state => Object.assign(state, stateWithNotes('before failure')));
  const folder = join(dir, 'organizations', A), saved = join(dir, 'saved-org');
  await rename(folder, saved);
  await writeFile(folder, 'synthetic blocker');
  await assert.rejects(a.store.update(state => { state.decisions[0].note = 'should not commit'; }));
  assert.equal((await a.store.read()).decisions[0].note, 'before failure');
  await rm(folder);
  await rename(saved, folder);
  await a.store.update(state => { state.decisions[0].note = 'after recovery'; });
  assert.equal((await a.store.read()).decisions[0].note, 'after recovery');
});

test('organization directory junctions/symlinks cannot redirect writes outside the data directory', async t => {
  const dir = await temporary(t), outside = await temporary(t), m = await manager(t, { dataDir: dir });
  const link = join(dir, 'organizations', A);
  try { await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'ENOTSUP'].includes(e.code)) { t.skip('OS cannot create the synthetic link fixture.'); return; } throw e; }
  await assert.rejects(m.get(A), e => e.status === 409);
  await assert.rejects(readFile(join(outside, 'state.json')), e => e.code === 'ENOENT');
});

test('stats expose only sanitized counts, limits and storage mode for the requested organization', async t => {
  const m = await manager(t), a = await m.get(A);
  await a.store.update(state => { Object.assign(state, stateWithNotes('sensitive-source-contents')); state.importWorkspace = stateWithNotes('import-secret-note'); });
  await a.importQueue.enqueue(sample, hash(sample));
  await m.idle();
  const stats = await m.stats(A), other = await m.stats(B);
  assert.equal(stats.mode, 'memory');
  assert.equal(stats.counts.demo.tasks, 1);
  assert.equal(stats.counts.import.decisions, 1);
  assert.equal(stats.counts.snapshots, 1);
  assert.equal(stats.counts.jobs, 1);
  assert.equal(stats.limits.importJobs, 200);
  assert.equal(stats.limits.pendingImportJobs, 20);
  assert.equal(other.counts.snapshots, 0);
  assert.equal(other.counts.demo.tasks, 0);
  assert.ok(!JSON.stringify(stats).includes('sensitive-source-contents'));
  assert.ok(!JSON.stringify(stats).includes('import-secret-note'));
  assert.ok(!JSON.stringify(stats).includes(sample.players[0].name));
});
