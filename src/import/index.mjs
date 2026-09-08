import { createHash } from 'node:crypto';
import { ageOn, COVERAGE_FIELDS, COVERAGE_STATES, ROLE_LABELS, sourceAllowed, visibleAt } from '../engine.mjs';

export const MAX_IMPORT_BYTES = 1024 * 1024;
const METRICS = ['progressivePasses', 'interceptions', 'progressiveCarries', 'chancesCreated', 'nonPenaltyGoals', 'saves', 'shotsOnTarget', 'passesCompleted', 'passesAttempted', 'duelsWon', 'duelsTotal'];
const TIMES = ['eventAt', 'publishedAt', 'retrievedAt', 'availableAt'];
const REQUIRED_USES = ['ingest', 'store', 'display', 'analysis'];
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o) && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const clone = value => structuredClone(value);
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}' : JSON.stringify(value);
const time = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const date = value.slice(0, 10), n = Date.parse(value);
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return NaN;
  if (!Number.isFinite(n) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) return NaN;
  return n;
};
const current = now => new Date(typeof now === 'function' ? now() : now ?? Date.now()).toISOString();
const key = p => JSON.stringify([p.provider, p.providerId]);
const rolledBack = state => new Set(state.history.filter(x => x.type === 'rollback').map(x => x.snapshotId));
const fail = (message, status = 400, details = []) => { const e = new Error(message); e.status = status; e.details = details; throw e; };

export function emptyImportState() { return { schemaVersion: 1, snapshots: [], history: [] }; }
function validState(state) {
  if (state == null) return emptyImportState();
  if (state.schemaVersion !== 1 || !Array.isArray(state.snapshots) || !Array.isArray(state.history)) fail('Ongeldige importopslag; herstel vereist.', 409);
  return state;
}

