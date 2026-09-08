import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/store.mjs';

const PASSWORD = 'synthetic review passphrase 2026';
const NEXT_PASSWORD = 'synthetic replacement passphrase 2026';
const NOW = '2026-09-08T12:00:00.000Z';
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const cleanup = new WeakMap();
function resources(t) {
  if (!cleanup.has(t)) {
    const owned = { apps: [], folders: [] };
    cleanup.set(t, owned);
    t.after(async () => {
      for (const app of owned.apps.reverse()) await app.close();
      for (const dir of owned.folders.reverse()) {
        const inside = relative(resolve(tmpdir()), resolve(dir));
        assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  return cleanup.get(t);
}
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-account-review-'));
  resources(t).folders.push(dir);
  return dir;
}
async function start(t, options = {}) {
  const app = await createApp({ now: () => NOW, ...options });
  resources(t).apps.push(app);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  app.base = `http://127.0.0.1:${app.server.address().port}`;
  return app;
}
function client(app) {
  const jar = new Map();
  return {
    csrf: '', org: '',
    cookies() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; '); },
    async request(path, { method = 'GET', data, headers = {}, cookies, csrf, org, raw } = {}) {
      const response = await fetch(app.base + path, {
        method, headers: {
          ...(method !== 'GET' && method !== 'HEAD' ? { origin: app.base, 'content-type': 'application/json', 'x-omniscout-csrf': csrf ?? this.csrf } : {}),
          cookie: cookies ?? this.cookies(),
          ...((org ?? this.org) ? { 'x-omniscout-organization': org ?? this.org } : {}),
          ...headers
        }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}), ...(raw !== undefined ? { body: raw } : {})
      });
      for (const entry of response.headers.getSetCookie()) {
        const [pair] = entry.split(';'), index = pair.indexOf('='), key = pair.slice(0, index), value = pair.slice(index + 1);
        if (value) jar.set(key, value); else jar.delete(key);
      }
      const text = await response.text();
      let result = text; try { result = JSON.parse(text); } catch { /* CSV or asset */ }
      return { status: response.status, headers: response.headers, data: result, text };
    },
    async refresh() {
      const response = await this.request('/api/session');
      assert.equal(response.status, 200);
      this.csrf = response.data.csrf;
      return response.data;
    },
    async setup() {
      await this.refresh();
      const response = await this.request('/api/auth/setup', { method: 'POST', data: { username: 'owner', password: PASSWORD, displayName: 'FICTIEF eigenaar', organizationName: 'FICTIEVE club A' } });
      assert.equal(response.status, 201, response.text);
      this.csrf = response.data.csrf; this.org = response.data.organizations[0].id;
      return response;
    },
    async login(username = 'owner', password = PASSWORD) {
      await this.refresh();
      const response = await this.request('/api/auth/login', { method: 'POST', data: { username, password } });
      assert.equal(response.status, 200, response.text);
      this.csrf = response.data.csrf; this.org = response.data.organizations[0]?.id || '';
      return response;
    }
  };
}
async function invite(owner, app, role, username) {
  const invitation = await owner.request('/api/auth/invites', { method: 'POST', data: { role } });
  assert.equal(invitation.status, 201, invitation.text);
  const member = client(app); await member.refresh();
  const registration = await member.request('/api/auth/register', { method: 'POST', data: { inviteToken: invitation.data.token, username, password: PASSWORD, role: 'owner', organizationId: 'attacker-chosen' } });
  assert.equal(registration.status, 201, registration.text);
  member.csrf = registration.data.csrf; member.org = registration.data.organizations[0].id;
  return { member, userId: registration.data.user.id, inviteToken: invitation.data.token, session: registration.data };
}
async function player(owner) {
  const result = await owner.request('/api/catalog');
  assert.equal(result.status, 200, result.text);
  return result.data.players[0].id;
}

test('review: secure default gates every workspace API and exports despite forged organization context', async t => {
  const app = await start(t), anonymous = client(app);
  const session = await anonymous.refresh();
  assert.equal(session.mode, 'local_accounts');
  assert.equal(session.authenticated, false);
  assert.equal(session.supportsImport, false);
  assert.equal(session.setupRequired, true);
  const headers = { 'x-omniscout-organization': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x-omniscout-user': 'owner', authorization: 'Bearer synthetic' };
  for (const path of ['/api/catalog', '/api/state', '/api/state?dataset=import', '/api/players', '/api/players/any', '/api/coverage', '/api/import/jobs', '/api/workspace/stats', '/api/export', '/api/export/state', '/api/unknown']) {
    const response = await anonymous.request(path, { headers });
    assert.equal(response.status, 401, path + ': ' + response.text);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await anonymous.request('/api/import/preview', { method: 'POST', data: sample, headers })).status, 401);
  assert.equal((await anonymous.request('/api/health')).status, 200);
  assert.equal((await anonymous.request('/')).status, 200);
  assert.equal((await anonymous.request('/api/import/sample')).status, 200);
  assert.equal((await anonymous.request('/.local/accounts.json')).status, 404);
  assert.equal((await anonymous.request('/src/auth/index.mjs')).status, 404);
});

test('review: preauth CSRF is cookie-bound and expires, and issued authenticated CSRF works for mutations', async t => {
  let clock = Date.parse(NOW);
  const app = await start(t, { now: () => new Date(clock).toISOString() }), a = client(app), b = client(app);
  await a.refresh(); await b.refresh();
  const setup = { username: 'owner', password: PASSWORD, organizationName: 'FICTIEVE club A' };
  assert.notEqual(a.csrf, b.csrf);
  assert.equal((await a.request('/api/auth/setup', { method: 'POST', data: setup, cookies: '' })).status, 403);
  assert.equal((await b.request('/api/auth/setup', { method: 'POST', data: setup, csrf: a.csrf })).status, 403);
  assert.equal((await a.request('/api/auth/setup', { method: 'POST', data: setup, headers: { origin: 'https://attacker.invalid' } })).status, 403);
  const old = a.csrf;
  clock += 16 * 60 * 1000;
  assert.equal((await a.request('/api/auth/setup', { method: 'POST', data: setup })).status, 403);
  await a.refresh(); assert.notEqual(a.csrf, old);
  const created = await a.setup();
  assert.match(created.data.csrf, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(created.data, 'token'), false);
  assert.match(created.headers.getSetCookie().join(';'), /HttpOnly; SameSite=Strict/);
  const brief = { role: '', minAge: 18, maxAge: 23, task: 'FICTIEVE integratieregressie', budgetScope: '' };
  assert.equal((await a.request('/api/brief', { method: 'PUT', data: brief })).status, 200);
  assert.equal((await a.request('/api/brief', { method: 'PUT', data: brief, csrf: old })).status, 403);
});

test('review: organization header controls all data and a live demoted/revoked session loses write/read access', async t => {
  const app = await start(t), owner = client(app);
  const ownerSession = await owner.setup();
  const { member: scout, userId, session } = await invite(owner, app, 'scout', 'scout');
  assert.equal(session.organizations[0].role, 'scout');
  const orgA = owner.org, p = await player(owner);
  const second = await scout.request('/api/auth/organizations', { method: 'POST', data: { name: 'FICTIEVE club B' } });
  assert.equal(second.status, 201, second.text);
  const orgB = second.data.id;
  const privateNote = 'FICTIEVE beperkte notitie voor A';
  assert.equal((await owner.request('/api/decisions', { method: 'POST', data: { playerId: p, action: 'follow', reason: 'positive', note: privateNote, organizationId: orgB, tenantId: orgB } })).status, 201);
  assert.equal((await owner.request('/api/state', { org: '' })).status, 400);
  for (const path of ['/api/state', '/api/export/state', '/api/export', '/api/import/jobs', '/api/workspace/stats']) {
    assert.equal((await owner.request(path, { org: orgB })).status, 403, path);
    const blank = await scout.request(path, { org: orgB });
    assert.equal(blank.status, 200, blank.text);
    assert.ok(!blank.text.includes(privateNote));
  }
  const preview = await owner.request('/api/import/preview', { method: 'POST', data: sample });
  assert.equal(preview.status, 200); assert.equal(preview.data.valid, true);
  const imported = await owner.request('/api/import/confirm', { method: 'POST', data: { payload: sample, digest: preview.data.digest, organizationId: orgB } });
  assert.equal(imported.status, 202, imported.text);
  await app.organizationManager.idle();
  assert.deepEqual((await scout.request('/api/import/jobs', { org: orgB })).data.jobs, []);
  assert.equal((await scout.request(`/api/import/jobs/${imported.data.job.id}/retry`, { org: orgB, method: 'POST', data: {} })).status, 404);
  assert.deepEqual((await scout.request('/api/catalog?dataset=import', { org: orgB })).data.players, []);
  assert.equal((await owner.request('/api/import/jobs')).data.jobs[0].payload, undefined);
  const task = { playerId: p, requestId: 'same-review-request', question: 'FICTIEVE controle A' };
  assert.equal((await scout.request('/api/tasks', { method: 'POST', data: task })).status, 201);
  assert.equal((await owner.request(`/api/auth/members/${userId}`, { method: 'PATCH', data: { role: 'viewer' } })).status, 200);
  for (const [path, data] of [['/api/tasks', task], ['/api/import/preview', sample], ['/api/import/confirm', { payload: sample, digest: 'invalid' }], ['/api/import/rollback', { snapshotId: sample.snapshotId }]]) {
    assert.equal((await scout.request(path, { method: 'POST', data })).status, 403, path);
  }
  assert.equal((await scout.request('/api/export/state')).status, 200);
  assert.equal((await scout.request('/api/auth/members')).status, 403);
  assert.equal((await scout.request('/api/auth/recover-migration', { method: 'POST', data: {} })).status, 403);
  assert.equal((await owner.request(`/api/auth/members/${userId}`, { method: 'DELETE' })).status, 200);
  for (const path of ['/api/state', '/api/export', '/api/export/state', '/api/import/jobs']) assert.equal((await scout.request(path, { org: orgA })).status, 403, path);
  assert.equal((await scout.request('/api/state', { org: orgB })).status, 200);
  const state = await owner.request('/api/state');
  assert.ok(state.data.audit.every(item => [session.user.id, ownerSession.data.user.id].includes(item.actor)));
  assert.ok(state.data.audit.every(item => item.actor !== 'local-demo-user'));
});

test('review: last owner protected, old owner role is rechecked and invitations die with issuer authority', async t => {
  const app = await start(t), owner = client(app), setup = await owner.setup(), ownerId = setup.data.user.id;
  assert.equal((await owner.request(`/api/auth/members/${ownerId}`, { method: 'DELETE' })).status, 409);
  assert.equal((await owner.request(`/api/auth/members/${ownerId}`, { method: 'PATCH', data: { role: 'viewer' } })).status, 409);
  const { member: coowner, userId } = await invite(owner, app, 'owner', 'coowner');
  const invitation = await coowner.request('/api/auth/invites', { method: 'POST', data: { role: 'viewer' } });
  assert.equal(invitation.status, 201);
  assert.equal((await owner.request(`/api/auth/members/${userId}`, { method: 'PATCH', data: { role: 'scout' } })).status, 200);
  assert.equal((await coowner.request('/api/auth/members')).status, 403);
  assert.equal((await coowner.request('/api/auth/invites', { method: 'POST', data: { role: 'owner' } })).status, 403);
  const newcomer = client(app); await newcomer.refresh();
  assert.equal((await newcomer.request('/api/auth/register', { method: 'POST', data: { username: 'newcomer', password: PASSWORD, inviteToken: invitation.data.token } })).status, 400);
  const renewed = await owner.request('/api/auth/invites', { method: 'POST', data: { role: 'viewer' } });
  const once = await newcomer.request('/api/auth/register', { method: 'POST', data: { username: 'newcomer', password: PASSWORD, inviteToken: renewed.data.token, role: 'owner' } });
  assert.equal(once.status, 201); assert.equal(once.data.organizations[0].role, 'viewer');
  const again = client(app); await again.refresh();
  assert.equal((await again.request('/api/auth/register', { method: 'POST', data: { username: 'another', password: PASSWORD, inviteToken: renewed.data.token } })).status, 400);
});

test('review: password rotation revokes every old cookie and logout cannot reuse old data/API access', async t => {
  const app = await start(t), owner = client(app); await owner.setup();
  const otherDevice = client(app); await otherDevice.login();
  const oldCookie = owner.cookies(), oldCsrf = owner.csrf;
  const changed = await owner.request('/api/auth/password', { method: 'POST', data: { currentPassword: PASSWORD, newPassword: NEXT_PASSWORD } });
  assert.equal(changed.status, 200, changed.text);
  owner.csrf = changed.data.csrf;
  assert.notEqual(owner.csrf, oldCsrf);
  assert.equal((await owner.request('/api/state', { cookies: oldCookie })).status, 401);
  assert.equal((await otherDevice.request('/api/export/state')).status, 401);
  const liveCookie = owner.cookies();
  assert.equal((await owner.request('/api/auth/logout', { method: 'POST', data: {} })).status, 200);
  for (const path of ['/api/state', '/api/export', '/api/import/jobs']) assert.equal((await owner.request(path, { cookies: liveCookie })).status, 401);
  const publicSession = await owner.refresh();
  assert.equal(publicSession.authenticated, false);
  assert.equal(Object.hasOwn(publicSession, 'user'), false);
  assert.equal(Object.hasOwn(publicSession, 'organizations'), false);
  assert.equal((await owner.request('/api/auth/login', { method: 'POST', data: { username: 'owner', password: PASSWORD } })).status, 401);
  await owner.login('owner', NEXT_PASSWORD);
  assert.equal((await owner.request('/api/state')).status, 200);
});

test('review: expired sessions, untrusted host/origin and duplicate session cookies fail closed', async t => {
  let clock = Date.parse(NOW);
  const app = await start(t, { now: () => new Date(clock).toISOString() }), owner = client(app);
  await owner.setup();
  // Node fetch normalizes Host; use the native HTTP client to actually send a forged value.
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(app.base + '/api/state', { headers: { host: 'attacker.invalid', cookie: owner.cookies(), 'x-omniscout-organization': owner.org } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await owner.request('/api/state', { headers: { origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await owner.request('/api/state', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await owner.request('/api/state', { cookies: owner.cookies() + '; ' + owner.cookies() })).status, 400);
  clock += 12 * 60 * 60 * 1000;
  assert.equal((await owner.request('/api/state')).status, 401);
  assert.equal((await owner.request('/api/export/state')).status, 401);
  assert.equal((await owner.refresh()).authenticated, false);
});

test('review: restarting persistent app invalidates session while retaining isolated state and exclusive lock', async t => {
  const dir = await folder(t);
  let app = await start(t, { dataDir: dir }), owner = client(app);
  await owner.setup();
  const org = owner.org, p = await player(owner);
  assert.equal((await owner.request('/api/decisions', { method: 'POST', data: { playerId: p, action: 'follow', reason: 'positive', note: 'FICTIEVE duurzame notitie' } })).status, 201);
  const oldCookie = owner.cookies();
  await assert.rejects(createApp({ dataDir: dir }), e => e.status === 409);
  await app.close();
  app = await start(t, { dataDir: dir }); owner = client(app); owner.org = org;
  assert.equal((await owner.request('/api/state', { cookies: oldCookie })).status, 401);
  await owner.login();
  const restored = await owner.request('/api/state');
  assert.equal(restored.data.decisions[0].note, 'FICTIEVE duurzame notitie');
  assert.equal(Object.hasOwn(restored.data, '_legacyMigration'), false);
  const accounts = await readFile(join(dir, 'accounts.json'), 'utf8');
  assert.ok(!accounts.includes(PASSWORD));
  assert.ok(!accounts.includes(oldCookie.split('=')[1]));
});

test('review: failed setup migration remains bound to the first organization across repair and restart', async t => {
  const dir = await folder(t), source = join(dir, 'state.json');
  await writeFile(source, '{broken old state');
  let app = await start(t, { dataDir: dir, legacyStatePath: source }), owner = client(app);
  const setup = await owner.setup(), firstOrg = owner.org;
  assert.equal(setup.data.migration.recoveryRequired, true);
  assert.equal((await owner.request('/api/state')).status, 409);
  assert.equal((await owner.request('/api/workspace/stats')).status, 409);
  const org = await owner.request('/api/auth/organizations', { method: 'POST', data: { name: 'FICTIEVE second organization' } });
  assert.equal(org.status, 201);
  await app.close();
  const legacy = { ...emptyState(), decisions: [{ id: 'synthetic-legacy-id', playerId: 'synthetic-player', note: 'legacy only for first org' }] };
  const bytes = JSON.stringify(legacy);
  await writeFile(source, bytes);
  app = await start(t, { dataDir: dir, legacyStatePath: source }); owner = client(app); await owner.login();
  assert.equal((await owner.request('/api/auth/recover-migration', { method: 'POST', data: {}, org: org.data.id })).status, 409);
  assert.equal((await owner.request('/api/auth/recover-migration', { method: 'POST', data: {}, org: firstOrg })).status, 200);
  assert.equal((await owner.request('/api/state', { org: firstOrg })).data.decisions[0].note, legacy.decisions[0].note);
  assert.deepEqual((await owner.request('/api/state', { org: org.data.id })).data.decisions, []);
  assert.equal(await readFile(source, 'utf8'), bytes);
});
