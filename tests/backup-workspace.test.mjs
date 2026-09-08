import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStore, emptyState } from '../src/store.mjs';
import { CATALOG } from '../src/fixtures.mjs';
import { createImportQueue } from '../src/ingestion/index.mjs';
import { applyImport, emptyImportState, previewImport, rollbackImport } from '../src/import/index.mjs';
import { createWorkspaceBackup, inspectWorkspaceBackup, validateWorkspaceState, stateDigest, retentionPreview, MAX_WORKSPACE_BACKUP_BYTES } from '../src/backup/workspace.mjs';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-09-08T12:00:00.000Z', LATER = '2026-09-09T12:00:00.000Z';
const SAMPLE = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const digest = payload => previewImport(payload, emptyImportState(), { now: NOW }).digest;
function notes(state, dataset = 'demo', at = NOW) {
  const target = dataset === 'demo' ? state : (state.importWorkspace ??= emptyState());
  const playerId = dataset === 'demo' ? CATALOG.players[0].id : SAMPLE.players[0].id;
  target.decisions.push({ id: 'synthetic-decision', playerId, action: 'follow', reason: 'positive', note: 'FICTIEVE notitie <script>inert</script>', at });
  target.tasks.push({ id: 'synthetic-task', playerId, question: 'FICTIEVE onderzoeksvraag', requestId: 'synthetic-request', status: 'todo', result: '', at, completedAt: null });
  target.audit.push({ id: 'synthetic-audit', action: 'decision.created', objectId: 'synthetic-decision', detail: 'FICTIEVE provenance', at, actor: 'local-demo-user' });
}
async function imported() {
  const store = await createStore(), queue = await createImportQueue({ store, now: () => NOW });
  await queue.enqueue(SAMPLE, digest(SAMPLE)); await queue.idle();
  const state = await store.read(); notes(state); notes(state, 'import'); return state;
}
const backup = state => createWorkspaceBackup({ organizationId: A, organizationName: 'FICTIEVE club A', state, now: NOW });
const inspect = (bundle, options = {}) => inspectWorkspaceBackup(bundle, { organizationId: A, now: NOW, ...options });

test('workspace backup preserves both datasets, original snapshots, jobs, actors and inert notes without changing input', async () => {
  const state = await imported(), before = structuredClone(state), bundle = backup(state);
  assert.deepEqual(state, before);
  assert.equal(bundle.format, 'omniscout-workspace');
  assert.equal(bundle.organization.id, A);
  const restored = inspect(bundle);
  assert.deepEqual(restored.state, state);
  assert.equal(restored.digest, stateDigest(state));
  assert.equal(restored.summary.counts.demo.decisions, 1);
  assert.equal(restored.summary.counts.import.tasks, 1);
  assert.equal(restored.summary.counts.jobs, 1);
  assert.equal(restored.summary.counts.snapshots, 1);
  assert.equal(restored.summary.counts.players, SAMPLE.players.length);
  assert.equal(restored.state.audit[0].actor, 'local-demo-user');
  assert.deepEqual(restored.state.imports.snapshots[0].payload, SAMPLE);
  restored.state.decisions[0].note = 'changed copy';
  assert.deepEqual(state, before);
});

test('digest is deterministic across object order while every state value remains significant', () => {
  const state = emptyState(), reversed = Object.fromEntries(Object.entries(state).reverse());
  assert.equal(stateDigest(state), stateDigest(reversed));
  reversed.brief = { ...reversed.brief, task: 'different' };
  assert.notEqual(stateDigest(state), stateDigest(reversed));
});

