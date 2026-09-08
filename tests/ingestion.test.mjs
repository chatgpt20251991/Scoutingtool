import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createStore } from '../src/store.mjs';
import { emptyImportState, MAX_IMPORT_BYTES, previewImport } from '../src/import/index.mjs';
import {
  createImportQueue, MAX_IMPORT_ATTEMPTS, MAX_IMPORT_JOBS, MAX_PENDING_IMPORT_JOBS,
  getImportAdapter, LOCAL_JSON_ADAPTER, coverageRecordsFromCatalog, COVERAGE_DIMENSIONS
} from '../src/ingestion/index.mjs';

const NOW = '2026-09-08T12:00:00.000Z';
const SAMPLE = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
function fixture(id = SAMPLE.snapshotId) {
  const payload = structuredClone(SAMPLE);
  payload.snapshotId = id;
  payload.source.expiresAt = '2027-09-08T12:00:00.000Z';
  return payload;
}
function digest(payload, imports = emptyImportState()) {
  const result = previewImport(payload, imports, { now: NOW });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result.digest;
}
async function setup(options = {}) {
  const store = await createStore();
  const queue = await createImportQueue({ store, now: () => NOW, ...options });
  return { store, queue };
}
const snapshots = state => state.imports.snapshots;
function persistedJob(payload, overrides = {}) {
  return {
    id: 'recovered-local-job', snapshotId: payload.snapshotId, digest: digest(payload),
    status: 'running', attempts: 1, maxAttempts: MAX_IMPORT_ATTEMPTS,
    error: null, result: null, payload, createdAt: NOW, updatedAt: NOW, ...overrides
  };
}

test('local adapter accepts only bounded UTF-8 JSON bytes and never connects a provider', () => {
  const adapter = getImportAdapter();
  assert.equal(adapter, LOCAL_JSON_ADAPTER);
  assert.equal(adapter.live, false);
  assert.equal(adapter.permissionsVerified, false);
  const payload = fixture();
  payload.source.rightsNote = '<script>fetch("https://example.invalid")</script>';
  assert.deepEqual(adapter.parse(Buffer.from(JSON.stringify(payload))), payload);
  assert.throws(() => adapter.parse('[]'), error => error.status === 400);
  assert.throws(() => adapter.parse('{bad'), error => error.status === 400);
  assert.throws(() => adapter.parse(new Uint8Array([0xff])), error => error.status === 400);
  assert.throws(() => adapter.parse('x'.repeat(MAX_IMPORT_BYTES + 1)), error => error.status === 413);
  assert.throws(() => getImportAdapter('remote-provider'), error => error.status === 404);
});

test('coverage keeps seven independent dimensions and counts only catalog players', () => {
  const payload = fixture();
  const competition = payload.competitions[0];
  competition.coverage = { results: 'available', minutes: 'partial', video: 'not_in_license' };
  competition.expectedMatches = null;
  competition.observedPlayers = 9999;
  const records = coverageRecordsFromCatalog({ sources: [payload.source], competitions: [competition], players: payload.players });
  assert.equal(records.length, 7);
  assert.deepEqual(records.map(record => record.type), [...COVERAGE_DIMENSIONS]);
  assert.equal(records.find(record => record.type === 'results').status, 'available');
  assert.equal(records.find(record => record.type === 'playerStats').status, 'unknown');
  assert.equal(records.find(record => record.type === 'video').status, 'not_in_license');
  assert.equal(records[0].matchCompletenessPercent, null);
  assert.equal(records[0].measurementCompletenessPercent, null);
  assert.equal(records[0].rightsIndependentlyVerified, false);
  assert.equal(records[0].observedPlayers, payload.players.filter(player => player.competitionId === competition.id && player.sourceId === competition.sourceId).length);
  assert.deepEqual(coverageRecordsFromCatalog({ sources: [], competitions: [], players: [] }), []);
});

test('coverage percentages need a known consistent denominator and never establish measurement completeness', () => {
  const payload = fixture();
  const competition = { ...payload.competitions[0], expectedMatches: 20, observedMatches: 5 };
  const catalog = { sources: [payload.source], competitions: [competition], players: [] };
  assert.equal(coverageRecordsFromCatalog(catalog)[0].matchCompletenessPercent, 25);
  assert.equal(coverageRecordsFromCatalog(catalog)[0].measurementCompletenessPercent, null);
  competition.observedMatches = 21;
  assert.equal(coverageRecordsFromCatalog(catalog)[0].matchCompletenessPercent, null);
  catalog.sources = [];
  assert.equal(coverageRecordsFromCatalog(catalog)[0].status, 'unknown');
  assert.equal(coverageRecordsFromCatalog(catalog)[0].connected, false);
});

