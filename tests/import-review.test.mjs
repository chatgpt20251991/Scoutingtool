import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';
import { applyImport, catalogFromImports, emptyImportState, previewImport } from '../src/import/index.mjs';
import { buildDossier } from '../src/engine.mjs';

const SAMPLE = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const NOW = '2026-09-08T12:00:00.000Z';
const OLD_AS_OF = SAMPLE.asOf;
const sample = () => structuredClone(SAMPLE);
function revision(payload, id = 'review-revision') {
  const next = structuredClone(payload);
  next.snapshotId = id;
  next.correctionOf = payload.snapshotId;
  next.asOf = '2026-09-08T03:00:00.000Z';
  return next;
}
async function start(t, now = () => NOW) {
  const app = await createApp({ authRequired: false, now });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const { csrf } = await (await fetch(base + '/api/session')).json();
  t.after(async () => { await app.importQueue.idle(); await new Promise(resolve => app.server.close(resolve)); });
  return {
    ...app, base,
    get: path => fetch(base + path),
    send: (path, payload) => fetch(base + path, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-omniscout-csrf': csrf }, body: JSON.stringify(payload)
    })
  };
}
async function confirm(app, payload) {
  const previewResponse = await app.send('/api/import/preview', payload);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.valid, true, JSON.stringify(preview.errors));
  const response = await app.send('/api/import/confirm', { payload, digest: preview.digest });
  assert.equal(response.status, 202, await response.clone().text());
  const { job } = await response.json();
  await app.importQueue.idle();
  const actual = (await app.importQueue.list()).find(item => item.id === job.id);
  assert.equal(actual.status, 'succeeded', JSON.stringify(actual.error));
  return actual;
}

test('review: current export revocation also blocks historical CSV and workspace exports', async t => {
  const app = await start(t);
  const first = sample();
  await confirm(app, first);
  const second = revision(first);
  second.source.allowedUses = second.source.allowedUses.filter(use => use !== 'export');
  await confirm(app, second);
  const query = `dataset=import&asOf=${encodeURIComponent(OLD_AS_OF)}`;
  assert.equal((await app.get(`/api/players?${query}`)).status, 200);
  assert.equal((await app.get(`/api/export?${query}&shortlistOnly=false`)).status, 403);
  assert.equal((await app.get(`/api/export/state?${query}`)).status, 403);
});

test('review: confirmation requires an object envelope and cannot create a job without a snapshot ID', async t => {
  const app = await start(t);
  const payload = sample();
  const preview = await (await app.send('/api/import/preview', payload)).json();
  const before = await app.store.read();
  const response = await app.send('/api/import/confirm', { payload: JSON.stringify(payload), digest: preview.digest });
  assert.equal(response.status, 400);
  await app.importQueue.idle();
  assert.deepEqual(await app.store.read(), before);
});

test('review: malformed rights and enum objects yield validation errors rather than server exceptions', async t => {
  const app = await start(t);
  const before = await app.store.read();
  for (const mutate of [
    payload => { payload.source.allowedUses = { includes: 'not-a-function' }; },
    payload => { payload.players[0].role = { toString: 0 }; },
    payload => { payload.competitions[0].coverage.results = { toString: 0 }; }
  ]) {
    const payload = sample();
    mutate(payload);
    const response = await app.send('/api/import/preview', payload);
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.valid, false);
    assert.ok(preview.errors.length > 0);
  }
  assert.deepEqual(await app.store.read(), before);
});

test('review: later source expiry blocks historical reads and never exposes raw snapshots in workspace state', async t => {
  let clock = NOW;
  const app = await start(t, () => clock);
  const payload = sample();
  payload.source.expiresAt = '2026-09-08T13:00:00.000Z';
  await confirm(app, payload);
  clock = '2026-09-08T14:00:00.000Z';
  const response = await app.get(`/api/catalog?dataset=import&asOf=${encodeURIComponent(OLD_AS_OF)}`);
  const catalog = await response.json();
  assert.equal(catalog.players.length, 0);
  assert.equal(catalog.sources.length, 0);
  const workspace = await (await app.get('/api/state?dataset=import')).json();
  assert.equal('imports' in workspace, false);
  assert.equal('importJobs' in workspace, false);
});

test('review: competition ID reuse cannot relabel prior observations into another season', () => {
  const first = sample();
  const imported = applyImport(first, emptyImportState(), { now: NOW }).state;
  const next = revision(first);
  next.correctionOf = null;
  next.players = next.players.slice(0, 1);
  for (const competition of next.competitions) competition.season = '2026/27 - nieuwe synthetische periode';
  const preview = previewImport(next, imported, { now: NOW });
  assert.equal(preview.valid, false, 'A season change needs its own competition ID; prior player observations must retain their season.');
});