test('restore rejects wrong club, version, tampered digest, forged summary, metadata and unknown credentials', () => {
  const original = backup(emptyState());
  assert.throws(() => inspect(original, { organizationId: B }), e => e.status === 403);
  for (const change of [
    bundle => { bundle.version = 2; }, bundle => { bundle.digest = '0'.repeat(64); },
    bundle => { bundle.summary.counts.jobs = 999; }, bundle => { bundle.createdAt = LATER; },
    bundle => { bundle.password = 'synthetic-secret'; }, bundle => { bundle.state.accounts = []; },
    bundle => { bundle.state._legacyMigration = { token: 'synthetic' }; }, bundle => { bundle.state._workspaceRestore = {}; },
    bundle => { bundle.organization.extra = 'unexpected'; }
  ]) { const changed = structuredClone(original); change(changed); assert.throws(() => inspect(changed), e => e.status === 400); }
});

test('strict state validation rejects malformed work, missing references, duplicate IDs and unknown nested fields', async () => {
  const original = await imported();
  for (const change of [
    state => { state.decisions[0].password = 'synthetic-secret'; }, state => { state.decisions[0].playerId = 'missing-player'; },
    state => { state.decisions[0].action = { toString: null }; }, state => { state.brief.role = { toString: null }; },
    state => { state.decisions.push(structuredClone(state.decisions[0])); }, state => { state.tasks[0].completedAt = NOW; },
    state => { state.tasks[0].status = 'done'; }, state => { state.audit[0].objectId = 'missing-decision'; },
    state => { state.brief.minAge = 12; }, state => { state.importWorkspace.tasks[0].playerId = 'missing-player'; },
    state => { state.imports.snapshots[0].digest = '0'.repeat(64); }, state => { state.imports.history = []; },
    state => { state.imports.snapshots[0].digest = { toString: null }; },
    state => { state.imports.history[0].snapshotId = 'missing'; }, state => { state.importJobs[0].result.playerCount += 1; },
    state => { state.importJobs[0].payload.source.extra = 'unknown'; }, state => { state.importJobs.push(structuredClone(state.importJobs[0])); }
  ]) { const state = structuredClone(original); change(state); assert.throws(() => backup(state), e => e.status === 400); }
});

test('bounded JSON rejects oversized, circular, deep, sparse, accessor and prototype-bearing input', () => {
  const tooLarge = emptyState(); tooLarge.brief.task = 'x'.repeat(MAX_WORKSPACE_BACKUP_BYTES);
  assert.throws(() => backup(tooLarge), e => e.status === 413);
  const circular = emptyState(); circular.extra = circular;
  assert.throws(() => backup(circular), e => e.status === 400);
  const deep = emptyState(); let cursor = deep;
  for (let index = 0; index < 26; index += 1) cursor = cursor.nested = {};
  assert.throws(() => backup(deep), e => e.status === 400);
  const sparse = emptyState(); sparse.decisions = new Array(3);
  assert.throws(() => backup(sparse), e => e.status === 400);
  let invoked = false; const getter = emptyState();
  Object.defineProperty(getter, 'extra', { enumerable: true, get() { invoked = true; return 'never'; } });
  assert.throws(() => backup(getter), e => e.status === 400); assert.equal(invoked, false);
  const prototype = JSON.parse('{"version":1,"decisions":[],"tasks":[],"audit":[],"brief":{"__proto__":{}}}');
  assert.throws(() => backup(prototype), e => e.status === 400);
});

test('all retained snapshots require current export/store rights even after rollback and expiry', () => {
  for (const denied of ['export', 'store']) {
    const payload = structuredClone(SAMPLE);
    if (denied === 'export') payload.source.allowedUses = payload.source.allowedUses.filter(use => use !== 'export');
    else payload.source.expiresAt = LATER;
    let imports = applyImport(payload, emptyImportState(), { now: NOW }).state;
    imports = rollbackImport(payload.snapshotId, imports, { now: NOW }).state;
    const state = { ...emptyState(), imports };
    const at = denied === 'store' ? LATER : NOW;
    assert.throws(() => createWorkspaceBackup({ organizationId: A, organizationName: 'FICTIEF', state, now: at }), e => e.status === 403);
    const report = retentionPreview(state, { now: at, days: 1 });
    assert.equal(report.destructive, false); assert.ok(report.counts.rightsBlocks > 0);
  }
  const payload = structuredClone(SAMPLE); payload.source.expiresAt = LATER;
  const bundle = backup({ ...emptyState(), imports: applyImport(payload, emptyImportState(), { now: NOW }).state });
  assert.throws(() => inspect(bundle, { now: LATER }), e => e.status === 403);
});

