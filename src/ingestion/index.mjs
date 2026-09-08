import { randomUUID } from 'node:crypto';
import { applyImport, emptyImportState, previewImport } from '../import/index.mjs';

export { getImportAdapter, LOCAL_JSON_ADAPTER } from './local-json.mjs';
export { COVERAGE_DIMENSIONS, coverageRecordsFromCatalog } from './coverage.mjs';

// Limits include retained failures/successes: history is never silently discarded.
export const MAX_PENDING_IMPORT_JOBS = 20;
export const MAX_IMPORT_JOBS = 200;
export const MAX_IMPORT_ATTEMPTS = 3;

const STATUSES = new Set(['queued', 'running', 'succeeded', 'failed']);
const publicJob = ({ payload, ...job }) => structuredClone(job);
const queueError = (message, status = 400, details = []) => Object.assign(new Error(message), { status, details });
const errorRecord = error => ({
  message: String(error?.message || 'Onbekende verwerkingsfout.').slice(0, 1000),
  status: Number.isInteger(error?.status) ? error.status : 500,
  details: Array.isArray(error?.details) ? error.details.slice(0, 30).map(detail => ({
    path: String(detail?.path || '').slice(0, 200), message: String(detail?.message || '').slice(0, 400)
  })) : []
});

function checkPreview(payload, imports, digest, now) {
  const preview = previewImport(payload, imports, { now });
  if (!preview.valid) throw queueError('Importvalidatie mislukt.', 400, preview.errors);
  if (typeof digest !== 'string' || digest !== preview.digest) {
    throw queueError('De bevestiging komt niet overeen met de preview. Maak een nieuwe preview.', 409);
  }
  return preview;
}

function initialize(state) {
  state.imports ??= emptyImportState();
  state.importJobs ??= [];
  if (!Array.isArray(state.importJobs) || state.importJobs.length > MAX_IMPORT_JOBS) {
    throw queueError('Ongeldige of te grote opgeslagen importwachtrij; herstel het lokale bestand.', 500);
  }
  const ids = new Set();
  for (const job of state.importJobs) {
    if (!job || typeof job.id !== 'string' || ids.has(job.id) || !STATUSES.has(job.status)
      || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > MAX_IMPORT_ATTEMPTS
      || job.maxAttempts !== MAX_IMPORT_ATTEMPTS) {
      throw queueError('Ongeldig opgeslagen importjob-formaat; herstel het lokale bestand.', 500);
    }
    ids.add(job.id);
  }
}

