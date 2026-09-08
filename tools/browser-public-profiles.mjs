/** Real browser -> account HTTP API with an injected, deterministic synthetic upstream. No external requests. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/server.mjs';
import { renderStandalone } from './standalone.mjs';
import { validatePublicProfiles } from '../src/providers/wikidata.mjs';

const require = createRequire(import.meta.url), packagePath = process.env.OMNISCOUT_PLAYWRIGHT_PATH || 'playwright';
const { chromium } = require(packagePath), { expect } = require(join(packagePath, 'test'));
const reports = resolve(process.env.OMNISCOUT_REPORT_DIR || 'reports/v0.5'); await mkdir(reports, { recursive: true });
const temp = await mkdtemp(join(tmpdir(), 'omniscout-public-browser-')), dataDir = join(temp, 'state');
const NOW = new Date().toISOString(), PASSWORD = 'Synthetic public browser password 2026!';
const hostile = 'SYNTHETIC </ScRiPt><img src=x onerror=window.profileXss=1> Alpha';
const checks = [], errors = [], pageErrors = [], logs = [], requests = [], upstream = { searches: [], loads: [] };
let app, browser, context, page, readerContext, reader, base, organizationA, organizationB;
const passed = name => { checks.push(name); logs.push(`PASS: ${name}`); console.log('PASS:', name); };
function snapshot(ids) {
  return validatePublicProfiles({ format: 'omniscout-public-profiles', version: 1, provider: 'wikidata', license: { name: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }, retrievedAt: NOW, requestedIds: ids,
    profiles: ids.filter(id => ['Q1001', 'Q1002'].includes(id)).map((id, index) => ({ id, name: id === 'Q1001' ? hostile : 'SYNTHETIC Beta public profile', dob: '1995-03-10', sourceUrl: `https://www.wikidata.org/wiki/${id}`, revisionUrl: `https://www.wikidata.org/w/index.php?title=${id}&oldid=${100 + index}`, revision: 100 + index, sourceModifiedAt: NOW, retrievedAt: NOW,
      positions: [{ id: 'Q193592', label: 'SYNTHETIC middenvelder <script>window.profileXss=2</script>' }], teams: [{ id: 'Q2001', label: 'SYNTHETIC historical team', start: '2019', end: '2021-05' }], currentClub: null, competition: null, stats: { minutes: null, matches: null }, synthetic: false })),
    excluded: ids.filter(id => !['Q1001', 'Q1002'].includes(id)).map(id => ({ id, reason: 'Synthetische testuitsluiting: minderjarig of leeftijd onbekend.' })), warnings: ['SYNTHETIC bronclaim; geen gemeten prestaties.'] });
}
const provider = {
  async search(query) { upstream.searches.push(query); if (query === 'unavailable') throw Object.assign(new Error('Synthetische upstream is niet bereikbaar.'), { status: 503 }); return { provider: 'wikidata', results: [{ id: 'Q1001', label: hostile, description: 'SYNTHETIC football search result' }, { id: 'Q1002', label: 'SYNTHETIC Beta public profile', description: 'SYNTHETIC adult profile' }, { id: 'Q1003', label: 'SYNTHETIC excluded profile', description: 'SYNTHETIC unknown age' }] }; },
  async load(ids) { upstream.loads.push([...ids]); return snapshot(ids); }
};
function observe(target) {
  target.on('pageerror', error => pageErrors.push(error.message));
  target.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/api/public-profiles')) requests.push({ path: url.pathname, method: request.method(), organization: request.headers()['x-omniscout-organization'] || null, csrfPresent: Boolean(request.headers()['x-omniscout-csrf']) }); });
}
async function shot(target, name) { await target.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await target.screenshot({ path: join(reports, name), fullPage: true, mask: [target.locator('input[type="password"]'), target.locator('[name="inviteToken"]')], maskColor: '#26384b' }); }
async function profiles(target = page) { await target.locator('#nav [data-view="public-profiles"]').click(); await expect(target.locator('#public-search-form [type="submit"]')).toBeEnabled(); }
async function api(target, path, body, organization) {
  return target.evaluate(async ({ path, body, organization }) => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(organization ? { 'X-Omniscout-Organization': organization } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Omniscout-CSRF': session.csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, body, organization });
}
async function holdCache(target, org) {
  let release, captured, complete, held = false;
  const gate = new Promise(resolveGate => { release = resolveGate; }), arrived = new Promise(resolveArrived => { captured = resolveArrived; }), finished = new Promise(resolveFinished => { complete = resolveFinished; });
  const handler = async route => {
    if (held || route.request().headers()['x-omniscout-organization'] !== org) return route.continue();
    held = true; const response = await route.fetch(); captured(); await gate;
    try { await route.fulfill({ response }); } catch (error) { if (!/closed|cancel|abort|handled/i.test(error.message)) throw error; } finally { complete(); }
  };
  await target.route('**/api/public-profiles', handler);
  return { arrived, async deliver() { release(); await finished; await target.unroute('**/api/public-profiles', handler); } };
}
try {
  app = await createApp({ dataDir, publicProfileProvider: provider }); await new Promise(done => app.server.listen(0, '127.0.0.1', done)); base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); page = await context.newPage(); observe(page); await page.goto(base);
  await expect(page.locator('#auth-form[data-mode="setup"]')).toBeVisible();
  for (const [name, value] of Object.entries({ displayName: 'Synthetic public owner', organizationName: 'Synthetic Public Club A', username: 'publicowner', password: PASSWORD })) await page.locator(`#auth-form [name="${name}"]`).fill(value);
  await page.locator('#auth-form [type="submit"]').click(); await expect(page.locator('.player-table tbody tr')).toHaveCount(12); organizationA = await page.locator('#organization-select').inputValue();
  const before = (await app.organizationManager.capture(organizationA)).digest;
  await profiles(); await expect(page.locator('#public-profile-list .public-profile-card')).toHaveCount(0); await expect(page.locator('#public-profile-list')).toContainText('Zoek eerst');
  assert.deepEqual(upstream.loads, []); assert.deepEqual(upstream.searches, []);
  await page.locator('#public-search-form [name="q"]').fill('Synthetic'); assert.deepEqual(upstream.searches, []);
  await page.locator('#public-search-form [name="q"]').press('Enter'); await expect(page.locator('#public-search-results .public-search-result')).toHaveCount(3); assert.deepEqual(upstream.searches, ['Synthetic']);
  passed('Empty account cache is explicit and entering a name makes no upstream request until keyboard search submission');

  for (const id of ['Q1001', 'Q1002', 'Q1003']) await page.locator(`[data-public-select="${id}"]`).check();
  const loadResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/public-profiles/load');
  await page.locator('#public-load-form [type="submit"]').click(); assert.equal((await loadResponse).status(), 200);
  await expect(page.locator('.public-profile-card')).toHaveCount(2); await expect(page.locator('#public-excluded')).toContainText('1 aangevraagde');
  assert.deepEqual(upstream.loads, [['Q1001', 'Q1002', 'Q1003']]); assert.equal((await app.organizationManager.capture(organizationA)).digest, before);
  await expect(page.locator('.demo-chip')).toHaveText('OPENBARE PROFIELEN'); await expect(page.locator('.demo-banner')).toContainText('Echte openbare profielen'); await expect(page.locator('.dataset-bar')).toBeHidden();
  assert.equal(await page.locator('.public-facts dd').evaluateAll(elements => elements.every(element => element.textContent === 'Onbekend')), true);
  await expect(page.locator('.public-profile-card').first()).toContainText(hostile); assert.equal(await page.evaluate(() => window.profileXss), undefined); await expect(page.locator('#main img, #main script')).toHaveCount(0);
  for (const href of await page.locator('.public-profile-card a').evaluateAll(elements => elements.map(element => element.href))) assert.match(href, /^https:\/\/www\.wikidata\.org\/wiki\/Q[1-9][0-9]*$/);
  assert.equal((await page.locator('#main').textContent()).includes('ROLSIGNAAL'), false); await shot(page, 'public-profiles-desktop.png');
  passed('Explicit selected-ID load renders two adult metadata profiles, explains one exclusion, keeps every measurement unknown and writes no scouting state');

  await page.locator('[data-public-profile="Q1001"]').first().focus(); await page.keyboard.press('Enter'); await expect(page.locator('#dossier-dialog')).toBeVisible();
  await expect(page.locator('#dossier-content')).toContainText('SYNTHETIC historical team'); await expect(page.locator('#dossier-content')).toContainText('Er wordt geen huidige club uit afgeleid');
  await expect(page.locator('#dossier-content a').last()).toHaveAttribute('href', 'https://www.wikidata.org/w/index.php?title=Q1001&oldid=100');
  await page.keyboard.press('Escape'); await expect(page.locator('#dossier-dialog')).not.toBeVisible();
  await page.locator('#public-filter').fill('no matching fixture'); await expect(page.locator('.public-profile-card')).toHaveCount(0);
  await page.locator('#public-filter').fill('Beta'); await expect(page.locator('.public-profile-card')).toHaveCount(1); await page.locator('#public-filter').fill('');
  assert.deepEqual(upstream.searches, ['Synthetic']); await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(page, 'public-profiles-mobile.png'); await page.setViewportSize({ width: 1440, height: 1000 });
  passed('Untrusted names and positions render as inert text; fixed source/revision links, keyboard dossier, local filtering and 390px layout work');

  await page.locator('#public-search-form [name="q"]').fill('unavailable'); await page.locator('#public-search-form [type="submit"]').click(); await expect(page.locator('#public-profile-error')).toContainText('niet bereikbaar'); await expect(page.locator('.public-profile-card')).toHaveCount(2);
  await page.locator('#public-load-form [name="ids"]').fill('not-a-qid'); await page.locator('#public-load-form [type="submit"]').click(); await expect(page.locator('#public-profile-error')).toContainText('geldige Wikidata'); assert.equal(upstream.loads.length, 1);
  passed('Upstream failure is visible while the dated prior snapshot remains; invalid IDs are rejected without an upstream load or fictitious fallback');

  const invitation = await api(page, '/api/auth/invites', { role: 'viewer' }, organizationA); assert.equal(invitation.status, 201);
  readerContext = await browser.newContext(); reader = await readerContext.newPage(); observe(reader); await reader.goto(base); await reader.locator('[data-action="auth-mode"]').click();
  for (const [name, value] of Object.entries({ inviteToken: invitation.body.token, displayName: 'Synthetic public viewer', username: 'publicviewer', password: PASSWORD })) await reader.locator(`#auth-form [name="${name}"]`).fill(value);
  await reader.locator('#auth-form [type="submit"]').click(); await expect(reader.locator('.player-table tbody tr')).toHaveCount(12); await profiles(reader);
  await expect(reader.locator('.public-profile-card')).toHaveCount(2); await expect(reader.locator('#public-load-form [type="submit"]')).toBeDisabled();
  await reader.locator('#public-search-form [name="q"]').fill('Reader'); await reader.locator('#public-search-form [type="submit"]').click(); await expect(reader.locator('.public-search-result')).toHaveCount(3);
  assert.equal((await api(reader, '/api/public-profiles/load', { ids: ['Q1002'] }, organizationA)).status, 403); assert.equal(upstream.loads.length, 1);
  assert.equal((await api(reader, '/api/public-profiles', undefined)).status, 400);
  passed('Viewer reads cached profiles and searches; load is disabled in UI and denied by real HTTP 403; missing club context returns 400');

  const created = await api(page, '/api/auth/organizations', { name: 'Synthetic Public Club B' }); assert.equal(created.status, 201); organizationB = created.body.id;
  await page.reload(); await expect(page.locator('#dataset-select')).toBeEnabled(); await profiles();
  let held = await holdCache(page, organizationA); await page.locator('#nav [data-view="public-profiles"]').click(); await held.arrived;
  await page.locator('#nav [data-view="radar"]').click(); await held.deliver(); await expect(page.locator('.player-table')).toBeVisible(); assert.equal((await page.locator('body').textContent()).includes(hostile), false);
  await profiles(); await expect(page.locator('#public-search-form [name="q"]')).toHaveValue(''); await expect(page.locator('#public-load-form [name="ids"]')).toHaveValue('');
  held = await holdCache(page, organizationA); await page.locator('#nav [data-view="public-profiles"]').click(); await held.arrived;
  await page.locator('#organization-select').selectOption(organizationB); await expect(page.locator('#organization-select')).toBeEnabled(); await expect(page.locator('#public-search-form [type="submit"]')).toBeEnabled(); await held.deliver();
  await expect(page.locator('.public-profile-card')).toHaveCount(0); assert.equal((await page.locator('body').textContent()).includes(hostile), false); assert.equal((await api(reader, '/api/public-profiles', undefined, organizationB)).status, 403);
  await page.locator('#organization-select').selectOption(organizationA); await expect(page.locator('#public-search-form [type="submit"]')).toBeEnabled(); await expect(page.locator('.public-profile-card')).toHaveCount(2);
  held = await holdCache(page, organizationA); await page.locator('#nav [data-view="public-profiles"]').click(); await held.arrived;
  await page.locator('#organization-bar [data-action="logout"]').click(); await expect(page.locator('#auth-form')).toBeVisible(); await held.deliver(); await expect(page.locator('#dossier-content')).toBeEmpty(); assert.equal((await page.locator('body').textContent()).includes(hostile), false);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage })); for (const value of [hostile, 'SYNTHETIC Beta public profile', 'wikidata', PASSWORD]) assert.equal(storage.includes(value), false);
  assert.ok(requests.filter(request => request.path === '/api/public-profiles/load' && request.organization).every(request => request.csrfPresent));
  passed('Real backend responses delayed until after navigation, club switch and logout cannot repopulate old profiles; club cache, fields and browser storage remain isolated');

  const preview = join(temp, 'synthetic-public-preview.html'); await writeFile(preview, await renderStandalone({ profiles: snapshot(['Q1001', 'Q1002', 'Q1003']) }));
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), offline = await offlineContext.newPage(), offlineRequests = []; observe(offline);
  offline.on('request', request => { if (/^https?:/.test(request.url())) offlineRequests.push(request.url()); }); await offline.goto(pathToFileURL(preview).href);
  await expect(offline.locator('.public-profile-card')).toHaveCount(2); await expect(offline.locator('#public-search-form')).toHaveCount(0); assert.equal(await offline.evaluate(() => window.profileXss), undefined); await expect(offline.locator('#main img, #main script')).toHaveCount(0);
  await expect(offline.locator('.public-profile-card').first()).toContainText(hostile); await expect(offline.locator('.demo-chip')).toHaveText('OPENBARE PROFIELEN'); assert.equal(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await shot(offline, 'public-profiles-standalone-mobile.png');
  await offline.locator('#nav [data-view="radar"]').click(); await expect(offline.locator('.player-table tbody tr')).toHaveCount(12); await expect(offline.locator('.demo-chip')).toHaveText('DEMO');
  await offline.locator('#nav [data-view="public-profiles"]').click(); await expect(offline.locator('.public-profile-card')).toHaveCount(2); assert.deepEqual(offlineRequests, []); await offlineContext.close();
  passed('Actual file:// standalone safely embeds mixed-case script-closing source text, opens real-profile view, switches to intact fictive demo and makes zero network requests');
  assert.deepEqual(pageErrors, []); passed('No uncaught browser JavaScript errors across account, viewer, context races and standalone workflows');
} catch (error) {
  const message = error.stack || error.message; errors.push(message); logs.push(`FAIL: ${message}`); console.error('FAIL:', message); process.exitCode = 1; await shot(page, 'public-profiles-failure.png').catch(() => {});
} finally {
  await browser?.close(); await app?.close();
  const result = { mode: 'native_browser_to_account_api_with_synthetic_injected_provider_and_file_standalone', realExternalProvider: false, executedAt: new Date().toISOString(), browser: process.env.BROWSER_CHANNEL || 'chromium', checks, errors, pageErrors, upstreamCounts: { searches: upstream.searches.length, loads: upstream.loads.length }, requestEvidence: requests, passed: !errors.length && !pageErrors.length };
  await writeFile(join(reports, 'browser-public-profiles.json'), JSON.stringify(result, null, 2) + '\n'); await writeFile(join(reports, 'browser-public-profiles.txt'), logs.join('\n') + '\n');
  const target = resolve(temp); assert.ok(target.startsWith(`${resolve(tmpdir())}${sep}omniscout-public-browser-`)); await rm(target, { recursive: true, force: true });
}
