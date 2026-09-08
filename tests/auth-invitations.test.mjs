import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { AUTH_LIMITS, createAuth, validateAccountState } from '../src/auth/index.mjs';

const PASSWORD = 'synthetic invitation test passphrase';
const account = username => ({ username, password: PASSWORD, displayName: `Fictief ${username}` });
const status = expected => error => error.status === expected;
const hash = value => createHash('sha256').update(value).digest('hex');
async function twoClubs(options = {}) {
  const auth = await createAuth(options);
  const ownerA = await auth.setup({ ...account('owner-a'), organizationName: 'Fictieve club A' });
  const orgA = ownerA.organizations[0].id;
  const registration = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  const ownerB = await auth.register({ ...account('owner-b'), inviteToken: registration.token });
  const orgB = (await auth.createOrganization(ownerB.token, { name: 'Fictieve club B' })).id;
  await auth.removeMember(ownerA.token, orgA, ownerB.user.id);
  return { auth, ownerA, ownerB, orgA, orgB };
}
async function folder(t) {
  const root = resolve(tmpdir()), dir = await mkdtemp(join(root, 'omniscout-invitation-test-'));
  function inside(path) {
    const absolute = resolve(path);
    assert.ok(absolute === dir || absolute.startsWith(`${dir}${sep}`));
    return absolute;
  }
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(`${root}${sep}omniscout-invitation-test-`));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, remove: async path => rm(inside(path), { recursive: true, force: true }) };
}

test('preview is read-only and acceptance joins an existing account without changing credentials', async t => {
  const { dir } = await folder(t), path = join(dir, 'accounts.json');
  const { auth, ownerA, ownerB, orgA, orgB } = await twoClubs({ path });
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const before = await readFile(path, 'utf8');
  const preview = await auth.invitePreview(ownerB.token, { inviteToken: invitation.token });
  assert.deepEqual(preview, { organization: { id: orgA, name: 'Fictieve club A' }, role: 'scout', expiresAt: invitation.expiresAt, alreadyMember: false });
  preview.organization.name = 'Forged';
  assert.equal((await auth.invitePreview(ownerB.token, { inviteToken: invitation.token })).organization.name, 'Fictieve club A');
  assert.equal(await readFile(path, 'utf8'), before);
  await assert.rejects(auth.authorize(ownerB.token, orgA), status(403));
  const accepted = await auth.acceptInvite(ownerB.token, {
    inviteToken: invitation.token, userId: ownerA.user.id, organizationId: orgB, role: 'owner', password: 'ignored', username: 'forged',
  });
  assert.deepEqual(accepted, { organization: { id: orgA, name: 'Fictieve club A', role: 'scout' }, alreadyMember: false });
  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(after.users, JSON.parse(before).users);
  assert.deepEqual(after.organizations, JSON.parse(before).organizations);
  assert.equal(after.memberships.length, JSON.parse(before).memberships.length + 1);
  assert.deepEqual((await auth.session(ownerB.token)).organizations.map(org => org.id).sort(), [orgA, orgB].sort());
  await auth.authorize(ownerB.token, orgA, { write: true });
  await assert.rejects(auth.authorize(ownerB.token, orgA, { owner: true }), status(403));
  assert.equal((await auth.login(account('owner-b'))).user.id, ownerB.user.id);
  await assert.rejects(auth.acceptInvite(ownerB.token, { inviteToken: invitation.token }), status(400));
});

test('existing members retain their role and last-owner protection while the code is consumed', async () => {
  const { auth, ownerA, ownerB, orgA } = await twoClubs();
  const viewer = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  await auth.acceptInvite(ownerB.token, { inviteToken: viewer.token });
  const elevated = await auth.invite(ownerA.token, orgA, { role: 'owner' });
  assert.equal((await auth.invitePreview(ownerB.token, { inviteToken: elevated.token })).role, 'viewer');
  const result = await auth.acceptInvite(ownerB.token, { inviteToken: elevated.token });
  assert.equal(result.alreadyMember, true);
  assert.equal(result.organization.role, 'viewer');
  await assert.rejects(auth.authorize(ownerB.token, orgA, { owner: true }), status(403));
  await assert.rejects(auth.register({ ...account('new-person'), inviteToken: elevated.token }), status(400));
  const lower = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  assert.deepEqual(await auth.acceptInvite(ownerA.token, { inviteToken: lower.token }), {
    organization: { id: orgA, name: 'Fictieve club A', role: 'owner' }, alreadyMember: true,
  });
  await assert.rejects(auth.removeMember(ownerA.token, orgA, ownerA.user.id), status(409));
  assert.equal((await auth.members(ownerA.token, orgA)).length, 2);
});

