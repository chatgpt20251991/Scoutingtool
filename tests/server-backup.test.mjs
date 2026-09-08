import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth, AUTH_LIMITS } from '../src/auth/index.mjs';
import { createOrganizationManager } from '../src/organizations/index.mjs';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/store.mjs';
import { applyImport, emptyImportState, previewImport, rollbackImport } from '../src/import/index.mjs';
import { openBackup, sealBackup } from '../src/backup/crypto.mjs';
import { createServerBackup, previewServerBackup, restoreServerBackup } from '../src/backup/server.mjs';

const run = promisify(execFile), NOW = '2026-09-08T04:00:00.000Z';
const PASSWORD = 'Synthetic server account passphrase';
const PASSPHRASE = 'Synthetic encrypted server backup phrase';
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const cli = new URL('../tools/server-backup.mjs', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const status = expected => error => error.status === expected;
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
async function write(path, value) { await writeFile(path, encode(value), { mode: 0o600 }); }
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'omniscout-server-backup-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}omniscout-server-backup-`));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function files(root) {
  const result = {};
  async function walk(folder, prefix = '') {
    for (const name of (await readdir(folder)).sort()) {
      const path = join(folder, name), info = await lstat(path), key = `${prefix}${name}`;
      if (info.isDirectory()) await walk(path, `${key}/`);
      else result[key] = hash(await readFile(path));
    }
  }
  await walk(root); return result;
}
async function fixture(t, { payload = sample, receipts = true } = {}) {
  const root = await temp(t), source = join(root, 'source'); await mkdir(source);
  const auth = await createAuth({ path: join(source, 'accounts.json'), now: () => NOW });
  const ownerA = await auth.setup({ username: 'owner-a', password: PASSWORD, displayName: 'Synthetic Owner A', organizationName: 'SYNTHETIC_CLUB_A' });
  const orgA = ownerA.organizations[0].id;
  const first = await auth.invite(ownerA.token, orgA, { role: 'viewer' });
  const ownerB = await auth.register({ username: 'owner-b', password: PASSWORD, displayName: 'Synthetic Owner B', inviteToken: first.token });
  const orgB = (await auth.createOrganization(ownerB.token, { name: 'SYNTHETIC_CLUB_B' })).id;
  await auth.removeMember(ownerA.token, orgA, ownerB.user.id);
  const unusedInvitation = await auth.invite(ownerA.token, orgA, { role: 'owner' });
  await mkdir(join(source, 'organizations'));
  const states = new Map();
  for (const [id, user, label] of [[orgA, ownerA.user.id, 'A'], [orgB, ownerB.user.id, 'B']]) {
    const state = emptyState();
    state.decisions.push({ id: 'matching-decision-id', playerId: 'p01', action: 'follow', reason: 'positive', note: `SYNTHETIC_PRIVATE_${label}`, at: NOW });
    state.audit.push({ id: 'matching-audit-id', action: 'decision.created', objectId: 'matching-decision-id', detail: 'Synthetic evidence', at: NOW, actor: user });
    state.imports = applyImport(structuredClone(payload), emptyImportState(), { now: NOW }).state;
    state.importJobs = []; state.importWorkspace = emptyState();
    states.set(id, state); await mkdir(join(source, 'organizations', id));
  }
  if (receipts) {
    const original = encode(emptyState()), digest = hash(original), recoveryId = randomUUID();
    await writeFile(join(source, 'state.json'), original);
    await write(join(source, 'legacy-claim.json'), { version: 1, organizationId: orgA, status: 'complete', digest, startedAt: NOW, completedAt: NOW });
    states.get(orgA)._legacyMigration = { version: 1, organizationId: orgA, digest, importedAt: NOW };
    states.get(orgA)._workspaceRestore = { version: 1, recoveryId, backupDigest: hash('synthetic previous state'), actor: ownerA.user.id, restoredAt: NOW };
    states.get(orgA).audit.push({ id: randomUUID(), action: 'workspace.restored', objectId: recoveryId, detail: 'Synthetic restore', at: NOW, actor: ownerA.user.id });
    const folder = join(source, 'organizations', orgA, 'recovery'); await mkdir(folder);
    await write(join(folder, `${recoveryId}.json`), { fixture: 'SYNTHETIC_OLD_RECOVERY_ONLY' });
  }
  for (const [id, state] of states) await write(join(source, 'organizations', id, 'state.json'), state);
  return { root, source, auth, ownerA, ownerB, orgA, orgB, states, unusedInvitation };
}
function client(app) {
  const cookies = new Map();
  const current = { csrf: '', org: '', async call(path, data) {
    const response = await fetch(app.base + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      ...(current.org ? { 'x-omniscout-organization': current.org } : {}),
      ...(data === undefined ? {} : { origin: app.base, 'content-type': 'application/json', 'x-omniscout-csrf': current.csrf }),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    for (const value of response.headers.getSetCookie()) { const item = value.split(';')[0], index = item.indexOf('='); cookies.set(item.slice(0, index), item.slice(index + 1)); }
    const body = await response.json(); if (body.csrf) current.csrf = body.csrf;
    return { status: response.status, body };
  } };
  return current;
}

test('full encrypted server backup restores real login and isolated scouting after fresh restart', async t => {
  const f = await fixture(t), original = await files(f.source);
  const envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const raw = JSON.stringify(envelope);
  for (const secret of [PASSWORD, PASSPHRASE, 'SYNTHETIC_CLUB_A', 'SYNTHETIC_PRIVATE_A', f.ownerA.token, f.unusedInvitation.token]) assert.equal(raw.includes(secret), false);
  assert.deepEqual(await files(f.source), original);
  const plan = await previewServerBackup({ envelope, passphrase: PASSPHRASE, now: NOW });
  assert.deepEqual(Object.keys(plan).sort(), ['counts', 'digest', 'exclusions']);
  assert.equal(plan.counts.users, 2); assert.equal(plan.counts.organizations, 2); assert.equal(plan.counts.memberships, 2);
  assert.equal(plan.counts.snapshots, 2); assert.equal(plan.counts.decisions, 2);
  const plaintext = await openBackup(envelope, PASSPHRASE);
  assert.deepEqual(plaintext.accounts.invitations, []);
  assert.equal(JSON.stringify(plaintext).includes('SYNTHETIC_OLD_RECOVERY_ONLY'), false);
  assert.ok(plaintext.organizations.every(org => !Object.hasOwn(org.state, '_legacyMigration') && !Object.hasOwn(org.state, '_workspaceRestore')));
  assert.equal(plaintext.manifest.length, 4);
  const destination = join(f.root, 'restored');
  const restored = await restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination, confirmDigest: plan.digest, now: NOW });
  assert.equal(restored.restored, true); assert.equal(restored.digest, plan.digest);
  assert.deepEqual(await files(f.source), original);
  assert.equal((await readdir(destination)).includes('state.json'), false);
  const app = await createApp({ dataDir: destination, legacyStatePath: join(destination, 'state.json'), now: () => NOW });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); app.base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal(await app.auth.session(f.ownerA.token), null);
    for (const [username, org, other, note] of [['owner-a', f.orgA, f.orgB, 'SYNTHETIC_PRIVATE_A'], ['owner-b', f.orgB, f.orgA, 'SYNTHETIC_PRIVATE_B']]) {
      const browser = client(app); assert.equal((await browser.call('/api/session')).body.authenticated, false);
      const login = await browser.call('/api/auth/login', { username, password: PASSWORD }); assert.equal(login.status, 200);
      browser.org = org; assert.equal((await browser.call('/api/state')).body.decisions[0].note, note);
      assert.equal((await browser.call('/api/catalog?dataset=import')).body.players.length, sample.players.length);
      browser.org = other; assert.equal((await browser.call('/api/state')).status, 403);
    }
    await assert.rejects(app.auth.register({ username: 'excluded-invite', password: PASSWORD, inviteToken: f.unusedInvitation.token }), status(400));
  } finally { await app.close(); }
});

