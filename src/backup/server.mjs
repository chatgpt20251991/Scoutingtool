import { randomUUID, createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { AUTH_LIMITS, validateAccountState } from '../auth/index.mjs';
import { emptyState } from '../store.mjs';
import { MAX_BACKUP_BYTES, openBackup, sealBackup } from './crypto.mjs';
import { stateDigest, validateWorkspaceState } from './workspace.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEX = /^[a-f0-9]{64}$/;
const LOCK = '.organization-manager.lock';
const EXCLUSIONS = Object.freeze(['sessions', 'invitations', 'private_recovery_copies', 'legacy_source', 'original_migration_registry', 'internal_migration_and_restore_receipts']);
const fail = (status, message) => Object.assign(new Error(message), { status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function timestamp(now) {
  const date = new Date(typeof now === 'function' ? now() : now ?? Date.now());
  if (!Number.isFinite(date.getTime())) throw fail(400, 'Ongeldige back-upklok.');
  return date.toISOString();
}
function fields(value, allowed, required = allowed) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw fail(400, 'Serverback-up bevat ongeldige of onbekende velden.');
  }
}
function date(value, now) {
  if (typeof value !== 'string' || value.length > 30 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)
    || Date.parse(value) > Date.parse(now)) throw fail(400, 'Serverback-up bevat een ongeldige of toekomstige tijd.');
}
function localPath(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\0-\x1f]/.test(value)
    || value.split(/[\\/]/).includes('..')) throw fail(400, 'Gebruik een geldig lokaal pad zonder bovenliggende padsegmenten.');
  return resolve(value);
}
async function exists(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
/** Every existing ancestor must be a real directory, never a junction or symlink. */
async function safePath(path, kind, optional = false) {
  const absolute = localPath(path), root = parse(absolute).root;
  const pieces = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root, info = await lstat(root);
  for (let index = 0; index < pieces.length; index += 1) {
    current = join(current, pieces[index]);
    info = await exists(current);
    if (!info) {
      if (optional && index === pieces.length - 1) return null;
      throw fail(400, 'Een vereist opslagpad ontbreekt.');
    }
    if (info.isSymbolicLink() || (index < pieces.length - 1 && !info.isDirectory())) throw fail(400, 'Koppelingen zijn niet toegestaan in back-uppaden.');
  }
  if ((kind === 'directory' && !info.isDirectory()) || (kind === 'file' && (!info.isFile() || info.nlink !== 1))) {
    throw fail(400, 'Een gewoon bestand of gewone map zonder koppelingen is vereist.');
  }
  if (!samePath(await realpath(absolute), absolute)) throw fail(400, 'Het opslagpad verwijst naar een andere locatie.');
  return info;
}
async function readJSON(path, max, budget = null) {
  const expected = await safePath(path, 'file');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== expected.dev || info.ino !== expected.ino) throw fail(400, 'Een gelezen bestand is gewijzigd of onveilig.');
    if (info.size > max || (budget && info.size > budget.remaining)) throw fail(413, 'Serverback-up overschrijdt de toegestane bestandsgrootte.');
    // A bounded read also prevents a file growing between stat and readFile from bypassing the cap.
    const bytes = Buffer.alloc(Math.min(info.size, max, budget?.remaining ?? max) + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > max || (budget && length > budget.remaining)) throw fail(413, 'Serverback-up overschrijdt de toegestane bestandsgrootte.');
    if (length !== info.size || (await handle.stat()).size !== info.size) throw fail(409, 'Een bronbestand veranderde tijdens de back-up; probeer opnieuw met een gestopte server.');
    if (budget) budget.remaining -= length;
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
    catch { throw fail(400, 'Een back-upbestand bevat ongeldige JSON.'); }
  } finally { await handle.close(); }
}
async function exclusiveLock(path, at) {
  await safePath(dirname(path), 'directory');
  await safePath(path, 'file', true);
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw fail(409, 'De opslag is vergrendeld. Stop de server; een bestaande lock wordt nooit overgenomen.'); throw error; }
  const nonce = randomUUID();
  try { await handle.writeFile(JSON.stringify({ version: 1, pid: process.pid, nonce, createdAt: at })); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }
  await handle.close();
  return async () => {
    const saved = await readJSON(path, 4096);
    if (saved.nonce !== nonce) throw fail(409, 'De vergrendeling is gewijzigd; deze is niet automatisch verwijderd.');
    await unlink(path);
  };
}
function accountsDocument(input) {
  if (Buffer.byteLength(encode(input)) > AUTH_LIMITS.fileBytes) throw fail(413, 'Accountopslag overschrijdt 2 MiB.');
  let checked;
  try { checked = validateAccountState(input); }
  catch { throw fail(400, 'Serverback-up bevat ongeldige accounts, rollen of relaties.'); }
  if (!checked.users.length || !checked.organizations.length) throw fail(400, 'Stel de lokale server in voordat je een volledige back-up maakt.');
  return checked;
}
function inspectClaim(claim, accounts, at) {
  if (claim === null) return null;
  fields(claim, ['version', 'organizationId', 'status', 'digest', 'startedAt', 'completedAt'], ['version', 'organizationId', 'status']);
  if (claim.version !== 1 || !accounts.organizations.some(org => org.id === claim.organizationId)) throw fail(400, 'Migratieregister verwijst naar een onbekende club.');
  if (claim.status === 'pending') throw fail(409, 'Voltooi of herstel eerst de openstaande legacy-migratie.');
  if (claim.status === 'absent') {
    fields(claim, ['version', 'organizationId', 'status', 'completedAt']); date(claim.completedAt, at);
  } else if (claim.status === 'complete') {
    fields(claim, ['version', 'organizationId', 'status', 'digest', 'startedAt', 'completedAt']);
    if (!HEX.test(claim.digest)) throw fail(400, 'Migratieregister bevat een ongeldige digest.');
    date(claim.startedAt, at); date(claim.completedAt, at);
    if (Date.parse(claim.completedAt) < Date.parse(claim.startedAt)) throw fail(400, 'Migratietijden zijn inconsistent.');
  } else throw fail(400, 'Onbekende migratiestatus.');
  return claim;
}
function stripReceipts(raw, id, claim, at) {
  if (!plain(raw)) throw fail(400, 'Een clubstatebestand is ongeldig.');
  if (Object.hasOwn(raw, '_legacyMigration')) {
    const receipt = raw._legacyMigration;
    fields(receipt, ['version', 'organizationId', 'digest', 'importedAt']); date(receipt.importedAt, at);
    if (receipt.version !== 1 || receipt.organizationId !== id || !HEX.test(receipt.digest)
      || claim?.status !== 'complete' || claim.organizationId !== id || claim.digest !== receipt.digest
      || Date.parse(receipt.importedAt) > Date.parse(claim.completedAt)) throw fail(400, 'Legacy-ontvangstbewijs en migratieregister zijn inconsistent.');
  } else if (claim?.status === 'complete' && claim.organizationId === id) throw fail(400, 'Voltooide migratie mist het ontvangstbewijs in de clubopslag.');
  if (Object.hasOwn(raw, '_workspaceRestore')) {
    const receipt = raw._workspaceRestore;
    fields(receipt, ['version', 'recoveryId', 'backupDigest', 'actor', 'restoredAt']); date(receipt.restoredAt, at);
    if (receipt.version !== 1 || !UUID.test(receipt.recoveryId) || !HEX.test(receipt.backupDigest) || !UUID.test(receipt.actor)
      || !raw.audit?.some(event => event.action === 'workspace.restored' && event.objectId === receipt.recoveryId
        && event.actor === receipt.actor && event.at === receipt.restoredAt)) throw fail(400, 'Herstelontvangstbewijs is inconsistent.');
  }
  const { _legacyMigration, _workspaceRestore, ...state } = raw;
  return state;
}
async function checkRecoveryDirectory(path) {
  if (!await safePath(path, 'directory', true)) return;
  const names = await readdir(path);
  if (names.length > 10) throw fail(400, 'De lokale herstelmap overschrijdt de bekende limiet.');
  for (const name of names) {
    if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) throw fail(400, 'De lokale herstelmap bevat onbekende bestanden.');
    await safePath(join(path, name), 'file');
  }
}
function normalizedClaim(accounts, at) { return { version: 1, organizationId: accounts.organizations[0].id, status: 'absent', completedAt: at }; }
function bundleFiles(bundle) {
  return [ { path: 'accounts.json', data: bundle.accounts }, { path: 'legacy-claim.json', data: bundle.legacyClaim },
    ...bundle.organizations.map(org => ({ path: `organizations/${org.id}/state.json`, data: org.state })) ];
}
function manifest(bundle) {
  return bundleFiles(bundle).map(file => { const bytes = encode(file.data); return { path: file.path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }; });
}
function inspectBundle(bundle, now) {
  const at = timestamp(now);
  stateDigest(bundle); // Reject oversized, non-JSON, cyclic or dangerous input before interpreting it.
  fields(bundle, ['format', 'version', 'createdAt', 'accounts', 'organizations', 'legacyClaim', 'manifest', 'exclusions', 'digest']);
  if (bundle.format !== 'omniscout-server' || bundle.version !== 1) throw fail(400, 'Dit is geen ondersteunde volledige serverback-up.');
  date(bundle.createdAt, at);
  const accounts = accountsDocument(bundle.accounts);
  if (accounts.invitations.length) throw fail(400, 'Uitnodigingen mogen niet worden hersteld uit een serverback-up.');
  if (!Array.isArray(bundle.organizations) || bundle.organizations.length !== accounts.organizations.length
    || bundle.organizations.length > AUTH_LIMITS.organizations) throw fail(400, 'Het servermanifest bevat niet precies alle clubs.');
  const expectedIds = accounts.organizations.map(org => org.id).sort(), seen = new Set();
  const counts = { users: accounts.users.length, organizations: expectedIds.length, memberships: accounts.memberships.length,
    decisions: 0, tasks: 0, auditEvents: 0, snapshots: 0, importJobs: 0 };
  for (const entry of bundle.organizations) {
    fields(entry, ['id', 'state']);
    if (!UUID.test(entry.id) || !expectedIds.includes(entry.id) || seen.has(entry.id)) throw fail(400, 'Het servermanifest heeft een onbekende of dubbele club.');
    seen.add(entry.id);
    const checked = validateWorkspaceState(entry.state, { now: at, allowPending: false, checkRights: true });
    const values = checked.summary.counts;
    counts.decisions += values.demo.decisions + values.import.decisions;
    counts.tasks += values.demo.tasks + values.import.tasks;
    counts.auditEvents += values.demo.audit + values.import.audit;
    counts.snapshots += values.snapshots; counts.importJobs += values.jobs;
  }
  if (stateDigest(bundle.legacyClaim) !== stateDigest(normalizedClaim(accounts, bundle.createdAt))) throw fail(400, 'Het herstelregister komt niet overeen met de actieve serverback-up.');
  if (stateDigest(bundle.exclusions) !== stateDigest(EXCLUSIONS)) throw fail(400, 'De back-upuitsluitingen zijn gewijzigd.');
  if (stateDigest(bundle.manifest) !== stateDigest(manifest(bundle))) throw fail(400, 'Bestandspaden, groottes of hashes in het servermanifest komen niet overeen.');
  const { digest, ...content } = bundle;
  if (typeof digest !== 'string' || !HEX.test(digest) || stateDigest(content) !== digest) throw fail(400, 'De serverback-updigest komt niet overeen.');
  return { digest, counts, exclusions: [...EXCLUSIONS] };
}

