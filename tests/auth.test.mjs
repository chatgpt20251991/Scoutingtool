import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { AUTH_LIMITS, createAuth } from '../src/auth/index.mjs';

const PASSWORD = 'synthetic test passphrase 2026';
const OTHER_PASSWORD = 'a different synthetic passphrase';
const account = (username = 'owner') => ({ username, password: PASSWORD, displayName: `Test ${username}` });
const initial = { ...account(), organizationName: 'Fictieve club A' };
const status = expected => error => error.status === expected;
async function fixture(options = {}) {
  const auth = await createAuth(options), owner = await auth.setup(initial);
  return { auth, owner, orgId: owner.organizations[0].id };
}
async function invited(auth, owner, orgId, assignedRole, username = assignedRole) {
  const invite = await auth.invite(owner.token, orgId, { role: assignedRole });
  return auth.register({ ...account(username), inviteToken: invite.token });
}
async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-auth-test-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(`${resolve(tmpdir())}${sep}omniscout-auth-test-`));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('first setup creates one owner and sanitized sessions; callers cannot mutate auth state', async () => {
  const auth = await createAuth();
  assert.deepEqual(await auth.status(), { setupRequired: true });
  const owner = await auth.setup({ ...initial, username: 'OwNeR', role: 'viewer', id: 'client-chosen-id' });
  assert.deepEqual(await auth.status(), { setupRequired: false });
  assert.equal(owner.user.username, 'owner');
  assert.equal(owner.organizations[0].role, 'owner');
  assert.match(owner.user.id, /^[a-f0-9-]{36}$/);
  assert.match(owner.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(owner.csrf, /^[a-f0-9]{64}$/);
  assert.notEqual(owner.token, owner.csrf);
  assert.equal(JSON.stringify(owner).includes(PASSWORD), false);
  assert.deepEqual(Object.keys(owner.user).sort(), ['displayName', 'id', 'username']);
  const orgId = owner.organizations[0].id;
  owner.user.username = 'tampered'; owner.organizations[0].role = 'viewer';
  assert.equal((await auth.session(owner.token)).user.username, 'owner');
  assert.equal((await auth.authorize(owner.token, orgId, { owner: true })).organization.role, 'owner');
  await assert.rejects(auth.setup(initial), status(409));
});

test('concurrent first setup cannot produce a second owner account', async () => {
  const auth = await createAuth();
  const results = await Promise.allSettled([auth.setup(initial), auth.setup({ ...initial, username: 'other' })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  await assert.rejects(auth.login(account('other')), status(401));
});

test('credential and display bounds reject invalid setup without consuming first-run state', async () => {
  const auth = await createAuth();
  for (const change of [
    { username: 'xy' }, { username: 'x'.repeat(65) }, { username: 'bad name' },
    { username: '__proto__' }, { password: 'too short' }, { password: 'x'.repeat(129) },
    { password: 'x'.repeat(14) + '\0' }, { password: 'x'.repeat(14) + '\ud800' }, { displayName: '\nInjected' },
    { organizationName: ' ' }, { organizationName: 'x'.repeat(101) },
  ]) await assert.rejects(auth.setup({ ...initial, ...change }), status(400));
  assert.equal((await auth.status()).setupRequired, true);
  const owner = await auth.setup({ ...initial, password: '🔐'.repeat(128) });
  assert.ok(owner.token);
  await auth.logout(owner.token);
  assert.ok((await auth.login({ username: initial.username, password: '🔐'.repeat(128) })).token);
});

test('roles are enforced and membership removal immediately denies existing sessions', async () => {
  const { auth, owner, orgId } = await fixture();
  const viewer = await invited(auth, owner, orgId, 'viewer');
  const scout = await invited(auth, owner, orgId, 'scout');
  assert.equal((await auth.authorize(viewer.token, orgId)).organization.role, 'viewer');
  await assert.rejects(auth.authorize(viewer.token, orgId, { write: true }), status(403));
  await auth.authorize(scout.token, orgId, { write: true });
  for (const member of [viewer, scout]) {
    await assert.rejects(auth.members(member.token, orgId), status(403));
    await assert.rejects(auth.invite(member.token, orgId, { role: 'owner' }), status(403));
    await assert.rejects(auth.setRole(member.token, orgId, member.user.id, { role: 'owner' }), status(403));
    await assert.rejects(auth.removeMember(member.token, orgId, owner.user.id), status(403));
  }
  const clubB = await auth.createOrganization(viewer.token, { name: 'Fictieve club B' });
  assert.equal(clubB.role, 'owner');
  await assert.rejects(auth.authorize(owner.token, clubB.id), status(403));
  await assert.rejects(auth.authorize(scout.token, clubB.id), status(403));
  await auth.setRole(owner.token, orgId, scout.user.id, { role: 'viewer' });
  await assert.rejects(auth.authorize(scout.token, orgId, { write: true }), status(403));
  await auth.removeMember(owner.token, orgId, scout.user.id);
  await assert.rejects(auth.authorize(scout.token, orgId), status(403));
  assert.deepEqual((await auth.session(scout.token)).organizations, []);
  const fresh = await auth.login(account('scout'));
  assert.deepEqual(fresh.organizations, []);
  assert.equal((await auth.members(owner.token, orgId)).length, 2);
});

test('last owner remains protected during concurrent demotions and removal', async () => {
  const { auth, owner, orgId } = await fixture();
  await assert.rejects(auth.setRole(owner.token, orgId, owner.user.id, { role: 'scout' }), status(409));
  await assert.rejects(auth.removeMember(owner.token, orgId, owner.user.id), status(409));
  const secondOwner = await invited(auth, owner, orgId, 'owner', 'second-owner');
  const results = await Promise.allSettled([
    auth.setRole(owner.token, orgId, owner.user.id, { role: 'scout' }),
    auth.setRole(secondOwner.token, orgId, secondOwner.user.id, { role: 'scout' }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.status, 409);
  assert.equal((await auth.members(secondOwner.token, orgId)).filter(item => item.role === 'owner').length, 1);
});

test('invite role cannot be overridden, one-time consumption is atomic, and invalid codes are generic', async () => {
  const { auth, owner, orgId } = await fixture();
  const invite = await auth.invite(owner.token, orgId, { role: 'viewer' });
  const results = await Promise.allSettled([
    auth.register({ ...account('first'), inviteToken: invite.token, role: 'owner', orgId: randomUUID() }),
    auth.register({ ...account('second'), inviteToken: invite.token, role: 'owner' }),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'fulfilled').value.organizations[0].role, 'viewer');
  const reused = results.find(item => item.status === 'rejected').reason;
  let unknown;
  try { await auth.register({ ...account('third'), inviteToken: 'A'.repeat(43) }); } catch (error) { unknown = error; }
  assert.equal(unknown.status, reused.status);
  assert.equal(unknown.message, reused.message);
  await assert.rejects(auth.invite(owner.token, orgId, { role: 'admin' }), status(400));
});

test('duplicate usernames do not consume a valid invitation', async () => {
  const { auth, owner, orgId } = await fixture();
  const invite = await auth.invite(owner.token, orgId, { role: 'scout' });
  await assert.rejects(auth.register({ ...account('OWNER'), inviteToken: invite.token }), status(409));
  assert.ok((await auth.register({ ...account('new-person'), inviteToken: invite.token })).token);
});

test('expired sessions and invitations deny access at the expiry boundary', async () => {
  let current = Date.parse('2026-09-08T10:00:00Z');
  const { auth, owner, orgId } = await fixture({ now: () => new Date(current).toISOString() });
  const invite = await auth.invite(owner.token, orgId, { role: 'scout' });
  current += AUTH_LIMITS.sessionMs;
  assert.equal(await auth.session(owner.token), null);
  await assert.rejects(auth.authorize(owner.token, orgId), status(401));
  current = Date.parse(invite.expiresAt);
  await assert.rejects(auth.register({ ...account('late'), inviteToken: invite.token }), status(400));
  const fresh = await auth.login(account());
  await auth.logout(fresh.token);
  assert.equal(await auth.session(fresh.token), null);
});

test('demoting or removing an invite creator revokes their outstanding invites', async () => {
  const { auth, owner, orgId } = await fixture();
  const second = await invited(auth, owner, orgId, 'owner', 'second-owner');
  const issued = await auth.invite(second.token, orgId, { role: 'owner' });
  await auth.setRole(owner.token, orgId, second.user.id, { role: 'scout' });
  await assert.rejects(auth.register({ ...account('escalation'), inviteToken: issued.token }), status(400));
  await auth.setRole(owner.token, orgId, second.user.id, { role: 'owner' });
  const next = await auth.invite(second.token, orgId, { role: 'owner' });
  await auth.removeMember(owner.token, orgId, second.user.id);
  await assert.rejects(auth.register({ ...account('escalation'), inviteToken: next.token }), status(400));
});

test('password changes verify current password, rotate sessions and persist only the new hash', async t => {
  const dir = await folder(t), path = join(dir, 'accounts.json');
  const { auth, owner, orgId } = await fixture({ path });
  const otherDevice = await auth.login(account());
  await assert.rejects(auth.changePassword(owner.token, { currentPassword: OTHER_PASSWORD, newPassword: OTHER_PASSWORD }), status(400));
  assert.ok(await auth.session(owner.token));
  const replacement = await auth.changePassword(owner.token, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD });
  assert.notEqual(replacement.token, owner.token);
  assert.notEqual(replacement.csrf, owner.csrf);
  assert.equal(await auth.session(owner.token), null);
  assert.equal(await auth.session(otherDevice.token), null);
  await auth.authorize(replacement.token, orgId, { owner: true });
  const reopened = await createAuth({ path });
  assert.equal(await reopened.session(replacement.token), null);
  await assert.rejects(reopened.login(account()), status(401));
  assert.ok((await reopened.login({ ...account(), password: OTHER_PASSWORD })).token);
});

test('persistent state has unique salts and digested invites but no passwords or session material', async t => {
  const path = join(await folder(t), 'accounts.json');
  const { auth, owner, orgId } = await fixture({ path });
  const scout = await invited(auth, owner, orgId, 'scout');
  const invite = await auth.invite(owner.token, orgId, { role: 'viewer' });
  const raw = await readFile(path, 'utf8'), state = JSON.parse(raw);
  for (const secret of [PASSWORD, owner.token, owner.csrf, scout.token, scout.csrf, invite.token]) assert.equal(raw.includes(secret), false);
  assert.notEqual(state.users[0].password.salt, state.users[1].password.salt);
  assert.notEqual(state.users[0].password.hash, state.users[1].password.hash);
  assert.equal(state.users[0].password.N, 2 ** 17);
  assert.equal(state.invitations[0].digest, createHash('sha256').update(invite.token).digest('hex'));
  const reopened = await createAuth({ path });
  assert.equal((await reopened.status()).setupRequired, false);
  assert.equal(await reopened.session(owner.token), null);
  const fresh = await reopened.login(account());
  assert.equal(fresh.organizations[0].id, orgId);
  assert.equal((await reopened.members(fresh.token, orgId)).length, 2);
  assert.ok((await reopened.register({ ...account('persisted-invite'), inviteToken: invite.token })).token);
});

test('failed setup and later writes leave in-memory accounts and existing sessions unchanged', async t => {
  const path = join(await folder(t), 'accounts.json');
  const auth = await createAuth({ path });
  await mkdir(path);
  await assert.rejects(auth.setup(initial), status(503));
  assert.equal((await auth.status()).setupRequired, true);
  await rm(path, { recursive: true });
  const owner = await auth.setup(initial), orgId = owner.organizations[0].id;
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await assert.rejects(auth.createOrganization(owner.token, { name: 'Must not persist' }), status(503));
  await assert.rejects(auth.invite(owner.token, orgId, { role: 'viewer' }), status(503));
  await assert.rejects(auth.changePassword(owner.token, { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD }), status(503));
  assert.ok(await auth.session(owner.token));
  assert.equal((await auth.session(owner.token)).organizations.length, 1);
  assert.ok((await auth.login(account())).token);
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  assert.equal((await auth.members(owner.token, orgId)).length, 1);
});

test('corrupted, oversized and unsafe stored account state fails closed without rewriting', async t => {
  const path = join(await folder(t), 'accounts.json');
  await fixture({ path });
  const original = await readFile(path, 'utf8');
  const invalidStates = ['{broken', ' '.repeat(AUTH_LIMITS.fileBytes + 1)];
  const missingOwner = JSON.parse(original); missingOwner.memberships[0].role = 'viewer'; invalidStates.push(JSON.stringify(missingOwner));
  const badHash = JSON.parse(original); badHash.users[0].password.N = 2; invalidStates.push(JSON.stringify(badHash));
  const extraSecret = JSON.parse(original); extraSecret.users[0].plaintext = PASSWORD; invalidStates.push(JSON.stringify(extraSecret));
  for (const invalid of invalidStates) {
    await writeFile(path, invalid);
    await assert.rejects(createAuth({ path }), status(500));
    assert.equal(await readFile(path, 'utf8'), invalid);
  }
});

test('failed registration preserves its invitation and creates no phantom account', async t => {
  const path = join(await folder(t), 'accounts.json');
  const { auth, owner, orgId } = await fixture({ path });
  const invitation = await auth.invite(owner.token, orgId, { role: 'scout' });
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await assert.rejects(auth.register({ ...account('new-scout'), inviteToken: invitation.token }), status(503));
  assert.equal((await auth.members(owner.token, orgId)).length, 1);
  await assert.rejects(auth.login(account('new-scout')), status(401));
  await rm(path, { recursive: true });
  await rename(`${path}.backup`, path);
  const registered = await auth.register({ ...account('new-scout'), inviteToken: invitation.token });
  assert.equal(registered.organizations[0].role, 'scout');
  await assert.rejects(auth.register({ ...account('duplicate'), inviteToken: invitation.token }), status(400));
});

test('per-account login limit includes wrong passwords and resets after a bounded window', async () => {
  let current = Date.parse('2026-09-08T10:00:00Z');
  const { auth } = await fixture({ now: () => new Date(current).toISOString() });
  for (let index = 0; index < AUTH_LIMITS.loginPerUsername; index += 1) {
    await assert.rejects(auth.login({ ...account(), password: OTHER_PASSWORD }), status(401));
  }
  await assert.rejects(auth.login(account()), status(429));
  current += AUTH_LIMITS.loginWindowMs;
  assert.ok((await auth.login(account())).token);
  await assert.rejects(auth.login({ username: 'missing-account', password: OTHER_PASSWORD }), error => error.status === 401 && error.message === 'Gebruikersnaam of wachtwoord onjuist.');
});

test('a global login limit bounds username rotation', async () => {
  const auth = await createAuth();
  for (let index = 0; index < AUTH_LIMITS.loginGlobal; index += 1) {
    // Invalid credentials avoid expensive hashing while still testing the global counter.
    await assert.rejects(auth.login({ username: `rotating-${index}`, password: 'short' }), status(401));
  }
  // A separate valid username cannot bypass attempts already charged to the global window.
  await assert.rejects(auth.login({ username: 'rotating', password: PASSWORD }), status(429));
});

test('organization, invitation and account capacity limits do not partially mutate state', async t => {
  const path = join(await folder(t), 'accounts.json');
  const { auth, owner, orgId } = await fixture({ path });
  const initialState = JSON.parse(await readFile(path, 'utf8'));
  const memory = await fixture();
  for (let index = 1; index < AUTH_LIMITS.organizations; index += 1) await memory.auth.createOrganization(memory.owner.token, { name: `Fictieve club ${index}` });
  await assert.rejects(memory.auth.createOrganization(memory.owner.token, { name: 'Over capacity' }), status(409));
  assert.equal((await memory.auth.session(memory.owner.token)).organizations.length, AUTH_LIMITS.organizations);
  for (let index = 0; index < AUTH_LIMITS.invitations; index += 1) await memory.auth.invite(memory.owner.token, memory.orgId, { role: 'viewer' });
  await assert.rejects(memory.auth.invite(memory.owner.token, memory.orgId, { role: 'viewer' }), status(409));
  for (let index = 1; index < AUTH_LIMITS.users; index += 1) initialState.users.push({ ...initialState.users[0], id: randomUUID(), username: `fixture-${index}` });
  await writeFile(path, JSON.stringify(initialState));
  const loaded = await createAuth({ path }), fresh = await loaded.login(account());
  const invitation = await loaded.invite(fresh.token, orgId, { role: 'viewer' });
  await assert.rejects(loaded.register({ ...account('over-capacity'), inviteToken: invitation.token }), status(409));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).users.length, AUTH_LIMITS.users);
  assert.ok(await auth.session(owner.token));
});

test('session capacity evicts oldest session while preserving newest valid logins', async () => {
  const { auth, owner } = await fixture();
  let newest;
  for (let index = 0; index < AUTH_LIMITS.sessions; index += 1) newest = await auth.login(account());
  assert.equal(await auth.session(owner.token), null);
  assert.ok(await auth.session(newest.token));
});

test('missing sessions and invalid organization identifiers deny access', async () => {
  const { auth, owner, orgId } = await fixture();
  for (const token of [null, undefined, '', 'x'.repeat(1_000), { token: owner.token }]) {
    assert.equal(await auth.session(token), null);
    await assert.rejects(auth.authorize(token, orgId), status(401));
  }
  for (const invalid of [null, undefined, '../../accounts.json', 'constructor', 'not-an-id']) await assert.rejects(auth.authorize(owner.token, invalid), status(404));
  await assert.rejects(auth.authorize(owner.token, randomUUID()), status(403));
});
