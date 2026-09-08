import http from 'node:http';
import { resolve } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createAuth } from './auth/index.mjs';
import { createOrganizationManager } from './organizations/index.mjs';
import { sealBackup, openBackup, MAX_ENVELOPE_BYTES } from './backup/crypto.mjs';
import { createWorkspaceBackup, inspectWorkspaceBackup, retentionPreview, validateWorkspaceState } from './backup/workspace.mjs';
import { createWikidataProvider, validatePublicProfiles } from './providers/wikidata.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
function cookies(req) {
  const result = Object.create(null);
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('='); if (index < 0) continue;
    const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (Object.hasOwn(result, name)) fail(400, 'Dubbele sessiecookie.');
    result[name] = value;
  }
  return result;
}
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
function csrfValid(got, expected) { return typeof got === 'string' && /^[a-f0-9]{64}$/.test(got) && typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected) && timingSafeEqual(Buffer.from(got), Buffer.from(expected)); }
async function readBody(req, limit = 65536) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Alleen application/json toegestaan.');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) fail(413, 'Verzoek is te groot.'); chunks.push(chunk); }
  let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Ongeldige JSON.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, 'Een JSON-object is vereist.');
  return result;
}

/** Account boundary remains loopback-only. No public deployment or external identity provider. */
export async function createAccountApp({ dataDir = null, legacyStatePath = null, statePath = null, now = () => new Date().toISOString(), publicProfileProvider, legacyFactory, contextKey, securityHeaders } = {}) {
  if (statePath && !dataDir) fail(400, 'Gebruik dataDir voor accounts; statePath is alleen voor expliciete legacy-tests.');
  const manager = await createOrganizationManager({ dataDir, legacyStatePath, now });
  let auth, publicApp;
  try {
    auth = await createAuth({ path: dataDir ? resolve(dataDir, 'accounts.json') : null, now });
    publicApp = await legacyFactory({ now });
  } catch (error) { await manager.close(); throw error; }
  const applications = new Map(), preauth = new Map(), authAttempts = new Map(), previews = new Map();
  let backupActive = 0, profileActive = 0, profileRequests = { until: 0, count: 0 };
  const profileProvider = publicProfileProvider ?? createWikidataProvider({ now });
  const profileCache = new Map();
  const clock = () => Date.parse(typeof now === 'function' ? now() : now);
  const persistence = dataDir ? 'local_file' : 'memory';
  function forgetPreview(id) { const preview = previews.get(id); if (preview) clearTimeout(preview.timer); previews.delete(id); }
  function clearPreviews(predicate) { for (const [id, preview] of previews) if (predicate(preview)) forgetPreview(id); }
  async function sessionJSON(session) { return { mode: 'local_accounts', authenticated: true, user: session.user, organizations: session.organizations, csrf: session.csrf, expiresAt: session.expiresAt, setupRequired: false, supportsImport: true, persistence, productionReady: false }; }
  async function application(orgId) {
    if (!applications.has(orgId)) {
      const scoped = await manager.get(orgId);
      applications.set(orgId, await legacyFactory({ providedStore: scoped.store, providedQueue: scoped.importQueue, now }));
    }
    return applications.get(orgId);
  }
  function preauthSession(req, res) {
    for (const [key, value] of preauth) if (value.expiresAt <= clock()) preauth.delete(key);
    const token = cookies(req).omniscout_preauth;
    const existing = token ? preauth.get(digest(token)) : null;
    if (existing) return existing;
    if (preauth.size >= 1000) fail(429, 'Te veel nieuwe sessies. Probeer later opnieuw.');
    const created = randomBytes(32).toString('hex'), session = { csrf: randomBytes(32).toString('hex'), expiresAt: clock() + 15 * 60 * 1000 };
    preauth.set(digest(created), session); res.setHeader('Set-Cookie', cookie('omniscout_preauth', created, 900)); return session;
  }
  function limitAuthentication(req) {
    // Socket address, never a caller-controlled forwarding header. Includes setup/invite registration.
    const key = req.socket.remoteAddress || 'loopback', timestamp = clock();
    for (const [address, bucket] of authAttempts) if (bucket.until <= timestamp) authAttempts.delete(address);
    const bucket = authAttempts.get(key) || { count: 0, until: timestamp + 15 * 60 * 1000 };
    if (++bucket.count > 40) fail(429, 'Te veel aanmeldpogingen. Probeer over 15 minuten opnieuw.');
    authAttempts.set(key, bucket);
  }
  const server = http.createServer(async (req, res) => {
    Object.entries(securityHeaders).forEach(([key, value]) => res.setHeader(key, value));
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const port = server.address()?.port;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) fail(403, 'Alleen lokale hostnamen toegestaan.');
      const origin = `http://${req.headers.host}`, url = new URL(req.url, origin), route = url.pathname;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) fail(403, 'Cross-site verzoek geblokkeerd.');
      const mutates = !['GET', 'HEAD'].includes(req.method);
      if (mutates && req.headers.origin !== origin) fail(403, 'Lokale origin vereist voor wijzigingen.');
      if (route === '/api/health' && req.method === 'GET') return json(200, { ok: true, mode: 'local_accounts', version: '0.5.0', liveSources: profileCache.size ? 1 : 0, liveMatchSources: 0, publicProfileProvider: 'wikidata', productionReady: false });
      const requestCookies = cookies(req), token = requestCookies.omniscout_session || '';
      const session = token ? await auth.session(token) : null;
      if (route === '/api/session' && req.method === 'GET') {
        if (session) return json(200, await sessionJSON(session));
        const temporary = preauthSession(req, res);
        return json(200, { mode: 'local_accounts', authenticated: false, ...(await auth.status()), csrf: temporary.csrf, supportsImport: false, persistence, productionReady: false });
      }
      if (route.startsWith('/api/auth/')) {
        if (mutates) {
          const temporary = requestCookies.omniscout_preauth ? preauth.get(digest(requestCookies.omniscout_preauth)) : null;
          const expected = session?.csrf || (temporary?.expiresAt > clock() ? temporary.csrf : null);
          if (!csrfValid(req.headers['x-omniscout-csrf'], expected)) fail(403, 'Ongeldig of verlopen sessietoken. Vernieuw de pagina.');
        }
        if (['/api/auth/setup', '/api/auth/login', '/api/auth/register'].includes(route) && req.method === 'POST') {
          if (session) fail(409, 'Meld eerst af voordat je een andere account aanmeldt.');
          limitAuthentication(req);
          const data = await readBody(req);
          const operation = route.split('/').at(-1), result = await auth[operation](data);
          let migration;
          if (operation === 'setup') {
            try { migration = await manager.claimLegacy(result.organizations[0].id); }
            catch { migration = { claimed: false, recoveryRequired: true, message: 'Bestaande lokale gegevens konden niet worden overgenomen. Het oorspronkelijke bestand is behouden. Herstel dit via Werkruimtebeheer.' }; }
          }
          preauth.delete(digest(requestCookies.omniscout_preauth || ''));
          res.setHeader('Set-Cookie', [cookie('omniscout_session', result.token, Math.max(1, Math.ceil((Date.parse(result.expiresAt) - clock()) / 1000))), cookie('omniscout_preauth', '', 0)]);
          return json(operation === 'login' ? 200 : 201, { ...await sessionJSON(result), ...(migration ? { migration } : {}) });
        }
        if (!session) fail(401, 'Aanmelden vereist.');
        if (route === '/api/auth/logout' && req.method === 'POST') {
          await auth.logout(token); clearPreviews(p => p.session === digest(token)); res.setHeader('Set-Cookie', cookie('omniscout_session', '', 0)); return json(200, { signedOut: true });
        }
        if (route === '/api/auth/password' && req.method === 'POST') {
          const result = await auth.changePassword(token, await readBody(req));
          clearPreviews(p => p.userId === session.user.id);
          res.setHeader('Set-Cookie', cookie('omniscout_session', result.token, Math.max(1, Math.ceil((Date.parse(result.expiresAt) - clock()) / 1000))));
          return json(200, await sessionJSON(result));
        }
        if (route === '/api/auth/organizations' && req.method === 'POST') return json(201, await auth.createOrganization(token, await readBody(req)));
        if (route === '/api/auth/invite-preview' && req.method === 'POST') return json(200, await auth.invitePreview(token, await readBody(req)));
        if (route === '/api/auth/accept-invite' && req.method === 'POST') return json(200, await auth.acceptInvite(token, await readBody(req)));
        const orgId = req.headers['x-omniscout-organization'];
        if (typeof orgId !== 'string') fail(400, 'Kies een clubwerkruimte.');
        await auth.authorize(token, orgId, { owner: true });
        if (route === '/api/auth/members' && req.method === 'GET') return json(200, { members: await auth.members(token, orgId) });
        if (route === '/api/auth/invites' && req.method === 'POST') return json(201, await auth.invite(token, orgId, await readBody(req)));
        if (route === '/api/auth/invitations' && req.method === 'GET') return json(200, { invitations: await auth.invitations(token, orgId) });
        const invitationMatch = route.match(/^\/api\/auth\/invitations\/([a-f0-9]{64})$/);
        if (invitationMatch && req.method === 'DELETE') return json(200, await auth.revokeInvitation(token, orgId, invitationMatch[1]));
        if (route === '/api/auth/recover-migration' && req.method === 'POST') return json(200, await manager.claimLegacy(orgId));
        const memberMatch = route.match(/^\/api\/auth\/members\/([a-f0-9-]+)$/);
        if (memberMatch && req.method === 'PATCH') return json(200, await auth.setRole(token, orgId, memberMatch[1], await readBody(req)));
        if (memberMatch && req.method === 'DELETE') return json(200, await auth.removeMember(token, orgId, memberMatch[1]));
        fail(404, 'Niet gevonden.');
      }
      if (!route.startsWith('/api/') || (route === '/api/import/sample' && req.method === 'GET')) {
        if (mutates) fail(405, 'Methode niet toegestaan.');
        req[contextKey] = { port }; publicApp.server.emit('request', req, res); return;
      }
      if (!session) fail(401, 'Aanmelden vereist.');
      const orgId = req.headers['x-omniscout-organization'];
      if (typeof orgId !== 'string') fail(400, 'Kies een clubwerkruimte.');
      const authorization = await auth.authorize(token, orgId, { write: mutates });
      if (mutates && !csrfValid(req.headers['x-omniscout-csrf'], session.csrf)) fail(403, 'Ongeldig of verlopen sessietoken.');
      if (route === '/api/public-profiles' && req.method === 'GET') {
        const snapshot = profileCache.get(orgId) ?? null;
        return json(200, { provider: 'wikidata', snapshot, supportsFetch: true, stale: snapshot ? clock() - Date.parse(snapshot.retrievedAt) > 86400000 : false });
      }
      if (route.startsWith('/api/public-profiles/')) {
        if (!((route === '/api/public-profiles/search' && req.method === 'GET') || (route === '/api/public-profiles/load' && req.method === 'POST'))) fail(404, 'Niet gevonden.');
        if (profileActive >= 4) fail(429, 'Te veel bronverzoeken tegelijk. Probeer later opnieuw.');
        if (profileRequests.until <= clock()) profileRequests = { until: clock() + 60000, count: 0 };
        if (++profileRequests.count > 30) fail(429, 'Bronlimiet bereikt. Wacht één minuut voordat je opnieuw probeert.');
        profileActive++;
        try {
          if (req.method === 'GET') {
            const result = await profileProvider.search(url.searchParams.get('q') || '');
            await auth.authorize(token, orgId); return json(200, result);
          }
          const data = await readBody(req, 4096);
          if (Object.keys(data).some(key => key !== 'ids')) fail(400, 'Alleen Wikidata-ID’s zijn toegestaan.');
          const snapshot = validatePublicProfiles(await profileProvider.load(data.ids));
          if (Date.parse(snapshot.retrievedAt) > clock()) fail(400, 'Een profielkopie uit de toekomst is niet toegestaan.');
          await auth.authorize(token, orgId, { write: true });
          profileCache.set(orgId, snapshot); return json(200, snapshot);
        } finally { profileActive--; }
      }
      if (route.startsWith('/api/backup/') || route === '/api/retention/preview') {
        const owner = () => auth.authorize(token, orgId, { owner: true });
        await owner();
        clearPreviews(p => p.expires <= clock());
        if (route === '/api/retention/preview' && req.method === 'GET') {
          const current = await manager.capture(orgId, { drain: false });
          const report = retentionPreview(current.state, { now: new Date(clock()).toISOString(), days: Number(url.searchParams.get('days') ?? 365) });
          await owner(); return json(200, report);
        }
        if (req.method !== 'POST' || !['/api/backup/create', '/api/backup/preview', '/api/backup/restore'].includes(route)) fail(404, 'Niet gevonden.');
        if (backupActive >= 4) fail(429, 'Te veel back-upbewerkingen. Probeer later opnieuw.');
        backupActive++;
        try {
          if (route === '/api/backup/create') {
            const data = await readBody(req), current = await manager.capture(orgId), access = await owner();
            const bundle = createWorkspaceBackup({ organizationId: orgId, organizationName: access.organization.name, state: current.state, now: new Date(clock()).toISOString() });
            const envelope = await sealBackup(bundle, data.passphrase);
            inspectWorkspaceBackup(bundle, { organizationId: orgId, now: new Date(clock()).toISOString() }); await owner();
            res.setHeader('Content-Disposition', 'attachment; filename="omniscout-club.osbackup"'); return json(200, envelope);
          }
          if (route === '/api/backup/preview') {
            if (previews.size >= 4) fail(429, 'Maximaal vier herstelvoorbeelden tegelijk. Wacht vijf minuten of meld af.');
            const data = await readBody(req, MAX_ENVELOPE_BYTES + 65536), bundle = await openBackup(data.envelope, data.passphrase);
            const checked = inspectWorkspaceBackup(bundle, { organizationId: orgId, now: new Date(clock()).toISOString() });
            const current = await manager.capture(orgId), access = await owner();
            // Capture may complete while another preview is decrypting; reserve capacity again.
            if (previews.size >= 4) fail(429, 'Maximaal vier herstelvoorbeelden tegelijk.');
            const previewId = randomBytes(32).toString('hex'), expires = clock() + 300000;
            const currentSummary = { organizationId: orgId, organizationName: access.organization.name, ...validateWorkspaceState(current.state, { now: new Date(clock()).toISOString(), checkRights: false }).summary };
            const timer = setTimeout(() => forgetPreview(previewId), 300000); timer.unref();
            previews.set(previewId, { state: checked.state, backupDigest: checked.digest, expectedDigest: current.digest, orgId, userId: session.user.id, session: digest(token), expires, timer });
            return json(200, { previewId, expiresAt: new Date(expires).toISOString(), summary: checked.summary, currentSummary });
          }
          const data = await readBody(req), preview = previews.get(data.previewId);
          if (data.confirm !== true) fail(400, 'Bevestig het getoonde herstelplan.');
          if (!preview || preview.expires <= clock() || preview.orgId !== orgId || preview.userId !== session.user.id || preview.session !== digest(token)) fail(409, 'Herstelvoorbeeld ontbreekt of is verlopen. Controleer de back-up opnieuw.');
          forgetPreview(data.previewId); await owner();
          const result = await manager.restore(orgId, { state: preview.state, expectedDigest: preview.expectedDigest, actor: session.user.id, backupDigest: preview.backupDigest, authorize: owner });
          clearPreviews(p => p.orgId === orgId); return json(200, result);
        } finally { backupActive--; }
      }
      if (route === '/api/workspace/stats' && req.method === 'GET') return json(200, await manager.stats(orgId));
      req[contextKey] = { port, userId: authorization.user.id, organizationId: orgId, csrf: session.csrf };
      const target = await application(orgId);
      target.server.emit('request', req, res);
    } catch (error) {
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Lokale accountverwerking mislukt. Eerdere geldige gegevens zijn behouden.' });
      else res.end();
      if (!error.status) console.error('Accountverwerkingsfout:', error.code || error.name);
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  let closing;
  async function close() {
    return closing ||= (async () => {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      clearPreviews(() => true); profileCache.clear(); await publicApp.importQueue.idle(); await manager.close();
    })();
  }
  return { server, auth, organizationManager: manager, close };
}