test('failed retained job payloads also require export rights even with no imported catalog', () => {
  const payload = structuredClone(SAMPLE); payload.source.allowedUses = payload.source.allowedUses.filter(use => use !== 'export');
  const state = { ...emptyState(), importJobs: [{ id: 'synthetic-failed-job', snapshotId: payload.snapshotId, digest: digest(payload), status: 'failed',
    attempts: 1, maxAttempts: 3, error: { message: 'synthetic failure', status: 500, details: [] }, result: null, createdAt: NOW, updatedAt: NOW, payload }] };
  assert.throws(() => backup(state), e => e.status === 403);
  const report = retentionPreview(state, { now: NOW });
  assert.equal(report.counts.rightsBlocks, 1);
  assert.equal(report.items.find(item => item.rightsBlocked).id, 'job:synthetic-failed-job');
});

test('pending jobs are refused for backup but visible in non-destructive retention preview', () => {
  for (const status of ['queued', 'running']) {
    const state = { ...emptyState(), importJobs: [{ id: 'pending-job', snapshotId: SAMPLE.snapshotId, digest: digest(SAMPLE), status,
      attempts: status === 'running' ? 1 : 0, maxAttempts: 3, error: null, result: null, createdAt: NOW, updatedAt: NOW, payload: SAMPLE }] };
    assert.throws(() => backup(state), e => e.status === 409);
    const report = retentionPreview(state, { now: NOW });
    assert.equal(report.counts.pendingJobs, 1);
    assert.ok(report.items.some(item => item.kind === 'job' && item.activeDependency));
    assert.equal(report.destructive, false);
  }
});

test('correction and rollback history is preserved; dependency violations cannot be imported as a backup', () => {
  let imports = applyImport(SAMPLE, emptyImportState(), { now: NOW }).state;
  const corrected = structuredClone(SAMPLE); corrected.snapshotId = 'synthetic-correction'; corrected.correctionOf = SAMPLE.snapshotId; corrected.asOf = LATER;
  imports = applyImport(corrected, imports, { now: LATER }).state;
  const good = { ...emptyState(), imports };
  const bundle = createWorkspaceBackup({ organizationId: A, organizationName: 'FICTIEF', state: good, now: LATER });
  assert.deepEqual(inspect(bundle, { now: LATER }).state.imports, imports);
  const bad = structuredClone(good); bad.imports.history.push({ id: 'invalid-rollback', type: 'rollback', snapshotId: SAMPLE.snapshotId, at: LATER });
  assert.throws(() => validateWorkspaceState(bad, { now: LATER }), e => e.status === 400);
});

test('retention bounds rows and separates old candidates, live dependencies and rights without leaking notes', () => {
  const state = emptyState(), old = '2020-01-01T00:00:00.000Z';
  notes(state, 'demo', old);
  for (let index = 1; index < 250; index += 1) state.decisions.push({ ...state.decisions[0], id: `old-${index}` });
  const before = structuredClone(state), report = retentionPreview(state, { now: NOW });
  assert.deepEqual(state, before);
  assert.equal(report.days, 365); assert.equal(report.destructive, false); assert.equal(report.truncated, true);
  assert.equal(report.items.length, 200); assert.equal(report.counts.returnedItems, 200);
  assert.equal(report.counts.ageCandidates, 252);
  assert.ok(report.counts.activeDependencies >= 3);
  assert.ok(!JSON.stringify(report).includes('FICTIEVE notitie'));
  assert.ok(report.warnings.some(warning => warning.includes('niets verwijderd')));
  for (const days of [0, 3651, 1.5, '365', NaN]) assert.throws(() => retentionPreview(state, { now: NOW, days }), e => e.status === 400);
});
