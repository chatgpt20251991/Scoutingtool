import { createHash } from 'node:crypto';
import { ACTION_LABELS, REASON_LABELS, ROLE_LABELS, sourceAllowed } from '../engine.mjs';
import { CATALOG } from '../fixtures.mjs';
import { applyImport, emptyImportState, previewImport, rollbackImport } from '../import/index.mjs';

export const MAX_WORKSPACE_BACKUP_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;
const hash = value => typeof value === 'string' && HASH.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);
const DAY = 86400000;
const ROOT_FIELDS = ['version', 'decisions', 'tasks', 'brief', 'audit', 'imports', 'importJobs', 'importWorkspace'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
const current = now => {
  const date = new Date(typeof now === 'function' ? now() : now ?? Date.now());
  if (!Number.isFinite(date.getTime())) fail('Ongeldige herstelklok.');
  return date.toISOString();
};
function json(value) {
  let bytes = 0, nodes = 0;
  const seen = new Set();
  function walk(item, depth) {
    if (depth > 24 || ++nodes > 1000000) fail('Back-up is te complex of te diep genest.');
    if (item === null || typeof item === 'boolean') { bytes += 5; return; }
    if (typeof item === 'string') { bytes += Buffer.byteLength(item, 'utf8') + 2; if (bytes > MAX_WORKSPACE_BACKUP_BYTES) fail('Werkruimteback-up is groter dan 32 MiB.', 413); return; }
    if (typeof item === 'number' && Number.isFinite(item)) { bytes += 24; return; }
    if ((!object(item) && !Array.isArray(item)) || seen.has(item) || Object.getOwnPropertySymbols(item).length) fail('Back-up moet gewone, niet-circulaire JSON bevatten.');
    seen.add(item); bytes += 2;
    const keys = Object.keys(item), descriptors = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) fail('Back-up bevat een ongeldige array.');
    for (const key of Object.getOwnPropertyNames(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = descriptors[key];
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !descriptor.enumerable || descriptor.get || descriptor.set) fail('Back-up bevat een onveilige eigenschap.');
      bytes += Buffer.byteLength(key, 'utf8') + 4;
      walk(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  walk(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_WORKSPACE_BACKUP_BYTES) fail('Werkruimteback-up is groter dan 32 MiB.', 413);
  return encoded;
}
function fields(value, allowed, required = allowed, label = 'record') {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail(`Ongeldige of onbekende velden in ${label}.`);
}
function text(value, max, label, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`Ongeldige ${label}.`);
}
function id(value, label) { if (typeof value !== 'string' || !ID.test(value)) fail(`Ongeldig ${label}.`); }
function date(value, now, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10) || Date.parse(value) > Date.parse(now)) fail(`Ongeldige of toekomstige ${label}.`);
}
function array(value, max, label) { if (!Array.isArray(value) || value.length > max) fail(`Ongeldige of te grote ${label}.`); }
function unique(values, label) { if (new Set(values).size !== values.length) fail(`Dubbele ${label}.`); }
function workspace(value, players, now, label, imports, root = false) {
  fields(value, root ? ROOT_FIELDS : ['version', 'decisions', 'tasks', 'brief', 'audit'], ['version', 'decisions', 'tasks', 'brief', 'audit'], label);
  if (value.version !== 1) fail('Onbekende versie van scoutingopslag.');
  array(value.decisions, 20000, 'besluiten'); array(value.tasks, 2000, 'opdrachten'); array(value.audit, 20000, 'audit');
  unique(value.decisions.map(item => item?.id), 'besluit-ID’s'); unique(value.tasks.map(item => item?.id), 'opdracht-ID’s');
  unique(value.tasks.map(item => item?.requestId), 'idempotentiesleutels'); unique(value.audit.map(item => item?.id), 'audit-ID’s');
  for (const decision of value.decisions) {
    fields(decision, ['id', 'playerId', 'action', 'reason', 'note', 'at']);
    id(decision.id, 'besluit-ID'); id(decision.playerId, 'speler-ID'); date(decision.at, now, 'besluittijd');
    if (!players.has(decision.playerId) || typeof decision.action !== 'string' || typeof decision.reason !== 'string'
      || !Object.hasOwn(ACTION_LABELS, decision.action) || !Object.hasOwn(REASON_LABELS, decision.reason)) fail('Besluit heeft een ongeldige speler, actie of reden.');
    text(decision.note, 2400, 'besluitnotitie', decision.action !== 'archive');
  }
  for (const task of value.tasks) {
    fields(task, ['id', 'playerId', 'question', 'requestId', 'status', 'result', 'at', 'completedAt']);
    id(task.id, 'opdracht-ID'); id(task.playerId, 'speler-ID'); text(task.requestId, 100, 'idempotentiesleutel');
    if (!players.has(task.playerId) || !['todo', 'done'].includes(task.status)) fail('Opdracht heeft een ongeldige speler of status.');
    text(task.question, 1600, 'onderzoeksvraag'); text(task.result, 2400, 'onderzoeksresultaat', task.status !== 'done'); date(task.at, now, 'opdrachttijd');
    if (task.status === 'done') { date(task.completedAt, now, 'voltooiingstijd'); if (Date.parse(task.completedAt) < Date.parse(task.at)) fail('Opdracht is voltooid vóór aanmaak.'); }
    else if (task.completedAt !== null) fail('Open opdracht mag geen voltooiingstijd bevatten.');
  }
  fields(value.brief, ['role', 'minAge', 'maxAge', 'task', 'budgetScope']);
  const brief = value.brief;
  if (typeof brief.role !== 'string' || (brief.role !== '' && !Object.hasOwn(ROLE_LABELS, brief.role)) || !Number.isInteger(brief.minAge) || !Number.isInteger(brief.maxAge)
    || brief.minAge < 18 || brief.maxAge > 60 || brief.minAge > brief.maxAge) fail('Ongeldige clubvraag.');
  text(brief.task, 2400, 'clubtaken', true); text(brief.budgetScope, 1000, 'budgetscope', true);
  const decisions = new Set(value.decisions.map(item => item.id)), tasks = new Set(value.tasks.map(item => item.id));
  for (const audit of value.audit) {
    fields(audit, ['id', 'action', 'objectId', 'detail', 'at', 'actor']);
    id(audit.id, 'audit-ID'); text(audit.actor, 100, 'auditactor'); text(audit.objectId, 100, 'auditobject'); text(audit.detail, 2400, 'auditdetail', true); date(audit.at, now, 'audittijd');
    const valid = audit.action === 'decision.created' ? decisions.has(audit.objectId)
      : ['task.created', 'task.updated'].includes(audit.action) ? tasks.has(audit.objectId)
      : audit.action === 'brief.updated' ? audit.objectId === 'local-brief'
      : audit.action === 'import.rolled_back' ? imports.snapshots.some(snapshot => snapshot.snapshotId === audit.objectId)
      : audit.action === 'workspace.restored' ? UUID.test(audit.objectId) : false;
    if (!valid) fail('Auditactie of objectverwijzing is ongeldig.');
  }
}
function rightAllowed(payload, now) { return ['store', 'export'].every(use => sourceAllowed(payload.source, now, use)); }

