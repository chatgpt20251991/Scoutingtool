import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { CATALOG } from './fixtures.mjs';
import { ACTION_LABELS, REASON_LABELS, ROLE_LABELS, buildDossier, dossierCSV, findPlayers, sourceAllowed } from './engine.mjs';
import { createStore, emptyState } from './store.mjs';
import { MAX_IMPORT_BYTES, emptyImportState, previewImport, rollbackImport, catalogFromImports } from './import/index.mjs';
import { createImportQueue, coverageRecordsFromCatalog } from './ingestion/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
});
const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'], '/index.html': ['public/index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'], '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/modules/engine.mjs': ['src/engine.mjs', 'text/javascript; charset=utf-8'], '/modules/fixtures.mjs': ['src/fixtures.mjs', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml']
};
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function text(value, name, max = 1600, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${name} ontbreekt of is ongeldig.`);
  return value.trim();
}
async function body(req, limit = 65536) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Alleen application/json toegestaan.');
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) fail(413, 'Verzoek is te groot.'); chunks.push(chunk); }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Ongeldige JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'JSON-object vereist.');
  return data;
}
export async function createApp({ statePath = null, catalog: demoCatalog = CATALOG, now = () => new Date().toISOString() } = {}) {
  const store = await createStore(statePath), csrf = randomBytes(32).toString('hex');
  const importQueue = await createImportQueue({ store, now });
  function dataset(value = 'demo') { if (!['demo', 'import'].includes(value)) fail(400, 'Onbekende dataset.'); return value; }
  function workspace(state, selected, create = false) {
    if (selected === 'demo') return state;
    if (!state.importWorkspace && create) state.importWorkspace = emptyState();
    return state.importWorkspace || emptyState();
  }
  function audit(state, action, objectId, detail = '') { state.audit.push({ id: randomUUID(), action, objectId, detail, at: new Date().toISOString(), actor: 'local-demo-user' }); }
  const server = http.createServer(async (req, res) => {
    Object.entries(SECURITY_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    function json(status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
    try {
      const port = server.address()?.port;
      const validHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!validHosts.includes(req.headers.host)) fail(403, 'Alleen lokale hostnamen toegestaan.');
      if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site verzoek geblokkeerd.');
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin), route = url.pathname;
      if (req.headers.origin && req.headers.origin !== origin) fail(403, 'Onbekende origin.');
      if (!['GET', 'HEAD'].includes(req.method)) {
        const got = String(req.headers['x-omniscout-csrf'] || '');
        if (!/^[a-f0-9]{64}$/.test(got) || !timingSafeEqual(Buffer.from(got), Buffer.from(csrf))) fail(403, 'Ontbrekend of ongeldig lokaal sessietoken.');
        if (req.headers.origin !== origin) fail(403, 'Lokale origin vereist voor wijzigingen.');
      }
      const selected = dataset(url.searchParams.get('dataset') ?? 'demo');
      const catalog = selected === 'import' ? catalogFromImports((await store.read()).imports || emptyImportState(), { now: now(), asOf: url.searchParams.get('asOf') || now() }) : demoCatalog;
      if (selected === 'import') catalog.competitions = catalog.competitions.map(competition => ({ ...competition, sourceReportedObservedPlayers: competition.observedPlayers, observedPlayers: catalog.players.filter(p => p.competitionId === competition.id && p.sourceId === competition.sourceId).length }));
      function player(id) { const p = catalog.players.find(x => x.id === id); if (!p || !buildDossier(p, catalog)) fail(404, 'Speler niet beschikbaar.'); return p; }
      function checkDataset(data) { if (dataset(data.dataset ?? selected) !== selected) fail(400, 'Dataset in verzoek en URL komen niet overeen.'); }
      function updateWorkspace(fn) { return store.update(state => fn(workspace(state, selected, true))); }
      function checkExport() {
        if (selected === 'import' && catalog.sources.some(source => !sourceAllowed(source, now(), 'export'))) fail(403, 'Exportrechten ontbreken of zijn verlopen voor een geïmporteerde bron.');
        // Expired/withdrawn sources may be absent from the visible catalog: do not leak their notes.
        if (selected === 'import' && workspaceState.decisions.concat(workspaceState.tasks).some(item => !catalog.players.some(p => p.id === item.playerId))) fail(403, 'Export bevat verwijzingen naar niet meer beschikbare importgegevens.');
      }
      const workspaceState = workspace(await store.read(), selected);
      if (route === '/api/health' && req.method === 'GET') return json(200, { ok: true, mode: 'synthetic_demo', version: '0.2.0', liveSources: 0, productionReady: false });
      if (route === '/api/session' && req.method === 'GET') return json(200, { csrf, mode: 'local_single_user_demo', supportsImport: true, persistence: statePath ? 'local_file' : 'memory', notice: 'Geen productie-authenticatie. Gebruik synthetische, niet-vertrouwelijke testgegevens.' });
      if (route === '/api/import/sample' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="omniscout-import-FICTIEF.json"' });
        return res.end(await readFile(resolve(ROOT, 'samples/import-demo.json')));
      }
      if (route === '/api/import/preview' && req.method === 'POST') return json(200, previewImport(await body(req, MAX_IMPORT_BYTES), (await store.read()).imports || emptyImportState(), { now: now() }));
      if (route === '/api/import/confirm' && req.method === 'POST') {
        const data = await body(req, MAX_IMPORT_BYTES + 8192);
        if (!data.payload || typeof data.payload !== 'object' || Array.isArray(data.payload)) fail(400, 'payload moet het gecontroleerde JSON-object bevatten.');
        const preview = previewImport(data.payload, (await store.read()).imports || emptyImportState(), { now: now() });
        if (!preview.valid) return json(400, { error: 'Importvalidatie mislukt. Er is niets geïmporteerd.', ...preview });
        if (data.digest !== preview.digest) fail(409, 'Import is gewijzigd sinds de controle. Maak opnieuw een preview.');
        return json(202, { job: await importQueue.enqueue(data.payload, data.digest) });
      }
      if (route === '/api/import/jobs' && req.method === 'GET') return json(200, { jobs: await importQueue.list() });
      const retryMatch = route.match(/^\/api\/import\/jobs\/([a-zA-Z0-9_-]+)\/retry$/);
      if (retryMatch && req.method === 'POST') return json(202, { job: await importQueue.retry(retryMatch[1]) });
      if (route === '/api/import/rollback' && req.method === 'POST') {
        const data = await body(req);
        const result = await store.update(state => {
          if ((state.importJobs || []).some(job => ['queued', 'running'].includes(job.status))) fail(409, 'Wacht tot de verwerking gereed is voordat je herstelt.');
          const applied = rollbackImport(data.snapshotId, state.imports || emptyImportState(), { now: now() });
          state.imports = applied.state;
          audit(workspace(state, 'import', true), 'import.rolled_back', data.snapshotId, 'Vorige snapshot hersteld; bronhistorie behouden.');
          return applied.result;
        });
        return json(200, result);
      }
      if (route === '/api/catalog' && req.method === 'GET') return json(200, catalog);
      if (route === '/api/coverage' && req.method === 'GET') return json(200, { dataset: selected, asOf: catalog.asOf, records: coverageRecordsFromCatalog(catalog) });
      if (route === '/api/state' && req.method === 'GET') return json(200, { version: workspaceState.version, decisions: workspaceState.decisions, tasks: workspaceState.tasks, brief: workspaceState.brief, audit: workspaceState.audit });
      if (route === '/api/players' && req.method === 'GET') {
        const filters = Object.fromEntries(url.searchParams);
        filters.newOnly = filters.newOnly === 'true'; filters.lowerOnly = filters.lowerOnly === 'true';
        return json(200, { mode: catalog.mode, asOf: catalog.asOf, results: findPlayers(catalog, filters, workspaceState) });
      }
      const playerMatch = route.match(/^\/api\/players\/([a-zA-Z0-9_-]+)$/);
      if (playerMatch && req.method === 'GET') return json(200, buildDossier(player(playerMatch[1]), catalog));
      if (route === '/api/decisions' && req.method === 'POST') {
        const data = await body(req); checkDataset(data); player(data.playerId);
        if (!Object.hasOwn(ACTION_LABELS, data.action) || !Object.hasOwn(REASON_LABELS, data.reason)) fail(400, 'Ongeldige actie of reden.');
        const note = text(data.note ?? '', 'Notitie', 2400, data.action === 'archive');
        const entry = { id: randomUUID(), playerId: data.playerId, action: data.action, reason: data.reason, note, at: new Date().toISOString() };
        await updateWorkspace(state => { state.decisions.push(entry); audit(state, 'decision.created', entry.id, `${entry.playerId}: ${entry.action} (${entry.reason})`); return entry; });
        return json(201, entry);
      }
      if (route === '/api/tasks' && req.method === 'POST') {
        const data = await body(req); checkDataset(data); player(data.playerId);
        const question = text(data.question, 'Onderzoeksvraag');
        const requestId = text(data.requestId, 'Idempotentiesleutel', 100);
        const task = await updateWorkspace(state => {
          const existing = state.tasks.find(x => x.requestId === requestId);
          if (existing) { if (existing.playerId !== data.playerId || existing.question !== question) fail(409, 'Idempotentiesleutel is al voor een andere opdracht gebruikt.'); return existing; }
          if (state.tasks.length >= 2000) fail(409, 'Lokale opdrachtenlimiet bereikt.');
          const created = { id: randomUUID(), playerId: data.playerId, question, requestId, status: 'todo', result: '', at: new Date().toISOString(), completedAt: null };
          state.tasks.push(created); audit(state, 'task.created', created.id, data.playerId); return created;
        });
        return json(201, task);
      }
      const taskMatch = route.match(/^\/api\/tasks\/([a-f0-9-]+)$/);
      if (taskMatch && req.method === 'PATCH') {
        const data = await body(req); checkDataset(data);
        if (!['todo', 'done'].includes(data.status)) fail(400, 'Ongeldige opdrachtstatus.');
        const result = text(data.result ?? '', 'Uitkomst', 2400, data.status === 'done');
        const task = await updateWorkspace(state => {
          const task = state.tasks.find(x => x.id === taskMatch[1]); if (!task) fail(404, 'Opdracht niet gevonden.');
          task.status = data.status; task.result = result; task.completedAt = data.status === 'done' ? new Date().toISOString() : null;
          audit(state, 'task.updated', task.id, data.status); return task;
        });
        return json(200, task);
      }
      if (route === '/api/brief' && req.method === 'PUT') {
        const data = await body(req); checkDataset(data);
        if (data.role !== '' && !Object.hasOwn(ROLE_LABELS, data.role)) fail(400, 'Onbekende rol.');
        if (!Number.isInteger(data.minAge) || !Number.isInteger(data.maxAge) || data.minAge < 18 || data.maxAge > 60 || data.minAge > data.maxAge) fail(400, 'Ongeldige leeftijdsgrenzen.');
        const brief = { role: data.role, minAge: data.minAge, maxAge: data.maxAge, task: text(data.task ?? '', 'Taken', 2400, false), budgetScope: text(data.budgetScope ?? '', 'Budgetscope', 1000, false) };
        await updateWorkspace(state => { state.brief = brief; audit(state, 'brief.updated', 'local-brief'); return brief; });
        return json(200, brief);
      }
      if (route === '/api/export' && req.method === 'GET') {
        checkExport();
        const decisions = workspaceState;
        const filters = Object.fromEntries(url.searchParams);
        filters.shortlistOnly = filters.shortlistOnly !== 'false';
        filters.newOnly = filters.newOnly === 'true'; filters.lowerOnly = filters.lowerOnly === 'true';
        const selected = findPlayers(catalog, filters, decisions);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="omniscout-shortlist-${catalog.mode === 'synthetic_demo' ? 'FICTIEF' : 'IMPORT'}.csv"` });
        return res.end(dossierCSV(selected));
      }
      if (route === '/api/export/state' && req.method === 'GET') { checkExport(); res.setHeader('Content-Disposition', `attachment; filename="omniscout-${selected}-logboek.json"`); return json(200, { dataset: selected, notice: catalog.datasetNotice, version: workspaceState.version, decisions: workspaceState.decisions, tasks: workspaceState.tasks, brief: workspaceState.brief, audit: workspaceState.audit }); }
      if (STATIC[route] && ['GET', 'HEAD'].includes(req.method)) {
        const [path, type] = STATIC[route]; const data = await readFile(resolve(ROOT, path));
        res.writeHead(200, { 'Content-Type': type }); return res.end(req.method === 'HEAD' ? undefined : data);
      }
      fail(404, 'Niet gevonden.');
    } catch (error) { json(error.status || 500, { error: error.status ? error.message : 'Lokale verwerking mislukt. Eerdere geldige opslag is behouden.', ...(error.status && error.details ? { details: error.details } : {}) }); if (!error.status) console.error('Verwerkingsfout:', error.code || error.name); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, store, importQueue };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT moet tussen 1024 en 65535 liggen.');
  const { server } = await createApp({ statePath: resolve(ROOT, '.local/state.json') });
  server.listen(port, '127.0.0.1', () => console.log(`\nOmni-Scout 0.2.0 • lokaal prototype\nhttp://127.0.0.1:${port}\nDemo is fictief; importbronverklaringen zijn niet onafhankelijk geverifieerd. Geen live bronnen; geen productie-authenticatie.\nStoppen: Ctrl+C\n`));
  server.on('error', error => { console.error(`Opstarten mislukt: ${error.message}`); process.exitCode = 1; });
}
