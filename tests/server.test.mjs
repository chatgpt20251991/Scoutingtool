import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';
let server, base, csrf;
test.before(async () => {
  ({ server } = await createApp({ authRequired: false }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  csrf = (await (await fetch(`${base}/api/session`)).json()).csrf;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
const send = (path, data, method = 'POST', headers = {}) => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, 'x-omniscout-csrf': csrf, ...headers }, body: JSON.stringify(data) });
test('health explicitly states synthetic demo and zero live sources', async () => { const r = await fetch(base + '/api/health'); assert.equal(r.status, 200); const data = await r.json(); assert.equal(data.liveSources, 0); assert.equal(data.productionReady, false); });
test('HTTP serves only known public files, not the repository', async () => { assert.equal((await fetch(base)).status, 200); for (const path of ['/.env', '/src/server.mjs', '/package.json', '/.local/state.json', '/unknown']) assert.equal((await fetch(base + path)).status, 404); });
test('security headers block framing and arbitrary script origins', async () => { const r = await fetch(base); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(r.headers.get('access-control-allow-origin'), null); });
test('DNS rebinding-style hostnames are denied', async () => { const status = await new Promise((resolve, reject) => { const request = http.get(base + '/api/session', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); }); assert.equal(status, 403); });
test('writes require a valid session token', async () => { const r = await send('/api/decisions', { playerId: 'p01', action: 'follow', reason: 'positive' }, 'POST', { 'x-omniscout-csrf': '' }); assert.equal(r.status, 403); });
test('cross-origin and cross-site requests are denied', async () => { assert.equal((await send('/api/decisions', {}, 'POST', { origin: 'https://attacker.example' })).status, 403); const r = await fetch(base + '/api/session', { headers: { 'sec-fetch-site': 'cross-site' } }); assert.equal(r.status, 403); });
test('Unicode session-token input does not trigger a server exception', async () => { const r = await send('/api/decisions', {}, 'POST', { 'x-omniscout-csrf': 'é'.repeat(64) }); assert.equal(r.status, 403); });
test('API search filters synthetic players', async () => { const data = await (await fetch(base + '/api/players?role=GK')).json(); assert.equal(data.results.length, 1); assert.equal(data.results[0].player.role, 'GK'); });
test('unknown player IDs cannot be saved', async () => { const r = await send('/api/decisions', { playerId: 'private-club-player', action: 'follow', reason: 'positive' }); assert.equal(r.status, 404); });
test('invalid actions and unsupported request content are rejected', async () => { assert.equal((await send('/api/decisions', { playerId: 'p01', action: 'buy_player', reason: 'positive' })).status, 400); assert.equal((await send('/api/decisions', {}, 'POST', { 'content-type': 'text/plain' })).status, 415); });
test('archive decisions require a note and preserve a budget reason', async () => {
  assert.equal((await send('/api/decisions', { playerId: 'p01', action: 'archive', reason: 'budget', note: '' })).status, 400);
  const r = await send('/api/decisions', { playerId: 'p01', action: 'archive', reason: 'budget', note: 'Totale kosten zijn nog niet geverifieerd.' });
  assert.equal(r.status, 201); const decision = await r.json(); assert.equal(decision.reason, 'budget'); assert.equal('talentLabel' in decision, false);
});
test('shortlist decisions persist and are recorded in audit events', async () => { const r = await send('/api/decisions', { playerId: 'p02', action: 'follow', reason: 'positive', note: 'Vervolgonderzoek.' }); assert.equal(r.status, 201); const data = await (await fetch(base + '/api/state')).json(); assert.ok(data.decisions.some(d => d.playerId === 'p02')); assert.ok(data.audit.some(d => d.action === 'decision.created')); });
test('retrying the same research request does not create a duplicate', async () => { const data = { playerId: 'p03', question: 'Verifieer speelminuten.', requestId: 'idempotency-test-1' }; const a = await (await send('/api/tasks', data)).json(); const b = await (await send('/api/tasks', data)).json(); assert.equal(a.id, b.id); const state = await (await fetch(base + '/api/state')).json(); assert.equal(state.tasks.filter(t => t.requestId === data.requestId).length, 1); });
test('an idempotency key cannot silently overwrite another task', async () => { const data = { playerId: 'p03', question: 'Andere vraag.', requestId: 'idempotency-test-1' }; const r = await send('/api/tasks', data); assert.equal(r.status, 409); });
test('completing a task requires a written observation', async () => {
  const task = await (await send('/api/tasks', { playerId: 'p04', question: 'Bekijk positionering.', requestId: 'complete-test' })).json();
  assert.equal((await send('/api/tasks/' + task.id, { status: 'done', result: '' }, 'PATCH')).status, 400);
  const r = await send('/api/tasks/' + task.id, { status: 'done', result: 'Onvoldoende volledig beeld; vraag blijft open.' }, 'PATCH'); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'done');
});
test('brief validation rejects minors and invalid age ranges', async () => { for (const [minAge, maxAge] of [[17, 23], [24, 18], [18, 80]]) assert.equal((await send('/api/brief', { role: 'CB', minAge, maxAge, task: '', budgetScope: '' }, 'PUT')).status, 400); });
test('a valid structured brief is saved without pretending to parse its text with AI', async () => { const r = await send('/api/brief', { role: 'CB', minAge: 18, maxAge: 23, task: 'Verdedig ruimte achter de laatste lijn.', budgetScope: 'Nog onbekend.' }, 'PUT'); assert.equal(r.status, 200); assert.equal((await r.json()).role, 'CB'); });
test('oversized requests are rejected', async () => { const r = await send('/api/decisions', { playerId: 'p01', action: 'follow', reason: 'positive', note: 'a'.repeat(70000) }); assert.equal(r.status, 413); });
test('shortlist CSV can be downloaded with a synthetic-data label', async () => { const r = await fetch(base + '/api/export'); assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /FICTIEF/); assert.match(await r.text(), /FICTIEF - softwaretest/); });
test('file persistence survives reopening and serializes concurrent writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-'));
  try { const path = join(dir, 'state.json'), store = await createStore(path); await Promise.all(Array.from({ length: 15 }, (_, i) => store.update(s => { s.audit.push({ id: i }); return i; }))); const reopened = await createStore(path); assert.equal((await reopened.read()).audit.length, 15); } finally { await rm(dir, { recursive: true, force: true }); }
});