/** Hashes bounded plain JSON, including every supplied field; not a source-rights approval. */
export function stateDigest(state) { json(state); return createHash('sha256').update(stable(state)).digest('hex'); }

/** Strict validation: this never sanitizes unknown fields or repairs retained records. */
export function validateWorkspaceState(input, { now, allowPending = false, checkRights = true } = {}) {
  const encoded = json(input), state = JSON.parse(encoded), nowAt = current(now);
  fields(state, ROOT_FIELDS, ['version', 'decisions', 'tasks', 'brief', 'audit'], 'werkruimtestate');
  const imports = state.imports ?? emptyImportState(), jobs = state.importJobs ?? [];
  fields(imports, ['schemaVersion', 'snapshots', 'history']);
  if (imports.schemaVersion !== 1) fail('Onbekende importopslagversie.');
  array(imports.snapshots, 200, 'snapshots'); array(imports.history, 20000, 'importhistorie'); array(jobs, 200, 'importjobs');
  unique(imports.snapshots.map(item => item?.snapshotId), 'snapshot-ID’s'); unique(imports.history.map(item => item?.id), 'historie-ID’s');
  let rebuilt = emptyImportState();
  const snapshots = new Map(), imported = new Set(), rolledBack = new Set();
  for (const snapshot of imports.snapshots) {
    fields(snapshot, ['snapshotId', 'digest', 'importedAt', 'payload']);
    id(snapshot.snapshotId, 'snapshot-ID'); if (!hash(snapshot.digest)) fail('Ongeldige snapshotdigest.'); date(snapshot.importedAt, nowAt, 'importtijd');
    snapshots.set(snapshot.snapshotId, snapshot);
  }
  let lastHistoryTime = -Infinity;
  for (const event of imports.history) {
    fields(event, event?.type === 'import' ? ['id', 'type', 'snapshotId', 'correctionOf', 'digest', 'at'] : ['id', 'type', 'snapshotId', 'at']);
    id(event.id, 'historie-ID'); date(event.at, nowAt, 'historietijd');
    if (Date.parse(event.at) < lastHistoryTime) fail('Importhistorie staat niet in tijdvolgorde.');
    lastHistoryTime = Date.parse(event.at);
    const snapshot = snapshots.get(event.snapshotId);
    if (!snapshot) fail('Importhistorie verwijst naar een ontbrekende snapshot.');
    if (event.type === 'import') {
      if (imported.has(event.snapshotId) || event.digest !== snapshot.digest || event.at !== snapshot.importedAt || event.correctionOf !== snapshot.payload?.correctionOf) fail('Importhistorie komt niet overeen met de snapshot.');
      try { rebuilt = applyImport(snapshot.payload, rebuilt, { now: event.at }).state; }
      catch { fail('Bewaarde importsnapshot faalt historische validatie.'); }
      const generated = rebuilt.snapshots.at(-1);
      if (stable(generated) !== stable(snapshot)) fail('Bewaarde snapshot of digest is gewijzigd.');
      imported.add(event.snapshotId);
    } else if (event.type === 'rollback') {
      if (!imported.has(event.snapshotId) || rolledBack.has(event.snapshotId)) fail('Ongeldige of dubbele rollbackhistorie.');
      try { rebuilt = rollbackImport(event.snapshotId, rebuilt, { now: event.at }).state; }
      catch { fail('Rollbackhistorie schendt een snapshotafhankelijkheid.'); }
      rolledBack.add(event.snapshotId);
    } else fail('Onbekende importhistorieactie.');
  }
  if (stable(rebuilt.snapshots) !== stable(imports.snapshots)) fail('Snapshotopslag heeft ontbrekende of afwijkende importhistorie.');
  unique(jobs.map(job => job?.id), 'job-ID’s'); unique(jobs.map(job => job?.digest), 'jobdigests'); unique(jobs.map(job => job?.snapshotId), 'jobsnapshot-ID’s');
  for (const job of jobs) {
    fields(job, ['id', 'snapshotId', 'digest', 'status', 'attempts', 'maxAttempts', 'error', 'result', 'createdAt', 'updatedAt', 'payload']);
    id(job.id, 'job-ID'); id(job.snapshotId, 'jobsnapshot-ID'); date(job.createdAt, nowAt, 'jobaanmaak'); date(job.updatedAt, nowAt, 'jobwijziging');
    if (!hash(job.digest) || !['queued', 'running', 'succeeded', 'failed'].includes(job.status) || !Number.isInteger(job.attempts)
      || job.attempts < 0 || job.attempts > 3 || job.maxAttempts !== 3 || Date.parse(job.updatedAt) < Date.parse(job.createdAt)) fail('Ongeldige importjob.');
    if (!allowPending && ['queued', 'running'].includes(job.status)) fail('Wacht tot alle importjobs zijn verwerkt vóór back-up of herstel.', 409);
    // Job retention outlives later corrections/rollbacks. Validate the admitted
    // envelope against its correction ancestry, not a later catalog revision.
    const parentIndex = job.payload?.correctionOf ? imports.snapshots.findIndex(snapshot => snapshot.snapshotId === job.payload.correctionOf) : -1;
    if (job.payload?.correctionOf && parentIndex < 0) fail('Jobcorrectie verwijst naar een ontbrekende snapshot.');
    const ancestors = parentIndex >= 0 ? imports.snapshots.slice(0, parentIndex + 1) : [];
    if (ancestors.some(snapshot => Date.parse(snapshot.importedAt) > Date.parse(job.createdAt))) fail('Job verwijst naar nog niet beschikbare snapshot.');
    const earlier = { schemaVersion: 1, snapshots: ancestors, history: [] };
    let preview;
    try { preview = previewImport(job.payload, earlier, { now: job.createdAt }); }
    catch { fail('Bewaarde jobpayload heeft ongeldige veldtypen.'); }
    if (!preview.valid || preview.digest !== job.digest || job.payload.snapshotId !== job.snapshotId) fail('Bewaarde jobpayload of digest is ongeldig.');
    if (job.error !== null) {
      fields(job.error, ['message', 'status', 'details']); text(job.error.message, 1000, 'jobfout', true);
      if (!Number.isInteger(job.error.status) || job.error.status < 100 || job.error.status > 599) fail('Ongeldige foutstatus.');
      array(job.error.details, 30, 'foutdetails');
      for (const detail of job.error.details) { fields(detail, ['path', 'message']); text(detail.path, 200, 'foutlocatie', true); text(detail.message, 400, 'foutdetail', true); }
    }
    if (job.status === 'succeeded') {
      const snapshot = snapshots.get(job.snapshotId), result = job.result;
      fields(result, ['snapshotId', 'digest', 'status', 'idempotent', 'playerCount', 'competitionCount', 'changed', 'importedAt']);
      if (job.error !== null || job.attempts < 1 || !snapshot || snapshot.digest !== job.digest || result.snapshotId !== job.snapshotId || result.digest !== job.digest
        || result.status !== 'succeeded' || typeof result.idempotent !== 'boolean' || result.playerCount !== job.payload.players.length
        || result.competitionCount !== job.payload.competitions.length || result.changed !== (result.idempotent ? 0 : result.playerCount)
        || result.importedAt !== snapshot.importedAt || Date.parse(result.importedAt) > Date.parse(job.updatedAt)) fail('Jobresultaat komt niet overeen met de geïmporteerde snapshot.');
    } else if (job.result !== null || (job.status === 'failed' && job.error === null) || (job.status === 'running' && job.attempts < 1)) fail('Ongeldige status, fout of resultaat van importjob.');
  }
  const payloads = imports.snapshots.map(snapshot => snapshot.payload).concat(jobs.map(job => job.payload));
  if (checkRights && payloads.some(payload => !rightAllowed(payload, nowAt))) fail('Actuele export- of opslagrechten ontbreken voor bewaarde brongegevens, inclusief historie en jobs.', 403);
  const importedPlayers = new Set(imports.snapshots.flatMap(snapshot => snapshot.payload.players.map(player => player.id)));
  workspace(state, new Set(CATALOG.players.map(player => player.id)), nowAt, 'demowerkgebied', imports, true);
  if (state.importWorkspace !== undefined) workspace(state.importWorkspace, importedPlayers, nowAt, 'importwerkgebied', imports);
  if (state.audit.length + (state.importWorkspace?.audit.length || 0) > 20000) fail('Gezamenlijke auditlimiet overschreden.');
  const counts = value => ({ decisions: value?.decisions.length || 0, tasks: value?.tasks.length || 0, audit: value?.audit.length || 0 });
  const summary = { counts: { demo: counts(state), import: counts(state.importWorkspace), snapshots: imports.snapshots.length, importHistory: imports.history.length, jobs: jobs.length,
    sources: new Set(payloads.map(payload => payload.source.id)).size, players: importedPlayers.size,
    competitions: new Set(imports.snapshots.flatMap(snapshot => snapshot.payload.competitions.map(competition => competition.id))).size }, bytes: Buffer.byteLength(encoded, 'utf8') };
  return { state, digest: stateDigest(state), summary };
}