/** An offline, active-state snapshot. Holding the same exclusive lock prevents server startup. */
export async function createServerBackup({ dataDir, passphrase, now } = {}) {
  const root = localPath(dataDir), at = timestamp(now);
  await safePath(root, 'directory');
  const release = await exclusiveLock(join(root, LOCK), at);
  try {
    const rootNames = await readdir(root), allowed = ['accounts.json', 'organizations', 'legacy-claim.json', 'state.json', LOCK];
    if (rootNames.some(name => !allowed.includes(name))) throw fail(400, 'De datamap bevat onbekende bestanden; beoordeel die vóór back-up.');
    const budget = { remaining: MAX_BACKUP_BYTES };
    const originalAccounts = accountsDocument(await readJSON(join(root, 'accounts.json'), AUTH_LIMITS.fileBytes, budget));
    const accounts = { ...originalAccounts, invitations: [] };
    const claimPath = join(root, 'legacy-claim.json');
    const claim = inspectClaim(await safePath(claimPath, 'file', true) ? await readJSON(claimPath, 4096) : null, accounts, at);
    const legacy = await safePath(join(root, 'state.json'), 'file', true);
    if (legacy && !claim) throw fail(409, 'Oude lokale opslag heeft nog geen gecontroleerd migratieregister.');
    const orgRoot = join(root, 'organizations');
    const orgExists = await safePath(orgRoot, 'directory', true), names = orgExists ? await readdir(orgRoot) : [];
    const ids = accounts.organizations.map(org => org.id).sort();
    if (names.some(name => !UUID.test(name) || !ids.includes(name))) throw fail(400, 'Organisatieopslag bevat een onbekende of verweesde map.');
    const organizations = [];
    for (const id of ids) {
      const folder = join(orgRoot, id);
      let raw = emptyState();
      if (names.includes(id)) {
        await safePath(folder, 'directory');
        const entries = await readdir(folder);
        if (entries.some(name => !['state.json', 'recovery'].includes(name))) throw fail(400, 'Een clubmap bevat onbekende bestanden.');
        if (entries.includes('recovery') && !entries.includes('state.json')) throw fail(400, 'Een herstelmap mist de bijbehorende actieve clubopslag.');
        if (entries.includes('state.json')) raw = await readJSON(join(folder, 'state.json'), MAX_BACKUP_BYTES, budget);
        await checkRecoveryDirectory(join(folder, 'recovery'));
      }
      const state = stripReceipts(raw, id, claim, at);
      organizations.push({ id, state: validateWorkspaceState(state, { now: at, allowPending: false, checkRights: true }).state });
    }
    const content = { format: 'omniscout-server', version: 1, createdAt: at, accounts, organizations,
      legacyClaim: normalizedClaim(accounts, at), manifest: [], exclusions: [...EXCLUSIONS] };
    content.manifest = manifest(content);
    const bundle = { ...content, digest: stateDigest(content) };
    inspectBundle(bundle, at);
    const envelope = await sealBackup(bundle, passphrase);
    inspectBundle(bundle, timestamp(now));
    return envelope;
  } finally { await release(); }
}