test('a running or stale server lock is never stolen and source files stay unchanged', async t => {
  const f = await fixture(t), manager = await createOrganizationManager({ dataDir: f.source, now: () => NOW });
  const locked = await files(f.source);
  try { await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(409)); assert.deepEqual(await files(f.source), locked); }
  finally { await manager.close(); }
  const lockPath = join(f.source, '.organization-manager.lock'); await write(lockPath, { version: 1, pid: 2147483000, nonce: randomUUID(), createdAt: NOW });
  const stale = await readFile(lockPath, 'utf8');
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(409));
  assert.equal(await readFile(lockPath, 'utf8'), stale);
});

test('queued jobs and pending or inconsistent migration claims refuse backup without processing jobs', async t => {
  const f = await fixture(t), path = join(f.source, 'organizations', f.orgA, 'state.json');
  const state = structuredClone(f.states.get(f.orgA));
  const digest = previewImport(sample, emptyImportState(), { now: NOW }).digest;
  state.importJobs = [{ id: 'pending-test-job', snapshotId: sample.snapshotId, digest, status: 'queued', attempts: 0, maxAttempts: 3,
    error: null, result: null, createdAt: NOW, updatedAt: NOW, payload: sample }];
  await write(path, state);
  const before = await files(f.source);
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(409));
  assert.deepEqual(await files(f.source), before);
  await write(path, f.states.get(f.orgA));
  const claimPath = join(f.source, 'legacy-claim.json'), claim = JSON.parse(await readFile(claimPath, 'utf8'));
  await write(claimPath, { version: 1, organizationId: f.orgA, status: 'pending', digest: claim.digest, startedAt: NOW });
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(409));
  await write(claimPath, { ...claim, digest: 'f'.repeat(64) });
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400));
});