test('confirmed job applies immutable data and succeeds in the same durable transaction', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'omniscout-ingestion-'));
  t.after(async () => {
    const within = relative(resolve(tmpdir()), resolve(dir));
    assert.ok(within && !within.startsWith('..') && !isAbsolute(within));
    await rm(dir, { recursive: true, force: true });
  });
  const path = join(dir, 'state.json');
  const store = await createStore(path);
  const queue = await createImportQueue({ store, now: NOW });
  const payload = fixture();
  const job = await queue.enqueue(payload, digest(payload));
  assert.equal(job.status, 'queued');
  assert.equal('payload' in job, false);
  await queue.idle();
  const state = await (await createStore(path)).read();
  assert.equal(state.importJobs[0].status, 'succeeded');
  assert.equal(state.importJobs[0].attempts, 1);
  assert.equal(snapshots(state).length, 1);
  assert.equal(snapshots(state)[0].snapshotId, payload.snapshotId);
  assert.deepEqual(snapshots(state)[0].payload, payload);
  assert.equal((await queue.list())[0].error, null);
  assert.equal('payload' in (await queue.list())[0], false);
});

test('invalid payload and stale preview digest write no jobs or imported records', async () => {
  const { store, queue } = await setup();
  const payload = fixture();
  await assert.rejects(queue.enqueue(payload, 'stale-digest'), error => error.status === 409);
  payload.source.rightsAttested = false;
  await assert.rejects(queue.enqueue(payload, 'invalid'), error => error.status === 400 && error.details.length > 0);
  await queue.idle();
  const state = await store.read();
  assert.equal(state.importJobs.length, 0);
  assert.equal(snapshots(state).length, 0);
});

test('queue module rejects string, array, and null envelopes before retaining a job', async () => {
  const { store, queue } = await setup();
  const payload = fixture();
  const hash = digest(payload);
  for (const invalid of [JSON.stringify(payload), [payload], null]) {
    await assert.rejects(queue.enqueue(invalid, hash), error => error.status === 400);
  }
  await queue.idle();
  const state = await store.read();
  assert.equal(state.importJobs.length, 0);
  assert.equal(snapshots(state).length, 0);
});

test('concurrent duplicate confirmations share one job and one imported snapshot', async () => {
  const { store, queue } = await setup();
  const payload = fixture();
  const hash = digest(payload);
  const jobs = await Promise.all(Array.from({ length: 12 }, () => queue.enqueue(payload, hash)));
  assert.equal(new Set(jobs.map(job => job.id)).size, 1);
  await queue.idle();
  const duplicate = await queue.enqueue(payload, hash);
  await queue.idle();
  assert.equal(duplicate.id, jobs[0].id);
  assert.equal(duplicate.status, 'succeeded');
  const state = await store.read();
  assert.equal(state.importJobs.length, 1);
  assert.equal(snapshots(state).length, 1);
  assert.equal(state.importJobs[0].attempts, 1);
});

test('snapshot IDs cannot be reused with changed content while queued', async () => {
  const { queue } = await setup();
  const payload = fixture();
  await queue.enqueue(payload, digest(payload));
  const changed = structuredClone(payload);
  changed.source.rightsNote += ' Andere verklaring.';
  await assert.rejects(queue.enqueue(changed, digest(changed)), error => error.status === 409);
  await queue.idle();
  assert.equal((await queue.list()).length, 1);
});

test('caller mutation after enqueue cannot alter the persisted job', async () => {
  const { store, queue } = await setup();
  const payload = fixture();
  const original = structuredClone(payload);
  const pending = queue.enqueue(payload, digest(payload));
  payload.source.rightsAttested = false;
  payload.players[0].name = 'mutated after call';
  await pending;
  await queue.idle();
  assert.equal((await queue.list())[0].status, 'succeeded');
  assert.deepEqual(snapshots(await store.read())[0].payload, original);
});

test('a failed commit leaves no partial data and explicit retry succeeds once', async () => {
  const store = await createStore();
  let failNextCommit = true;
  const faultyStore = {
    read: () => store.read(),
    update: fn => store.update(state => {
      const result = fn(state);
      if (failNextCommit && state.importJobs?.some(job => job.status === 'succeeded')) {
        failNextCommit = false;
        throw new Error('Synthetische schrijffout.');
      }
      return result;
    })
  };
  const queue = await createImportQueue({ store: faultyStore, now: NOW });
  const payload = fixture();
  const job = await queue.enqueue(payload, digest(payload));
  await queue.idle();
  assert.equal(snapshots(await store.read()).length, 0);
  const failed = (await queue.list())[0];
  assert.equal(failed.status, 'failed');
  assert.match(failed.error.message, /Synthetische schrijffout/);
  assert.equal(failed.attempts, 1);
  const retried = await queue.retry(job.id);
  assert.equal(retried.status, 'queued');
  await queue.idle();
  assert.equal((await queue.list())[0].status, 'succeeded');
  assert.equal((await queue.list())[0].attempts, 2);
  assert.equal(snapshots(await store.read()).length, 1);
});