test('invitation preview and acceptance require an active signed-in session', async () => {
  let time = Date.parse('2026-09-08T10:00:00Z');
  const { auth, ownerA, ownerB, orgA } = await twoClubs({ now: () => new Date(time).toISOString() });
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  for (const token of [null, '', 'invalid', randomUUID()]) {
    await assert.rejects(auth.invitePreview(token, { inviteToken: invitation.token }), status(401));
    await assert.rejects(auth.acceptInvite(token, { inviteToken: invitation.token }), status(401));
  }
  time += AUTH_LIMITS.sessionMs;
  await assert.rejects(auth.acceptInvite(ownerB.token, { inviteToken: invitation.token }), status(401));
  const fresh = await auth.login(account('owner-b'));
  await auth.invitePreview(fresh.token, { inviteToken: invitation.token });
  await auth.logout(fresh.token);
  await assert.rejects(auth.acceptInvite(fresh.token, { inviteToken: invitation.token }), status(401));
});

test('bad, expired, revoked and used codes return the same generic error', async () => {
  let time = Date.parse('2026-09-08T10:00:00Z');
  const { auth, ownerA, ownerB, orgA } = await twoClubs({ now: () => new Date(time).toISOString() });
  const expired = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const revoked = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const used = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  await auth.revokeInvitation(ownerA.token, orgA, revoked.id);
  await auth.acceptInvite(ownerB.token, { inviteToken: used.token });
  time = Date.parse(expired.expiresAt);
  const fresh = await auth.login(account('owner-b'));
  for (const inviteToken of [null, '', 'A'.repeat(43), 'x'.repeat(100_000), expired.token, revoked.token, used.token, expired.id]) {
    for (const method of ['invitePreview', 'acceptInvite']) {
      await assert.rejects(auth[method](fresh.token, { inviteToken }), error => error.status === 400 && error.message === 'Uitnodiging is ongeldig, verlopen of al gebruikt.');
    }
  }
});

test('a preview grants no authority after the issuing owner is demoted or removed', async () => {
  const { auth, ownerA, ownerB, orgB } = await twoClubs();
  const coowner = await auth.invite(ownerB.token, orgB, { role: 'owner' });
  await auth.acceptInvite(ownerA.token, { inviteToken: coowner.token });
  const demoted = await auth.invite(ownerB.token, orgB, { role: 'scout' });
  await auth.invitePreview(ownerA.token, { inviteToken: demoted.token });
  await auth.setRole(ownerA.token, orgB, ownerB.user.id, { role: 'scout' });
  await assert.rejects(auth.acceptInvite(ownerA.token, { inviteToken: demoted.token }), status(400));
  assert.deepEqual(await auth.invitations(ownerA.token, orgB), []);
  await auth.setRole(ownerA.token, orgB, ownerB.user.id, { role: 'owner' });
  const removed = await auth.invite(ownerB.token, orgB, { role: 'scout' });
  await auth.removeMember(ownerA.token, orgB, ownerB.user.id);
  await assert.rejects(auth.invitePreview(ownerA.token, { inviteToken: removed.token }), status(400));
  await assert.rejects(auth.acceptInvite(ownerA.token, { inviteToken: removed.token }), status(400));
});