function organization(value) {
  fields(value, ['id', 'name']);
  if (!uuid(value.id)) fail('Ongeldig organisatie-ID in back-up.');
  text(value.name, 200, 'organisatienaam');
}
function summary(checked, org, createdAt) { return { organizationId: org.id, organizationName: org.name, createdAt, ...checked.summary }; }
export function createWorkspaceBackup({ organizationId, organizationName, state, now } = {}) {
  const org = { id: organizationId, name: organizationName }; organization(org);
  const createdAt = current(now), checked = validateWorkspaceState(state, { now: createdAt });
  const bundle = { format: 'omniscout-workspace', version: 1, organization: org, createdAt, state: checked.state, digest: checked.digest, summary: summary(checked, org, createdAt) };
  json(bundle);
  return bundle;
}
export function inspectWorkspaceBackup(bundle, { organizationId, now } = {}) {
  json(bundle); fields(bundle, ['format', 'version', 'organization', 'createdAt', 'state', 'digest', 'summary']);
  const nowAt = current(now);
  if (bundle.format !== 'omniscout-workspace' || bundle.version !== 1) fail('Onbekend werkruimteback-upformaat.');
  organization(bundle.organization); date(bundle.createdAt, nowAt, 'back-uptijd');
  if (!uuid(organizationId) || bundle.organization.id !== organizationId) fail('Deze back-up hoort bij een andere clubwerkruimte.', 403);
  const checked = validateWorkspaceState(bundle.state, { now: nowAt });
  if (bundle.digest !== checked.digest) fail('Back-updigest komt niet overeen met de inhoud.');
  const calculated = summary(checked, bundle.organization, bundle.createdAt);
  if (stable(bundle.summary) !== stable(calculated)) fail('Back-upsamenvatting komt niet overeen met de inhoud.');
  return { state: checked.state, digest: checked.digest, summary: calculated };
}