test('bad passwords and tampering fail before any destination is created', async t => {
  const f = await fixture(t), envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const destination = join(f.root, 'bad-restore');
  await assert.rejects(previewServerBackup({ envelope, passphrase: 'A different synthetic passphrase', now: NOW }), status(400));
  const corrupted = structuredClone(envelope), bytes = Buffer.from(corrupted.ciphertext, 'base64'); bytes[5] ^= 1; corrupted.ciphertext = bytes.toString('base64');
  await assert.rejects(restoreServerBackup({ envelope: corrupted, passphrase: PASSPHRASE, destination, confirmDigest: 'a'.repeat(64), now: NOW }), status(400));
  await assert.rejects(lstat(destination), error => error.code === 'ENOENT');
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.omniscout-server-stage-')), false);
});

test('manifest path forgery, missing clubs, hashes and invitations are rejected after decryption', async t => {
  const f = await fixture(t), envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const original = await openBackup(envelope, PASSPHRASE);
  for (const alter of [
    data => { data.manifest[0].path = '../outside.json'; },
    data => { data.manifest[0].sha256 = '0'.repeat(64); },
    data => { data.organizations.pop(); },
    data => { data.organizations[0].state.unknownSecret = 'must reject'; },
    data => { data.accounts.invitations.push({ invalid: true }); },
  ]) {
    const changed = structuredClone(original); alter(changed);
    const forged = await sealBackup(changed, PASSPHRASE);
    await assert.rejects(previewServerBackup({ envelope: forged, passphrase: PASSPHRASE, now: NOW }), status(400));
  }
  assert.equal((await readdir(f.root)).length, 1);
});

test('current rights apply to retained rollback history during create, preview and restore', async t => {
  const payload = structuredClone(sample); payload.source.expiresAt = '2026-09-08T05:00:00.000Z';
  const f = await fixture(t, { payload });
  for (const [id, current] of f.states) { current.imports = rollbackImport(payload.snapshotId, current.imports, { now: NOW }).state; await write(join(f.source, 'organizations', id, 'state.json'), current); }
  const envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const plan = await previewServerBackup({ envelope, passphrase: PASSPHRASE, now: NOW });
  const later = '2026-09-08T05:00:00.000Z';
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: later }), status(403));
  let createReads = 0;
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: () => ++createReads === 1 ? NOW : later }), status(403));
  assert.equal(createReads, 2);
  await assert.rejects(previewServerBackup({ envelope, passphrase: PASSPHRASE, now: later }), status(403));
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: join(f.root, 'expired'), confirmDigest: plan.digest, now: later }), status(403));
  await assert.rejects(lstat(join(f.root, 'expired')), error => error.code === 'ENOENT');
  let clockReads = 0;
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: join(f.root, 'expired-during-restore'), confirmDigest: plan.digest,
    now: () => ++clockReads <= 2 ? NOW : later }), status(403));
  assert.equal(clockReads, 3);
  await assert.rejects(lstat(join(f.root, 'expired-during-restore')), error => error.code === 'ENOENT');
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.omniscout-server-stage-')), false);
});

test('unknown files, orphan clubs, malformed accounts and oversized accounts fail closed', async t => {
  const f = await fixture(t), accountPath = join(f.source, 'accounts.json'), original = await readFile(accountPath);
  const unknown = join(f.source, 'unknown.json'); await write(unknown, { synthetic: true });
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400)); await unlink(unknown);
  const orphan = join(f.source, 'organizations', randomUUID()); await mkdir(orphan);
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400)); await rmdir(orphan);
  await writeFile(accountPath, '{malformed');
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400));
  assert.equal(await readFile(accountPath, 'utf8'), '{malformed');
  await writeFile(accountPath, ' '.repeat(AUTH_LIMITS.fileBytes + 1));
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(413));
  await writeFile(accountPath, original);
});

test('existing or unsafe restore destinations remain unchanged and mismatched confirmation cannot restore', async t => {
  const f = await fixture(t), envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const plan = await previewServerBackup({ envelope, passphrase: PASSPHRASE, now: NOW });
  const existing = join(f.root, 'existing'); await mkdir(existing);
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: existing, confirmDigest: plan.digest, now: NOW }), status(409));
  await writeFile(join(existing, 'keep.txt'), 'SYNTHETIC_KEEP');
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: existing, confirmDigest: plan.digest, now: NOW }), status(409));
  assert.equal(await readFile(join(existing, 'keep.txt'), 'utf8'), 'SYNTHETIC_KEEP');
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: join(f.root, 'fresh'), confirmDigest: '0'.repeat(64), now: NOW }), status(409));
  await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: `${f.root}${sep}..${sep}outside`, confirmDigest: plan.digest, now: NOW }), status(400));
  const linked = join(f.root, 'linked-parent'); await symlink(existing, linked, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: join(linked, 'new'), confirmDigest: plan.digest, now: NOW }), status(400)); }
  finally { await unlink(linked); }
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.omniscout-server-stage-')), false);
});