/** Pure bounded preview. External text is data; no locator is ever fetched. */
export function previewImport(raw, importState, { now } = {}) {
  const errors = [], warnings = [];
  const error = (path, message) => { if (errors.length < 100) errors.push({ path, message }); };
  const warn = (path, message) => { if (warnings.length < 100) warnings.push({ path, message }); };
  let payload = raw, digest = null, state;
  const finish = summary => ({ valid: errors.length === 0, errors, warnings, summary, digest });
  try { state = validState(importState); } catch (e) { error('$state', e.message); return finish(null); }
  let nowAt;
  try { nowAt = current(now); } catch { error('$now', 'Ongeldige actuele tijd.'); return finish(null); }
  try {
    const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (typeof serialized !== 'string') { error('$', 'Een JSON-object is vereist.'); return finish(null); }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_IMPORT_BYTES) { error('$', 'Maximaal 1 MiB JSON per import.'); return finish(null); }
    if (typeof raw === 'string') payload = JSON.parse(raw);
  } catch { error('$', 'Ongeldige JSON of niet-serialiseerbare invoer.'); return finish(null); }
  if (!object(payload)) { error('$', 'Een JSON-object is vereist.'); return finish(null); }
  // Reject values that JSON would silently discard/coerce, and bound nesting before hashing.
  const visit = (v, path, depth, seen) => {
    if (depth > 12) { error(path, 'JSON is te diep genest.'); return; }
    if (v === null || ['string', 'boolean'].includes(typeof v)) return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) error(path, 'Alleen eindige JSON-getallen.'); return; }
    if (!object(v) && !Array.isArray(v)) { error(path, 'Alleen gewone JSON-waarden zijn toegestaan.'); return; }
    if (seen.has(v)) { error(path, 'Circulaire invoer is niet toegestaan.'); return; }
    if (Array.isArray(v) && (Object.keys(v).length !== v.length || Object.keys(v).some(k => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length))) { error(path, 'Arrays mogen geen lege posities of extra eigenschappen bevatten.'); return; }
    seen.add(v);
    for (const k of Object.keys(v)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) error(path + '.' + k, 'Gereserveerde sleutel.');
      visit(v[k], path + '.' + k, depth + 1, seen);
    }
    seen.delete(v);
  };
  visit(payload, '$', 0, new Set());
  if (errors.length) return finish(null);
  digest = createHash('sha256').update(stable(payload)).digest('hex');
  const fields = (v, path, allowed) => {
    if (!object(v)) { error(path, 'Object vereist.'); return false; }
    for (const k of Object.keys(v)) if (!allowed.includes(k)) error(path + '.' + k, 'Onbekend veld.');
    return true;
  };
  const id = (v, path) => { if (typeof v !== 'string' || !ID.test(v) || ['__proto__', 'constructor', 'prototype'].includes(v)) error(path, 'ID: 1–80 ASCII-letters, cijfers, _ of -.'); };
  const text = (v, path, max = 160, empty = false) => { if (typeof v !== 'string' || (!empty && !v.trim()) || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) error(path, `Tekst vereist, maximaal ${max} tekens.`); };
  const boolean = (v, path) => { if (typeof v !== 'boolean') error(path, 'Expliciet true of false vereist.'); };
  const timestamp = (v, path, nullable = false) => {
    if (!(nullable && v === null) && !Number.isFinite(time(v))) error(path, 'Geldige ISO-tijdstempel met tijdzone vereist.');
    return time(v);
  };
  const number = (v, path, max = 100000, nullable = true) => {
    if (nullable && v === null) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > max) error(path, `Geheel getal 0–${max}${nullable ? ' of null' : ''} vereist.`);
  };
  const temporal = (v, path) => {
    TIMES.forEach(k => timestamp(v[k], path + '.' + k, k === 'publishedAt'));
    if (!(time(v.eventAt) <= time(v.retrievedAt) && time(v.retrievedAt) <= time(v.availableAt) && time(v.availableAt) <= time(payload.asOf))) error(path, 'Vereist: eventAt ≤ retrievedAt ≤ availableAt ≤ asOf.');
    if (v.publishedAt !== null && !(time(v.eventAt) <= time(v.publishedAt) && time(v.publishedAt) <= time(v.retrievedAt))) error(path + '.publishedAt', 'Publicatie moet tussen gebeurtenis en ophalen liggen.');
  };
  fields(payload, '$', ['schemaVersion', 'snapshotId', 'correctionOf', 'asOf', 'source', 'competitions', 'players']);
  if (payload.schemaVersion !== 1) error('schemaVersion', 'Alleen schemaVersion 1 wordt ondersteund.');
  id(payload.snapshotId, 'snapshotId');
  if (payload.correctionOf !== null) id(payload.correctionOf, 'correctionOf');
  timestamp(payload.asOf, 'asOf');
  if (!(time(payload.asOf) <= Date.parse(nowAt))) error('asOf', 'Peildatum mag niet in de toekomst liggen.');
  const source = payload.source;
  if (fields(source, 'source', ['id', 'name', 'status', 'rightsAttested', 'allowedUses', 'validFrom', 'expiresAt', 'rightsNote'])) {
    id(source.id, 'source.id'); text(source.name, 'source.name'); text(source.rightsNote, 'source.rightsNote', 2000);
    if (!['synthetic', 'approved'].includes(source.status)) error('source.status', 'synthetic of approved vereist; approved is uitsluitend een verklaring van de importeur.');
    if (source.rightsAttested !== true) error('source.rightsAttested', 'Een expliciete rechtenverklaring is vereist.');
    if (!Array.isArray(source.allowedUses) || source.allowedUses.length > 5 || source.allowedUses.some(x => ![...REQUIRED_USES, 'export'].includes(x)) || new Set(source.allowedUses).size !== source.allowedUses.length) error('source.allowedUses', 'Unieke toegestane doelen: ingest, store, display, analysis en optioneel export.');
    for (const use of REQUIRED_USES) if (!Array.isArray(source.allowedUses) || !source.allowedUses.includes(use)) error('source.allowedUses', `Recht ontbreekt: ${use}.`);
    timestamp(source.validFrom, 'source.validFrom');
    timestamp(source.expiresAt, 'source.expiresAt', source.status === 'synthetic');
    if (!(time(source.validFrom) <= time(payload.asOf))) error('source.validFrom', 'Rechten moeten op de peildatum al geldig zijn.');
    if (source.expiresAt !== null && !(time(source.expiresAt) > Date.parse(nowAt))) error('source.expiresAt', 'Bronrechten zijn verlopen of ongeldig op de actuele tijd.');
    if (source.status === 'approved' && source.expiresAt === null) error('source.expiresAt', 'Importeurverklaarde bron vereist een expliciete einddatum.');
  }
  if (!Array.isArray(payload.competitions) || payload.competitions.length < 1 || payload.competitions.length > 100) error('competitions', '1–100 competities vereist.');
  if (!Array.isArray(payload.players) || payload.players.length > 3000) error('players', '0–3000 spelers vereist.');
  const competitions = Array.isArray(payload.competitions) ? payload.competitions.slice(0, 100) : [];
  const players = Array.isArray(payload.players) ? payload.players.slice(0, 3000) : [];
  const competitionIds = new Set(), playerIds = new Set(), providerIds = new Set(), observationIds = new Set(), names = new Map();
  competitions.forEach((c, i) => {
    const path = `competitions[${i}]`;
    if (!fields(c, path, ['id', 'name', 'country', 'region', 'tier', 'season', 'lat', 'lon', 'coverage', 'lastReceivedAt', 'synthetic', 'expectedMatches', 'observedMatches', 'observedPlayers', 'sourceId'])) return;
    id(c.id, path + '.id'); if (competitionIds.has(c.id)) error(path + '.id', 'Dubbel competitie-ID.'); competitionIds.add(c.id);
    ['name', 'country', 'region', 'season'].forEach(k => text(c[k], path + '.' + k));
    id(c.sourceId, path + '.sourceId'); if (c.sourceId !== source?.id) error(path + '.sourceId', 'Competitie moet naar de bron van deze import verwijzen.');
    number(c.tier, path + '.tier', 30); if (c.tier === 0) error(path + '.tier', 'Niveau begint bij 1.');
    boolean(c.synthetic, path + '.synthetic'); if (c.synthetic !== (source?.status === 'synthetic')) error(path + '.synthetic', 'Fictieve status moet overeenkomen met de bron.');
    if (fields(c.coverage, path + '.coverage', COVERAGE_FIELDS)) for (const k of COVERAGE_FIELDS) if (!own(COVERAGE_STATES, c.coverage[k])) error(path + '.coverage.' + k, 'Expliciete bekende dekkingsstatus vereist.');
    timestamp(c.lastReceivedAt, path + '.lastReceivedAt'); if (!(time(c.lastReceivedAt) <= time(payload.asOf))) error(path + '.lastReceivedAt', 'Ontvangst ligt na de peildatum.');
    for (const k of ['expectedMatches', 'observedMatches', 'observedPlayers']) if (own(c, k)) number(c[k], path + '.' + k, 1000000);
    if (typeof c.expectedMatches === 'number' && typeof c.observedMatches === 'number' && c.observedMatches > c.expectedMatches) error(path + '.observedMatches', 'Waargenomen wedstrijden overschrijden bekende noemer.');
    for (const [k, max] of [['lat', 90], ['lon', 180]]) if (own(c, k) && c[k] !== null && (typeof c[k] !== 'number' || !Number.isFinite(c[k]) || Math.abs(c[k]) > max)) error(path + '.' + k, 'Ongeldige coördinaat.');
  });
  players.forEach((p, i) => {
    const path = `players[${i}]`;
    if (!fields(p, path, ['id', 'provider', 'providerId', 'identityStatus', 'sourceId', 'competitionId', 'name', 'club', 'dob', 'role', 'preferredFoot', 'synthetic', 'stats', 'evidence', ...TIMES])) return;
    ['id', 'provider', 'providerId', 'sourceId', 'competitionId'].forEach(k => id(p[k], path + '.' + k));
    if (playerIds.has(p.id)) error(path + '.id', 'Dubbel intern spelers-ID.'); playerIds.add(p.id);
    if (providerIds.has(key(p))) error(path + '.providerId', 'Dubbele provideridentiteit; geen automatische samenvoeging.'); providerIds.add(key(p));
    if (!['provider_id', 'verified'].includes(p.identityStatus)) error(path + '.identityStatus', 'Duidelijke provideridentiteit vereist; needs_review blokkeert import.');
    if (p.sourceId !== source?.id) error(path + '.sourceId', 'Speler verwijst niet naar deze bron.');
    if (!competitionIds.has(p.competitionId)) error(path + '.competitionId', 'Competitie ontbreekt in deze import.');
    text(p.name, path + '.name'); text(p.club, path + '.club');
    if (own(p, 'preferredFoot')) text(p.preferredFoot, path + '.preferredFoot', 40);
    if (typeof p.name === 'string') {
      const normalized = p.name.trim().normalize('NFKC').toLocaleLowerCase('nl');
      if (names.has(normalized)) warn(path + '.name', 'Gelijknamige spelers blijven aparte provideridentiteiten; verifieer mogelijke dubbelen.');
      names.set(normalized, p.id);
    }
    if (typeof p.dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dob) || !Number.isFinite(time(p.dob + 'T00:00:00Z'))) error(path + '.dob', 'Geldige geboortedatum YYYY-MM-DD vereist.');
    const age = ageOn(p.dob, payload.asOf); if (age === null || age < 18 || age > 100) error(path + '.dob', 'Alleen volwassenen van 18–100 jaar op de peildatum.');
    if (!own(ROLE_LABELS, p.role)) error(path + '.role', 'Rol moet GK, CB, FB, CM, W of ST zijn.');
    boolean(p.synthetic, path + '.synthetic'); if (p.synthetic !== (source?.status === 'synthetic')) error(path + '.synthetic', 'Fictieve status moet overeenkomen met de bron.');
    temporal(p, path);
    if (fields(p.stats, path + '.stats', ['snapshotId', 'definition', 'coverageVersion', 'minutes', 'matches', ...METRICS, ...TIMES])) {
      id(p.stats.snapshotId, path + '.stats.snapshotId');
      if (observationIds.has(p.stats.snapshotId)) error(path + '.stats.snapshotId', 'Dubbel waarnemings-ID.'); observationIds.add(p.stats.snapshotId);
      if (p.stats.definition !== 'omniscout-counts-v1') error(path + '.stats.definition', 'Onbekende meetdefinitie; vereist omniscout-counts-v1.');
      if (own(p.stats, 'coverageVersion')) id(p.stats.coverageVersion, path + '.stats.coverageVersion');
      number(p.stats.minutes, path + '.stats.minutes', 100000); number(p.stats.matches, path + '.stats.matches', 1000);
      if (typeof p.stats.minutes === 'number' && typeof p.stats.matches === 'number' && p.stats.minutes > p.stats.matches * 130) error(path + '.stats.minutes', 'Minuten overschrijden 130 per opgegeven wedstrijd.');
      for (const k of METRICS) if (own(p.stats, k)) number(p.stats[k], path + '.stats.' + k, 1000000);
      for (const [part, total] of [['saves', 'shotsOnTarget'], ['passesCompleted', 'passesAttempted'], ['duelsWon', 'duelsTotal']]) if (typeof p.stats[part] === 'number' && typeof p.stats[total] === 'number' && p.stats[part] > p.stats[total]) error(path + '.stats.' + part, 'Deel overschrijdt het totaal.');
      temporal(p.stats, path + '.stats');
      if (p.stats.minutes === null) warn(path + '.stats.minutes', 'Minuten onbekend; geen meting per 90 minuten.');
      if (METRICS.some(k => !own(p.stats, k) || p.stats[k] === null)) warn(path + '.stats', 'Ontbrekende meetwaarden blijven null; er wordt niets afgeleid.');
    }
    if (own(p, 'evidence') && (!Array.isArray(p.evidence) || p.evidence.length > 30)) error(path + '.evidence', 'Maximaal 30 bewijsobjecten per speler.');
    for (const [j, e] of (Array.isArray(p.evidence) ? p.evidence.slice(0, 30) : []).entries()) {
      const ep = path + `.evidence[${j}]`;
      if (!fields(e, ep, ['id', 'sourceId', 'kind', 'title', 'text', 'locator', ...TIMES])) continue;
      id(e.id, ep + '.id'); if (observationIds.has(e.id)) error(ep + '.id', 'Dubbel waarnemings-ID.'); observationIds.add(e.id);
      id(e.sourceId, ep + '.sourceId'); if (e.sourceId !== source?.id) error(ep + '.sourceId', 'Bewijs moet naar deze bron verwijzen.');
      if (!['positive', 'counter', 'claim', 'unknown'].includes(e.kind)) error(ep + '.kind', 'Bewijstype moet positive, counter, claim of unknown zijn.');
      text(e.title, ep + '.title', 200); text(e.text, ep + '.text', 2000); text(e.locator, ep + '.locator', 1000); temporal(e, ep);
    }
  });
  const existing = state.snapshots.find(s => s.snapshotId === payload.snapshotId);
  if (existing && existing.digest !== digest) error('snapshotId', 'Snapshot-ID bestaat met andere inhoud; maak een nieuwe correctieversie.');
  if (existing && rolledBack(state).has(payload.snapshotId)) error('snapshotId', 'Snapshot is teruggedraaid; gebruik een nieuw snapshot-ID.');
  if (payload.correctionOf !== null) {
    const parent = state.snapshots.find(s => s.snapshotId === payload.correctionOf);
    if (!parent) error('correctionOf', 'Te corrigeren snapshot ontbreekt.');
    else {
      if (parent.payload.source.id !== source?.id) error('correctionOf', 'Correctie moet dezelfde bron betreffen.');
      if (!(time(payload.asOf) > time(parent.payload.asOf))) error('asOf', 'Correctie vereist een latere peildatum, zodat oude dossiers behouden blijven.');
      if (!existing && (rolledBack(state).has(parent.snapshotId) || state.snapshots.some(s => s.payload.correctionOf === parent.snapshotId && !rolledBack(state).has(s.snapshotId)))) error('correctionOf', 'Corrigeer de actieve laatste revisie.');
    }
  }
  // Compare immutable identities and observations against ALL prior revisions, including rollbacks.
  const oldPlayers = new Map(), oldProviders = new Map(), oldObservations = new Map(), oldCompetitions = new Map(), latestPlayerAsOf = new Map();
  for (const s of state.snapshots) {
    if (s.payload.source.id === source?.id && s.payload.source.status !== source.status) error('source.status', 'Een bron kan niet wisselen tussen fictief en importeurverklaard.');
    for (const c of s.payload.competitions) oldCompetitions.set(c.id, c);
    for (const p of s.payload.players) {
      oldPlayers.set(p.id, p); oldProviders.set(key(p), p);
      latestPlayerAsOf.set(p.id, Math.max(latestPlayerAsOf.get(p.id) ?? -Infinity, time(s.payload.asOf)));
      oldObservations.set(p.stats.snapshotId, { owner: p.id, value: p.stats });
      for (const e of p.evidence || []) oldObservations.set(e.id, { owner: p.id, value: e });
    }
  }
  for (const c of competitions.filter(object)) if (oldCompetitions.has(c.id) && (oldCompetitions.get(c.id).sourceId !== c.sourceId || oldCompetitions.get(c.id).season !== c.season)) error('competitions', 'Competitie-ID is al aan een andere bron of seizoen gekoppeld; gebruik voor een nieuw seizoen een nieuw ID.');
  const oldNames = new Set([...oldPlayers.values()].map(p => p.name.trim().normalize('NFKC').toLocaleLowerCase('nl')));
  for (const p of players.filter(object)) {
    const old = oldPlayers.get(p.id), provider = oldProviders.get(key(p));
    if (old && (key(old) !== key(p) || old.sourceId !== p.sourceId || old.dob !== p.dob)) error('players', 'Bestaand spelers-ID heeft een conflicterende provider, bron of geboortedatum; handmatige beoordeling nodig.');
    if (provider && (provider.id !== p.id || provider.sourceId !== p.sourceId)) error('players', 'Provideridentiteit is al aan een ander spelers-ID of bron gekoppeld.');
    if (!existing && old && stable(old) !== stable(p) && latestPlayerAsOf.get(p.id) >= time(payload.asOf)) error('asOf', 'Gewijzigde spelersgegevens vereisen een latere snapshot-peildatum; eerdere revisies blijven historisch beschikbaar.');
    if (!old && typeof p.name === 'string' && oldNames.has(p.name.trim().normalize('NFKC').toLocaleLowerCase('nl'))) warn('players', 'Gelijknamige bestaande speler; geen automatische samenvoeging.');
    for (const [oid, v] of [[p.stats?.snapshotId, p.stats], ...(Array.isArray(p.evidence) ? p.evidence.filter(object).map(e => [e.id, e]) : [])]) {
      const prior = oldObservations.get(oid);
      if (prior && (prior.owner !== p.id || stable(prior.value) !== stable(v))) error('players', 'Waarnemings-ID is onveranderlijk; gebruik een nieuw ID voor gecorrigeerde inhoud.');
    }
  }
  if (!existing && state.snapshots.length >= 200) error('$state', 'Maximaal 200 snapshots in dit lokale prototype; expliciet archiefbeheer is vereist.');
  const summary = {
    snapshotId: payload.snapshotId, correctionOf: payload.correctionOf, asOf: payload.asOf,
    playerCount: players.length, competitionCount: competitions.length, sourceCount: source ? 1 : 0,
    synthetic: source?.status === 'synthetic', idempotent: !!existing && existing.digest === digest,
    source: object(source) ? clone(source) : null,
    seasons: [...new Set(competitions.filter(object).map(c => c.season).filter(s => typeof s === 'string'))],
    competitions: competitions.filter(object).map(c => ({ id: c.id, name: c.name, season: c.season, coverage: c.coverage, sourceId: c.sourceId, playerCount: players.filter(object).filter(p => p.competitionId === c.id).length })),
    missingMinutes: players.filter(object).filter(p => p.stats?.minutes === null).length
  };
  return finish(summary);
}

