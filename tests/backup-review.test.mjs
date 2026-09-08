import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtemp, readFile, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createApp } from '../src/server.mjs';
import { sealBackup, openBackup, MAX_BACKUP_BYTES } from '../src/backup/crypto.mjs';

const PASSWORD = 'FICTIEF review accountwachtwoord 2026';
const PHRASE = 'FICTIEVE onafhankelijke backup wachtzin';
async function fixture(t, persistent = false) {
  const dir = persistent ? await mkdtemp(join(tmpdir(), 'omniscout-backup-review-')) : null;
  let clock = Date.parse('2026-09-08T12:00:00.000Z');
  const app = await createApp({ dataDir: dir, now: () => new Date(clock).toISOString() });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`, streams = [];
  t.after(async () => {
    for (const stream of streams) stream.request.destroy();
    await app.close();
    if (dir) { const inside = relative(resolve(tmpdir()), resolve(dir)); assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside)); await rm(dir, { recursive: true, force: true }); }
  });
  // Authentication setup itself is covered by account/API suites. These sessions
  // exercise the real HTTP recovery boundary without duplicating preauth tests.
  const owner = await app.auth.setup({ username: 'reviewowner', password: PASSWORD, organizationName: 'FICTIEVE private clubnaam' });
  const orgId = owner.organizations[0].id;
  const invitation = await app.auth.invite(owner.token, orgId, { role: 'owner' });
  const coowner = await app.auth.register({ username: 'reviewcoowner', password: PASSWORD, inviteToken: invitation.token });
  function headers(session) { return { cookie: `omniscout_session=${session.token}`, 'x-omniscout-organization': orgId, origin: base, 'content-type': 'application/json', 'x-omniscout-csrf': session.csrf }; }
  async function call(session, path, data, method = data === undefined ? 'GET' : 'POST') {
    const response = await fetch(base + path, { method, headers: headers(session), ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const body = await response.json();
    return { status: response.status, body, headers: response.headers };
  }
  async function stalled(session, path, data) {
    const encoded = JSON.stringify(data);
    let seen;
    const arrived = new Promise(resolve => { seen = resolve; });
    const marker = `synthetic-${streams.length}`;
    function observer(req) { if (req.headers['x-review-marker'] === marker) { app.server.off('request', observer); seen(); } }
    app.server.on('request', observer);
    let request;
    const result = new Promise((resolve, reject) => {
      request = httpRequest(base + path, { method: 'POST', headers: { ...headers(session), 'content-length': Buffer.byteLength(encoded), 'x-review-marker': marker } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')), headers: response.headers }));
      });
      request.on('error', reject); request.write('{');
    });
    result.catch(() => {}); // Cleanup may destroy a request; the test still awaits every normal result.
    const stream = { request, result, finish() { request.end(encoded.slice(1)); } }; streams.push(stream);
    await arrived;
    // Let all account authorization stages finish while body parsing is held.
    for (let index = 0; index < 6; index += 1) await app.auth.session(session.token);
    return stream;
  }
  return { app, dir, owner, coowner, orgId, call, stalled, advance(ms) { clock += ms; } };
}

test('review: oversized passphrases are rejected before Unicode expansion and excessive ciphertext before decode', async () => {
  const originalIterator = String.prototype[Symbol.iterator]; let expanded = false;
  String.prototype[Symbol.iterator] = function () { if (this.length > 512) expanded = true; return originalIterator.call(this); };
  try {
    await assert.rejects(sealBackup({ synthetic: true }, 'x'.repeat(100000)), e => e.status === 400);
    assert.equal(expanded, false);
  } finally { String.prototype[Symbol.iterator] = originalIterator; }
  const envelope = await sealBackup({ synthetic: true }, PHRASE), originalFrom = Buffer.from; let decodedHuge = false;
  const huge = 'A'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3) * 4 + 4);
  Buffer.from = function (value, ...args) { if (typeof value === 'string' && value.length === huge.length) decodedHuge = true; return originalFrom(value, ...args); };
  try { await assert.rejects(openBackup({ ...envelope, ciphertext: huge }, PHRASE), e => e.status === 400); assert.equal(decodedHuge, false); }
  finally { Buffer.from = originalFrom; }
});

test('review: four in-flight HTTP backup operations bound slow bodies and capacity returns after rejected requests', async t => {
  const f = await fixture(t), held = [];
  for (let index = 0; index < 4; index += 1) held.push(await f.stalled(f.owner, '/api/backup/create', { passphrase: 'short' }));
  assert.equal((await f.call(f.owner, '/api/backup/create', { passphrase: PHRASE })).status, 429);
  for (const request of held) request.finish();
  for (const response of await Promise.all(held.map(request => request.result))) assert.equal(response.status, 400);
  const recovered = await f.call(f.owner, '/api/backup/create', { passphrase: PHRASE });
  assert.equal(recovered.status, 200);
  assert.ok(!JSON.stringify(recovered.body).includes('FICTIEVE private clubnaam'));
  assert.equal(recovered.headers.get('cache-control'), 'no-store');
});

test('review: four stored previews are bounded, disclose only summaries and expiry releases capacity', async t => {
  const f = await fixture(t), envelope = (await f.call(f.owner, '/api/backup/create', { passphrase: PHRASE })).body, previews = [];
  for (let index = 0; index < 4; index += 1) {
    const preview = await f.call(f.owner, '/api/backup/preview', { envelope, passphrase: PHRASE });
    assert.equal(preview.status, 200); previews.push(preview.body.previewId);
    assert.deepEqual(Object.keys(preview.body).sort(), ['currentSummary', 'expiresAt', 'previewId', 'summary']);
    assert.ok(!JSON.stringify(preview.body).includes(PHRASE));
  }
  assert.equal(new Set(previews).size, 4);
  assert.equal((await f.call(f.owner, '/api/backup/preview', { envelope, passphrase: PHRASE })).status, 429);
  f.advance(300001);
  assert.equal((await f.call(f.owner, '/api/backup/preview', { envelope, passphrase: PHRASE })).status, 200);
  assert.equal((await f.call(f.owner, '/api/backup/restore', { previewId: previews[0], confirm: true })).status, 409);
});

test('review: permission revocation or session expiry while reading a backup body prevents later download', async t => {
  const f = await fixture(t);
  const pending = await f.stalled(f.owner, '/api/backup/create', { passphrase: PHRASE });
  assert.equal((await f.call(f.coowner, `/api/auth/members/${f.owner.user.id}`, { role: 'scout' }, 'PATCH')).status, 200);
  pending.finish(); const denied = await pending.result;
  assert.equal(denied.status, 403); assert.equal(denied.headers['content-disposition'], undefined);
  assert.equal(Object.hasOwn(denied.body, 'ciphertext'), false);
  const expires = await f.stalled(f.coowner, '/api/backup/create', { passphrase: PHRASE });
  f.advance(12 * 60 * 60 * 1000);
  expires.finish(); const expired = await expires.result;
  assert.equal(expired.status, 401); assert.equal(expired.headers['content-disposition'], undefined);
});

test('review: owner revoked after private-copy work starts cannot commit an HTTP restore', async t => {
  const f = await fixture(t, true), envelope = (await f.call(f.owner, '/api/backup/create', { passphrase: PHRASE })).body;
  assert.equal((await f.call(f.owner, '/api/decisions', { playerId: 'p01', action: 'follow', reason: 'positive', note: 'FICTIEVE state die bij intrekking blijft' })).status, 201);
  const preview = await f.call(f.owner, '/api/backup/preview', { envelope, passphrase: PHRASE }); assert.equal(preview.status, 200);
  const scoped = await f.app.organizationManager.get(f.orgId), before = await scoped.store.read();
  const path = join(f.dir, 'organizations', f.orgId, 'state.json'), oldBytes = await readFile(path, 'utf8');
  const originalWrite = fs.writeFile; let release, entered;
  const blocked = new Promise(resolve => { release = resolve; }), copying = new Promise(resolve => { entered = resolve; });
  fs.writeFile = async (target, ...args) => {
    if (String(target).replaceAll('\\', '/').includes('/recovery/')) { entered(); await blocked; }
    return originalWrite(target, ...args);
  };
  syncBuiltinESMExports();
  let pending;
  try {
    pending = f.call(f.owner, '/api/backup/restore', { previewId: preview.body.previewId, confirm: true });
    await copying;
    assert.equal((await f.call(f.coowner, `/api/auth/members/${f.owner.user.id}`, { role: 'viewer' }, 'PATCH')).status, 200);
    release(); const denied = await pending;
    assert.equal(denied.status, 403);
  } finally { release(); fs.writeFile = originalWrite; syncBuiltinESMExports(); await pending; }
  assert.deepEqual(await scoped.store.read(), before);
  assert.equal(await readFile(path, 'utf8'), oldBytes);
  assert.equal((await f.app.organizationManager.stats(f.orgId)).counts.recoveryCopies, 1);
  assert.equal((await f.call(f.coowner, '/api/backup/restore', { previewId: preview.body.previewId, confirm: true })).status, 409);
});