test('hardlinked account files and junction organization folders are refused', async t => {
  const f = await fixture(t), copied = join(f.root, 'linked-accounts.json');
  await link(join(f.source, 'accounts.json'), copied);
  await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400)); await unlink(copied);
  const folder = join(f.source, 'organizations', f.orgB), actual = join(f.root, 'actual-club');
  await rename(folder, actual); await symlink(actual, folder, process.platform === 'win32' ? 'junction' : 'dir');
  try { await assert.rejects(createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW }), status(400)); }
  finally { await unlink(folder); await rename(actual, folder); }
});

test('unwritten new organizations are explicitly backed up as empty while source files stay unchanged', async t => {
  const f = await fixture(t), empty = await f.auth.createOrganization(f.ownerA.token, { name: 'Synthetic unopened club' });
  const before = await files(f.source), envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const plain = await openBackup(envelope, PASSPHRASE);
  assert.deepEqual(plain.organizations.find(org => org.id === empty.id).state, emptyState());
  assert.deepEqual(await files(f.source), before);
});

test('concurrent full restores publish once and leave no owned staging directories', async t => {
  const f = await fixture(t), envelope = await createServerBackup({ dataDir: f.source, passphrase: PASSPHRASE, now: NOW });
  const plan = await previewServerBackup({ envelope, passphrase: PASSPHRASE, now: NOW }), destination = join(f.root, 'concurrent');
  const destinations = [destination, process.platform === 'win32' ? destination.toUpperCase() : destination];
  const result = await Promise.allSettled(destinations.map(target => restoreServerBackup({ envelope, passphrase: PASSPHRASE, destination: target, confirmDigest: plan.digest, now: NOW })));
  assert.equal(result.filter(entry => entry.status === 'fulfilled').length, 1);
  assert.equal(result.find(entry => entry.status === 'rejected').reason.status, 409);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.omniscout-server-stage-') || name.startsWith('.omniscout-restore-')), false);
});

test('CLI supports private-file create, inspect and confirmed restore without plaintext stdout or overwrites', async t => {
  const f = await fixture(t), phrase = join(f.root, 'phrase.txt'), output = join(f.root, 'server.osbackup');
  await writeFile(phrase, `${PASSPHRASE}\n`, { mode: 0o600 });
  const command = args => run(process.execPath, [fileURLToPath(cli), ...args], { maxBuffer: 1024 * 1024 });
  const created = await command(['create', '--data-dir', f.source, '--output', output, '--passphrase-file', phrase]);
  assert.equal(JSON.parse(created.stdout).created, true);
  assert.equal(`${created.stdout}${created.stderr}`.includes(PASSPHRASE), false);
  const inspected = await command(['inspect', '--input', output, '--passphrase-file', phrase]), plan = JSON.parse(inspected.stdout);
  assert.equal(plan.counts.organizations, 2); assert.equal(inspected.stdout.includes('SYNTHETIC_CLUB_A'), false);
  const restored = await command(['restore', '--input', output, '--destination', join(f.root, 'cli-restored'), '--confirm', plan.digest, '--passphrase-file', phrase]);
  assert.equal(JSON.parse(restored.stdout).restored, true);
  const previous = await readFile(output, 'utf8');
  await assert.rejects(command(['create', '--data-dir', f.source, '--output', output, '--passphrase-file', phrase]));
  assert.equal(await readFile(output, 'utf8'), previous);
  const misleadingName = join(f.source, '..backup.osbackup');
  await assert.rejects(command(['create', '--data-dir', f.source, '--output', misleadingName, '--passphrase-file', phrase]), error => error.stderr.includes('buiten de actieve datamap'));
  await assert.rejects(lstat(misleadingName), error => error.code === 'ENOENT');
  const git = join(f.root, 'fake-repo'); await mkdir(git); await mkdir(join(git, '.git'));
  const unsafePhrase = join(git, 'phrase.txt'); await writeFile(unsafePhrase, PASSPHRASE, { mode: 0o600 });
  await assert.rejects(command(['inspect', '--input', output, '--passphrase-file', unsafePhrase]), error => error.stderr.includes('buiten iedere Git-werkmap') && !error.stderr.includes(PASSPHRASE));
});