test('repeated processing errors are visible and retries stop after three attempts', async () => {
  const store = await createStore();
  const faultyStore = {
    read: () => store.read(),
    update: fn => store.update(state => {
      const result = fn(state);
      if (state.importJobs?.some(job => job.status === 'succeeded')) throw new Error('Synthetische aanhoudende schrijffout.');
      return result;
    })
  };
  const queue = await createImportQueue({ store: faultyStore, now: NOW });
  const payload = fixture();
  const job = await queue.enqueue(payload, digest(payload));
  for (let attempt = 1; attempt <= MAX_IMPORT_ATTEMPTS; attempt++) {
    await queue.idle();
    assert.equal((await queue.list())[0].attempts, attempt);
    assert.equal((await queue.list())[0].status, 'failed');
    if (attempt < MAX_IMPORT_ATTEMPTS) await queue.retry(job.id);
  }
  await assert.rejects(queue.retry(job.id), error => error.status === 409);
  assert.equal(snapshots(await store.read()).length, 0);
});

test('execution rechecks source expiry after confirmation and rejects expired retry', async () => {
  let clock = NOW;
  const { store, queue } = await setup({ now: () => clock });
  const payload = fixture();
  payload.source.expiresAt = '2026-09-08T13:00:00.000Z';
  const job = await queue.enqueue(payload, digest(payload));
  clock = '2026-09-08T14:00:00.000Z';
  await queue.idle();
  assert.equal((await queue.list())[0].status, 'failed');
  assert.equal(snapshots(await store.read()).length, 0);
  await assert.rejects(queue.retry(job.id), error => error.status === 400);
});

test('restart recovers interrupted and queued work using persisted immutable payloads', async () => {
  const store = await createStore();
  const payload = fixture();
  await store.update(state => {
    state.imports = emptyImportState();
    state.importJobs = [persistedJob(payload)];
  });
  const queue = await createImportQueue({ store, now: NOW });
  await queue.idle();
  assert.equal((await queue.list())[0].status, 'succeeded');
  assert.equal((await queue.list())[0].attempts, 2);
  assert.equal(snapshots(await store.read()).length, 1);
  const reopened = await createImportQueue({ store, now: NOW });
  await reopened.idle();
  assert.equal((await reopened.list())[0].attempts, 2);
  assert.equal(snapshots(await store.read()).length, 1);
});

test('restart never resets exhausted attempts or hides interrupted failures', async () => {
  const store = await createStore();
  const payload = fixture();
  await store.update(state => {
    state.imports = emptyImportState();
    state.importJobs = [persistedJob(payload, { attempts: MAX_IMPORT_ATTEMPTS })];
  });
  const queue = await createImportQueue({ store, now: NOW });
  await queue.idle();
  const [job] = await queue.list();
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, MAX_IMPORT_ATTEMPTS);
  assert.match(job.error.message, /onderbroken/);
  await assert.rejects(queue.retry(job.id), error => error.status === 409);
  assert.equal(snapshots(await store.read()).length, 0);
});

test('pending queue is bounded and rejects extra jobs without dropping admitted work', async () => {
  const { queue } = await setup();
  const requests = Array.from({ length: MAX_PENDING_IMPORT_JOBS + 1 }, (_, i) => {
    const payload = fixture(`queue-bound-${i}`);
    return queue.enqueue(payload, digest(payload));
  });
  const settled = await Promise.allSettled(requests);
  assert.equal(settled.filter(result => result.status === 'fulfilled').length, MAX_PENDING_IMPORT_JOBS);
  assert.equal(settled.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 1);
  await queue.idle();
  assert.equal((await queue.list()).length, MAX_PENDING_IMPORT_JOBS);
});

test('retained history has a hard bound and is never silently pruned', async () => {
  const store = await createStore();
  const payload = fixture();
  await store.update(state => {
    state.imports = emptyImportState();
    state.importJobs = Array.from({ length: MAX_IMPORT_JOBS }, (_, i) => persistedJob(payload, {
      id: `retained-${i}`, snapshotId: `retained-snapshot-${i}`, digest: `retained-digest-${i}`,
      status: 'failed', attempts: MAX_IMPORT_ATTEMPTS
    }));
  });
  const queue = await createImportQueue({ store, now: NOW });
  await assert.rejects(queue.enqueue(payload, digest(payload)), error => error.status === 429);
  await queue.idle();
  assert.equal((await queue.list()).length, MAX_IMPORT_JOBS);
});

test('unknown or nonfailed jobs cannot be retried', async () => {
  const { queue } = await setup();
  await assert.rejects(queue.retry('missing'), error => error.status === 404);
  const payload = fixture();
  const job = await queue.enqueue(payload, digest(payload));
  await assert.rejects(queue.retry(job.id), error => error.status === 409);
  await queue.idle();
  await assert.rejects(queue.retry(job.id), error => error.status === 409);
});