/** Retention is an inventory for human review, never a deletion instruction. */
export function retentionPreview(input, { now, days = 365 } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail('Bewaartermijn moet 1–3650 hele dagen zijn.');
  const asOf = current(now), cutoff = new Date(Date.parse(asOf) - days * DAY).toISOString();
  const { state } = validateWorkspaceState(input, { now: asOf, allowPending: true, checkRights: false });
  const imports = state.imports ?? emptyImportState(), jobs = state.importJobs ?? [], all = [];
  const referencedPlayers = new Set([state, state.importWorkspace].filter(Boolean).flatMap(value => [...value.decisions, ...value.tasks].map(item => item.playerId)));
  const push = (kind, dataset, itemId, at, activeDependency, rightsBlocked, reason) => all.push({ kind, dataset, id: itemId, at,
    ageCandidate: Date.parse(at) < Date.parse(cutoff), activeDependency: !!activeDependency, rightsBlocked: !!rightsBlocked, reason });
  for (const [dataset, value] of [['demo', state], ['import', state.importWorkspace]]) {
    if (!value) continue;
    const latestDecision = new Map(value.decisions.map(item => [item.playerId, item.id]));
    for (const item of value.decisions) push('decision', dataset, item.id, item.at, latestDecision.get(item.playerId) === item.id, false, 'Laatste besluit per speler bepaalt de huidige scoutingstatus.');
    for (const item of value.tasks) push('task', dataset, item.id, item.at, item.status === 'todo', false, item.status === 'todo' ? 'Open onderzoeksopdracht.' : 'Afgeronde opdracht; bewijsrelaties blijven te beoordelen.');
    for (const item of value.audit) push('audit', dataset, item.id, item.at, true, false, 'Audit bewaart de herkomst van besluiten en wijzigingen.');
  }
  for (const item of imports.history) push('history', 'import', item.id, item.at, true, false, 'Import- en rollbackhistorie is nodig om snapshots te reconstrueren.');
  for (const snapshot of imports.snapshots) {
    const dependent = imports.snapshots.some(other => other.payload.correctionOf === snapshot.snapshotId) || snapshot.payload.players.some(player => referencedPlayers.has(player.id));
    push('snapshot', 'import', snapshot.snapshotId, snapshot.importedAt, dependent || !imports.history.some(item => item.type === 'rollback' && item.snapshotId === snapshot.snapshotId), false, 'Controleer actieve projectie, correcties en scoutingverwijzingen; rollback verwijdert geen bronhistorie.');
    push('source', 'import', `snapshot:${snapshot.snapshotId}`, snapshot.importedAt, true, !rightAllowed(snapshot.payload, asOf), rightAllowed(snapshot.payload, asOf) ? 'Bewaarde bronversie verklaart momenteel opslag en export.' : 'Actuele verklaarde opslag- of exportrechten blokkeren back-up; geen verwijdering uitgevoerd.');
  }
  for (const job of jobs) {
    const pending = ['queued', 'running'].includes(job.status);
    push('job', 'import', job.id, job.createdAt, pending || job.status === 'succeeded', false, pending ? 'Wacht op verwerking; deze job mag niet worden gearchiveerd.' : 'Bewaarde job ondersteunt idempotentie en verwerkinghistorie.');
    push('source', 'import', `job:${job.id}`, job.createdAt, true, !rightAllowed(job.payload, asOf), 'Ook een bewaarde jobpayload valt onder de actuele bronrechten.');
  }
  const selected = all.filter(item => item.ageCandidate || item.rightsBlocked || item.kind === 'source' || (item.kind === 'job' && jobs.some(job => job.id === item.id && ['queued', 'running'].includes(job.status))));
  const warnings = ['Dit is een niet-destructieve inventarisatie; er is niets verwijderd.', 'Een leeftijdsgrens is geen vaststelling van wettelijke bewaarplicht of toestemming.'];
  if (all.some(item => item.rightsBlocked)) warnings.push('Controleer vervallen of ontbrekende bronrechten vóór een back-up; ook rollbackhistorie en jobpayloads tellen mee.');
  if (selected.length > 200) warnings.push('Alle aantallen zijn berekend; de lijst toont maximaal 200 te beoordelen records.');
  return { asOf, days, cutoff, counts: { ageCandidates: all.filter(item => item.ageCandidate).length, activeDependencies: all.filter(item => item.activeDependency).length,
    pendingJobs: jobs.filter(job => ['queued', 'running'].includes(job.status)).length, rightsBlocks: all.filter(item => item.rightsBlocked).length, totalItems: all.length, returnedItems: Math.min(selected.length, 200) },
    items: selected.slice(0, 200), warnings, destructive: false, truncated: selected.length > 200 };
}