test('owner invite lists expose bounded metadata and safe IDs only for their own club', async () => {
  const { auth, ownerA, ownerB, orgA, orgB } = await twoClubs();
  const inviteA = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  const inviteB = await auth.invite(ownerB.token, orgB, { role: 'owner' });
  assert.equal(inviteA.id, hash(inviteA.token));
  const listed = await auth.invitations(ownerA.token, orgA);
  assert.equal(listed.length, 1);
  assert.deepEqual(Object.keys(listed[0]).sort(), ['createdAt', 'expiresAt', 'id', 'role']);
  assert.match(listed[0].id, /^[a-f0-9]{64}$/);
  assert.equal(listed[0].id, inviteA.id);
  assert.equal(JSON.stringify(listed).includes(inviteA.token), false);
  assert.equal(JSON.stringify(listed).includes(inviteB.id), false);
  listed[0].role = 'owner'; listed.length = 0;
  assert.equal((await auth.invitations(ownerA.token, orgA))[0].role, 'viewer');
  await assert.rejects(auth.invitePreview(ownerB.token, { inviteToken: inviteA.id }), status(400));
  await assert.rejects(auth.invitations(ownerA.token, orgB), status(403));
  await assert.rejects(auth.invitations(ownerB.token, orgA), status(403));
});

test('revocation is owner-scoped, never changes roles and prevents both forms of acceptance', async () => {
  const { auth, ownerA, ownerB, orgA, orgB } = await twoClubs();
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const joinViewer = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  await auth.acceptInvite(ownerB.token, { inviteToken: joinViewer.token });
  for (const method of ['invitations', 'revokeInvitation']) {
    await assert.rejects(auth[method](ownerB.token, orgA, invitation.id), status(403));
  }
  await auth.setRole(ownerA.token, orgA, ownerB.user.id, { role: 'scout' });
  await assert.rejects(auth.revokeInvitation(ownerB.token, orgA, invitation.id), status(403));
  await assert.rejects(auth.revokeInvitation(ownerB.token, orgB, invitation.id), status(404));
  for (const invalid of [null, '', '../accounts.json', invitation.token, 'f'.repeat(64)]) {
    await assert.rejects(auth.revokeInvitation(ownerA.token, orgA, invalid), status(404));
  }
  const members = await auth.members(ownerA.token, orgA);
  assert.deepEqual(await auth.revokeInvitation(ownerA.token, orgA, invitation.id), { revoked: true });
  assert.deepEqual(await auth.members(ownerA.token, orgA), members);
  await assert.rejects(auth.invitePreview(ownerB.token, { inviteToken: invitation.token }), status(400));
  await assert.rejects(auth.acceptInvite(ownerB.token, { inviteToken: invitation.token }), status(400));
  await assert.rejects(auth.register({ ...account('after-revoke'), inviteToken: invitation.token }), status(400));
  await assert.rejects(auth.revokeInvitation(ownerA.token, orgA, invitation.id), status(404));
});