export function applyImport(raw, importState, { now } = {}) {
  const state = validState(importState), nowAt = current(now), preview = previewImport(raw, state, { now: nowAt });
  if (!preview.valid) fail('Importvalidatie mislukt.', preview.errors.some(e => ['snapshotId', 'correctionOf', '$state'].includes(e.path) || /conflict|onveranderlijk|al aan/.test(e.message)) ? 409 : 400, preview.errors);
  const payload = typeof raw === 'string' ? JSON.parse(raw) : clone(raw);
  const result = { snapshotId: payload.snapshotId, digest: preview.digest, status: 'succeeded', idempotent: preview.summary.idempotent, playerCount: payload.players.length, competitionCount: payload.competitions.length, changed: preview.summary.idempotent ? 0 : payload.players.length, importedAt: nowAt };
  if (preview.summary.idempotent) return { state: clone(state), result: { ...result, importedAt: state.snapshots.find(s => s.snapshotId === payload.snapshotId).importedAt } };
  const next = clone(state);
  next.snapshots.push({ snapshotId: payload.snapshotId, digest: preview.digest, importedAt: nowAt, payload });
  next.history.push({ id: `import-${next.history.length + 1}`, type: 'import', snapshotId: payload.snapshotId, correctionOf: payload.correctionOf, digest: preview.digest, at: nowAt });
  return { state: next, result };
}

