import { CATALOG } from '/modules/fixtures.mjs';
const emptyCatalog = () => ({ ...CATALOG, asOf: null, players: [], sources: [], competitions: [] });
let catalog = emptyCatalog();
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
// Account workspaces never read browser notes. Existing standalone demo work is preserved.
try { if (localStorage.getItem(datasetKey) === 'import') preferredDataset = 'import'; } catch { /* Dataset preference is optional. */ }
let demoState = state;
let environment = window.OMNI_INLINE || location.protocol === 'file:' ? 'standalone' : 'checking';
let organizationId = '', epoch = 0, authMode = 'login', authError = '', authBusy = false, expiryTimer, sessionCheck;
const requests = new Set();
const accountUI = { members: [], invitations: [], invitationsError: '', stats: null, statsError: '', error: '', loading: false, invite: null, migrationRequired: false, migrationMessage: '' };
const recoveryUI = { invitePreview: null, backupPreview: null, retention: null, inviteError: '', backupError: '', retentionError: '', message: '', busy: false };
let accountSequence = 0;
function clearAccountTransient() {
  accountSequence++; accountUI.invite = null;
  Object.assign(recoveryUI, { invitePreview: null, backupPreview: null, retention: null, inviteError: '', backupError: '', retentionError: '', message: '', busy: false });
}
const accountContext = () => ({ ...context(), accountSequence });
function assertAccountContext(ctx) { assertContext(ctx); if (ctx.accountSequence !== accountSequence || view !== 'account') throw staleError(); }
const membership = () => backend?.organizations?.find(org => org.id === organizationId);
const roleLabels = { owner: 'Eigenaar', scout: 'Scout', viewer: 'Alleen lezen' };
const isAccounts = () => environment === 'local_accounts';
const isAuthenticated = () => Boolean(isAccounts() && backend?.authenticated);
const canWrite = () => ['standalone', 'edge'].includes(environment) || Boolean(backend && (!isAccounts() || ['owner', 'scout'].includes(membership()?.role)));
const staleError = () => Object.assign(new Error('De werkruimte is intussen gewijzigd.'), { stale: true });
const context = () => ({ epoch, organizationId });
function assertContext(ctx) { if (ctx.epoch !== epoch || ctx.organizationId !== organizationId) throw staleError(); }
const importUI = { payload: null, preview: null, filename: '', error: '', busy: false, sequence: 0, jobs: [], snapshots: [], jobsError: '', jobsLoading: false, rolledBack: new Set() };
let jobsTimer;
let view = 'radar', filters = { search: '', role: '', region: '', competition: '', quality: '', minAge: 18, maxAge: 23, newOnly: false, lowerOnly: false };
let comparison = new Set(), openPlayerId = null;
const main = document.querySelector('#main'), dossierDialog = document.querySelector('#dossier-dialog'), actionDialog = document.querySelector('#action-dialog');
const viewLabels = { radar: 'Wereldradar', tasks: 'Onderzoeksbord', shortlist: 'Shortlist', coverage: 'Datadekking', import: 'Bronimport', brief: 'Clubvraag', log: 'Beslislogboek', account: 'Account & club' };
let toastTimeout;
function notify(message, error = false) { const el = document.querySelector('#toast'); el.textContent = message; el.className = `toast show ${error ? 'error' : ''}`; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => el.classList.remove('show'), 4500); }
function restoreDemo() { try { const saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (saved?.version === 1 && ['decisions', 'tasks', 'audit'].every(key => Array.isArray(saved[key]))) state = saved; demoState = state; } catch { storageWorking = false; } }
function persist() { if (dataset !== 'demo' || !['standalone', 'edge'].includes(environment)) throw new Error('Clubgegevens worden uitsluitend in de lokale backend opgeslagen.'); demoState = state; try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { storageWorking = false; notify('Browseropslag niet beschikbaar. Demowijzigingen blijven alleen in deze tab.', true); } }
function addAudit(action, objectId, detail = '') { state.audit.push({ id: newId(), action, objectId, detail, at: new Date().toISOString(), actor: 'browser-demo-user' }); }
const scopedPath = (path, selected = dataset) => `${path}${path.includes('?') ? '&' : '?'}dataset=${encodeURIComponent(selected)}`;
const canImport = () => Boolean(backend?.supportsImport && !window.OMNI_INLINE);
const sourceLabel = source => source?.status === 'synthetic' ? 'Synthetische testimport' : source?.status === 'approved' ? 'Importverklaring · niet onafhankelijk geverifieerd' : 'Bronstatus ontbreekt of is ongeldig';
const playerLabel = player => dataset === 'demo' ? 'Fictief profiel' : player?.synthetic ? 'Synthetische testimport' : 'Importverklaring · niet onafhankelijk geverifieerd';
function datasetLabel() { return dataset === 'demo' ? 'Fictieve testgegevens' : !catalog.players.length ? 'Lokale import · geen beschikbare profielen' : catalog.players.every(p => p.synthetic) ? 'Synthetische testimport' : 'Importgegevens · verklaring niet onafhankelijk geverifieerd'; }
function clearWorkspace() {
  epoch++; for (const controller of requests) controller.abort(); requests.clear();
  clearTimeout(jobsTimer); clearTimeout(toastTimeout); mutationCount = 0;
  state = blankState(); catalog = emptyCatalog(); demoState = blankState(); comparison.clear(); openPlayerId = null;
  filters = { search: '', role: '', region: '', competition: '', quality: '', minAge: 18, maxAge: 23, newOnly: false, lowerOnly: false };
  dossierDialog.close(); actionDialog.close(); document.querySelector('#dossier-content').replaceChildren(); document.querySelector('#action-content').replaceChildren();
  document.querySelector('#toast').textContent = ''; document.querySelector('#toast').className = 'toast';
  Object.assign(importUI, { payload: null, preview: null, filename: '', error: '', busy: false, sequence: importUI.sequence + 1, jobs: [], snapshots: [], jobsError: '', jobsLoading: false, rolledBack: new Set() });
  clearAccountTransient();
  Object.assign(accountUI, { members: [], invitations: [], invitationsError: '', stats: null, statsError: '', error: '', loading: false, invite: null, migrationRequired: false, migrationMessage: '' });
  main.replaceChildren();
}
function loseSession(message = 'Je sessie is verlopen. Meld je opnieuw aan.') {
  clearWorkspace(); clearTimeout(expiryTimer); backend = null; organizationId = ''; environment = 'local_accounts'; datasetLoading = false; authMode = 'login'; authError = message; render();
}
async function api(path, { method = 'GET', data, publicRequest = false, raw = false } = {}) {
  const ctx = context(), controller = new AbortController(); requests.add(controller);
  const headers = {};
  if (isAccounts() && organizationId) headers['X-Omniscout-Organization'] = organizationId;
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-Omniscout-CSRF'] = backend?.csrf || ''; }
  try {
    const response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = raw && response.ok ? await response.text() : await response.json(); assertContext(ctx);
    if (!response.ok) {
      const error = Object.assign(new Error(result.error || 'Verzoek mislukt.'), { status: response.status, details: result.details });
      if (response.status === 401 && isAccounts() && !publicRequest) { loseSession(); void checkSession(); }
      if (response.status === 403 && isAccounts() && !publicRequest) { clearWorkspace(); datasetLoading = true; render(); void checkSession({ reload: true }); }
      throw error;
    }
    return result;
  } catch (error) { if (error.name === 'AbortError' || ctx.epoch !== epoch) { if (error.status === 401 || error.status === 403) throw error; throw staleError(); } throw error; }
  finally { requests.delete(controller); }
}
async function readJSON(path) { return api(path, { publicRequest: path === '/api/session' || path === '/api/import/sample' }); }
async function refreshWorkspace(selected = dataset) {
  const ctx = context();
  const result = await readJSON(scopedPath('/api/state', selected));
  assertContext(ctx);
  if (dataset === selected) state = result;
}
async function request(path, method, data, { refresh = !path.startsWith('/api/import/') } = {}) {
  if (!backend) throw new Error('Deze actie vereist de lokale Node-backend.');
  if (!canWrite()) throw new Error('Je hebt alleen leesrechten in deze club. Vraag een eigenaar om de scoutrol.');
  const ctx = context();
  const selected = dataset, workspaceMutation = !path.startsWith('/api/import/');
  mutationCount++; updateCounts();
  try {
    const result = await api(workspaceMutation ? scopedPath(path, selected) : path, { method, data: workspaceMutation ? { ...data, dataset: selected } : data });
    if (refresh) await refreshWorkspace(selected);
    assertContext(ctx);
    return result;
  } finally { if (ctx.epoch === epoch) { mutationCount--; updateCounts(); } }
}
async function selectDataset(selected, { remember = true } = {}) {
  if (!['demo', 'import'].includes(selected)) return;
  if (selected === 'import' && !canImport()) throw new Error('Lokale import vereist de Node-app. De zelfstandige en edge-demo tonen alleen fictieve gegevens.');
  if (isAccounts() && (!isAuthenticated() || !organizationId)) return;
  const savedDemo = demoState; clearWorkspace(); const ctx = context(); datasetLoading = true; render();
  try {
    const [nextCatalog, nextState] = backend && environment !== 'edge' ? await Promise.all([readJSON(scopedPath('/api/catalog', selected)), readJSON(scopedPath('/api/state', selected))]) : [CATALOG, savedDemo];
    assertContext(ctx);
    dataset = selected; catalog = nextCatalog; state = nextState; workspaceError = '';
    comparison.clear(); filters = { ...filters, search: '', competition: '', region: '', quality: '' };
    dossierDialog.close(); actionDialog.close(); openPlayerId = null;
    if (remember) { preferredDataset = selected; try { localStorage.setItem(datasetKey, selected); } catch { /* Never cache imported data. */ } }
    render();
  } catch (error) { if (!error.stale && ctx.epoch === epoch) workspaceError = error.message; throw error; }
  finally { if (ctx.epoch === epoch) { datasetLoading = false; render(); if (view === 'import') void loadImportJobs(); } }
}
async function saveDecision(playerId, action, reason, note = '') {
  if (backend) await request('/api/decisions', 'POST', { playerId, action, reason, note });
  else { const id = newId(); state.decisions.push({ id, playerId, action, reason, note, at: new Date().toISOString() }); addAudit('decision.created', id, `${playerId}: ${action} (${reason})`); persist(); }
  updateCounts();
}
function latestDecision(id) { return state.decisions.filter(x => x.playerId === id).at(-1); }
function isShortlisted(id) { return latestDecision(id)?.action === 'follow'; }
function updateCounts() {
  document.querySelectorAll('input[type="password"]').forEach(input => { input.maxLength = 128; });
  const locked = ['checking', 'unavailable'].includes(environment) || (isAccounts() && !isAuthenticated());
  document.body.classList.toggle('auth-locked', locked);
  document.querySelector('#nav').hidden = locked;
  document.querySelector('.demo-banner').hidden = locked;
  document.querySelector('.dataset-bar').hidden = locked || (isAccounts() && !organizationId);
  document.querySelector('#organization-bar').hidden = !isAuthenticated();
  document.querySelector('#nav [data-view="account"]').hidden = !isAuthenticated();
  const orgPicker = document.querySelector('#organization-select');
  if (isAuthenticated()) {
    const organizations = backend.organizations || [];
    orgPicker.innerHTML = organizations.length ? organizations.map(org => `<option value="${esc(org.id)}" ${org.id === organizationId ? 'selected' : ''}>${esc(org.name)}</option>`).join('') : '<option value="">Nog geen club</option>';
    orgPicker.disabled = datasetLoading || mutationCount > 0 || !organizations.length;
  } else orgPicker.replaceChildren();
  document.querySelector('#organization-role').textContent = membership() ? `${roleLabels[membership().role]} · ${backend.user.displayName || backend.user.username}` : '';
  document.querySelector('#workspace-name').innerHTML = isAuthenticated() ? `${esc(membership()?.name || 'Kies een club')}<small>${esc(roleLabels[membership()?.role] || 'Account')}</small>` : 'Scouting Lab<small>Lokale testomgeving</small>';
  document.querySelector('#task-count').textContent = state.tasks.filter(t => t.status === 'todo').length;
  document.querySelector('#shortlist-count').textContent = catalog.players.filter(p => isShortlisted(p.id)).length;
  document.querySelector('#player-count').textContent = catalog.players.length;
  document.querySelector('#storage-status').textContent = locked ? 'Geen clubgegevens zichtbaar' : workspaceError ? 'Backendgegevens niet geladen' : backend && environment !== 'edge' ? backend.persistence === 'memory' ? 'Node-backend · tijdelijk geheugen' : 'Lokaal opgeslagen op dit apparaat' : environment === 'edge' ? 'Alleen-lezen synthetische demo' : storageWorking ? 'Preview · browseropslag' : 'Preview · tijdelijk geheugen';
  const picker = document.querySelector('#dataset-select');
  picker.value = dataset; picker.disabled = datasetLoading || mutationCount > 0;
  picker.querySelector('[value="import"]').disabled = !canImport();
  document.querySelector('#dataset-status').textContent = datasetLoading ? 'Gegevens ophalen…' : workspaceError ? 'Backendgegevens konden niet worden geladen. Kies de gegevensset opnieuw om te proberen.' : dataset === 'import' ? 'Importcatalogus en onderzoek blijven in de lokale backend.' : canImport() ? 'Demo en import hebben een afzonderlijk onderzoekslogboek.' : 'Alleen fictieve demo · import vereist de lokale Node-app.';
  document.querySelector('.date-label').textContent = `PEILDATUM ${dates(catalog.asOf)}`;
  document.querySelector('.demo-chip').textContent = dataset === 'demo' ? 'DEMO' : 'IMPORT';
  document.querySelector('.demo-banner p').innerHTML = dataset === 'demo' ? '<strong>Fictieve testomgeving.</strong> Alle spelers, clubs, competities en statistieken zijn voorbeelden. <strong>0 live databronnen.</strong>' : `<strong>${esc(datasetLabel())}.</strong> Bronrechten en inhoud zijn verklaringen van de importeur. Geen live providerverbinding of onafhankelijk geverifieerde scoutingdekking.`;
  applyAccess();
}
function applyAccess() {
  if (view === 'account' && (accountUI.loading || datasetLoading)) document.querySelectorAll('#main form input, #main form textarea, #main form select, #main form [type="submit"]').forEach(control => { control.disabled = true; });
  if (canWrite()) return;
  document.querySelectorAll('[data-save], [data-task], [data-action="create-task"], [data-action="decision"], [data-import-retry], [data-import-rollback], #import-file, #import-confirm, #brief-form [type="submit"], #brief-form input, #brief-form textarea, #brief-form select').forEach(el => { el.disabled = true; el.title = 'Alleen lezen: een eigenaar kan je de scoutrol geven.'; });
}
function renderAuth() {
  if (environment === 'checking') { main.innerHTML = '<section class="panel auth-panel" role="status"><h1>Werkruimte openen…</h1><p>De lokale sessie wordt gecontroleerd.</p></section>'; return; }
  if (environment === 'unavailable') { main.innerHTML = `<section class="panel auth-panel"><h1>De werkruimte is niet bereikbaar.</h1><p>Clubgegevens zijn gewist uit dit scherm. Controleer of de lokale Node-app draait en probeer opnieuw.</p><p class="import-error" role="alert">${esc(authError)}</p><button class="button primary" data-action="session-retry">Opnieuw verbinden</button></section>`; return; }
  const setup = backend?.setupRequired === true, mode = setup ? 'setup' : authMode;
  main.innerHTML = `<section class="panel auth-panel"><span class="eyebrow">OMNI-SCOUT · LOKALE CLUBWERKRUIMTE</span><h1>${mode === 'setup' ? 'Richt je eerste club in.' : mode === 'register' ? 'Neem je uitnodiging aan.' : 'Welkom terug.'}</h1><p>${mode === 'setup' ? 'Maak een eigenaaraccount. Eerdere lokale scoutinggegevens worden bij deze eerste club ondergebracht.' : mode === 'register' ? 'Gebruik de eenmalige code van een clubeigenaar. Je rol is vastgelegd in de uitnodiging.' : 'Meld je aan om de gegevens van jouw clubs te openen.'}</p><form id="auth-form" data-mode="${mode}">${mode === 'register' ? '<label>Uitnodigingscode<input name="inviteToken" required maxlength="200" autocomplete="off" spellcheck="false"></label>' : ''}${mode !== 'login' ? '<label>Weergavenaam<input name="displayName" required maxlength="80" autocomplete="name"></label>' : ''}${mode === 'setup' ? '<label>Clubnaam<input name="organizationName" required maxlength="100" autocomplete="organization"></label>' : ''}<label>Gebruikersnaam<input name="username" required minlength="3" maxlength="64" autocomplete="username" autocapitalize="none" spellcheck="false"></label><label>Wachtwoord<input name="password" type="password" required ${mode === 'login' ? '' : 'minlength="15"'} maxlength="256" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>${mode !== 'login' ? '<p class="form-note">Gebruik minimaal 15 tekens. Bewaar je wachtwoord veilig; deze lokale versie verstuurt geen herstelmails.</p>' : ''}<p id="auth-error" class="import-error" role="alert" ${authError ? '' : 'hidden'}>${esc(authError)}</p><button class="button primary" type="submit" ${authBusy || !backend?.csrf ? 'disabled' : ''}>${authBusy ? 'Even wachten…' : mode === 'setup' ? 'Eigenaar en club aanmaken' : mode === 'register' ? 'Account aanmaken' : 'Aanmelden'}</button></form>${!setup ? `<button class="text-button auth-alternative" data-action="auth-mode" data-mode="${mode === 'login' ? 'register' : 'login'}">${mode === 'login' ? 'Ik heb een uitnodigingscode' : 'Ik heb al een account'}</button>` : ''}<p class="form-note">Accounts en clubgegevens blijven op de lokale Node-app. Er zijn geen live databronnen aangesloten.</p>${!backend?.csrf ? '<button class="button secondary" data-action="session-retry">Verbinding opnieuw controleren</button>' : ''}</section>`;
}
function renderAccount() {
  const org = membership(), owner = org?.role === 'owner';
  main.innerHTML = heading('JOUW ACCOUNT EN CLUBWERKRUIMTE', 'Werk samen. Houd overzicht.', 'Elke club heeft een eigen importcatalogus, shortlist, onderzoeksbord en logboek.') + `<div class="account-grid"><section class="panel form-panel"><h2>${esc(backend.user.displayName || backend.user.username)}</h2><p class="muted-copy">Gebruikersnaam: ${esc(backend.user.username)}</p><p class="muted-copy">Actieve club: <strong>${esc(org?.name || 'Nog geen club')}</strong> · ${esc(roleLabels[org?.role] || '')}</p><p class="form-note">${org?.role === 'viewer' ? 'Je hebt alleen leesrechten. Een eigenaar kan je de scoutrol geven om onderzoek en imports te wijzigen.' : org?.role === 'scout' ? 'Je kunt scoutingwerk en imports wijzigen. Clubleden worden beheerd door een eigenaar.' : 'Als eigenaar beheer je scoutingwerk, uitnodigingen en rollen. De laatste eigenaar kan niet worden verwijderd.'}</p><div id="workspace-stats">${accountUI.stats ? renderStats(accountUI.stats) : '<p class="muted-copy">Werkruimte-informatie ophalen…</p>'}</div><button class="button secondary" data-action="account-refresh">Vernieuwen</button><button class="button secondary" data-action="logout">Afmelden</button></section><form id="organization-form" class="panel form-panel"><h2>Nieuwe clubwerkruimte</h2><p class="form-note">De nieuwe club begint leeg. Bestaande clubgegevens worden niet gekopieerd.</p><label>Clubnaam<input name="name" required maxlength="100" autocomplete="organization"></label><button class="button primary" type="submit">Club aanmaken</button></form><form id="password-form" class="panel form-panel"><h2>Wachtwoord wijzigen</h2><label>Huidig wachtwoord<input name="currentPassword" type="password" required maxlength="256" autocomplete="current-password"></label><label>Nieuw wachtwoord<input name="newPassword" type="password" required minlength="15" maxlength="256" autocomplete="new-password"></label><p class="form-note">Minimaal 15 tekens. Andere bestaande sessies worden afgesloten.</p><button class="button primary" type="submit">Wachtwoord wijzigen</button></form>${owner ? `<form id="invite-form" class="panel form-panel"><h2>Nodig een clublid uit</h2><label>Rol<select name="role"><option value="viewer">Alleen lezen</option><option value="scout">Scout · scouting en import wijzigen</option><option value="owner">Eigenaar · ook leden beheren</option></select></label><p class="form-note">Er wordt geen e-mail verstuurd. Deel de eenmalige code zelf met de bedoelde persoon, die deze lokale app moet kunnen bereiken.</p><button class="button primary" type="submit">Uitnodigingscode maken</button>${accountUI.invite ? `<div class="invite-result" role="status"><label>Eenmalige code<textarea id="invite-code" readonly rows="3" autocomplete="off" spellcheck="false">${esc(accountUI.invite.token)}</textarea></label><p class="form-note">Rol: ${esc(roleLabels[accountUI.invite.role])} · geldig tot ${esc(new Date(accountUI.invite.expiresAt).toLocaleString('nl-NL'))}. Kopieer de code nu. Deze wordt niet in je browser opgeslagen en verdwijnt wanneer je dit scherm verlaat.</p></div>` : ''}</form>` : ''}</div><section class="panel form-panel account-members"><div class="panel-head"><h2>Clubleden</h2><span class="status-tag neutral">${esc(org?.name || 'Geen club')}</span></div>${accountUI.loading ? '<p role="status" class="muted-copy">Leden ophalen…</p>' : ''}${accountUI.error ? `<p class="import-error" role="alert">${esc(accountUI.error)}</p>` : ''}${accountUI.members.length ? `<div class="table-scroll"><table class="members-table"><thead><tr><th>Naam</th><th>Gebruikersnaam</th><th>Rol</th>${owner ? '<th>Beheer</th>' : ''}</tr></thead><tbody>${accountUI.members.map(member => { const user = member.user || member, userId = member.userId || user.id; return `<tr><td>${esc(user.displayName || user.username)}</td><td>${esc(user.username)}</td><td>${esc(roleLabels[member.role])}</td>${owner ? `<td><form class="member-role-form" data-user="${esc(userId)}"><select name="role" aria-label="Rol voor ${esc(user.username)}">${Object.entries(roleLabels).map(([role, label]) => `<option value="${role}" ${role === member.role ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="button secondary compact" type="submit">Rol opslaan</button><button class="button secondary compact" type="button" data-remove-member="${esc(userId)}" data-member-name="${esc(user.displayName || user.username)}">Verwijderen</button></form></td>` : ''}</tr>`; }).join('')}</tbody></table></div>` : '<p class="muted-copy">Geen ledenoverzicht beschikbaar.</p>'}</section>`;
  if (!owner) document.querySelector('.account-members').innerHTML = `<h2>Clubleden</h2><p class="form-note">Een clubeigenaar beheert uitnodigingen, het ledenoverzicht en rollen. Je huidige rol staat bij de actieve club.</p>${accountUI.error ? `<p class="import-error" role="alert">${esc(accountUI.error)}</p>` : ''}`;
  if (!accountUI.stats && accountUI.statsError) document.querySelector('#workspace-stats').innerHTML = `<p class="import-error" role="status">Werkruimtestatistieken niet beschikbaar: ${esc(accountUI.statsError)}</p>`;
  if (accountUI.migrationRequired) main.insertAdjacentHTML('afterbegin', `<section class="panel form-panel migration-recovery" id="migration-recovery"><h2>Herstel de overname van eerdere scoutinggegevens</h2><p class="form-note">De eerdere lokale opslag kon niet worden overgenomen. Het oorspronkelijke bestand is behouden en de scoutinggegevens van deze club blijven geblokkeerd tot herstel. Account- en ledenbeheer blijven beschikbaar.</p>${owner ? '<p class="form-note">Maak eerst een veiligheidskopie en herstel het oorspronkelijke lokale statebestand met een geldige versie-1-back-up. Controleer daarna opnieuw. De toepassing vervangt de bron niet en voegt geen gegevens aan een andere club toe.</p><button class="button primary" data-action="recover-migration">Controleer opnieuw en hervat overname</button>' : '<p class="form-note">Vraag een clubeigenaar om de lokale opslag te herstellen.</p>'}<p id="migration-status" class="import-error" role="status">${esc(accountUI.migrationMessage || accountUI.error || 'De eerdere opslag vereist herstel.')}</p></section>`);
  else if (accountUI.migrationMessage) main.insertAdjacentHTML('afterbegin', `<p id="migration-status" class="notice-card" role="status">${esc(accountUI.migrationMessage)}</p>`);
  if (!org) {
    document.querySelector('#workspace-stats').innerHTML = '<p class="form-note">Maak een nieuwe clubwerkruimte aan om scoutinggegevens op te slaan.</p>';
    document.querySelector('.account-grid section>.form-note').textContent = 'Je account heeft momenteel geen clubtoegang. Je kunt zelf een nieuwe club aanmaken.';
  }
  renderAccountRecovery();
}
function renderAccountRecovery() {
  const owner = membership()?.role === 'owner', disabled = recoveryUI.busy ? 'disabled' : '';
  const invitations = document.querySelector('#invite-form');
  if (invitations) invitations.insertAdjacentHTML('beforeend', `<div id="outstanding-invitations" class="outstanding-invitations"><h3>Openstaande uitnodigingen</h3><p class="form-note">Alleen geldige, nog niet gebruikte uitnodigingen. Codes worden hier niet opnieuw getoond.</p>${accountUI.invitationsError ? `<p class="import-error" role="alert">${esc(accountUI.invitationsError)}</p>` : ''}${accountUI.invitations.length ? `<ul>${accountUI.invitations.map(invitation => `<li><div><strong>${esc(roleLabels[invitation.role])}</strong><small>Aangemaakt ${dates(invitation.createdAt)} · geldig tot ${esc(new Date(invitation.expiresAt).toLocaleString('nl-NL'))}</small></div><button type="button" class="button secondary compact" data-revoke-invitation="${esc(invitation.id)}">Intrekken</button></li>`).join('')}</ul>` : '<p class="muted-copy">Geen openstaande uitnodigingen.</p>'}</div>`);
  const preview = recoveryUI.invitePreview;
  main.insertAdjacentHTML('beforeend', `<section class="panel form-panel recovery-section"><h2>Sluit met je account aan bij een club</h2><p class="form-note">Controleer eerst de club en rol uit de uitnodiging. Bevestig daarna dat je wilt aansluiten.</p><form id="invite-preview-form"><label>Eenmalige uitnodigingscode<input name="inviteToken" required maxlength="200" autocomplete="off" spellcheck="false" autocapitalize="none"></label><button type="submit" class="button secondary" data-recovery-submit ${disabled}>Uitnodiging controleren</button></form>${recoveryUI.inviteError ? `<p class="import-error" role="alert">${esc(recoveryUI.inviteError)}</p>` : ''}${preview ? `<form id="invite-accept-form" class="invitation-preview"><h3>${esc(preview.organization.name)}</h3><p class="form-note">Aangeboden rol: ${esc(roleLabels[preview.role])}. Geldig tot ${esc(new Date(preview.expiresAt).toLocaleString('nl-NL'))}.${preview.alreadyMember ? ' Je bent al lid. Je bestaande rol blijft behouden; deze code verhoogt je rechten niet.' : ''}</p><label class="import-consent"><input type="checkbox" id="invite-accept-check" required><span>Ik heb de club en rol gecontroleerd en wil deze uitnodiging met mijn account gebruiken.</span></label><button type="submit" class="button primary" data-recovery-submit ${disabled}>Bevestig aansluiting</button></form>` : ''}</section>`);
  if (recoveryUI.message) main.insertAdjacentHTML('beforeend', `<p class="notice-card" id="recovery-message" role="status">${esc(recoveryUI.message)}</p>`);
  if (!owner) return;
  main.insertAdjacentHTML('beforeend', `<section class="panel form-panel recovery-section" id="backup-panel"><h2>Versleutelde clubback-up en herstel</h2><p class="form-note">Een back-up bevat de fictieve demo én lokale imports met het scoutingwerk van <strong>${esc(membership().name)}</strong>. Accounts en clubrollen staan niet in dit bestand. Bronrechten worden ook voor eerdere en teruggedraaide snapshots gecontroleerd.</p><div class="backup-grid"><form id="backup-create-form"><h3>Back-up downloaden</h3><label>Wachtzin<input type="password" name="passphrase" required minlength="15" maxlength="128" autocomplete="new-password" aria-describedby="backup-passphrase-help"></label><p class="form-note" id="backup-passphrase-help">Gebruik 15–128 tekens en bewaar de wachtzin apart. De toepassing bewaart deze niet. Zonder de juiste wachtzin kan het .osbackup-bestand niet worden geopend.</p><button type="submit" class="button primary" data-recovery-submit ${disabled}>Versleutelde back-up downloaden</button></form><form id="backup-preview-form"><h3>Back-up controleren voor herstel</h3><label>Versleuteld .osbackup-bestand<input id="backup-file" name="backupFile" type="file" required accept=".osbackup,application/json" aria-describedby="backup-file-help"></label><p class="form-note" id="backup-file-help">Maximaal 46 MiB. Alleen een back-up van dezezelfde club kan worden hersteld.</p><label>Wachtzin van het bestand<input type="password" name="passphrase" required minlength="15" maxlength="128" autocomplete="off"></label><button type="submit" class="button secondary" data-recovery-submit ${disabled}>Herstel eerst controleren</button></form></div>${recoveryUI.backupError ? `<p class="import-error" id="backup-error" role="alert">${esc(recoveryUI.backupError)}</p>` : ''}${recoveryUI.backupPreview ? renderBackupPreview(recoveryUI.backupPreview) : ''}</section><section class="panel form-panel recovery-section" id="retention-panel"><h2>Bewaartermijnen onderzoeken</h2><p class="form-note">Dit overzicht markeert oudere gegevens, afhankelijkheden, lopende taken en huidige rechtenblokkades. Er wordt niets verwijderd. Een leeftijdsgrens is geen juridische bewaartermijn.</p><form id="retention-form" class="retention-controls"><label>Ouder dan hoeveel dagen?<input name="days" type="number" required min="1" max="3650" step="1" value="${esc(recoveryUI.retention?.days || 365)}"></label><button type="submit" class="button secondary" data-recovery-submit ${disabled}>Bewaaroverzicht bekijken</button></form>${recoveryUI.retentionError ? `<p class="import-error" role="alert">${esc(recoveryUI.retentionError)}</p>` : ''}<div id="retention-report" aria-live="polite">${recoveryUI.retention ? renderRetention(recoveryUI.retention) : ''}</div></section>`);
}
function renderBackupPreview(preview) {
  const backup = preview.summary, current = preview.currentSummary;
  const fields = [['Demo · besluiten', value => value.counts.demo.decisions], ['Demo · onderzoeken', value => value.counts.demo.tasks], ['Demo · logboekregels', value => value.counts.demo.audit], ['Import · besluiten', value => value.counts.import.decisions], ['Import · onderzoeken', value => value.counts.import.tasks], ['Import · logboekregels', value => value.counts.import.audit], ['Snapshots', value => value.counts.snapshots], ['Importgebeurtenissen', value => value.counts.importHistory], ['Importopdrachten', value => value.counts.jobs], ['Bronnen', value => value.counts.sources], ['Spelers', value => value.counts.players], ['Competities', value => value.counts.competitions], ['Bytes onversleuteld', value => value.bytes]];
  return `<div id="backup-preview" class="backup-preview"><h3>Vergelijk vóór vervangen</h3><p class="form-note">Back-up van ${esc(backup.organizationName)} · gemaakt ${esc(new Date(backup.createdAt).toLocaleString('nl-NL'))}. Deze controle is geldig tot ${esc(new Date(preview.expiresAt).toLocaleString('nl-NL'))}.</p><div class="table-scroll"><table class="backup-summary"><thead><tr><th>Onderdeel</th><th>Nu in club</th><th>In back-up</th></tr></thead><tbody>${fields.map(([label, get]) => `<tr><th>${label}</th><td>${fmt(get(current), 0)}</td><td>${fmt(get(backup), 0)}</td></tr>`).join('')}</tbody></table></div><form id="backup-restore-form"><p class="form-note">Herstel vervangt het scoutingwerk van beide datasets in deze club. Accounts en rollen blijven behouden. Voor vervanging wordt de huidige staat als een private lokale herstelkopie bewaard. Die lokale kopie is geen versleuteld downloadbestand. Wijzigingen na deze controle vereisen een nieuwe controle.</p><label class="import-consent"><input type="checkbox" id="backup-restore-check" required><span>Ik heb de aantallen gecontroleerd en wil de huidige demo- en importgegevens van ${esc(membership()?.name)} vervangen door deze back-up.</span></label><button type="submit" class="button primary" data-recovery-submit ${recoveryUI.busy ? 'disabled' : ''}>Bevestig vervanging van clubgegevens</button></form></div>`;
}
function renderRetention(report) {
  const labels = { ageCandidates: 'Ouder dan gekozen grens', activeDependencies: 'Actieve afhankelijkheden', pendingJobs: 'Lopende importopdrachten', rightsBlocks: 'Rechtenblokkades', totalItems: 'Beoordeelde onderdelen', returnedItems: 'Getoonde onderdelen' };
  const kinds = { decision: 'Besluit', task: 'Onderzoek', audit: 'Logboekregel', history: 'Importgebeurtenis', source: 'Bron', snapshot: 'Snapshot', job: 'Importopdracht' };
  return `<p class="form-note">Peildatum ${esc(new Date(report.asOf).toLocaleString('nl-NL'))} · grens ${dates(report.cutoff)} · alleen beoordeling, niets verwijderd.</p><dl class="account-stats retention-stats">${Object.entries(labels).map(([key, label]) => `<div><dt>${label}</dt><dd>${fmt(report.counts[key], 0)}</dd></div>`).join('')}</dl>${report.warnings?.length ? `<ul class="retention-warnings">${report.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}<ul class="retention-items">${report.items.slice(0, 200).map(item => `<li data-retention-item><div><strong>${esc(kinds[item.kind] || item.kind)} · ${esc(item.dataset === 'demo' ? 'Fictieve demo' : item.dataset === 'import' ? 'Lokale import' : item.dataset || 'Club')}</strong><small>${esc(item.id)} · ${dates(item.at)}</small></div><p>${esc(item.reason)}</p><div class="retention-tags">${item.ageCandidate ? '<span class="status-tag amber">Ouder · te beoordelen</span>' : ''}${item.activeDependency ? '<span class="status-tag neutral">Actieve afhankelijkheid · behouden</span>' : ''}${item.rightsBlocked ? '<span class="status-tag amber">Huidige rechten blokkeren gebruik</span>' : ''}</div></li>`).join('')}</ul>${report.truncated ? '<p class="form-note">Het overzicht is begrensd op 200 onderdelen. De totale aantallen staan hierboven.</p>' : ''}`;
}
function renderStats(stats) {
  const rows = [];
  const labels = { players: 'Spelers', competitions: 'Competities', sources: 'Bronnen', jobs: 'Importopdrachten', snapshots: 'Snapshots', tasks: 'Onderzoeksopdrachten', decisions: 'Besluiten', audit: 'Logboekregels', imports: 'Imports', bytes: 'Bytes', organizations: 'Clubs', demo: 'Fictieve demo', import: 'Lokale import', activeJobs: 'Actieve importopdrachten', counts: 'Opgeslagen', limits: 'Limiet', importHistory: 'Importgebeurtenissen', pendingJobs: 'Wachtende importopdrachten', failedJobs: 'Mislukte importopdrachten', tasksPerDataset: 'Onderzoeken per dataset', auditEvents: 'Logboekregels', importJobs: 'Importopdrachten', pendingImportJobs: 'Wachtende importopdrachten', importAttempts: 'Pogingen per import', importBytes: 'Bytes per import' };
  function collect(value, prefix = '', depth = 0) { if (!value || typeof value !== 'object' || depth > 3) return; for (const [key, item] of Object.entries(value)) { if (typeof item === 'number') rows.push(`<div><dt>${esc(prefix + (labels[key] || key))}</dt><dd>${fmt(item, 0)}</dd></div>`); else if (item && typeof item === 'object') collect(item, `${prefix}${labels[key] || key} · `, depth + 1); } }
  collect(stats);
  const counts = stats.counts || {}, summaries = [['Importsnapshots', counts.snapshots], ['Importopdrachten', counts.jobs], ['Onderzoeksopdrachten', (counts.demo?.tasks || 0) + (counts.import?.tasks || 0)], ['Scoutbesluiten', (counts.demo?.decisions || 0) + (counts.import?.decisions || 0)]];
  return `<dl class="account-stats">${summaries.map(([label, count]) => `<div><dt>${label}</dt><dd>${fmt(count, 0)}</dd></div>`).join('')}</dl><details class="account-storage-detail"><summary>Alle aantallen en opslaggrenzen</summary><dl class="account-stats">${rows.join('')}</dl></details><p class="form-note">Opslag: ${esc(backend.persistence === 'memory' ? 'tijdelijk geheugen; verdwijnt bij afsluiten' : 'lokale bestanden op dit apparaat')}. Herstart van de server sluit sessies af.${stats.migration === 'complete' ? ' Eerdere lokale scoutinggegevens zijn overgenomen; het oorspronkelijke bestand is behouden.' : ''}</p>`;
}
async function loadAccount() {
  if (!isAuthenticated()) return;
  const ctx = context(); accountUI.loading = true; accountUI.error = ''; accountUI.statsError = ''; if (view === 'account') render();
  try {
    if (!organizationId) { accountUI.members = []; accountUI.stats = {}; return; }
    const [memberResult, statsResult, invitationResult] = await Promise.allSettled([membership()?.role === 'owner' ? readJSON('/api/auth/members') : Promise.resolve([]), readJSON('/api/workspace/stats'), membership()?.role === 'owner' ? readJSON('/api/auth/invitations') : Promise.resolve([])]); assertContext(ctx);
    if (memberResult.status === 'fulfilled') accountUI.members = Array.isArray(memberResult.value) ? memberResult.value : memberResult.value.members || [];
    else accountUI.error = memberResult.reason.message;
    if (statsResult.status === 'fulfilled') { accountUI.stats = statsResult.value; accountUI.migrationRequired = false; }
    else { accountUI.statsError = statsResult.reason.message; accountUI.migrationRequired = statsResult.reason.status === 409 && /migratie|oude opslag/i.test(statsResult.reason.message); }
    if (invitationResult.status === 'fulfilled') { accountUI.invitations = Array.isArray(invitationResult.value) ? invitationResult.value : invitationResult.value.invitations || []; accountUI.invitationsError = ''; }
    else accountUI.invitationsError = invitationResult.reason.message;
  } catch (error) { if (ctx.epoch === epoch && !error.stale) accountUI.error = error.message; }
  finally { if (ctx.epoch === epoch) { accountUI.loading = false; if (view === 'account') render(); } }
}
async function selectOrganization(id, { remember = true } = {}) {
  if (!backend?.organizations?.some(org => org.id === id)) throw new Error('Deze club is niet beschikbaar voor je account.');
  clearWorkspace(); organizationId = id; workspaceError = '';
  if (remember) try { localStorage.setItem('omniscout.organization.v1', id); } catch { /* Preference only. */ }
  await selectDataset(preferredDataset === 'import' && canImport() ? 'import' : 'demo', { remember: false });
  if (view === 'account') await loadAccount();
}
async function checkSession({ reload = false } = {}) {
  if (environment === 'standalone' || environment === 'edge') return;
  const ctx = context();
  try {
    const next = await readJSON('/api/session'); assertContext(ctx);
    if (next.mode === 'synthetic_demo' && next.readOnly === true) { environment = 'edge'; backend = null; catalog = CATALOG; restoreDemo(); datasetLoading = false; render(); return; }
    if (next.mode === 'local_single_user_demo' && next.csrf) { environment = 'legacy'; backend = next; await selectDataset(preferredDataset === 'import' ? 'import' : 'demo', { remember: false }); return; }
    if (next.mode !== 'local_accounts') throw new Error('De server heeft geen herkenbare sessiemodus teruggegeven.');
    const oldUser = backend?.user?.id, oldRole = membership()?.role;
    environment = 'local_accounts'; backend = next;
    clearTimeout(expiryTimer);
    if (!next.authenticated) { clearWorkspace(); organizationId = ''; datasetLoading = false; authMode = next.setupRequired ? 'setup' : authMode; render(); return; }
    expiryTimer = setTimeout(() => { loseSession(); void checkSession(); }, Math.max(0, Math.min(2147483647, new Date(next.expiresAt).getTime() - Date.now())));
    let selected = next.organizations?.some(org => org.id === organizationId) ? organizationId : '';
    if (!selected) { try { const preferred = localStorage.getItem('omniscout.organization.v1'); if (next.organizations.some(org => org.id === preferred)) selected = preferred; } catch { /* Preference only. */ } selected ||= next.organizations?.[0]?.id || ''; }
    if (!selected) { clearWorkspace(); organizationId = ''; datasetLoading = false; view = 'account'; render(); return; }
    if (reload || selected !== organizationId || oldUser !== next.user.id || oldRole !== next.organizations.find(org => org.id === selected)?.role) await selectOrganization(selected, { remember: false });
    else { datasetLoading = false; updateCounts(); }
  } catch (error) { if (!error.stale && ctx.epoch === epoch) { clearWorkspace(); backend = null; organizationId = ''; environment = 'unavailable'; datasetLoading = false; authError = error.message; render(); } }
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
  if (!file || !canImport() || !canWrite()) return;
  const ctx = context();
  const sequence = ++importUI.sequence;
  importUI.busy = true; importUI.payload = null; importUI.preview = null; importUI.error = ''; importUI.filename = file.name; renderImport();
  try {
    if (file.size > 1024 * 1024) throw new Error('Bestand is groter dan 1 MiB. Kies een kleinere JSON-snapshot.');
    let payload; try { payload = JSON.parse(await file.text()); } catch { throw new Error('Ongeldige JSON. Er is niets geïmporteerd.'); }
    assertContext(ctx);
    const preview = await request('/api/import/preview', 'POST', payload);
    if (sequence !== importUI.sequence) return;
    importUI.payload = payload; importUI.preview = preview;
  } catch (error) { if (sequence === importUI.sequence) importUI.error = error.message || 'Voorvertoning mislukt.'; }
  finally { if (sequence === importUI.sequence) { importUI.busy = false; if (view === 'import') { renderImport(); document.querySelector('#import-preview')?.focus(); } } }
}
async function refreshImportCatalog() {
  if (dataset !== 'import') return;
  const ctx = context();
  const [nextCatalog, nextState] = await Promise.all([readJSON(scopedPath('/api/catalog', 'import')), readJSON(scopedPath('/api/state', 'import'))]);
  assertContext(ctx);
  if (dataset !== 'import') return;
  catalog = nextCatalog; state = nextState;
  comparison = new Set([...comparison].filter(id => catalog.players.some(player => player.id === id)));
  if (dossierDialog.open) { if (catalog.players.some(player => player.id === openPlayerId)) showDossier(openPlayerId); else dossierDialog.close(); }
  if (view !== 'import') render(); else updateCounts();
}
async function loadImportJobs() {
  if (!canImport() || importUI.jobsLoading) return;
  const ctx = context();
  clearTimeout(jobsTimer); importUI.jobsLoading = true;
  try {
    const previous = new Map(importUI.jobs.map(job => [job.id, job.status]));
    const previousSnapshots = JSON.stringify(importUI.snapshots);
    const [result, importedCatalog] = await Promise.all([readJSON('/api/import/jobs'), readJSON(scopedPath('/api/catalog', 'import'))]);
    assertContext(ctx);
    importUI.jobs = result.jobs; importUI.snapshots = importedCatalog.importSnapshots || []; importUI.jobsError = '';
    if (JSON.stringify(importUI.snapshots) !== previousSnapshots || importUI.jobs.some(job => job.status === 'succeeded' && previous.get(job.id) !== 'succeeded')) await refreshImportCatalog();
  } catch (error) { if (ctx.epoch === epoch && !error.stale) importUI.jobsError = `${error.message} Gebruik Vernieuwen om opnieuw te controleren.`; }
  finally {
    if (ctx.epoch === epoch) {
      importUI.jobsLoading = false; renderImportJobs(); applyAccess();
      if (!importUI.jobsError && importUI.jobs.some(job => ['queued', 'running'].includes(job.status))) jobsTimer = setTimeout(loadImportJobs, 1200);
    }
  }
}
async function downloadResponse(path, name, type) {
  const ctx = context(); const content = await api(path, { raw: true, publicRequest: path === '/api/import/sample' }); assertContext(ctx); download(name, content, type);
}
function render() {
  if (['checking', 'unavailable'].includes(environment) || (isAccounts() && !isAuthenticated())) { renderAuth(); updateCounts(); document.title = 'Omni-Scout · Aanmelden'; return; }
  if (isAccounts() && !organizationId) view = 'account';
  document.querySelector('#breadcrumb').textContent = viewLabels[view]; document.title = `Omni-Scout · ${viewLabels[view]}`;
  document.querySelectorAll('#nav [data-view]').forEach(el => { const active = el.dataset.view === view; el.classList.toggle('active', active); if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); });
  if (view === 'account') renderAccount();
  else if (datasetLoading) main.innerHTML = '<section class="panel auth-panel" role="status"><h2>Clubgegevens ophalen…</h2><p>De vorige werkruimte is gesloten.</p></section>';
  else if (workspaceError) main.innerHTML = `<section class="panel auth-panel"><h2>Clubgegevens konden niet worden geladen.</h2><p class="import-error" role="alert">${esc(workspaceError)}</p><button class="button primary" data-action="workspace-retry">Opnieuw proberen</button>${isAuthenticated() ? '<button class="button secondary" data-view="account">Account &amp; werkruimtebeheer</button>' : ''}</section>`;
  else ({ radar: () => renderRadar(), shortlist: () => renderRadar(true), tasks: renderTasks, coverage: renderCoverage, import: renderImport, brief: renderBrief, log: renderLog, account: renderAccount })[view]();
  if (!canWrite() && !datasetLoading && view !== 'account') main.insertAdjacentHTML('afterbegin', `<div class="notice-card read-only-notice" role="status"><p>${environment === 'edge' ? 'Alleen-lezen synthetische demo. Open de lokale Node-app voor eigen scoutingwerk.' : 'Je hebt alleen leesrechten in deze club. Een eigenaar kan je de scoutrol geven om scoutingwerk en imports te wijzigen.'}</p></div>`);
  updateCounts();
}
function navigate(next) { if (!viewLabels[next] || next === 'account' && !isAuthenticated()) return; if (next !== 'account') clearAccountTransient(); view = next; render(); if (next === 'import') void loadImportJobs(); if (next === 'account') void loadAccount(); window.scrollTo({ top: 0, behavior: 'instant' }); }
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
  applyAccess();
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
  if (el.id === 'organization-select') { selectOrganization(el.value).catch(error => { if (!error.stale) notify(error.message, true); }); return; }
  if (el.id === 'dataset-select') { selectDataset(el.value).catch(error => { if (!error.stale) { updateCounts(); notify(error.message, true); } }); return; }
  if (el.id === 'import-file') { previewFile(el.files?.[0]); return; }
  if (el.matches('[data-filter]') && el.type !== 'search') applyFiltersFromControl(el);
  if (el.dataset.compare) {
    if (el.checked && comparison.size >= 3) { el.checked = false; return notify('Vergelijk maximaal drie profielen tegelijk.'); }
    el.checked ? comparison.add(el.dataset.compare) : comparison.delete(el.dataset.compare);
    const button = document.querySelector('#compare-button'); if (button) { button.disabled = comparison.size < 2; button.innerHTML = `${icon('compare')} Vergelijk <span>${comparison.size}/3</span>`; }
  }
});
document.addEventListener('click', async event => {
  const el = event.target.closest('button, a.brand'); if (!el || el.disabled) return;
  const ctx = context();
  try {
    if (el.dataset.action === 'session-retry') { environment = 'checking'; authError = ''; render(); await checkSession({ reload: true }); return; }
    if (el.dataset.action === 'workspace-retry') { await selectDataset(dataset, { remember: false }); return; }
    if (el.dataset.action === 'auth-mode') { authMode = el.dataset.mode; authError = ''; render(); return; }
    if (el.dataset.action === 'logout') {
      el.disabled = true;
      try { await api('/api/auth/logout', { method: 'POST', data: {} }); loseSession(''); authError = ''; await checkSession(); }
      catch (error) { if (!error.stale) { loseSession(''); environment = 'unavailable'; authError = `Het scherm is vergrendeld. Afmelden bij de server is niet bevestigd: ${error.message}`; render(); } }
      return;
    }
    if (el.dataset.action === 'account-refresh') { await checkSession(); await loadAccount(); return; }
    if (el.dataset.revokeInvitation) {
      if (membership()?.role !== 'owner') throw new Error('Alleen een eigenaar kan uitnodigingen intrekken.');
      openAction('Uitnodiging intrekken', `<form id="revoke-invitation-form" data-id="${esc(el.dataset.revokeInvitation)}"><p class="muted-copy">Deze openstaande uitnodiging voor ${esc(membership().name)} kan na intrekking niet meer worden gebruikt. Bestaande clubleden behouden hun toegang.</p><button type="submit" class="button primary" data-recovery-submit>Bevestig intrekken</button></form>`); return;
    }
    if (el.dataset.action === 'recover-migration') {
      if (membership()?.role !== 'owner') throw new Error('Alleen een eigenaar kan de eerdere opslag herstellen.');
      el.disabled = true;
      try {
        await api('/api/auth/recover-migration', { method: 'POST', data: {} }); assertContext(ctx);
        await checkSession({ reload: true }); await loadAccount();
        accountUI.migrationMessage = 'De overname is voltooid. De eerdere scoutinggegevens zijn beschikbaar en het oorspronkelijke bestand is behouden.'; render();
      } catch (error) {
        if (!error.stale && ctx.epoch === epoch) { accountUI.migrationMessage = `Herstel nog niet voltooid: ${error.message}`; render(); }
        else throw error;
      }
      return;
    }
    if (el.dataset.removeMember) { if (membership()?.role !== 'owner') throw new Error('Alleen een eigenaar beheert clubleden.'); openAction('Clublid verwijderen', `<form id="remove-member-form" data-user="${esc(el.dataset.removeMember)}"><p class="muted-copy">Verwijder de toegang van ${esc(el.dataset.memberName)} tot ${esc(membership().name)}. De bestaande scoutinggeschiedenis blijft bewaard. De laatste eigenaar kan niet worden verwijderd.</p><button class="button primary" type="submit">Verwijder toegang tot deze club</button></form>`); return; }
    if ((el.dataset.save || el.dataset.task || el.dataset.importRetry || el.dataset.importRollback || ['create-task', 'decision'].includes(el.dataset.action)) && !canWrite()) throw new Error('Je hebt alleen leesrechten in deze club.');
    if (el.matches('a.brand')) { event.preventDefault(); return navigate('radar'); }
    if (el.dataset.close) { (el.dataset.close === 'dossier' ? dossierDialog : actionDialog).close(); return; }
    if (el.dataset.view) return navigate(el.dataset.view);
    if (el.dataset.importRetry) {
      importUI.busy = true; el.disabled = true;
      try { await request(`/api/import/jobs/${encodeURIComponent(el.dataset.importRetry)}/retry`, 'POST', {}); await loadImportJobs(); notify('Nieuwe poging geregistreerd. Volg de werkelijke taakstatus hieronder.'); }
      catch (error) { if (ctx.epoch === epoch && !error.stale) importUI.jobsError = error.message; throw error; }
      finally { if (ctx.epoch === epoch) { importUI.busy = false; renderImportJobs(); applyAccess(); } }
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
  } catch (error) { if (!error.stale) notify(error.message || 'Actie mislukt.', true); } finally { if (el.isConnected) el.disabled = false; applyAccess(); }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['invite-preview-form', 'invite-accept-form', 'revoke-invitation-form', 'backup-create-form', 'backup-preview-form', 'backup-restore-form', 'retention-form'].includes(form.id)) return;
  event.preventDefault(); const submit = form.querySelector('[type="submit"]'); if (submit.disabled || recoveryUI.busy) return;
  const ctx = accountContext(), data = Object.fromEntries(new FormData(form));
  const file = form.id === 'backup-preview-form' ? form.querySelector('#backup-file').files?.[0] : null;
  const confirmed = form.querySelector('input[type="checkbox"]')?.checked === true;
  const area = form.id.startsWith('invite-') || form.id === 'revoke-invitation-form' ? 'inviteError' : form.id === 'retention-form' ? 'retentionError' : 'backupError';
  recoveryUI[area] = ''; recoveryUI.message = ''; recoveryUI.busy = true;
  document.querySelectorAll('[data-recovery-submit]').forEach(button => { button.disabled = true; });
  // Keep selected file and credentials only in this active operation; clear the inputs immediately.
  if (['invite-preview-form', 'backup-create-form', 'backup-preview-form'].includes(form.id)) form.reset();
  try {
    if (!isAuthenticated()) throw new Error('Meld je opnieuw aan.');
    if (form.id === 'invite-preview-form') {
      recoveryUI.invitePreview = null; document.querySelector('#invite-accept-form')?.remove();
      const preview = await api('/api/auth/invite-preview', { method: 'POST', data: { inviteToken: data.inviteToken } }); assertAccountContext(ctx);
      recoveryUI.invitePreview = { ...preview, token: data.inviteToken }; return;
    }
    if (form.id === 'invite-accept-form') {
      const preview = recoveryUI.invitePreview;
      if (!preview || !confirmed) throw new Error('Controleer de uitnodiging en bevestig de club en rol eerst.');
      recoveryUI.invitePreview = null;
      const accepted = await api('/api/auth/accept-invite', { method: 'POST', data: { inviteToken: preview.token } }); assertAccountContext(ctx);
      clearWorkspace(); organizationId = accepted.organization.id; datasetLoading = true; render();
      await checkSession({ reload: true }); await loadAccount();
      recoveryUI.message = accepted.alreadyMember ? 'Uitnodiging gebruikt. Je bestaande clubrol is behouden.' : 'Uitnodiging geaccepteerd. De club is aan je account toegevoegd.';
      render(); return;
    }
    if (membership()?.role !== 'owner') throw new Error('Alleen een eigenaar beheert back-ups, herstel, bewaartermijnen en uitnodigingen.');
    if (form.id === 'revoke-invitation-form') {
      await api(`/api/auth/invitations/${encodeURIComponent(form.dataset.id)}`, { method: 'DELETE', data: {} }); assertAccountContext(ctx);
      actionDialog.close(); document.querySelector('#action-content').replaceChildren();
      await loadAccount(); assertAccountContext(ctx); recoveryUI.message = 'Uitnodiging ingetrokken. De code is niet meer te gebruiken.'; return;
    }
    if (form.id === 'backup-create-form') {
      const envelope = await api('/api/backup/create', { method: 'POST', data: { passphrase: data.passphrase }, raw: true }); assertAccountContext(ctx);
      download(`OmniScout-clubbackup-${new Date().toISOString().slice(0, 10)}.osbackup`, envelope, 'application/json');
      recoveryUI.message = 'Versleutelde clubback-up klaargezet als download. Bewaar het bestand en de wachtzin apart.'; return;
    }
    if (form.id === 'backup-preview-form') {
      recoveryUI.backupPreview = null; document.querySelector('#backup-preview')?.remove();
      if (!file || file.size === 0) throw new Error('Kies een versleuteld .osbackup-bestand.');
      if (file.size > 46 * 1024 * 1024) throw new Error('Het back-upbestand is groter dan 46 MiB.');
      let envelope; try { envelope = JSON.parse(await file.text()); } catch { throw new Error('Het gekozen bestand is geen geldig JSON-back-upbestand.'); }
      assertAccountContext(ctx);
      const preview = await api('/api/backup/preview', { method: 'POST', data: { envelope, passphrase: data.passphrase } }); assertAccountContext(ctx);
      recoveryUI.backupPreview = preview; return;
    }
    if (form.id === 'backup-restore-form') {
      const preview = recoveryUI.backupPreview;
      if (!preview || !confirmed) throw new Error('Controleer de back-up en bevestig de vervanging eerst.');
      recoveryUI.backupPreview = null;
      if (Date.parse(preview.expiresAt) <= Date.now()) throw new Error('De herstelcontrole is verlopen. Kies het bestand opnieuw voor een actuele controle.');
      const result = await api('/api/backup/restore', { method: 'POST', data: { previewId: preview.previewId, confirm: true } }); assertAccountContext(ctx);
      if (!result.restored) throw new Error('De backend heeft geen geslaagd herstel bevestigd.');
      clearWorkspace(); datasetLoading = true; render();
      await checkSession({ reload: true }); await loadAccount();
      recoveryUI.message = 'Clubgegevens hersteld. De vorige staat is als private lokale herstelkopie behouden; accounts en rollen zijn ongewijzigd.'; render(); return;
    }
    if (form.id === 'retention-form') {
      recoveryUI.retention = null; const days = Number(data.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('Kies een heel aantal dagen van 1 tot en met 3650.');
      const report = await readJSON(`/api/retention/preview?days=${days}`); assertAccountContext(ctx);
      recoveryUI.retention = report;
    }
  } catch (error) {
    if (!error.stale && ctx.epoch === epoch && ctx.accountSequence === accountSequence && view === 'account') recoveryUI[area] = error.message || 'Deze bewerking is mislukt.';
    else if (error.status === 403 && ctx.organizationId === organizationId) notify(error.message, true);
    if (form.id === 'revoke-invitation-form' && ctx.epoch === epoch) { actionDialog.close(); document.querySelector('#action-content').replaceChildren(); }
  } finally {
    delete data.passphrase; delete data.inviteToken; delete data.backupFile;
    if (ctx.epoch === epoch && ctx.organizationId === organizationId && ctx.accountSequence === accountSequence && view === 'account') { recoveryUI.busy = false; render(); }
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['auth-form', 'organization-form', 'password-form', 'invite-form', 'remove-member-form'].includes(form.id) && !form.matches('.member-role-form')) return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]'); if (submit.disabled) return; submit.disabled = true;
  const ctx = context(), data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'auth-form') {
      authBusy = true; authError = '';
      await api(`/api/auth/${form.dataset.mode}`, { method: 'POST', data, publicRequest: true }); assertContext(ctx);
      form.reset(); authBusy = false; view = 'radar'; await checkSession({ reload: true }); return;
    }
    if (!isAuthenticated()) throw new Error('Meld je opnieuw aan.');
    if (form.id === 'organization-form') {
      const result = await api('/api/auth/organizations', { method: 'POST', data }); assertContext(ctx); form.reset();
      const id = result.organization?.id || result.id; if (id) { clearWorkspace(); organizationId = id; datasetLoading = true; render(); }
      await checkSession({ reload: true }); notify('Nieuwe clubwerkruimte aangemaakt.'); return;
    }
    if (form.id === 'password-form') {
      await api('/api/auth/password', { method: 'POST', data }); assertContext(ctx); form.reset(); await checkSession({ reload: true }); notify('Wachtwoord gewijzigd. Andere sessies zijn afgesloten.'); return;
    }
    if (membership()?.role !== 'owner') throw new Error('Alleen een eigenaar beheert clubleden.');
    if (form.id === 'invite-form') { const inviteCtx = accountContext(); accountUI.invite = null; form.querySelector('.invite-result')?.remove(); const invite = await api('/api/auth/invites', { method: 'POST', data }); assertAccountContext(inviteCtx); accountUI.invite = invite; await loadAccount(); assertAccountContext(inviteCtx); document.querySelector('#invite-code')?.focus(); return; }
    if (form.matches('.member-role-form')) { await api(`/api/auth/members/${encodeURIComponent(form.dataset.user)}`, { method: 'PATCH', data }); assertContext(ctx); await checkSession({ reload: true }); await loadAccount(); notify('Rol gewijzigd.'); return; }
    if (form.id === 'remove-member-form') { await api(`/api/auth/members/${encodeURIComponent(form.dataset.user)}`, { method: 'DELETE', data: {} }); assertContext(ctx); actionDialog.close(); await checkSession({ reload: true }); await loadAccount(); notify('Clubtoegang verwijderd.'); }
  } catch (error) {
    if (!error.stale && ctx.epoch === epoch) {
      if (form.id === 'auth-form') { authError = error.message; const box = document.querySelector('#auth-error'); if (box) { box.textContent = authError; box.hidden = false; } }
      else notify(error.message || 'Wijzigen mislukt.', true);
    }
  } finally { authBusy = false; if (submit.isConnected) submit.disabled = false; }
});
document.addEventListener('submit', async event => {
  const form = event.target; if (!['brief-form', 'create-task-form', 'task-result-form', 'decision-form', 'import-confirm-form', 'import-rollback-form'].includes(form.id)) return;
  event.preventDefault(); const submit = form.querySelector('[type="submit"]'); if (submit.disabled) return; submit.disabled = true;
  const ctx = context();
  const data = Object.fromEntries(new FormData(form));
  try {
    if (!canWrite()) throw new Error('Je hebt alleen leesrechten in deze club.');
    if (form.id === 'import-confirm-form') {
      if (importUI.busy || !importUI.preview?.valid || !form.querySelector('#import-confirm-check').checked) throw new Error('Controleer het bestand en bevestig de importverklaring eerst.');
      importUI.busy = true; importUI.error = '';
      try {
        const result = await request('/api/import/confirm', 'POST', { payload: importUI.payload, digest: importUI.preview.digest });
        importUI.preview = null; importUI.payload = null;
        importUI.jobs = [result.job, ...importUI.jobs.filter(job => job.id !== result.job.id)];
        await selectDataset('import'); await loadImportJobs();
        notify('Importopdracht geregistreerd. De taakstatus toont of verwerking is geslaagd.');
      } catch (error) { if (ctx.epoch === epoch && !error.stale) { importUI.error = `${error.message} Kies het bestand opnieuw voor een actuele controle.`; importUI.preview = null; } throw error; }
      finally { if (ctx.epoch === epoch) { importUI.busy = false; if (view === 'import') renderImport(); applyAccess(); } }
      return;
    }
    if (form.id === 'import-rollback-form') {
      importUI.busy = true;
      try {
        await request('/api/import/rollback', 'POST', { snapshotId: form.dataset.snapshot });
        importUI.rolledBack.add(form.dataset.snapshot); importUI.preview = null;
        await refreshImportCatalog(); await loadImportJobs(); actionDialog.close();
        notify('Rollback bevestigd door de backend. Actieve importcatalogus bijgewerkt.');
      } finally { if (ctx.epoch === epoch) { importUI.busy = false; if (view === 'import') renderImport(); applyAccess(); } }
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
  } catch (error) { if (!error.stale) notify(error.message || 'Opslaan mislukt.', true); } finally { if (submit.isConnected) submit.disabled = false; applyAccess(); }
});
for (const dialog of [dossierDialog, actionDialog]) dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
render();
async function init() {
  if (environment === 'standalone') { catalog = CATALOG; restoreDemo(); datasetLoading = false; render(); return; }
  await checkSession({ reload: true });
  sessionCheck = setInterval(() => { if (isAuthenticated() && !datasetLoading && mutationCount === 0 && !authBusy) void checkSession(); }, 45000);
}
window.addEventListener('focus', () => { if (isAuthenticated() && !datasetLoading && mutationCount === 0 && !authBusy) void checkSession(); });
init();
