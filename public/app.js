import { CATALOG } from '/modules/fixtures.mjs';
let catalog = CATALOG;
import { ROLE_LABELS, ACTION_LABELS, REASON_LABELS, COVERAGE_FIELDS, COVERAGE_LABELS, COVERAGE_STATES, buildDossier, findPlayers, dossierCSV } from '/modules/engine.mjs';

const icons = {
 radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7M12 2v2M2 12h2M12 20v2M20 12h2"/>',
 board: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16M15 4v16M5 9h2M11 13h2M17 9h2"/>',
 bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
 globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
 sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
 clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 plus: '<path d="M12 5v14M5 12h14"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 export: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
 eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 warning: '<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>',
 compare: '<path d="M5 3v18M19 3v18M3 7h6M15 17h6M9 7l3 3M15 17l-3-3"/>',
 file: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const fmt = (value, decimals = 1) => value == null || !Number.isFinite(value) ? 'Onbekend' : value.toLocaleString('nl-NL', { maximumFractionDigits: decimals });
const initials = name => name.split(' ').filter(Boolean).slice(0, 2).map(x => x[0]).join('');
const dates = value => value ? new Date(value).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : 'Onbekend';
const newId = () => globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const blankState = () => ({ version: 1, decisions: [], tasks: [], brief: { role: '', minAge: 18, maxAge: 23, task: '', budgetScope: '' }, audit: [] });
const storageKey = 'omniscout.synthetic-demo.v1';
const datasetKey = 'omniscout.dataset.v1';
let state = blankState(), backend = null, storageWorking = true, dataset = 'demo', preferredDataset = 'demo', datasetLoading = true, mutationCount = 0, workspaceError = '';
try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (saved?.version === 1 && ['decisions', 'tasks', 'audit'].every(k => Array.isArray(saved[k]))) state = saved; } catch { storageWorking = false; }
try { if (localStorage.getItem(datasetKey) === 'import') preferredDataset = 'import'; } catch { /* Dataset preference is optional. */ }
let demoState = state;
const importUI = { payload: null, preview: null, filename: '', error: '', busy: false, sequence: 0, jobs: [], snapshots: [], jobsError: '', jobsLoading: false, rolledBack: new Set() };
let jobsTimer;
let view = 'radar', filters = { search: '', role: '', region: '', competition: '', quality: '', minAge: 18, maxAge: 23, newOnly: false, lowerOnly: false };
let comparison = new Set(), openPlayerId = null;
const main = document.querySelector('#main'), dossierDialog = document.querySelector('#dossier-dialog'), actionDialog = document.querySelector('#action-dialog');
const viewLabels = { radar: 'Wereldradar', tasks: 'Onderzoeksbord', shortlist: 'Shortlist', coverage: 'Datadekking', import: 'Bronimport', brief: 'Clubvraag', log: 'Beslislogboek' };
let toastTimeout;
function notify(message, error = false) { const el = document.querySelector('#toast'); el.textContent = message; el.className = `toast show ${error ? 'error' : ''}`; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('show'), 4500); }
function persist() { if (dataset !== 'demo') throw new Error('Importgegevens worden uitsluitend in de lokale backend opgeslagen.'); demoState = state; try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { storageWorking = false; notify('Browseropslag niet beschikbaar. Wijzigingen blijven alleen in deze tab.', true); } }
function addAudit(action, objectId, detail = '') { state.audit.push({ id: newId(), action, objectId, detail, at: new Date().toISOString(), actor: 'browser-demo-user' }); }
const scopedPath = (path, selected = dataset) => `${path}${path.includes('?') ? '&' : '?'}dataset=${encodeURIComponent(selected)}`;
const canImport = () => Boolean(backend?.supportsImport && !window.OMNI_INLINE);
const sourceLabel = source => source?.status === 'synthetic' ? 'Synthetische testimport' : source?.status === 'approved' ? 'Importverklaring · niet onafhankelijk geverifieerd' : 'Bronstatus ontbreekt of is ongeldig';
const playerLabel = player => dataset === 'demo' ? 'Fictief profiel' : player?.synthetic ? 'Synthetische testimport' : 'Importverklaring · niet onafhankelijk geverifieerd';
function datasetLabel() { return dataset === 'demo' ? 'Fictieve testgegevens' : !catalog.players.length ? 'Lokale import · geen beschikbare profielen' : catalog.players.every(p => p.synthetic) ? 'Synthetische testimport' : 'Importgegevens · verklaring niet onafhankelijk geverifieerd'; }
async function readJSON(path) {
  const response = await fetch(path, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Lokale gegevens ophalen mislukt.');
  return result;
}
async function refreshWorkspace(selected = dataset) {
  const result = await readJSON(scopedPath('/api/state', selected));
  if (dataset === selected) state = result;
}
async function request(path, method, data, { refresh = !path.startsWith('/api/import/') } = {}) {
  if (!backend) throw new Error('Deze actie vereist de lokale Node-backend.');
  const selected = dataset, workspaceMutation = !path.startsWith('/api/import/');
  mutationCount++; updateCounts();
  try {
    const r = await fetch(workspaceMutation ? scopedPath(path, selected) : path, { method, headers: { 'Content-Type': 'application/json', 'X-Omniscout-CSRF': backend.csrf }, body: JSON.stringify(workspaceMutation ? { ...data, dataset: selected } : data) });
    const result = await r.json();
    if (!r.ok) { const error = new Error(result.error || 'Opslaan mislukt.'); error.details = result.details; throw error; }
    if (refresh) await refreshWorkspace(selected);
    return result;
  } finally { mutationCount--; updateCounts(); }
}
async function selectDataset(selected, { remember = true } = {}) {
  if (!['demo', 'import'].includes(selected)) return;
  if (selected === 'import' && !canImport()) throw new Error('Lokale import vereist de Node-app. De zelfstandige en edge-demo tonen alleen fictieve gegevens.');
  datasetLoading = true; updateCounts();
  try {
    const [nextCatalog, nextState] = backend ? await Promise.all([readJSON(scopedPath('/api/catalog', selected)), readJSON(scopedPath('/api/state', selected))]) : [CATALOG, demoState];
    dataset = selected; catalog = nextCatalog; state = nextState; workspaceError = '';
    comparison.clear(); filters = { ...filters, search: '', competition: '', region: '', quality: '' };
    dossierDialog.close(); actionDialog.close(); openPlayerId = null;
    if (remember) { preferredDataset = selected; try { localStorage.setItem(datasetKey, selected); } catch { /* Never cache imported data. */ } }
    render();
  } finally { datasetLoading = false; updateCounts(); }
}
async function saveDecision(playerId, action, reason, note = '') {
  if (backend) await request('/api/decisions', 'POST', { playerId, action, reason, note });
  else { const id = newId(); state.decisions.push({ id, playerId, action, reason, note, at: new Date().toISOString() }); addAudit('decision.created', id, `${playerId}: ${action} (${reason})`); persist(); }
  updateCounts();
}
function latestDecision(id) { return state.decisions.filter(x => x.playerId === id).at(-1); }
function isShortlisted(id) { return latestDecision(id)?.action === 'follow'; }
function updateCounts() {
  document.querySelector('#task-count').textContent = state.tasks.filter(t => t.status === 'todo').length;
  document.querySelector('#shortlist-count').textContent = catalog.players.filter(p => isShortlisted(p.id)).length;
  document.querySelector('#player-count').textContent = catalog.players.length;
  document.querySelector('#storage-status').textContent = workspaceError ? 'Backendgegevens niet geladen' : backend ? backend.persistence === 'memory' ? 'Node-backend · tijdelijk geheugen' : 'Lokaal opgeslagen op dit apparaat' : storageWorking ? 'Preview · browseropslag' : 'Preview · tijdelijk geheugen';
  const picker = document.querySelector('#dataset-select');
  picker.value = dataset; picker.disabled = datasetLoading || mutationCount > 0;
  picker.querySelector('[value="import"]').disabled = !canImport();
  document.querySelector('#dataset-status').textContent = datasetLoading ? 'Gegevens ophalen…' : workspaceError ? 'Backendgegevens konden niet worden geladen. Kies de gegevensset opnieuw om te proberen.' : dataset === 'import' ? 'Importcatalogus en onderzoek blijven in de lokale backend.' : canImport() ? 'Demo en import hebben een afzonderlijk onderzoekslogboek.' : 'Alleen fictieve demo · import vereist de lokale Node-app.';
  document.querySelector('.date-label').textContent = `PEILDATUM ${dates(catalog.asOf)}`;
  document.querySelector('.demo-chip').textContent = dataset === 'demo' ? 'DEMO' : 'IMPORT';
  document.querySelector('.demo-banner p').innerHTML = dataset === 'demo' ? '<strong>Fictieve testomgeving.</strong> Alle spelers, clubs, competities en statistieken zijn voorbeelden. <strong>0 live databronnen.</strong>' : `<strong>${esc(datasetLabel())}.</strong> Bronrechten en inhoud zijn verklaringen van de importeur. Geen live providerverbinding of onafhankelijk geverifieerde scoutingdekking.`;
}
function heading(kicker, title, description, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${actions}</div></div>`; }
function empty(title, detail) { return `<div class="empty-state">${icon('radar')}<h3>${esc(title)}</h3><p>${esc(detail)}</p><button class="button secondary" data-action="reset">Toon alle spelers in deze set</button></div>`; }
function options(obj, current, all) { return `<option value="">${esc(all)}</option>` + Object.entries(obj).map(([key, label]) => `<option value="${esc(key)}" ${String(current) === key ? 'selected' : ''}>${esc(label)}</option>`).join(''); }
function qualityTag(d) { return `<span class="status-tag ${d.quality === 'documented' ? 'green' : 'amber'}"><i></i>${d.quality === 'documented' ? 'Meer bewijs' : 'Verkenning'}</span>`; }
function metric(d) { return d.roleMetric ? `${fmt(d.metrics[d.roleMetric.metric])}${d.metrics[d.roleMetric.metric] == null ? '' : ' ' + d.roleMetric.unit}` : 'Onbekend'; }
function worldMap() {
  const regions = [ ['Noord-Amerika', 151, 112, 'NOORD-AMERIKA'], ['Zuid-Amerika', 250, 208, 'ZUID-AMERIKA'], ['Europa', 385, 76, 'EUROPA'], ['Afrika', 369, 160, 'AFRIKA'], ['Azië', 558, 98, 'AZIË'], ['Oceanië', 603, 226, 'OCEANIË'] ];
  return `<div class="world-card panel"><div class="panel-head"><div><span class="eyebrow">WERELDWIJD ONTDEKKEN</span><h2>Niet elke kans staat al op de radar.</h2></div><span class="status-tag neutral">${dataset === 'demo' ? 'SCHEMA + TESTDATA' : 'LOKALE IMPORT'}</span></div>
   <div class="map-wrap"><svg viewBox="0 0 720 285" class="world-map" role="img" aria-label="Schematisch overzicht van de geselecteerde dataset. Geen kaart van live scoutingdekking."><defs><pattern id="grid" width="36" height="28" patternUnits="userSpaceOnUse"><path d="M36 0H0V28" fill="none" stroke="#274357" stroke-width=".5"/></pattern><pattern id="dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="#36526a"/></pattern><radialGradient id="glow"><stop stop-color="#a6f27a" stop-opacity=".13"/><stop offset="1" stop-color="#a6f27a" stop-opacity="0"/></radialGradient></defs><rect width="720" height="285" fill="url(#grid)" opacity=".5"/><ellipse cx="385" cy="140" rx="190" ry="140" fill="url(#glow)"/>
    <g fill="url(#dots)" stroke="#3e596c" stroke-width=".65" opacity=".85"><path d="M48 70l20-23 44-9 23-17 53 9 35 25-21 22-16 29-28 2-9 26-24 2 2 22 32 20 21 1 12 15-19 7-19-12-22-8-24-26-22-25-28-13z"/><path d="m244 193 28-14 28 15 12 23-17 29-11 30-14-11-9-34-16-18z"/><path d="m248 17 35-9 23 12-14 26-32 3-14-13z"/><path d="m337 70 21-20 12 9 15-16 14 9 13-23 16 16-1 24-29 6-14 15-9 18-34-6 6-17z"/><path d="m340 115 20-17 40 9 27 24 5 25-28 24-9 30-18-4-12-29-27-14-12-28z"/><path d="m418 43 36-11 26 9 18-16 36 9 45-1 27 17 27-4 30 22-23 18-29 5-8 17-31-3-3 28-26 21-14-12-13 14-19-6-14-29-30-12-13-15-22-3-22-14z"/><path d="m545 151 12 8 14 17 27 8 8 11-28-2-28-20z"/><path d="m579 209 26-13 33 8 8 24-15 21-30-5-27-15z"/><path d="m665 246 12-11 3 15-15 19z"/><path d="m409 194 7-5 3 16-8 18-5-12z"/></g>
    <g stroke="#94d675" stroke-opacity=".2" fill="none" stroke-dasharray="3 7"><path d="M385 76Q223 3 151 112M385 76Q291 139 250 208M385 76Q390 102 369 160M385 76Q462 21 558 98M385 76Q553 150 603 226"/></g>
    ${regions.map(([name, x, y, label]) => { const count = catalog.players.filter(p => catalog.competitions.find(c => c.id === p.competitionId)?.region === name).length; return `<g><circle cx="${x}" cy="${y}" r="14" fill="${count ? '#aff57d' : '#64798b'}" opacity=".1"/><circle cx="${x}" cy="${y}" r="5" fill="${count ? '#b8f384' : '#64798b'}"/><text x="${x + 13}" y="${y - 2}" class="map-label">${label}</text><text x="${x + 13}" y="${y + 13}" class="map-value">${count ? `${count} spelers` : 'Niet aangesloten'}</text></g>`; }).join('')}
   </svg></div><div class="region-pills">${regions.map(([name]) => `<button data-region="${esc(name)}">${esc(name)}<b>${catalog.players.filter(p => catalog.competitions.find(c => c.id === p.competitionId)?.region === name).length}</b></button>`).join('')}</div><div class="map-footer"><span><i class="legend-dot"></i>${catalog.competitions.filter(c => catalog.players.some(p => p.competitionId === c.id)).length} competities met spelers</span><span><i class="legend-dot muted"></i>${catalog.competitions.filter(c => !catalog.players.some(p => p.competitionId === c.id)).length} zonder spelersdata</span><button class="text-button" data-view="coverage">Alle dekking ${icon('arrow')}</button></div></div>`;
}
function tableRows(dossiers) {
  return dossiers.map((d, index) => `<tr><td class="check-cell"><input type="checkbox" aria-label="Vergelijk ${esc(d.player.name)}" data-compare="${esc(d.player.id)}" ${comparison.has(d.player.id) ? 'checked' : ''}></td><td><button class="player-link" data-open="${esc(d.player.id)}"><span class="player-avatar variant-${index % 4}">${esc(initials(d.player.name))}</span><span><strong>${esc(d.player.name)}</strong><small>${esc(d.player.club)}</small>${dataset === 'import' ? `<small>${esc(playerLabel(d.player))}</small>` : ''}<small class="mobile-player-meta">${esc(d.player.role)} · ${d.age} jaar · ${esc(d.competition.country)} · niveau ${d.competition.tier}</small></span></button></td><td><span class="role-label">${esc(d.player.role)}</span><small>${d.age} jaar · ${esc(d.player.preferredFoot)}</small></td><td><strong class="cell-normal">${esc(d.competition.country)}</strong><small>Niveau ${esc(d.competition.tier)} · ${esc(d.competition.name)}</small></td><td><strong class="numeric">${esc(metric(d))}</strong><small>${esc(d.roleMetric?.label || 'Rolgegevens')}</small></td><td><strong class="cell-normal">${fmt(d.minutes, 0)}</strong><small>${fmt(d.matches, 0)} wedstrijden</small></td><td>${qualityTag(d)}<small>${d.minutesChange !== null && d.minutesChange >= 120 ? `+${d.minutesChange} min · gelijke vensters` : d.quality === 'exploration' ? 'Aanvullend onderzoek nodig' : 'Geen toekomstvoorspelling'}</small></td><td><button class="icon-button ${isShortlisted(d.player.id) ? 'selected' : ''}" data-save="${esc(d.player.id)}" aria-label="${isShortlisted(d.player.id) ? 'Verwijder van shortlist' : 'Zet op shortlist'}: ${esc(d.player.name)}">${icon('bookmark')}</button><button class="icon-button" data-open="${esc(d.player.id)}" aria-label="Open dossier ${esc(d.player.name)}">${icon('arrow')}</button></td></tr>`).join('');
}
function playerTable(dossiers) {
  return dossiers.length ? `<div class="table-scroll"><table class="player-table"><thead><tr><th aria-label="Vergelijken"></th><th>SPELER / CLUB</th><th>ROL / LEEFTIJD</th><th>COMPETITIE</th><th>ROLSIGNAAL</th><th>MINUTEN</th><th>BEWIJSROUTE</th><th aria-label="Acties"></th></tr></thead><tbody>${tableRows(dossiers)}</tbody></table></div>` : empty('Geen kandidaten binnen deze filters', 'Dit resultaat geldt alleen voor de geselecteerde gegevensset. Het zegt niets over talent in niet-aangesloten competities.');
}
function renderRadar(shortlist = false) {
  const all = findPlayers(catalog, {}, state), documented = all.filter(d => d.quality === 'documented').length;
  const current = findPlayers(catalog, { ...filters, shortlistOnly: shortlist }, state);
  const regions = Object.fromEntries([...new Set(catalog.competitions.map(c => c.region))].map(x => [x, x]));
  const compOptions = Object.fromEntries(catalog.competitions.map(c => [c.id, `${c.country} · ${c.name}`]));
  main.innerHTML = heading(shortlist ? 'JOUW SCOUTINGSELECTIE' : 'VERBORGEN TALENT · ZICHTBAAR BEWIJS', shortlist ? 'Jouw shortlist.' : 'Zie wat anderen missen.', shortlist ? 'Opgeslagen onderzoekskandidaten. Een shortlist is geen contractbeslissing.' : 'Een wereld aan mogelijkheden. Eén werkplek voor gericht scoutingonderzoek.', `<button class="button secondary" data-action="export">${icon('export')} Export selectie</button><button class="button primary" data-view="brief">${icon('sliders')} Clubvraag instellen</button>`) +
  (!shortlist ? `<div class="kpi-grid"><div class="kpi-card"><span class="kpi-label">${dataset === 'demo' ? 'SPELERS IN DE TESTSET' : 'BESCHIKBARE IMPORTSPELERS'} ${icon('eye')}</span><div class="kpi-number">${all.length}<span>${esc(datasetLabel())}</span></div><p>${catalog.competitions.length} competities in deze gegevensset</p></div><div class="kpi-card"><span class="kpi-label">MEER ONDERLIGGEND BEWIJS ${icon('file')}</span><div class="kpi-number">${documented}<span class="green-text">onderzoekskandidaten</span></div><p>Voldoende minuten voor de voorbeeldregel</p></div><div class="kpi-card"><span class="kpi-label">VERKENNINGSROUTE ${icon('radar')}</span><div class="kpi-number">${all.length - documented}<span class="amber-text">nog nader te bekijken</span></div><p>Weinig data betekent niet weinig talent</p></div></div><div class="radar-top-grid">${worldMap()}<div class="focus-card panel"><div class="eyebrow">ONDERZOEK, GEEN GOKWERK</div><div class="focus-orbit">${icon('radar')}</div><h2>De beste volgende<br>vraag.</h2><p>Geen onverklaarbare talentscore. Wel de bron, het tegenbewijs en wat je nu moet onderzoeken.</p><div class="focus-steps"><span><b>01</b>Ontdek een relevant signaal</span><span><b>02</b>Controleer wat nog ontbreekt</span><span><b>03</b>Geef de scout een gerichte taak</span></div><button class="text-button" data-view="tasks">Open onderzoeksbord ${icon('arrow')}</button></div></div>` : '') +
  `<section class="panel candidates"><div class="candidates-top"><div><h2>${shortlist ? 'Opgeslagen spelers' : 'Ontdekkingsradar'} <span class="count-badge">${current.length}</span></h2><p>Gesorteerd op beschikbare informatie. Niet op voorspeld talent.</p></div><button class="button secondary compact" id="compare-button" data-action="compare" ${comparison.size < 2 ? 'disabled' : ''}>${icon('compare')} Vergelijk <span>${comparison.size}/3</span></button></div>
    <div class="filters"><label class="search-input">${icon('search')}<input id="search" data-filter="search" type="search" value="${esc(filters.search)}" placeholder="Zoek speler, club of land" aria-label="Zoek speler, club of land"></label><label class="select-filter"><span class="sr-only">Positie</span><select data-filter="role" aria-label="Positie">${options(ROLE_LABELS, filters.role, 'Alle posities')}</select></label><label class="select-filter"><span class="sr-only">Regio</span><select data-filter="region" aria-label="Regio">${options(regions, filters.region, 'Alle regio’s')}</select></label><label class="age-filter"><span>Leeftijd</span><input type="number" min="18" max="60" data-filter="minAge" aria-label="Minimumleeftijd" value="${esc(filters.minAge)}"><span>–</span><input type="number" min="18" max="60" data-filter="maxAge" aria-label="Maximumleeftijd" value="${esc(filters.maxAge)}"></label></div>
    <div class="filter-secondary"><div class="segment-control"><button data-quality="" class="${filters.quality === '' ? 'active' : ''}">Alle kandidaten</button><button data-quality="documented" class="${filters.quality === 'documented' ? 'active' : ''}">Meer bewijs</button><button data-quality="exploration" class="${filters.quality === 'exploration' ? 'active' : ''}">Verkenning</button></div><div class="quick-filters"><label><input type="checkbox" data-filter="lowerOnly" ${filters.lowerOnly ? 'checked' : ''}> Niveau 3 en lager</label><label><input type="checkbox" data-filter="newOnly" ${filters.newOnly ? 'checked' : ''}> Nieuw voor onze club</label></div></div>
    ${filters.competition ? `<div class="active-filter">Competitie: ${esc(compOptions[filters.competition])}<button data-action="clear-competition">${icon('close')} Wissen</button></div>` : ''}
    ${playerTable(current)}<div class="table-foot"><span><i class="legend-dot"></i>${esc(datasetLabel())} · Statistieken zijn niet tussen competities genormaliseerd</span><span>Peildatum ${dates(catalog.asOf)}</span></div></section>`;
}
function renderCoverage() {
  main.innerHTML = heading('TRANSPARANT OVER WAT WE WETEN', 'Dekking, zonder blinde claims.', 'Een competitienaam in de database is geen volledige spelersanalyse.') + `<div class="notice-card">${icon('warning')}<div><strong>${esc(datasetLabel())}.</strong><p>${dataset === 'demo' ? 'Onderstaande statussen demonstreren het dekkingsregister met fictieve competities. 0 echte databronnen aangesloten.' : 'Onderstaande bronrechten en dekkingsvelden zijn aangeleverd door de importeur; ze zijn niet onafhankelijk geverifieerd. Geen live providerverbinding.'}</p></div></div><section class="panel"><div class="panel-head"><div><span class="eyebrow">DEKKINGSREGISTER</span><h2>Per bron. Per competitie. Per gegevenstype.</h2></div></div><div class="table-scroll"><table class="coverage-table"><thead><tr><th>COMPETITIE</th><th>NIVEAU</th>${COVERAGE_FIELDS.map(k => `<th>${esc(COVERAGE_LABELS[k])}</th>`).join('')}<th>ACTUALITEIT</th></tr></thead><tbody>${catalog.competitions.map(c => `<tr><td><button class="coverage-link" data-competition="${esc(c.id)}">${esc(c.country)} ${icon('arrow')}</button><small>${esc(c.name)} · ${esc(c.season || 'Seizoen onbekend')} · ${esc(dataset === 'demo' ? 'fictief' : sourceLabel(catalog.sources.find(s => s.id === c.sourceId)))}</small></td><td>${esc(c.tier)}</td>${COVERAGE_FIELDS.map(k => `<td><span class="coverage-dot ${esc(c.coverage[k])}" title="${esc(COVERAGE_STATES[c.coverage[k]])}" aria-label="${esc(COVERAGE_LABELS[k] + ': ' + COVERAGE_STATES[c.coverage[k]])}"><span class="sr-only">${esc(COVERAGE_STATES[c.coverage[k]])}</span>${c.coverage[k] === 'available' ? '✓' : c.coverage[k] === 'partial' ? '◐' : '—'}</span></td>`).join('')}<td>${dates(c.lastReceivedAt)}<small>${fmt(c.observedPlayers, 0)} spelers</small></td></tr>`).join('')}</tbody></table></div><div class="coverage-legend">${Object.entries(COVERAGE_STATES).map(([k, v]) => `<span><i class="coverage-dot ${k}"></i>${esc(v)}</span>`).join('')}</div></section><div class="info-grid"><div class="panel info-panel"><h3>Onbekend blijft onbekend</h3><p>Geen minuten betekent geen berekening per 90 minuten. Geen volledige noemer betekent geen dekkingspercentage. Een niet-aangesloten competitie blijft zichtbaar als een gat.</p></div><div class="panel info-panel"><h3>Bronrechten vóór verwerking</h3><p>Voor bronnen zijn rechten nodig voor ophalen, bewaren, weergeven, analyse en export. De importeur verklaart deze rechten; de toepassing controleert velden en vervaldatums, geen externe overeenkomsten. Er worden geen externe verbindingen gelegd.</p></div></div>`;
}
function taskCard(task) {
  const p = catalog.players.find(p => p.id === task.playerId);
  return `<article class="task-card"><div class="task-card-head"><span class="status-tag ${task.status === 'done' ? 'green' : 'amber'}">${task.status === 'done' ? 'Afgerond' : 'Te onderzoeken'}</span><span>${dates(task.at)}</span></div><button class="task-player" data-open="${esc(task.playerId)}">${esc(p?.name || task.playerId)} ${icon('arrow')}</button><p>${esc(task.question)}</p>${task.result ? `<div class="task-result"><strong>Waargenomen uitkomst</strong><p>${esc(task.result)}</p></div>` : ''}<div class="task-card-bottom"><span>Interne opdracht · niet verstuurd</span><button class="button secondary compact" data-task="${esc(task.id)}">${task.status === 'done' ? 'Heropenen' : 'Uitkomst vastleggen'}</button></div></article>`;
}
function renderTasks() {
  const todo = state.tasks.filter(t => t.status !== 'done'), done = state.tasks.filter(t => t.status === 'done');
  main.innerHTML = heading('VAN SIGNAAL NAAR WAARNEMING', 'Onderzoek met een doel.', 'Leg eerst de vraag vast. Beoordeel daarna wat het nieuwe bewijs werkelijk verandert.', `<button class="button primary" data-view="radar">${icon('plus')} Kies een kandidaat</button>`) + `<div class="board"><section class="board-column"><div class="board-title"><span class="legend-dot amber-dot"></span><h2>Te onderzoeken</h2><span class="count-badge">${todo.length}</span></div>${todo.length ? todo.map(taskCard).join('') : '<div class="board-empty">Nog geen opdrachten. Open een spelersdossier en kies “Maak onderzoeksopdracht”.</div>'}</section><section class="board-column"><div class="board-title"><span class="legend-dot"></span><h2>Uitkomst vastgelegd</h2><span class="count-badge">${done.length}</span></div>${done.length ? done.map(taskCard).join('') : '<div class="board-empty">Een afgeronde opdracht krijgt een geschreven uitkomst. Een klik alleen is geen bewijs.</div>'}</section></div>`;
}
function renderBrief() {
  const b = state.brief;
  main.innerHTML = heading('BEGIN BIJ DE CLUBVRAAG', 'Welke rol ontbreekt?', 'Benoem taken en grenzen. De scout bepaalt hoe de informatie wordt gewogen.') + `<div class="brief-grid"><form id="brief-form" class="panel form-panel"><div class="panel-head"><h2>Recruitmentprofiel</h2><span class="status-tag neutral">${dataset === 'demo' ? 'LOKALE DEMO' : 'LOKALE IMPORT'}</span></div><label>Gezochte positie<select name="role">${options(ROLE_LABELS, b.role, 'Nog niet beperkt')}</select></label><div class="form-row"><label>Minimumleeftijd<input required name="minAge" type="number" min="18" max="60" value="${b.minAge}"></label><label>Maximumleeftijd<input required name="maxAge" type="number" min="18" max="60" value="${b.maxAge}"></label></div><label>Welke taken moet deze speler vervullen?<textarea name="task" maxlength="2400" rows="5" placeholder="Bijvoorbeeld: ruimte achter een hoge verdediging verdedigen en onder druk vooruit spelen.">${esc(b.task)}</textarea></label><label>Budgetscope en nog te verifiëren voorwaarden<textarea name="budgetScope" maxlength="1000" rows="3" placeholder="Bijvoorbeeld: totaalbudget inclusief salaris, niet alleen transfersom. Onbekende bedragen blijven onbekend.">${esc(b.budgetScope)}</textarea></label><p class="form-note">De tekst wordt bewaard als menselijke onderzoeksinstructie. Deze versie vertaalt de tekst niet met AI naar een automatische rolscore.</p><div class="form-actions"><button class="button primary" type="submit">${icon('check')} Profiel opslaan</button><button class="button secondary" type="button" data-action="apply-brief">Gebruik positie en leeftijd</button></div></form><div class="panel info-panel brief-explanation"><span class="eyebrow">VIER APARTE VRAGEN</span><h2>Geen alles-in-één<br>talentcijfer.</h2><div class="principle"><b>01</b><div><strong>Wat zien we nu?</strong><p>Prestaties en waarnemingen met hun bron.</p></div></div><div class="principle"><b>02</b><div><strong>Wat kan veranderen?</strong><p>Een ontwikkelhypothese is nog geen bewezen groeipad.</p></div></div><div class="principle"><b>03</b><div><strong>Past de gevraagde taak?</strong><p>Dit beoordeelt de scout met passend bewijs.</p></div></div><div class="principle"><b>04</b><div><strong>Is de overstap haalbaar?</strong><p>Budget, beschikbaarheid en registratie blijven afzonderlijk te controleren.</p></div></div></div></div>`;
}
function renderLog() {
  const actions = { 'decision.created': 'Scoutbesluit vastgelegd', 'task.created': 'Onderzoek aangemaakt', 'task.updated': 'Onderzoek bijgewerkt', 'brief.updated': 'Clubvraag gewijzigd' };
  main.innerHTML = heading('HET GEHEUGEN VAN JE SCOUTING', 'Bewaar de reden.', 'Een budgetafwijzing is geen negatief talentlabel. Alle wijzigingen blijven als nieuwe gebeurtenissen zichtbaar.', `<button class="button secondary" data-action="export-state">${icon('export')} Exporteer logboek</button>`) + `<section class="panel log-panel">${state.audit.length ? `<div class="timeline">${[...state.audit].reverse().map(e => `<article class="timeline-item"><span class="timeline-icon">${icon(e.action.startsWith('task') ? 'board' : e.action.startsWith('brief') ? 'sliders' : 'bookmark')}</span><div><h3>${esc(actions[e.action] || e.action)}</h3><p>${esc(e.detail || 'Lokaal onderzoeksprofiel opgeslagen')}</p><small>${esc(new Date(e.at).toLocaleString('nl-NL'))} · ${esc(e.actor)}</small></div></article>`).join('')}</div>` : '<div class="board-empty">Nog geen scoutbesluiten of onderzoeksacties. Het logboek wordt gevuld zodra je een actie opslaat.</div>'}<div class="table-foot">Dit lokale logboek is geen productie-audit met onafhankelijk gecontroleerde integriteit.</div></section>`;
}
function importIssues(items, title, kind) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<section class="import-issues ${kind}" aria-label="${esc(title)}"><h3>${esc(title)} (${items.length})</h3><ul>${items.slice(0, 100).map(item => `<li><code>${esc(item.path)}</code> ${esc(item.message)}</li>`).join('')}</ul>${items.length > 100 ? '<p>De eerste 100 meldingen worden getoond. Herstel deze en controleer opnieuw.</p>' : ''}</section>`;
}
function importSummary() {
  if (!importUI.preview) return '';
  const payload = importUI.payload && typeof importUI.payload === 'object' ? importUI.payload : {}, preview = importUI.preview, summary = preview.summary || {}, source = summary.source || payload.source || {};
  const competitions = Array.isArray(payload.competitions) ? payload.competitions : [], players = Array.isArray(payload.players) ? payload.players : [];
  const timestamps = ['eventAt', 'publishedAt', 'retrievedAt', 'availableAt'];
  const timeLabels = { eventAt: 'Gebeurtenis', publishedAt: 'Gepubliceerd', retrievedAt: 'Opgehaald', availableAt: 'Beschikbaar' };
  const stampRange = key => {
    const values = players.flatMap(p => [p?.[key], p?.stats?.[key]]).filter(value => typeof value === 'string').sort();
    return values.length ? `${values[0]} — ${values.at(-1)}` : 'Onbekend';
  };
  return `<section class="panel import-preview" id="import-preview" tabindex="-1"><div class="panel-head"><div><span class="eyebrow">CONTROLE ZONDER OPSLAG</span><h2>${preview.valid ? 'Bestand voldoet aan de importcontroles' : 'Import geblokkeerd'}</h2></div><span class="status-tag ${preview.valid ? 'green' : 'amber'}">${preview.valid ? 'Klaar voor bevestiging' : 'Herstel fouten / conflicten'}</span></div>
    <div class="import-preview-body"><p class="muted-copy">${esc(sourceLabel(source))}. Een geslaagde controle verifieert geen externe bronrechten of voetbalclaims.</p>
    <dl class="import-summary"><div><dt>Snapshot</dt><dd>${esc(payload.snapshotId)}</dd></div><div><dt>Correctie van</dt><dd>${esc(payload.correctionOf || 'Geen')}</dd></div><div><dt>Peildatum</dt><dd>${esc(payload.asOf)}</dd></div><div><dt>Aantallen in upload</dt><dd>${esc(summary.playerCount ?? players.length)} spelers · ${esc(summary.competitionCount ?? competitions.length)} competities · ${esc(summary.sourceCount ?? (payload.source ? 1 : 0))} bron</dd></div><div><dt>Bron</dt><dd>${esc(source.name)} (${esc(source.id)})</dd></div><div><dt>Toegestane verwerking</dt><dd>${esc(Array.isArray(source.allowedUses) ? source.allowedUses.join(', ') : 'Ontbreekt')}</dd></div><div><dt>Rechten verklaard</dt><dd>${source.rightsAttested === true ? 'Ja, volgens de importeur' : 'Nee'}</dd></div><div><dt>Rechten geldig vanaf</dt><dd>${esc(source.validFrom || 'Ontbreekt')}</dd></div><div><dt>Rechten vervallen</dt><dd>${esc(source.expiresAt === null && source.status === 'synthetic' ? 'Geen vervaldatum (synthetische bron)' : source.expiresAt || 'Ontbreekt')}</dd></div><div><dt>Rechtennotitie</dt><dd>${esc(source.rightsNote || 'Ontbreekt')}</dd></div>${timestamps.map(key => `<div><dt>${timeLabels[key]} (bereik)</dt><dd>${esc(stampRange(key))}</dd></div>`).join('')}</dl>
    <p class="form-note">${esc(summary.missingMinutes ?? players.filter(p => p?.stats?.minutes === null).length)} spelers met onbekende minuten; deze krijgen geen per-90-meting. ${summary.idempotent ? 'Deze ongewijzigde snapshot bestaat al: herhaling maakt geen dubbele waarnemingen.' : ''}</p><h3>Competities en seizoenen</h3><ul class="import-seasons">${competitions.slice(0, 100).map(c => `<li>${esc(c?.name)} · ${esc(c?.season || 'Seizoen ontbreekt')} · ${esc(c?.country)} · ontvangen ${esc(c?.lastReceivedAt || 'Onbekend')}</li>`).join('') || '<li>Geen competities aangeleverd.</li>'}</ul>
    ${importIssues(preview.errors, 'Blokkerende fouten en identiteitsconflicten', 'error')}${importIssues(preview.warnings, 'Waarschuwingen — geen automatische samenvoeging', 'warning')}
    ${preview.valid ? `<form id="import-confirm-form"><label class="import-consent"><input type="checkbox" id="import-confirm-check" required><span>Ik heb de bron, rechtenverklaring, peildatum en waarschuwingen gecontroleerd en wil deze snapshot in de lokale importdataset opslaan.</span></label><button type="submit" class="button primary" id="import-confirm" ${importUI.busy ? 'disabled' : ''}>${icon('check')} Bevestig lokale import</button><p class="form-note">Pas na bevestiging wordt een verwerkingsopdracht aangemaakt. De backend controleert rechten en identiteit opnieuw.</p></form>` : '<p class="form-note">Er is niets geïmporteerd. Corrigeer het bronbestand en kies het opnieuw om de controle te herhalen.</p>'}</div></section>`;
}
function renderImportJobs() {
  const host = document.querySelector('#import-jobs'); if (!host) return;
  const statusLabels = { queued: 'In wachtrij', running: 'Wordt verwerkt', succeeded: 'Geslaagd', failed: 'Mislukt' };
  host.innerHTML = `${importUI.jobsError ? `<p class="import-error" role="alert">${esc(importUI.jobsError)}</p>` : ''}${importUI.jobsLoading && !importUI.jobs.length ? '<p class="muted-copy">Werkelijke taakstatus ophalen…</p>' : !importUI.jobs.length ? '<p class="muted-copy">Nog geen importopdrachten in deze lokale backend.</p>' : ''}${[...importUI.jobs].reverse().map(job => `<article class="import-job" data-job-id="${esc(job.id)}" data-job-status="${esc(job.status)}"><div class="import-job-heading"><h3>${esc(job.snapshotId)}</h3><span class="status-tag ${job.status === 'succeeded' ? 'green' : 'amber'}">${esc(statusLabels[job.status] || job.status)}</span></div><p class="muted-copy">Poging ${esc(job.attempts)} / ${esc(job.maxAttempts)} · Bijgewerkt ${esc(job.updatedAt)}</p><small>Taak ${esc(job.id)}</small>${job.error ? `<p class="import-error">${esc(typeof job.error === 'string' ? job.error : job.error.message)}</p>${importIssues(job.error.details, 'Foutdetails', 'error')}` : ''}<div class="form-actions">${job.status === 'failed' && job.attempts < job.maxAttempts ? `<button class="button secondary" data-import-retry="${esc(job.id)}" ${importUI.busy ? 'disabled' : ''}>Opnieuw proberen</button>` : ''}${job.status === 'succeeded' ? (snapshotStatus(job.snapshotId) === 'rolled_back' || importUI.rolledBack.has(job.snapshotId)) ? '<p class="muted-copy">Snapshot teruggedraaid · backendgeschiedenis blijft bewaard.</p>' : snapshotStatus(job.snapshotId) === 'superseded' ? '<p class="muted-copy">Vervangen door een correctie. Draai eerst die correctie terug.</p>' : `<button class="button secondary" data-import-rollback="${esc(job.snapshotId)}" ${importUI.busy ? 'disabled' : ''}>Snapshot terugdraaien</button>` : ''}</div></article>`).join('')}`;
}
function snapshotStatus(snapshotId) { return importUI.snapshots.find(snapshot => snapshot.snapshotId === snapshotId)?.status; }
function renderImport() {
  main.innerHTML = heading('LOKALE BRONIMPORT', 'Controleer. Bevestig. Volg.', 'Importeer één JSON-snapshot met expliciete bronrechten, seizoenen, provideridentiteiten en tijdstempels.') + (!canImport() ? `<section class="panel info-panel"><h2>Start de lokale Node-app voor bronimport</h2><p>De zelfstandige HTML-preview en de edge-demo bevatten alleen synthetische testgegevens. Import, taakverwerking en rollback vereisen de lokale backend.</p><p>Open de toepassing via het adres dat <code>npm start</code> toont. Je huidige demogegevens blijven in de fictieve gegevensset.</p></section>` : `<section class="panel form-panel import-upload"><div class="panel-head"><h2>1. Kies en controleer een bronbestand</h2><button class="button secondary compact" data-action="import-sample">${icon('export')} Synthetisch voorbeeld</button></div><label for="import-file">JSON-bestand · maximaal 1 MiB<input type="file" id="import-file" accept=".json,application/json" ${importUI.busy ? 'disabled' : ''} aria-describedby="import-file-help"></label><p id="import-file-help" class="form-note">Alleen het gekozen bestand wordt gelezen. Een voorvertoning schrijft niets naar de importcatalogus. Bronlocators worden als tekst behandeld.</p>${importUI.filename ? `<p class="muted-copy">Bestand: <strong>${esc(importUI.filename)}</strong></p>` : ''}${importUI.busy ? '<p class="muted-copy" role="status">Lokale backend verwerkt het verzoek…</p>' : ''}${importUI.error ? `<p class="import-error" id="import-error" role="alert">${esc(importUI.error)}</p>` : ''}</section>${importSummary()}<section class="panel import-jobs-panel"><div class="panel-head"><div><span class="eyebrow">STATUS UIT DE BACKEND</span><h2>Verwerkingsopdrachten</h2></div><button class="button secondary compact" data-action="import-refresh">${icon('clock')} Vernieuwen</button></div><p class="form-note">Lopende taken worden automatisch gecontroleerd. Een geslaagde taak blijft in de geschiedenis staan na rollback; de actuele catalogus bepaalt welke gegevens beschikbaar zijn.</p><div id="import-jobs" aria-live="polite" aria-atomic="false"></div></section>`);
  renderImportJobs();
}
async function previewFile(file) {
  if (!file || !canImport()) return;
  const sequence = ++importUI.sequence;
  importUI.busy = true; importUI.payload = null; importUI.preview = null; importUI.error = ''; importUI.filename = file.name; renderImport();
  try {
    if (file.size > 1024 * 1024) throw new Error('Bestand is groter dan 1 MiB. Kies een kleinere JSON-snapshot.');
    let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('Ongeldige JSON. Er is niets geïmporteerd.'); }
    const preview = await request('/api/import/preview', 'POST', payload);
    if (sequence !== importUI.sequence) return;
    importUI.payload = payload; importUI.preview = preview;
  } catch (error) { if (sequence === importUI.sequence) importUI.error = error.message || 'Voorvertoning mislukt.'; }
  finally { if (sequence === importUI.sequence) { importUI.busy = false; if (view === 'import') { renderImport(); document.querySelector('#import-preview')?.focus(); } } }
}
async function refreshImportCatalog() {
  if (dataset !== 'import') return;
  const [nextCatalog, nextState] = await Promise.all([readJSON(scopedPath('/api/catalog', 'import')), readJSON(scopedPath('/api/state', 'import'))]);
  if (dataset !== 'import') return;
  catalog = nextCatalog; state = nextState;
  comparison = new Set([...comparison].filter(id => catalog.players.some(player => player.id === id)));
  if (dossierDialog.open) { if (catalog.players.some(player => player.id === openPlayerId)) showDossier(openPlayerId); else dossierDialog.close(); }
  if (view !== 'import') render(); else updateCounts();
}
async function loadImportJobs() {
  if (!canImport() || importUI.jobsLoading) return;
  clearTimeout(jobsTimer); importUI.jobsLoading = true;
  try {
    const previous = new Map(importUI.jobs.map(job => [job.id, job.status]));
    const previousSnapshots = JSON.stringify(importUI.snapshots);
    const [result, importedCatalog] = await Promise.all([readJSON('/api/import/jobs'), readJSON(scopedPath('/api/catalog', 'import'))]);
    importUI.jobs = result.jobs; importUI.snapshots = importedCatalog.importSnapshots || []; importUI.jobsError = '';
    if (JSON.stringify(importUI.snapshots) !== previousSnapshots || importUI.jobs.some(job => job.status === 'succeeded' && previous.get(job.id) !== 'succeeded')) await refreshImportCatalog();
  } catch (error) { importUI.jobsError = `${error.message} Gebruik Vernieuwen om opnieuw te controleren.`; }
  finally {
    importUI.jobsLoading = false; renderImportJobs();
    if (!importUI.jobsError && importUI.jobs.some(job => ['queued', 'running'].includes(job.status))) jobsTimer = setTimeout(loadImportJobs, 1200);
  }
}
async function downloadResponse(path, name, type) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error || 'Export niet toegestaan.'); }
  download(name, await response.text(), type);
}
function render() {
  document.querySelector('#breadcrumb').textContent = viewLabels[view]; document.title = `Omni-Scout · ${viewLabels[view]}`;
  document.querySelectorAll('#nav [data-view]').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  ({ radar: () => renderRadar(), shortlist: () => renderRadar(true), tasks: renderTasks, coverage: renderCoverage, import: renderImport, brief: renderBrief, log: renderLog })[view]();
  updateCounts();
}
function navigate(next) { if (!viewLabels[next]) return; view = next; render(); if (next === 'import') loadImportJobs(); window.scrollTo({ top: 0, behavior: 'instant' }); }
function showDossier(id) {
  const d = buildDossier(catalog.players.find(p => p.id === id), catalog); if (!d) return;
  openPlayerId = id;
  const decisions = state.decisions.filter(x => x.playerId === id);
  document.querySelector('#dossier-content').innerHTML = `<div class="dialog-top"><span class="eyebrow">SPELERSDOSSIER · ${esc(playerLabel(d.player))}</span><button class="icon-button" data-close="dossier" aria-label="Dossier sluiten">${icon('close')}</button></div><div class="dossier-header"><span class="player-avatar huge variant-0">${esc(initials(d.player.name))}</span><div><h2 id="dossier-title">${esc(d.player.name)}</h2><p>${esc(d.player.club)} · ${esc(d.competition.country)}</p><div class="dossier-tags"><span class="status-tag neutral">${esc(ROLE_LABELS[d.player.role])}</span><span class="status-tag neutral">${d.age} jaar</span>${qualityTag(d)}</div></div></div><div class="dossier-actions"><button class="button ${isShortlisted(id) ? 'secondary' : 'primary'}" data-save="${esc(id)}">${icon('bookmark')}${isShortlisted(id) ? 'Van shortlist halen' : 'Zet op shortlist'}</button><button class="button secondary" data-action="decision" data-player="${esc(id)}">${icon('file')} Leg besluit vast</button></div><div class="dossier-metrics"><div><span>${esc(d.roleMetric.label)}</span><strong>${esc(metric(d))}</strong><small>Testregel · geen universele norm</small></div><div><span>Speelminuten</span><strong>${fmt(d.minutes, 0)}</strong><small>${fmt(d.matches, 0)} wedstrijden</small></div><div><span>Competitieniveau</span><strong>${d.competition.tier}</strong><small>${esc(d.competition.name)}</small></div></div>
    <section class="dossier-section"><div class="section-label"><span class="legend-dot"></span><h3>Waarom nader onderzoeken?</h3></div>${d.signals.length ? d.signals.map(s => `<div class="evidence-item"><strong>${esc(s.title)}</strong><p>${esc(s.detail)}</p><small>Beschikbaar sinds ${dates(s.availableAt)} · ${esc(d.source.name)}</small></div>`).join('') : '<p>Geen aantoonbaar signaal binnen de beschikbare gegevens. Niet automatisch geïnterpreteerd als een slechte speler.</p>'}</section>
    <section class="next-action"><span class="eyebrow">DE BESTE VOLGENDE VRAAG · REGELGEBASEERD</span><h3>${esc(d.nextQuestion)}</h3><p>Gericht op ontbrekend bewijs. Niet op bevestiging van een vooraf gekozen conclusie.</p><button class="button primary" data-action="create-task" data-player="${esc(id)}">${icon('plus')} Maak onderzoeksopdracht</button></section>
    <section class="dossier-section"><div class="section-label"><span class="legend-dot amber-dot"></span><h3>Wat spreekt tegen de aanbeveling?</h3></div>${d.counters.length ? d.counters.map(e => `<div class="evidence-item counter"><strong>${esc(e.title)}</strong><p>${esc(e.text)}</p><small>${esc(e.locator)} · ${d.player.synthetic ? 'menselijke testobservatie' : 'aangeleverde menselijke observatie'}</small></div>`).join('') : '<p>Geen tegenobservaties vastgelegd. Dat is niet hetzelfde als afwezigheid van risico.</p>'}</section>
    <section class="dossier-section"><div class="section-label">${icon('warning')}<h3>Wat weten we nog niet?</h3></div><div class="gap-list">${d.gaps.map(g => `<p><span>?</span>${esc(g)}</p>`).join('')}</div></section>
    <section class="dossier-section"><div class="section-label">${icon('file')}<h3>Bronnen en bewijs</h3></div>${d.evidence.map(e => `<div class="source-row"><strong>${esc(e.locator)}</strong><span>${esc(e.kind === 'counter' ? 'Tegenobservatie' : 'Positieve observatie')}</span><small>Waargenomen ${dates(e.eventAt)} · Beschikbaar ${dates(e.availableAt)}<br>${esc(e.text)}</small></div>`).join('')}<p class="muted-copy">${d.player.synthetic ? 'Dit profiel bevat synthetische softwaretestgegevens.' : 'De aangeleverde broninhoud en rechtenverklaring zijn niet onafhankelijk geverifieerd.'} “Meer bewijs” betekent dat de beschikbare metingen aan een demonstratieregel voldoen. Bronlocators zijn tekst, geen geverifieerde beelden.</p></section>
    <section class="dossier-section"><div class="section-label">${icon('clock')}<h3>Eerdere besluiten</h3></div>${decisions.length ? [...decisions].reverse().map(e => `<div class="source-row"><strong>${esc(ACTION_LABELS[e.action])} · ${esc(REASON_LABELS[e.reason])}</strong><small>${esc(e.note || 'Geen aanvullende notitie')}<br>${esc(new Date(e.at).toLocaleString('nl-NL'))}</small></div>`).join('') : '<p class="muted-copy">Nog niet beoordeeld door deze lokale werkruimte. Geen uitspraak over bekendheid bij andere clubs.</p>'}</section><div class="dialog-footer">Bron: ${esc(d.source.name)} · Peildatum ${dates(d.asOf)}</div>`;
  if (!dossierDialog.open) dossierDialog.showModal();
}
function openAction(title, body) {
  document.querySelector('#action-content').innerHTML = `<div class="dialog-top"><h2 id="action-title">${esc(title)}</h2><button class="icon-button" data-close="action" aria-label="Dialoog sluiten">${icon('close')}</button></div>${body}`;
  actionDialog.showModal();
}
function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
function applyFiltersFromControl(el) {
  const key = el.dataset.filter; if (!key) return;
  filters[key] = el.type === 'checkbox' ? el.checked : el.value;
  const pos = el.type === 'search' ? el.selectionStart : null;
  render(); const next = main.querySelector(`[data-filter="${key}"]`); next?.focus(); if (pos !== null) next?.setSelectionRange(pos, pos);
}
main.addEventListener('input', event => { if (event.target.matches('input[type="search"][data-filter]')) applyFiltersFromControl(event.target); });
document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'dataset-select') { selectDataset(el.value).catch(error => { updateCounts(); notify(error.message, true); }); return; }
  if (el.id === 'import-file') { previewFile(el.files?.[0]); return; }
  if (el.matches('[data-filter]') && el.type !== 'search') applyFiltersFromControl(el);
  if (el.dataset.compare) {
    if (el.checked && comparison.size >= 3) { el.checked = false; return notify('Vergelijk maximaal drie profielen tegelijk.'); }
    el.checked ? comparison.add(el.dataset.compare) : comparison.delete(el.dataset.compare);
    const button = document.querySelector('#compare-button'); if (button) { button.disabled = comparison.size < 2; button.innerHTML = `${icon('compare')} Vergelijk <span>${comparison.size}/3</span>`; }
  }
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button, a.brand'); if (!el) return;
  try {
    if (el.matches('a.brand')) { event.preventDefault(); return navigate('radar'); }
    if (el.dataset.close) { (el.dataset.close === 'dossier' ? dossierDialog : actionDialog).close(); return; }
    if (el.dataset.view) return navigate(el.dataset.view);
    if (el.dataset.importRetry) {
      importUI.busy = true; el.disabled = true;
      try { await request(`/api/import/jobs/${encodeURIComponent(el.dataset.importRetry)}/retry`, 'POST', {}); await loadImportJobs(); notify('Nieuwe poging geregistreerd. Volg de werkelijke taakstatus hieronder.'); }
      catch (error) { importUI.jobsError = error.message; throw error; }
      finally { importUI.busy = false; renderImportJobs(); }
      return;
    }
    if (el.dataset.importRollback) {
      openAction('Importsnapshot terugdraaien', `<form id="import-rollback-form" data-snapshot="${esc(el.dataset.importRollback)}"><p class="muted-copy">Snapshot <strong>${esc(el.dataset.importRollback)}</strong> wordt uit de actieve importcatalogus teruggenomen. Eerdere versies en de mutatiegeschiedenis blijven bewaard. Onderzoeksbesluiten worden niet stilzwijgend herschreven.</p><button type="submit" class="button primary">Bevestig rollback</button></form>`); return;
    }
    if (el.dataset.open) return showDossier(el.dataset.open);
    if (el.dataset.quality !== undefined) { filters.quality = el.dataset.quality; return render(); }
    if (el.dataset.region) { filters.region = el.dataset.region; filters.competition = ''; render(); document.querySelector('.candidates')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (el.dataset.competition) { filters = { ...filters, competition: el.dataset.competition, region: '', role: '', quality: '', search: '' }; return navigate('radar'); }
    if (el.dataset.save) {
      el.disabled = true; const id = el.dataset.save, removing = isShortlisted(id);
      await saveDecision(id, removing ? 'archive' : 'follow', removing ? 'other' : 'positive', removing ? 'Van shortlist gehaald; dit is geen negatief talentlabel.' : 'Opgeslagen als onderzoekskandidaat.');
      render(); if (dossierDialog.open) showDossier(id); notify(removing ? 'Van shortlist gehaald. Reden is vastgelegd.' : 'Opgeslagen op je shortlist.'); return;
    }
    if (el.dataset.task) {
      const task = state.tasks.find(t => t.id === el.dataset.task);
      openAction(task.status === 'done' ? 'Onderzoek heropenen' : 'Uitkomst vastleggen', `<form id="task-result-form" data-id="${esc(task.id)}" data-status="${task.status === 'done' ? 'todo' : 'done'}"><p class="muted-copy">${esc(task.question)}</p><label>Wat heb je waargenomen? Wat bleef onzeker?<textarea name="result" rows="5" maxlength="2400" ${task.status !== 'done' ? 'required' : ''}>${esc(task.result)}</textarea></label><button class="button primary" type="submit">${icon('check')} ${task.status === 'done' ? 'Heropenen' : 'Uitkomst opslaan'}</button></form>`); return;
    }
    const action = el.dataset.action;
    if (action === 'import-refresh') { await loadImportJobs(); await refreshImportCatalog(); return; }
    if (action === 'import-sample') { await downloadResponse('/api/import/sample', 'OmniScout-import-SYNTHETISCH.json', 'application/json'); return; }
    if (action === 'reset') { filters = { search: '', role: '', region: '', competition: '', quality: '', minAge: 18, maxAge: 35, newOnly: false, lowerOnly: false }; return navigate('radar'); }
    if (action === 'clear-competition') { filters.competition = ''; return render(); }
    if (action === 'apply-brief') { filters.role = state.brief.role; filters.minAge = state.brief.minAge; filters.maxAge = state.brief.maxAge; return navigate('radar'); }
    if (action === 'export') {
      const selectedFilters = { ...filters, shortlistOnly: view === 'shortlist' };
      if (backend) await downloadResponse(scopedPath(`/api/export?${new URLSearchParams(selectedFilters)}`), `OmniScout-selectie-${dataset === 'import' ? 'IMPORT' : 'FICTIEF'}.csv`, 'text/csv;charset=utf-8');
      else download('OmniScout-selectie-FICTIEF.csv', dossierCSV(findPlayers(catalog, selectedFilters, state)), 'text/csv;charset=utf-8');
      return notify('Selectie geëxporteerd met bron- en gegevensstatus.');
    }
    if (action === 'export-state') {
      if (backend) await downloadResponse(scopedPath('/api/export/state'), `OmniScout-logboek-${dataset === 'import' ? 'IMPORT' : 'FICTIEF'}.json`, 'application/json');
      else download('OmniScout-demologboek.json', JSON.stringify({ mode: 'synthetic_demo', exportedAt: new Date().toISOString(), ...state }, null, 2), 'application/json');
      return;
    }
    if (action === 'create-task') {
      const d = buildDossier(catalog.players.find(p => p.id === el.dataset.player), catalog);
      openAction('Gerichte onderzoeksopdracht', `<form id="create-task-form" data-player="${esc(d.player.id)}" data-request="${newId()}"><p class="muted-copy">${esc(d.player.name)} · ${esc(d.player.club)} · ${esc(playerLabel(d.player))}</p><label>Welke onzekerheid ga je onderzoeken?<textarea name="question" rows="5" required maxlength="1600">${esc(d.nextQuestion)}</textarea></label><p class="form-note">Alleen intern vastleggen. Deze toepassing verstuurt geen bericht en koopt geen beelden in.</p><button class="button primary" type="submit">${icon('plus')} Opdracht vastleggen</button></form>`); return;
    }
    if (action === 'decision') {
      openAction('Scoutbesluit vastleggen', `<form id="decision-form" data-player="${esc(el.dataset.player)}"><label>Vervolgactie<select name="action" required>${Object.entries(ACTION_LABELS).map(([k,v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Reden<select name="reason" required>${Object.entries(REASON_LABELS).map(([k,v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Onderbouwing<textarea name="note" required maxlength="2400" rows="4" placeholder="Wat ondersteunt dit besluit? Wat blijft onzeker?"></textarea></label><p class="form-note">Een budget- of rolafwijzing wordt niet omgezet in een label ‘slechte speler’.</p><button class="button primary" type="submit">${icon('check')} Besluit opslaan</button></form>`); return;
    }
    if (action === 'compare') {
      const ds = [...comparison].map(id => buildDossier(catalog.players.find(p => p.id === id), catalog));
      const rows = [['Competitie', d => d.competition.name], ['Rol', d => ROLE_LABELS[d.player.role]], ['Leeftijd', d => `${d.age} jaar`], ['Minuten', d => fmt(d.minutes, 0)], ['Rolmeting', d => `${d.roleMetric.label}: ${metric(d)}`], ['Bewijsroute', d => d.quality === 'documented' ? 'Meer bewijs' : 'Verkenning'], ['Ontbrekend', d => d.gaps[0]], ['Volgende vraag', d => d.nextQuestion]];
      openAction('Vergelijk bewijs, niet een talentscore', `<p class="form-note">${esc(datasetLabel())}. De statistieken zijn niet gecorrigeerd voor verschillen tussen competities of rollen.</p><div class="table-scroll"><table class="compare-table"><thead><tr><th>Onderdeel</th>${ds.map(d => `<th>${esc(d.player.name)}</th>`).join('')}</tr></thead><tbody>${rows.map(([label, get]) => `<tr><th>${label}</th>${ds.map(d => `<td>${esc(get(d))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); return;
    }
  } catch (error) { notify(error.message || 'Actie mislukt.', true); } finally { if (el.isConnected) el.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!['brief-form', 'create-task-form', 'task-result-form', 'decision-form', 'import-confirm-form', 'import-rollback-form'].includes(form.id)) return;
  event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'import-confirm-form') {
      if (importUI.busy || !importUI.preview?.valid || !form.querySelector('#import-confirm-check').checked) throw new Error('Controleer het bestand en bevestig de importverklaring eerst.');
      importUI.busy = true; importUI.error = '';
      try {
        const result = await request('/api/import/confirm', 'POST', { payload: importUI.payload, digest: importUI.preview.digest });
        importUI.preview = null; importUI.payload = null;
        importUI.jobs = [result.job, ...importUI.jobs.filter(job => job.id !== result.job.id)];
        await selectDataset('import'); await loadImportJobs();
        notify('Importopdracht geregistreerd. De taakstatus toont of verwerking is geslaagd.');
      } catch (error) { importUI.error = `${error.message} Kies het bestand opnieuw voor een actuele controle.`; importUI.preview = null; throw error; }
      finally { importUI.busy = false; if (view === 'import') renderImport(); }
      return;
    }
    if (form.id === 'import-rollback-form') {
      importUI.busy = true;
      try {
        await request('/api/import/rollback', 'POST', { snapshotId: form.dataset.snapshot });
        importUI.rolledBack.add(form.dataset.snapshot); importUI.preview = null;
        await refreshImportCatalog(); await loadImportJobs(); actionDialog.close();
        notify('Rollback bevestigd door de backend. Actieve importcatalogus bijgewerkt.');
      } finally { importUI.busy = false; if (view === 'import') renderImport(); }
      return;
    }
    if (form.id === 'brief-form') {
      const brief = { ...data, minAge: Number(data.minAge), maxAge: Number(data.maxAge) };
      if (brief.minAge > brief.maxAge) throw new Error('Minimumleeftijd mag niet hoger zijn dan maximumleeftijd.');
      if (backend) await request('/api/brief', 'PUT', brief); else { state.brief = brief; addAudit('brief.updated', 'local-brief'); persist(); }
      notify('Clubvraag opgeslagen. Positie en leeftijd kunnen op de radar worden toegepast.');
    }
    if (form.id === 'create-task-form') {
      if (!data.question.trim()) throw new Error('Vul een onderzoeksvraag in.');
      const payload = { playerId: form.dataset.player, question: data.question.trim(), requestId: form.dataset.request };
      if (backend) await request('/api/tasks', 'POST', payload);
      else if (!state.tasks.some(t => t.requestId === payload.requestId)) { const task = { id: newId(), ...payload, status: 'todo', result: '', at: new Date().toISOString(), completedAt: null }; state.tasks.push(task); addAudit('task.created', task.id, task.playerId); persist(); }
      actionDialog.close(); dossierDialog.close(); navigate('tasks'); notify('Onderzoeksopdracht vastgelegd. Er is niets extern verstuurd.');
    }
    if (form.id === 'task-result-form') {
      const payload = { status: form.dataset.status, result: data.result.trim() };
      if (payload.status === 'done' && !payload.result) throw new Error('Beschrijf eerst de waargenomen uitkomst.');
      if (backend) await request(`/api/tasks/${form.dataset.id}`, 'PATCH', payload);
      else { const task = state.tasks.find(t => t.id === form.dataset.id); Object.assign(task, payload, { completedAt: payload.status === 'done' ? new Date().toISOString() : null }); addAudit('task.updated', task.id, payload.status); persist(); }
      actionDialog.close(); render(); notify('Onderzoeksuitkomst opgeslagen.');
    }
    if (form.id === 'decision-form') {
      if (!data.note.trim()) throw new Error('Een geschreven onderbouwing is vereist.');
      await saveDecision(form.dataset.player, data.action, data.reason, data.note.trim()); actionDialog.close(); showDossier(form.dataset.player); render(); notify('Besluit en reden vastgelegd.');
    }
    updateCounts();
  } catch (error) { notify(error.message || 'Opslaan mislukt.', true); } finally { if (submit.isConnected) submit.disabled = false; }
});
for (const dialog of [dossierDialog, actionDialog]) dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
render();
async function init() {
  if (!window.OMNI_INLINE && ['http:', 'https:'].includes(location.protocol)) {
    try {
      const session = await readJSON('/api/session');
      if (session.mode === 'local_single_user_demo' && session.csrf) { backend = session; await selectDataset(preferredDataset === 'import' && canImport() ? 'import' : 'demo', { remember: false }); }
    } catch (error) { if (backend) { workspaceError = error.message; notify(`Lokale gegevens konden niet worden geladen: ${error.message}`, true); } }
  }
  datasetLoading = false;
  if (preferredDataset === 'import' && !canImport()) notify('De bewaarde importkeuze vereist de lokale Node-app. Hier wordt de fictieve demo getoond.');
  render();
  updateCounts();
}
init();