export function rollbackImport(snapshotId, importState, { now } = {}) {
  const state = validState(importState), nowAt = current(now);
  if (typeof snapshotId !== 'string' || !ID.test(snapshotId)) fail('Ongeldig snapshot-ID.');
  if (!state.snapshots.some(s => s.snapshotId === snapshotId)) fail('Snapshot bestaat niet.', 409);
  const removed = rolledBack(state), idempotent = removed.has(snapshotId);
  if (!idempotent && state.snapshots.some(s => s.payload.correctionOf === snapshotId && !removed.has(s.snapshotId))) fail('Draai eerst de afhankelijke correctie terug.', 409);
  const next = clone(state);
  if (!idempotent) next.history.push({ id: `rollback-${next.history.length + 1}`, type: 'rollback', snapshotId, at: nowAt });
  return { state: next, result: { snapshotId, status: 'rolled_back', idempotent, rolledBackAt: nowAt } };
}

/** Catalog is an as-of projection, never a mutation of immutable uploaded snapshots. */
export function catalogFromImports(importState, { asOf, now } = {}) {
  const state = validState(importState), nowAt = current(now), cutoff = asOf ?? nowAt;
  if (!Number.isFinite(time(cutoff)) || time(cutoff) > Date.parse(nowAt)) fail('Ongeldige of toekomstige peildatum.');
  const removed = rolledBack(state);
  const active = state.snapshots.filter(s => !removed.has(s.snapshotId));
  const eligible = active.filter(s => time(s.payload.asOf) <= time(cutoff));
  const superseded = new Set(eligible.map(s => s.payload.correctionOf).filter(Boolean));
  const selected = eligible.filter(s => !superseded.has(s.snapshotId));
  const sources = new Map(), currentSources = new Map(), competitions = new Map(), players = new Map();
  // Current rights can block historical reads too. Historical asOf never revives expired rights.
  for (const s of active) currentSources.set(s.payload.source.id, s.payload.source);
  for (const s of selected.sort((a, b) => time(a.payload.asOf) - time(b.payload.asOf))) {
    const source = s.payload.source, latestSource = currentSources.get(source.id);
    if (!REQUIRED_USES.every(use => sourceAllowed(latestSource, nowAt, use) && sourceAllowed(source, cutoff, use))) continue;
    // Export/display callers must see effective current rights, including a newer
    // export revocation, even when requesting an older sporting observation.
    // The untouched original rights declaration remains in snapshot provenance.
    sources.set(source.id, { ...clone(source), allowedUses: source.allowedUses.filter(use => latestSource.allowedUses.includes(use)), expiresAt: [source.expiresAt, latestSource.expiresAt].filter(Boolean).sort((a, b) => time(a) - time(b))[0] ?? null });
    for (const c of s.payload.competitions) if (time(c.lastReceivedAt) <= time(cutoff)) competitions.set(c.id, { ...clone(c), expectedMatches: c.expectedMatches ?? null, observedMatches: c.observedMatches ?? null, observedPlayers: c.observedPlayers ?? null });
    for (const p of s.payload.players) if (visibleAt(p, cutoff) && visibleAt(p.stats, cutoff)) {
      const projected = clone(p);
      for (const metric of METRICS) if (!own(projected.stats, metric)) projected.stats[metric] = null;
      projected.evidence = (projected.evidence || []).filter(e => visibleAt(e, cutoff));
      projected.importProvenance = { snapshotId: s.snapshotId, correctionOf: s.payload.correctionOf, digest: s.digest, importedAt: s.importedAt };
      players.set(p.id, projected);
    }
  }
  return { schemaVersion: 1, asOf: cutoff, mode: 'import', datasetNotice: 'Lokale import: bronrechten en identiteit zijn verklaringen van de importeur, niet onafhankelijk geverifieerd. Synthetische imports blijven fictieve softwaretestdata. Geen live providerverbinding.', sources: [...sources.values()], competitions: [...competitions.values()], players: [...players.values()], importSnapshots: state.snapshots.filter(s => time(s.payload.asOf) <= time(cutoff)).map(s => ({ snapshotId: s.snapshotId, correctionOf: s.payload.correctionOf, asOf: s.payload.asOf, importedAt: s.importedAt, playerCount: s.payload.players.length, competitionCount: s.payload.competitions.length, sourceId: s.payload.source.id, status: removed.has(s.snapshotId) ? 'rolled_back' : superseded.has(s.snapshotId) ? 'superseded' : 'active' })) };
}