test('two existing accounts cannot concurrently consume the same invitation', async () => {
  const { auth, ownerA, ownerB, orgA, orgB } = await twoClubs();
  const registration = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  const third = await auth.register({ ...account('candidate-c'), inviteToken: registration.token });
  const invitation = await auth.invite(ownerB.token, orgB, { role: 'scout' });
  const results = await Promise.allSettled([
    auth.acceptInvite(ownerA.token, { inviteToken: invitation.token }),
    auth.acceptInvite(third.token, { inviteToken: invitation.token }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 400);
  assert.equal((await auth.members(ownerB.token, orgB)).length, 2);
});

test('registration, acceptance and revocation share atomic one-use consumption', async () => {
  const { auth, ownerA, ownerB, orgA } = await twoClubs();
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const race = await Promise.allSettled([
    auth.acceptInvite(ownerB.token, { inviteToken: invitation.token }),
    auth.register({ ...account('new-person'), inviteToken: invitation.token }),
    auth.revokeInvitation(ownerA.token, orgA, invitation.id),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(race.filter(result => result.status === 'rejected').map(result => result.reason.status), [400, 404]);
  const next = await auth.invite(ownerA.token, orgA, { role: 'owner' });
  const revocationWins = await Promise.allSettled([
    auth.revokeInvitation(ownerA.token, orgA, next.id),
    auth.acceptInvite(ownerB.token, { inviteToken: next.token }),
  ]);
  assert.equal(revocationWins[0].status, 'fulfilled');
  assert.equal(revocationWins[1].reason.status, 400);
});

test('old version-1 stored invites keep stable IDs and accepted membership survives restart', async t => {
  const { dir } = await folder(t), path = join(dir, 'accounts.json');
  const { auth, ownerA, ownerB, orgA, orgB } = await twoClubs({ path });
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const persisted = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.deepEqual(Object.keys(persisted.invitations[0]).sort(), ['createdAt', 'createdBy', 'digest', 'expiresAt', 'orgId', 'role']);
  const validated = validateAccountState(persisted);
  assert.deepEqual(validated, persisted);
  validated.users[0].displayName = 'Detached validation result';
  assert.notEqual(persisted.users[0].displayName, validated.users[0].displayName);
  const invalid = structuredClone(persisted); invalid.memberships[0].role = 'viewer';
  assert.throws(() => validateAccountState(invalid), status(500));
  assert.equal(persisted.memberships[0].role, 'owner');
  const reopened = await createAuth({ path });
  const freshA = await reopened.login(account('owner-a')), freshB = await reopened.login(account('owner-b'));
  assert.equal((await reopened.invitations(freshA.token, orgA))[0].id, invitation.id);
  await reopened.acceptInvite(freshB.token, { inviteToken: invitation.token });
  const restarted = await createAuth({ path }), latest = await restarted.login(account('owner-b'));
  assert.equal(await restarted.session(freshB.token), null);
  assert.deepEqual(latest.organizations.map(org => org.id).sort(), [orgA, orgB].sort());
  assert.equal(latest.organizations.find(org => org.id === orgA).role, 'scout');
  await assert.rejects(restarted.acceptInvite(latest.token, { inviteToken: invitation.token }), status(400));
  assert.equal(latest.user.id, ownerB.user.id);
});

test('failed acceptance and revocation writes preserve accounts, membership and reusable invite', async t => {
  const temporary = await folder(t), path = join(temporary.dir, 'accounts.json');
  const { auth, ownerA, ownerB, orgA } = await twoClubs({ path });
  const invitation = await auth.invite(ownerA.token, orgA, { role: 'scout' });
  const before = await readFile(path, 'utf8');
  await rename(path, `${path}.backup`);
  await mkdir(path);
  await assert.rejects(auth.acceptInvite(ownerB.token, { inviteToken: invitation.token }), status(503));
  await assert.rejects(auth.revokeInvitation(ownerA.token, orgA, invitation.id), status(503));
  assert.equal((await auth.invitePreview(ownerB.token, { inviteToken: invitation.token })).alreadyMember, false);
  await assert.rejects(auth.authorize(ownerB.token, orgA), status(403));
  assert.equal((await auth.invitations(ownerA.token, orgA))[0].id, invitation.id);
  assert.equal(await readFile(`${path}.backup`, 'utf8'), before);
  await temporary.remove(path);
  await rename(`${path}.backup`, path);
  await auth.acceptInvite(ownerB.token, { inviteToken: invitation.token });
  assert.equal((await auth.authorize(ownerB.token, orgA)).organization.role, 'scout');
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).users, JSON.parse(before).users);
});

test('invite administration stays bounded and hides expired invitations without a write', async t => {
  let time = Date.parse('2026-09-08T10:00:00Z');
  const { dir } = await folder(t), path = join(dir, 'accounts.json');
  const { auth, ownerA, orgA } = await twoClubs({ path, now: () => new Date(time).toISOString() });
  for (let index = 0; index < AUTH_LIMITS.invitations; index += 1) await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  assert.equal((await auth.invitations(ownerA.token, orgA)).length, AUTH_LIMITS.invitations);
  await assert.rejects(auth.invite(ownerA.token, orgA, { role: 'viewer' }), status(409));
  const before = await readFile(path, 'utf8');
  time += AUTH_LIMITS.invitationMs;
  const fresh = await auth.login(account('owner-a'));
  assert.deepEqual(await auth.invitations(fresh.token, orgA), []);
  assert.equal(await readFile(path, 'utf8'), before);
  const next = await auth.invite(fresh.token, orgA, { role: 'scout' });
  assert.equal((await auth.invitations(fresh.token, orgA))[0].id, next.id);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).invitations.length, 1);
});