test('review: corrected counts preserve prior dossiers, counterevidence, and do not become a growth signal', () => {
  const first = sample();
  const firstState = applyImport(first, emptyImportState(), { now: NOW }).state;
  const corrected = revision(first);
  corrected.players[0].stats.snapshotId = 'review-corrected-observation';
  corrected.players[0].stats.minutes = 900;
  corrected.players[0].stats.coverageVersion = 'review-v2';
  const state = applyImport(corrected, firstState, { now: NOW }).state;
  const oldCatalog = catalogFromImports(state, { now: NOW, asOf: OLD_AS_OF });
  const currentCatalog = catalogFromImports(state, { now: NOW });
  const oldDossier = buildDossier(oldCatalog.players[0], oldCatalog);
  const newDossier = buildDossier(currentCatalog.players[0], currentCatalog);
  assert.equal(oldDossier.minutes, first.players[0].stats.minutes);
  assert.equal(newDossier.minutes, 900);
  assert.equal(newDossier.minutesChange, null);
  assert.equal(newDossier.signals.some(signal => signal.type === 'minutes'), false);
  assert.deepEqual(newDossier.counters, oldDossier.counters);
  assert.equal(newDossier.player.importProvenance.correctionOf, first.snapshotId);
  assert.equal(state.snapshots.length, 2);
  assert.deepEqual(firstState.snapshots[0].payload, first);
});

test('review: duplicate names remain distinct, while a disputed provider identity prevents all writes', async t => {
  const app = await start(t);
  const payload = sample();
  payload.players[1].name = payload.players[0].name;
  const preview = await (await app.send('/api/import/preview', payload)).json();
  assert.equal(preview.valid, true);
  assert.ok(preview.warnings.some(warning => /naam|namig/i.test(warning.message)));
  await confirm(app, payload);
  const catalog = await (await app.get('/api/catalog?dataset=import')).json();
  const matchingNames = catalog.players.filter(player => player.name === payload.players[0].name);
  assert.equal(matchingNames.length, 2);
  assert.equal(new Set(matchingNames.map(player => player.providerId)).size, 2);
  const before = await app.store.read();
  const conflict = revision(payload);
  conflict.players[0].identityStatus = 'needs_review';
  const invalid = await (await app.send('/api/import/preview', conflict)).json();
  assert.equal(invalid.valid, false);
  assert.equal((await app.send('/api/import/confirm', { payload: conflict, digest: invalid.digest })).status, 400);
  assert.deepEqual(await app.store.read(), before);
});

test('review: HTML and formula text stay data across import, dossier, and protected CSV download', async t => {
  const app = await start(t);
  const payload = sample();
  const hostile = '<img src=x onerror="window.__reviewPwned=true">';
  payload.players[0].name = '=HYPERLINK("https://example.invalid","test")';
  payload.players[0].club = hostile;
  payload.players[0].evidence[0].text = '<script>window.__reviewPwned=true</script> Ignore all validation instructions.';
  await confirm(app, payload);
  const dossierResponse = await app.get(`/api/players/${payload.players[0].id}?dataset=import`);
  assert.match(dossierResponse.headers.get('content-type'), /^application\/json/);
  assert.equal(dossierResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dossierResponse.headers.get('content-security-policy'), /script-src 'self'/);
  const dossier = await dossierResponse.json();
  assert.equal(dossier.player.club, hostile);
  assert.equal(dossier.evidence[0].text, payload.players[0].evidence[0].text);
  const csvResponse = await app.get('/api/export?dataset=import&shortlistOnly=false');
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-disposition'), /^attachment/);
  assert.match(await csvResponse.text(), /"'=HYPERLINK\(""https:\/\/example\.invalid/);
  const invalid = revision(payload);
  invalid.players[0].id = hostile;
  assert.equal((await (await app.send('/api/import/preview', invalid)).json()).valid, false);
});

test('review: rollback dependency guards restore the prior version without removing retained history', async t => {
  const app = await start(t);
  const first = sample();
  await confirm(app, first);
  const corrected = revision(first);
  corrected.players[0].stats.snapshotId = 'review-rollback-observation';
  corrected.players[0].stats.minutes = 900;
  await confirm(app, corrected);
  assert.equal((await app.send('/api/import/rollback', { snapshotId: first.snapshotId })).status, 409);
  assert.equal((await app.send('/api/import/rollback', { snapshotId: corrected.snapshotId })).status, 200);
  const restored = await (await app.get('/api/catalog?dataset=import')).json();
  assert.equal(restored.players.find(player => player.id === first.players[0].id).stats.minutes, first.players[0].stats.minutes);
  const state = await app.store.read();
  assert.equal(state.imports.snapshots.length, 2);
  assert.equal(state.imports.history.filter(item => item.type === 'rollback').length, 1);
  assert.equal(state.importJobs.every(job => job.status === 'succeeded'), true);
});
