import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, rename, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';

const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const now = () => '2026-09-08T12:00:00.000Z';
async function start(statePath = null) {
  const app = await createApp({ statePath, now });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const { csrf } = await (await fetch(base + '/api/session')).json();
  return { ...app, base,
    get: async path => { const response = await fetch(base + path); return { status: response.status, data: await response.json() }; },
    send: (path, payload, method = 'POST', headers = {}) => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, 'x-omniscout-csrf': csrf, ...headers }, body: JSON.stringify(payload) }),
    close: async () => { await app.importQueue.idle(); await new Promise(resolve => app.server.close(resolve)); }
  };
}
async function importSample(app, payload = sample) {
  const previewResponse = await app.send('/api/import/preview', payload);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.valid, true, JSON.stringify(preview.errors));
  const response = await app.send('/api/import/confirm', { payload, digest: preview.digest });
  assert.equal(response.status, 202, await response.clone().text());
  await app.importQueue.idle();
  const jobs = (await app.get('/api/import/jobs')).data.jobs;
  assert.equal(jobs.at(-1).status, 'succeeded', JSON.stringify(jobs));
  return { preview, jobs };
}

test('import preview writes nothing; malformed, oversized and unauthorized imports leave state unchanged', async () => {
  const app = await start();
  try {
    const before = await app.store.read();
    const preview = await (await app.send('/api/import/preview', sample)).json();
    assert.equal(preview.valid, true, JSON.stringify(preview.errors));
    assert.deepEqual(await app.store.read(), before);
    const invalid = structuredClone(sample); invalid.schemaVersion = 999;
    assert.equal((await (await app.send('/api/import/preview', invalid)).json()).valid, false);
    assert.equal((await app.send('/api/import/confirm', { payload: invalid, digest: preview.digest })).status, 400);
    assert.equal((await app.send('/api/import/confirm', { payload: sample, digest: 'changed' })).status, 409);
    assert.equal((await app.send('/api/import/preview', { padding: 'x'.repeat(1024 * 1024) })).status, 413);
    assert.equal((await app.send('/api/import/preview', sample, 'POST', { 'x-omniscout-csrf': '' })).status, 403);
    const malformed = await fetch(app.base + '/api/import/preview', { method: 'POST', headers: { 'content-type': 'application/json', origin: app.base, 'x-omniscout-csrf': (await app.get('/api/session')).data.csrf }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await app.store.read(), before);
  } finally { await app.close(); }
});

test('import, dossier, shortlist, research, CSV, duplicate import and restart use one durable isolated workspace', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-import-api-'));
  let app = await start(join(dir, 'state.json'));
  try {
    await importSample(app);
    const imported = (await app.get('/api/catalog?dataset=import')).data;
    assert.equal(imported.players.length, sample.players.length);
    const id = imported.players[0].id;
    assert.equal((await app.get('/api/players/' + id + '?dataset=import')).status, 200);
    assert.equal((await app.get('/api/catalog')).data.players.length, 12);
    assert.equal((await app.send('/api/decisions?dataset=import', { dataset: 'import', playerId: id, action: 'follow', reason: 'positive', note: 'Synthetische API-test.' })).status, 201);
    assert.equal((await app.get('/api/state')).data.decisions.length, 0);
    assert.equal('imports' in (await app.get('/api/state')).data, false);
    assert.equal('imports' in (await app.get('/api/export/state')).data, false);
    assert.equal((await app.send('/api/decisions?dataset=demo', { dataset: 'import', playerId: id, action: 'follow', reason: 'positive' })).status, 400);
    const taskResponse = await app.send('/api/tasks?dataset=import', { dataset: 'import', playerId: id, requestId: 'import-research-1', question: 'Controleer volledig synthetisch tegenbewijs.' });
    assert.equal(taskResponse.status, 201); const task = await taskResponse.json();
    assert.equal((await app.send('/api/tasks/' + task.id + '?dataset=import', { dataset: 'import', status: 'done', result: 'Nog onvoldoende waarnemingen.' }, 'PATCH')).status, 200);
    const csv = await fetch(app.base + '/api/export?dataset=import'); assert.equal(csv.status, 200); assert.match(await csv.text(), /FICTIEF/);
    await importSample(app);
    assert.equal((await app.get('/api/catalog?dataset=import')).data.players.length, imported.players.length);
    assert.equal((await app.get('/api/import/jobs')).data.jobs.length, 1);
    await app.close(); app = await start(join(dir, 'state.json'));
    assert.equal((await app.get('/api/state?dataset=import')).data.decisions.length, 1);
    assert.equal((await app.get('/api/state?dataset=import')).data.tasks[0].status, 'done');
    assert.equal((await app.get('/api/catalog?dataset=import')).data.players.length, sample.players.length);
    const restored = await app.send('/api/import/rollback', { snapshotId: sample.snapshotId });
    assert.equal(restored.status, 200, await restored.clone().text());
    assert.equal((await app.get('/api/catalog?dataset=import')).data.players.length, 0);
    assert.equal((await fetch(app.base + '/api/export/state?dataset=import')).status, 403);
    assert.equal((await app.get('/api/catalog')).data.players.length, 12);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an importer cannot bypass separate export rights through CSV or workspace JSON', async () => {
  const app = await start();
  try {
    const payload = structuredClone(sample); payload.source.allowedUses = payload.source.allowedUses.filter(use => use !== 'export');
    await importSample(app, payload);
    assert.equal((await fetch(app.base + '/api/export?dataset=import&shortlistOnly=false')).status, 403);
    assert.equal((await fetch(app.base + '/api/export/state?dataset=import')).status, 403);
  } finally { await app.close(); }
});

test('filesystem replacement failure preserves the previous in-memory and durable state and allows recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-storage-failure-'));
  const path = join(dir, 'state.json'), backup = join(dir, 'prior.json');
  try {
    const store = await createStore(path);
    await store.update(state => { state.audit.push({ action: 'prior-valid' }); return true; });
    await rename(path, backup); await mkdir(path);
    await assert.rejects(store.update(state => { state.audit.push({ action: 'must-not-persist' }); return true; }));
    assert.equal((await store.read()).audit.length, 1);
    assert.equal(JSON.parse(await readFile(backup, 'utf8')).audit.length, 1);
    await rm(path, { recursive: true }); await rename(backup, path);
    await store.update(state => { state.audit.push({ action: 'recovered' }); return true; });
    assert.equal((await (await createStore(path)).read()).audit.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