export async function previewServerBackup({ envelope, passphrase, now } = {}) {
  return inspectBundle(await openBackup(envelope, passphrase), now);
}

async function writePrivate(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(encode(value)); await handle.sync(); }
  finally { await handle.close(); }
}
async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (error) { if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
async function cleanupOwnedStaging(path, parent, identity) {
  const info = await exists(path);
  if (!info) return;
  const name = relative(parent, path);
  if (isAbsolute(name) || name.includes(sep) || !name.startsWith('.omniscout-server-stage-') || info.dev !== identity.dev || info.ino !== identity.ino) {
    throw fail(409, 'De tijdelijke herstelmap is gewijzigd en blijft behouden voor controle.');
  }
  async function checkTree(directory) {
    await safePath(directory, 'directory');
    for (const name of await readdir(directory)) {
      const child = join(directory, name), info = await lstat(child);
      if (info.isDirectory() && !info.isSymbolicLink()) await checkTree(child);
      else await safePath(child, 'file');
    }
  }
  await checkTree(path);
  await rm(path, { recursive: true });
}

/** Restore to a fresh destination only. Existing directories, including empty ones, are refused. */
export async function restoreServerBackup({ envelope, passphrase, destination, confirmDigest, now } = {}) {
  const target = localPath(destination), parent = dirname(target), at = timestamp(now);
  if (await exists(target)) throw fail(409, 'Herstel vereist een nieuwe, nog niet bestaande bestemmingsmap.');
  await safePath(parent, 'directory');
  const bundle = await openBackup(envelope, passphrase), plan = inspectBundle(bundle, timestamp(now));
  if (typeof confirmDigest !== 'string' || !HEX.test(confirmDigest) || confirmDigest !== plan.digest) throw fail(409, 'Bevestig exact de digest uit de gecontroleerde serverback-uppreview.');
  const guardKey = process.platform === 'win32' ? target.toLowerCase() : target;
  const guard = join(parent, `.omniscout-restore-${sha256(guardKey).slice(0, 24)}.lock`);
  const release = await exclusiveLock(guard, at);
  let staging, identity, published = false;
  try {
    if (await exists(target)) throw fail(409, 'De herstelbestemming is inmiddels aangemaakt; bestaande gegevens blijven behouden.');
    staging = await mkdtemp(join(parent, '.omniscout-server-stage-'));
    identity = await lstat(staging);
    await mkdir(join(staging, 'organizations'), { mode: 0o700 });
    for (const file of bundleFiles(bundle)) {
      const path = resolve(staging, file.path), within = relative(staging, path);
      if (!within || within.startsWith('..') || isAbsolute(within)) throw fail(400, 'Onveilig pad in het herstelmanifest.');
      if (file.path.startsWith('organizations/')) await mkdir(dirname(path), { mode: 0o700 });
      await writePrivate(path, file.data);
      const readBack = await readJSON(path, file.path === 'accounts.json' ? AUTH_LIMITS.fileBytes : MAX_BACKUP_BYTES);
      if (sha256(encode(readBack)) !== sha256(encode(file.data))) throw fail(400, 'Controle van een geschreven herstelbestand is mislukt.');
      await syncDirectory(dirname(path));
    }
    await syncDirectory(join(staging, 'organizations'));
    await syncDirectory(staging);
    // All content and paths are validated while staged; cooperating restorers share the guard.
    await safePath(parent, 'directory');
    if (await exists(target)) throw fail(409, 'De herstelbestemming is inmiddels aangemaakt; bestaande gegevens blijven behouden.');
    // Rights can expire during scrypt or staging; preview time grants no later authority.
    inspectBundle(bundle, timestamp(now));
    await rename(staging, target);
    published = true;
    try { await syncDirectory(parent); }
    catch { throw fail(503, 'De herstelmap is gepubliceerd, maar de afsluitende opslagflush mislukte. Controleer de nieuwe map vóór gebruik.'); }
    return { restored: true, ...plan };
  } finally {
    try { if (staging && !published) await cleanupOwnedStaging(staging, parent, identity); }
    finally { await release(); }
  }
}
