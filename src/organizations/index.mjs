import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createStore, emptyState } from '../store.mjs';
import { emptyImportState, MAX_IMPORT_BYTES, previewImport } from '../import/index.mjs';
import { createImportQueue, MAX_IMPORT_JOBS, MAX_PENDING_IMPORT_JOBS, MAX_IMPORT_ATTEMPTS } from '../ingestion/index.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCK = '.organization-manager.lock';
const CLAIM = 'legacy-claim.json';
const RECEIPT = '_legacyMigration';
const MAX_LEGACY_BYTES = 512 * 1024 * 1024;
const MAX_ORGANIZATIONS = 50;
const sensitive = /^(?:password(?:hash|salt)?|passwd|credentials?|secret|clientsecret|apikey|accesskey|privatekey|token|accesstoken|refreshtoken|sessiontoken|invitetoken|authorization|cookie|sessions?|accounts|users|invitations)$/i;
const error = (message, status = 409) => Object.assign(new Error(message), { status });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function organizationId(id) {
  if (typeof id !== 'string' || !UUID.test(id)) throw error('Ongeldig organisatie-ID; een UUID is vereist.', 400);
  return id.toLowerCase();
}
async function exists(path) {
  try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function regularFile(path, optional = false) {
  const info = await exists(path);
  if (!info && optional) return null;
  if (!info?.isFile() || info.isSymbolicLink() || info.nlink > 1) throw error('Opslag vereist een gewoon bestand zonder koppelingen.');
  return info;
}
async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw error('Opslagmap mag geen symbolische koppeling zijn.');
}
async function syncDirectory(path) {
  let handle;
  try { handle = await open(path, 'r'); await handle.sync(); }
  catch (e) { if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL', 'ENOTSUP'].includes(e.code)) throw e; }
  finally { await handle?.close(); }
}
async function atomicJSON(path, value) {
  await regularFile(path, true);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, path);
  } catch (e) { await unlink(temporary).catch(() => {}); throw e; }
}
function sanitize(value, depth = 0) {
  if (depth > 24) throw error('Het oude statebestand is te diep genest.');
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (!plain(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw error('Het oude statebestand bevat gereserveerde sleutels.');
    if (!sensitive.test(key.replace(/[_-]/g, ''))) result[key] = sanitize(child, depth + 1);
  }
  return result;
}
function validateWorkspace(value) {
  if (!plain(value) || value.version !== 1 || !['decisions', 'tasks', 'audit'].every(key => Array.isArray(value[key]) && value[key].every(plain))
    || !plain(value.brief) || value.tasks.length > 2000 || value.audit.length > 20000) throw error('Ongeldig versie-1 scoutingwerkgebied; handmatig herstel vereist.');
}
function legacyState(raw) {
  if (!plain(raw)) throw error('Ongeldig versie-1 statebestand.');
  const result = {};
  for (const key of ['version', 'decisions', 'tasks', 'brief', 'audit', 'imports', 'importJobs', 'importWorkspace']) {
    if (Object.hasOwn(raw, key)) result[key] = sanitize(raw[key]);
  }
  validateWorkspace(result);
  if (result.importWorkspace !== undefined) validateWorkspace(result.importWorkspace);
  if (result.audit.length + (result.importWorkspace?.audit.length || 0) > 20000) throw error('Het oude beslislog overschrijdt de opslaglimiet.');
  const imports = result.imports || emptyImportState();
  if (!plain(imports) || imports.schemaVersion !== 1 || !Array.isArray(imports.snapshots) || imports.snapshots.length > 200
    || !Array.isArray(imports.history) || imports.history.length > 20000) throw error('Ongeldige oude importopslag.');
  const previous = emptyImportState();
  for (const snapshot of imports.snapshots) {
    if (!plain(snapshot) || !Number.isFinite(Date.parse(snapshot.importedAt))) throw error('Ongeldige oude importsnapshot.');
    // Historical rights are checked at original import time, never revived for current reads.
    const preview = previewImport(snapshot.payload, previous, { now: snapshot.importedAt });
    if (!preview.valid || snapshot.snapshotId !== snapshot.payload.snapshotId || snapshot.digest !== preview.digest) throw error('Oude importsnapshot faalt validatie; bronbestand behouden.');
    previous.snapshots.push(snapshot);
  }
  const snapshotIds = new Set(imports.snapshots.map(item => item.snapshotId));
  if (snapshotIds.size !== imports.snapshots.length || imports.history.some(item => !plain(item) || !['import', 'rollback'].includes(item.type)
    || !snapshotIds.has(item.snapshotId) || !Number.isFinite(Date.parse(item.at)))) throw error('Ongeldige oude importhistorie.');
  const jobs = result.importJobs || [];
  const jobIds = new Set();
  if (!Array.isArray(jobs) || jobs.length > MAX_IMPORT_JOBS) throw error('Ongeldige oude importwachtrij.');
  for (const job of jobs) {
    if (!plain(job) || typeof job.id !== 'string' || !job.id || jobIds.has(job.id) || !['queued', 'running', 'succeeded', 'failed'].includes(job.status)
      || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > MAX_IMPORT_ATTEMPTS || job.maxAttempts !== MAX_IMPORT_ATTEMPTS
      || !Number.isFinite(Date.parse(job.createdAt)) || !plain(job.payload)) throw error('Ongeldige oude importjob.');
    const preview = previewImport(job.payload, emptyImportState(), { now: job.createdAt });
    // A correction may refer to its preceding snapshot; use stored history for that case.
    const checked = preview.valid ? preview : previewImport(job.payload, imports, { now: job.createdAt });
    if (!checked.valid || job.digest !== checked.digest || job.snapshotId !== job.payload.snapshotId) throw error('Oude importjob faalt validatie.');
    jobIds.add(job.id);
  }
  return result;
}
function nonempty(state) {
  const initial = emptyState();
  const workspace = value => !!value && (value.decisions?.length || value.tasks?.length || value.audit?.length
    || JSON.stringify(value.brief) !== JSON.stringify(initial.brief));
  return !!(workspace(state) || workspace(state.importWorkspace) || state.importJobs?.length || state.imports?.snapshots?.length || state.imports?.history?.length);
}
function validateClaim(value) {
  if (!plain(value) || value.version !== 1 || !['pending', 'complete', 'absent'].includes(value.status)
    || organizationId(value.organizationId) !== value.organizationId
    || (value.status === 'complete' && !/^[a-f0-9]{64}$/.test(value.digest))
    || (value.status === 'pending' && value.digest !== null && !/^[a-f0-9]{64}$/.test(value.digest))) throw error('Ongeldig migratieregister; herstel het bestand handmatig.');
  return value;
}

/** One explicitly locked local data directory; membership authorization belongs to HTTP/auth. */
export async function createOrganizationManager({ dataDir = null, legacyStatePath = null, now = () => new Date().toISOString() } = {}) {
  if (dataDir !== null && (typeof dataDir !== 'string' || !dataDir.trim())) throw new TypeError('dataDir moet een pad of null zijn.');
  if (legacyStatePath !== null && (typeof legacyStatePath !== 'string' || !legacyStatePath.trim())) throw new TypeError('legacyStatePath moet een pad of null zijn.');
  let root = dataDir ? resolve(dataDir) : null;
  const source = legacyStatePath ? resolve(legacyStatePath) : null;
  const timestamp = () => new Date(typeof now === 'function' ? now() : now).toISOString();
  let lock = null, claim = null, serial = Promise.resolve(), closePromise = null, accepting = true;
  const entries = new Map();

  async function acquire() {
    if (!root) return;
    await directory(root);
    root = await realpath(root);
    const path = join(root, LOCK);
    let handle;
    try { handle = await open(path, 'wx', 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Never automatically steal: PID reuse and two simultaneous recovery attempts are ambiguous.
      throw error('Deze opslagmap is vergrendeld. Sluit de andere server. Na een crash: controleer het proces en verwijder uitsluitend .organization-manager.lock volgens ORGANIZATION_STORAGE.md.');
    }
    const owner = { version: 1, pid: process.pid, nonce: randomUUID(), createdAt: timestamp() };
    try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
    catch (e) { await handle.close(); await unlink(path).catch(() => {}); throw e; }
    await handle.close();
    lock = { path, nonce: owner.nonce };
    await directory(join(root, 'organizations'));
    await regularFile(join(root, CLAIM), true);
    const saved = await readFile(join(root, CLAIM), 'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (saved !== null) claim = validateClaim(JSON.parse(saved));
  }
  async function release() {
    if (!lock) return;
    await regularFile(lock.path);
    const owner = JSON.parse(await readFile(lock.path, 'utf8'));
    if (owner.nonce !== lock.nonce) throw error('Opslagvergrendeling is gewijzigd; niet automatisch verwijderd.');
    await unlink(lock.path);
    lock = null;
  }
  try { await acquire(); } catch (e) { await release().catch(() => {}); throw e; }

  function active() { if (!accepting) throw error('Organisatieopslag is gesloten.', 503); }
  function perform(fn) {
    try { active(); } catch (e) { return Promise.reject(e); }
    const result = serial.then(fn);
    serial = result.catch(() => {});
    return result;
  }
  async function paths(id) {
    if (!root) return null;
    const parent = join(root, 'organizations'), folder = join(parent, id), path = join(folder, 'state.json');
    const within = relative(root, path);
    if (!within || within.startsWith('..') || isAbsolute(within)) throw error('Organisatiepad valt buiten de opslagmap.');
    await directory(root);
    await directory(parent);
    await directory(folder);
    await regularFile(path, true);
    return path;
  }
  async function rawStore(id) {
    const raw = await createStore(await paths(id));
    return {
      read: () => raw.read(),
      update: async fn => { await paths(id); return raw.update(fn); }
    };
  }
  async function openEntry(id, initialStore = null) {
    if (entries.has(id)) return entries.get(id);
    if (entries.size >= MAX_ORGANIZATIONS) throw error('Maximaal 50 organisatieopslagen per server.', 429);
    const raw = initialStore || await rawStore(id);
    const queue = await createImportQueue({ store: raw, now });
    const exposed = Object.freeze({
      store: Object.freeze({ read: () => perform(() => raw.read()), update: fn => perform(() => raw.update(fn)) }),
      importQueue: Object.freeze({
        enqueue: (payload, digest) => perform(() => queue.enqueue(payload, digest)),
        retry: id => perform(() => queue.retry(id)),
        list: () => perform(() => queue.list()),
        idle: () => perform(() => queue.idle())
      })
    });
    const entry = { raw, queue, exposed };
    entries.set(id, entry);
    return entry;
  }
  async function writeClaim(next) {
    if (root) { await atomicJSON(join(root, CLAIM), next); await syncDirectory(root); }
    claim = next;
  }
  async function readLegacy() {
    if (!source) return null;
    const info = await regularFile(source, true);
    if (!info) return null;
    if (info.size > MAX_LEGACY_BYTES) throw error('Oud statebestand overschrijdt de migratielimiet van 512 MiB.');
    const bytes = await readFile(source);
    if (bytes.length > MAX_LEGACY_BYTES) throw error('Oud statebestand overschrijdt de migratielimiet.');
    let raw;
    try { raw = JSON.parse(bytes.toString('utf8')); } catch { throw error('Oud statebestand bevat ongeldige JSON; bronbestand behouden.'); }
    return { state: legacyState(raw), digest: createHash('sha256').update(bytes).digest('hex') };
  }

  const manager = {
    get(orgId) {
      return perform(async () => {
        const id = organizationId(orgId);
        if (claim?.organizationId === id && claim.status === 'pending') throw error('Oude opslagmigratie vereist herstel door de eigenaar.');
        return (await openEntry(id)).exposed;
      });
    },
    claimLegacy(orgId) {
      return perform(async () => {
        const id = organizationId(orgId);
        if (claim && claim.organizationId !== id) throw error('Oude opslag is al aan de eerste organisatie toegewezen.');
        if (claim && claim.status !== 'pending') return { claimed: false, organizationId: id, reason: claim.status === 'absent' ? 'no_legacy_state' : 'already_claimed' };
        const entry = entries.get(id);
        if (entry) await entry.queue.idle();
        const raw = entry?.raw || await rawStore(id), current = await raw.read();
        const receipt = current[RECEIPT];
        if (claim?.status === 'pending' && claim.digest && receipt?.organizationId === id && receipt.digest === claim.digest) {
          await writeClaim({ ...claim, status: 'complete', completedAt: timestamp() });
          await openEntry(id, raw);
          return { claimed: false, organizationId: id, reason: 'recovered_completed_claim' };
        }
        if (receipt || nonempty(current)) throw error('De organisatie heeft al gegevens; oude opslag wordt niet overschreven.');
        // Reserve the first organization before parsing an existing source. A malformed
        // legacy file must not become claimable by a different organization after repair.
        if (!claim && source && await exists(source)) {
          await writeClaim({ version: 1, organizationId: id, status: 'pending', digest: null, startedAt: timestamp() });
        }
        const legacy = await readLegacy();
        if (!legacy) {
          if (claim) throw error('Oud bronbestand ontbreekt tijdens hervatten van de migratie.');
          await writeClaim({ version: 1, organizationId: id, status: 'absent', completedAt: timestamp() });
          return { claimed: false, organizationId: id, reason: 'no_legacy_state' };
        }
        if (claim?.digest && claim.digest !== legacy.digest) throw error('Oud bronbestand is gewijzigd sinds de migratie begon; herstel vereist.');
        if (!claim) await writeClaim({ version: 1, organizationId: id, status: 'pending', digest: legacy.digest, startedAt: timestamp() });
        else if (!claim.digest) await writeClaim({ ...claim, digest: legacy.digest });
        await raw.update(state => {
          if (nonempty(state) || state[RECEIPT]) throw error('De organisatie heeft al gegevens; migratie geannuleerd.');
          for (const key of Object.keys(state)) delete state[key];
          Object.assign(state, legacy.state, { [RECEIPT]: { version: 1, organizationId: id, digest: legacy.digest, importedAt: timestamp() } });
        });
        if (root) await syncDirectory(join(root, 'organizations', id));
        await writeClaim({ ...claim, status: 'complete', completedAt: timestamp() });
        await openEntry(id, raw);
        return { claimed: true, organizationId: id, reason: 'migrated' };
      });
    },
    stats(orgId) {
      return perform(async () => {
        const id = organizationId(orgId);
        if (claim?.organizationId === id && claim.status === 'pending') throw error('Oude opslagmigratie vereist herstel door de eigenaar.');
        const state = await (await openEntry(id)).raw.read();
        const counts = workspace => ({ decisions: workspace?.decisions.length || 0, tasks: workspace?.tasks.length || 0, audit: workspace?.audit.length || 0 });
        const imports = state.imports || emptyImportState(), jobs = state.importJobs || [];
        return {
          mode: root ? 'local_file' : 'memory', organizationId: id,
          counts: { demo: counts(state), import: counts(state.importWorkspace), snapshots: imports.snapshots.length, importHistory: imports.history.length,
            jobs: jobs.length, pendingJobs: jobs.filter(job => ['queued', 'running'].includes(job.status)).length, failedJobs: jobs.filter(job => job.status === 'failed').length },
          limits: { organizations: MAX_ORGANIZATIONS, tasksPerDataset: 2000, auditEvents: 20000, snapshots: 200, importJobs: MAX_IMPORT_JOBS,
            pendingImportJobs: MAX_PENDING_IMPORT_JOBS, importAttempts: MAX_IMPORT_ATTEMPTS, importBytes: MAX_IMPORT_BYTES },
          migration: claim?.organizationId === id ? claim.status : 'none'
        };
      });
    },
    idle() { return perform(async () => { await Promise.all([...entries.values()].map(entry => entry.queue.idle())); }); },
    close() {
      if (closePromise) return closePromise;
      accepting = false;
      closePromise = (async () => {
        await serial;
        try { await Promise.all([...entries.values()].map(entry => entry.queue.idle())); }
        finally { await release(); }
      })();
      return closePromise;
    }
  };
  return Object.freeze(manager);
}