/** One queue per single-user store/server process. No provider fetches or cloud jobs. */
export async function createImportQueue({ store, now = () => new Date() } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.update !== 'function') {
    throw new TypeError('Een lokale store met read() en update(syncFn) is verplicht.');
  }
  const timestamp = () => {
    const value = typeof now === 'function' ? now() : now;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Ongeldige queueklok.');
    return date.toISOString();
  };

  // A committed import and its success marker share one store transaction, so a
  // persisted running job is always safe to retry after an interrupted process.
  await store.update(state => {
    initialize(state);
    for (const job of state.importJobs) {
      if (job.status !== 'running') continue;
      job.status = job.attempts < job.maxAttempts ? 'queued' : 'failed';
      job.error = errorRecord(queueError('Verwerking onderbroken; hersteld bij lokale herstart.', 503));
      job.updatedAt = timestamp();
    }
  });

  let running = null;
  let requested = false;
  let fatalError = null;

  async function drain() {
    while (true) {
      const claimed = await store.update(state => {
        const job = state.importJobs.find(item => item.status === 'queued');
        if (!job) return null;
        if (job.attempts >= job.maxAttempts) {
          job.status = 'failed';
          job.error = errorRecord(queueError('Maximum aantal verwerkingspogingen bereikt.', 409));
          job.updatedAt = timestamp();
          return { skip: true };
        }
        job.status = 'running';
        job.attempts += 1;
        job.updatedAt = timestamp();
        return { id: job.id };
      });
      if (!claimed) return;
      if (claimed.skip) continue;

      try {
        await store.update(state => {
          const job = state.importJobs.find(item => item.id === claimed.id);
          if (!job || job.status !== 'running') throw queueError('Importjob veranderde tijdens verwerking.', 409);
          const time = timestamp();
          checkPreview(job.payload, state.imports, job.digest, time);
          const applied = applyImport(job.payload, state.imports, { now: time });
          state.imports = applied.state;
          job.status = 'succeeded';
          job.error = null;
          job.result = applied.result;
          job.updatedAt = time;
        });
      } catch (error) {
        // Failed application/persistence cannot leave partial imported records:
        // store.update commits only after its synchronous callback succeeds.
        await store.update(state => {
          const job = state.importJobs.find(item => item.id === claimed.id);
          if (job?.status === 'running') {
            job.status = 'failed';
            job.error = errorRecord(error);
            job.result = null;
            job.updatedAt = timestamp();
          }
        });
      }
    }
  }

  function kick() {
    requested = true;
    if (running) return;
    fatalError = null;
    running = (async () => {
      // Enqueue returns a real queued job before work starts. Explicit retries,
      // rather than automatic retry loops, keep failures visible to the user.
      await new Promise(resolve => setImmediate(resolve));
      do {
        requested = false;
        await drain();
      } while (requested);
    })().catch(error => { fatalError = error; }).finally(() => {
      running = null;
      if (requested && !fatalError) kick();
    });
  }

  const queue = {
    async enqueue(payload, digest) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) {
        throw queueError('Bevestiging vereist één gewoon JSON-object als importenvelop.');
      }
      const copy = structuredClone(payload);
      const job = await store.update(state => {
        const time = timestamp();
        checkPreview(copy, state.imports, digest, time);
        const existing = state.importJobs.find(item => item.digest === digest);
        if (existing) return publicJob(existing);
        if (state.importJobs.some(item => item.snapshotId === copy.snapshotId)) {
          throw queueError('Dit snapshot-ID is al voor een andere import gebruikt.', 409);
        }
        if (state.importJobs.length >= MAX_IMPORT_JOBS) {
          throw queueError('Limiet van de lokale importgeschiedenis bereikt; exporteer en archiveer de lokale opslag.', 429);
        }
        if (state.importJobs.filter(item => ['queued', 'running'].includes(item.status)).length >= MAX_PENDING_IMPORT_JOBS) {
          throw queueError('De lokale importwachtrij is vol. Wacht tot bestaande taken klaar zijn.', 429);
        }
        const next = {
          id: randomUUID(), snapshotId: copy.snapshotId, digest, status: 'queued',
          attempts: 0, maxAttempts: MAX_IMPORT_ATTEMPTS, error: null, result: null,
          createdAt: time, updatedAt: time, payload: copy
        };
        state.importJobs.push(next);
        return publicJob(next);
      });
      kick();
      return job;
    },
    async list() {
      const state = await store.read();
      return state.importJobs.map(publicJob);
    },
    async retry(id) {
      const job = await store.update(state => {
        const existing = state.importJobs.find(item => item.id === id);
        if (!existing) throw queueError('Importjob niet gevonden.', 404);
        if (existing.status !== 'failed') throw queueError('Alleen een mislukte importjob kan opnieuw worden gestart.', 409);
        if (existing.attempts >= existing.maxAttempts) throw queueError('Maximum aantal verwerkingspogingen bereikt.', 409);
        if (state.importJobs.filter(item => ['queued', 'running'].includes(item.status)).length >= MAX_PENDING_IMPORT_JOBS) {
          throw queueError('De lokale importwachtrij is vol.', 429);
        }
        const time = timestamp();
        checkPreview(existing.payload, state.imports, existing.digest, time);
        existing.status = 'queued';
        existing.error = null;
        existing.updatedAt = time;
        return publicJob(existing);
      });
      kick();
      return job;
    },
    async idle() {
      while (running) await running;
      if (fatalError) throw fatalError;
    }
  };
  kick();
  return queue;
}
