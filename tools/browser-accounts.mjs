/** Native browser -> loopback HTTP -> account/organization storage, using only synthetic test data. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.mjs';
import { emptyState } from '../src/store.mjs';

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.OMNISCOUT_PLAYWRIGHT_PATH || 'playwright';
const { chromium } = require(playwrightPackage);
const { expect } = require(join(playwrightPackage, 'test'));
const reportDir = resolve(process.env.OMNISCOUT_REPORT_DIR || 'reports/v0.3');
await mkdir(reportDir, { recursive: true });
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
const sampleA = structuredClone(sample), sampleB = structuredClone(sample);
sampleA.players[0].name = 'Fictief A scoutingprofiel'; sampleB.players[0].name = 'Fictief B scoutingprofiel';
const PASSWORD = 'Synthetic browser password 2026!', NEW_PASSWORD = 'Changed synthetic password 2026!';
const checks = [], errors = [], pageErrors = [], requestEvidence = [], logs = [];
const temp = await mkdtemp(join(tmpdir(), 'omniscout-accounts-browser-'));
let app, browser, base, port = 0, ownerContext, viewerContext, page, viewer;
const passed = name => { checks.push(name); logs.push(`PASS: ${name}`); console.log('PASS:', name); };
async function start(options = {}) {
  app = await createApp({ dataDir: temp, ...options });
  await new Promise(resolveListen => app.server.listen(port, '127.0.0.1', resolveListen));
  port = app.server.address().port; base = `http://127.0.0.1:${port}`;
}
async function stop() { if (app) { await app.close(); app = null; } }
function observe(target) {
  target.on('pageerror', error => pageErrors.push(error.message));
  target.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && !['/api/session', '/api/health', '/api/import/sample'].includes(url.pathname) && !url.pathname.startsWith('/api/auth/')) {
      const headers = request.headers();
      requestEvidence.push({ path: url.pathname, method: request.method(), organization: headers['x-omniscout-organization'] || null, csrfPresent: Boolean(headers['x-omniscout-csrf']) });
    }
  });
}
async function session(target) { return target.evaluate(async () => (await fetch('/api/session', { cache: 'no-store' })).json()); }
async function login(target, username, password = PASSWORD) {
  await expect(target.locator('#auth-form')).toBeVisible();
  await target.locator('#auth-form [name="username"]').fill(username);
  await target.locator('#auth-form [name="password"]').fill(password);
  await target.locator('#auth-form [type="submit"]').click();
  await expect(target.locator('#organization-select')).toBeVisible();
  await expect(target.locator('#dataset-select')).toBeEnabled();
}
async function upload(target, payload) {
  await target.locator('#nav [data-view="import"]').click();
  await target.locator('#import-file').setInputFiles({ name: 'synthetic-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
  await expect(target.locator('#import-confirm-form')).toBeVisible();
  await target.locator('#import-confirm-check').check();
  await target.locator('#import-confirm-form [type="submit"]').click();
  await expect(target.locator('#import-jobs')).toContainText('Geslaagd');
  await app.organizationManager.idle();
  await target.locator('#nav [data-view="radar"]').click();
  await expect(target.locator('.player-table tbody tr')).toHaveCount(payload.players.length);
}
async function club(target, id) {
  await target.locator('#organization-select').selectOption(id);
  await expect(target.locator('#organization-select')).toBeEnabled();
  await expect(target.locator('#organization-select')).toHaveValue(id);
}
async function noContent(target, text) {
  assert.equal((await target.locator('body').textContent()).includes(text), false);
  assert.equal((await target.locator('#dossier-content').textContent()).includes(text), false);
  assert.equal((await target.locator('#action-content').textContent()).includes(text), false);
}
async function holdCatalog(target, organization) {
  let release, arrived, finished, held = false;
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const captured = new Promise(resolveCaptured => { arrived = resolveCaptured; });
  const completed = new Promise(resolveCompleted => { finished = resolveCompleted; });
  const pattern = '**/api/catalog?dataset=import';
  const handler = async route => {
    if (held || route.request().headers()['x-omniscout-organization'] !== organization) return route.continue();
    held = true;
    // Fetch the real backend response, then hold only its delivery to the UI.
    const response = await route.fetch(); arrived(); await gate;
    try { await route.fulfill({ response }); } catch (error) { if (!/closed|cancel|abort|handled/i.test(error.message)) throw error; }
    finally { finished(); }
  };
  await target.route(pattern, handler);
  return { captured, async deliver() { release(); await completed; await target.unroute(pattern, handler); } };
}
try {
  await start();
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  ownerContext = await browser.newContext({ viewport: { width: 1512, height: 1050 }, acceptDownloads: true });
  page = await ownerContext.newPage(); observe(page);
  await page.goto(base);
  await expect(page.locator('#auth-form[data-mode="setup"]')).toBeVisible();
  await page.evaluate(() => localStorage.setItem('omniscout.synthetic-demo.v1', JSON.stringify({ version: 1, decisions: [{ note: 'SYNTHETIC OLD BROWSER NOTE' }], tasks: [], audit: [] })));
  await page.reload(); await expect(page.locator('#auth-form[data-mode="setup"]')).toBeVisible();
  await noContent(page, 'SYNTHETIC OLD BROWSER NOTE');
  assert.ok((await page.evaluate(() => localStorage.getItem('omniscout.synthetic-demo.v1'))).includes('SYNTHETIC OLD BROWSER NOTE'));
  await expect(page.locator('.player-table')).toHaveCount(0);
  await expect(page.locator('#nav')).toBeHidden();
  await page.screenshot({ path: join(reportDir, 'accounts-first-setup.png'), fullPage: true });
  await page.locator('#auth-form [name="displayName"]').fill('Synthetische eigenaar');
  await page.locator('#auth-form [name="organizationName"]').fill('Fictieve Club A');
  await page.locator('#auth-form [name="username"]').fill('browserowner');
  await page.locator('#auth-form [name="password"]').fill(PASSWORD);
  await page.locator('#auth-form [type="submit"]').click();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(12);
  const orgA = await page.locator('#organization-select').inputValue();
  assert.equal((await session(page)).authenticated, true);
  assert.equal(await page.evaluate(() => document.cookie.includes('omniscout_session')), false);
  passed('First-run setup creates owner and club; existing browser notes remain untouched/unused, locked screen hides club data and cookie is HttpOnly');

  await upload(page, sampleA);
  await page.locator('[data-open="import-p01"]').first().click();
  await page.locator('#dossier-content [data-save="import-p01"]').click();
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#dossier-content [data-action="create-task"]').click();
  await page.locator('#create-task-form [name="question"]').fill('Synthetische club-A onderzoeksvraag met onbekend bewijs.');
  await page.locator('#create-task-form [type="submit"]').click();
  await expect(page.locator('.task-card')).toHaveCount(1);
  await page.locator('[data-task]').click();
  await page.locator('#task-result-form [name="result"]').fill('Synthetische club-A uitkomst; onvoldoende bewijs behouden.');
  await page.locator('#task-result-form [type="submit"]').click();
  await expect(page.locator('.task-card .status-tag')).toHaveText('Afgerond');
  await page.locator('#nav [data-view="shortlist"]').click();
  const downloaded = page.waitForEvent('download'); await page.locator('[data-action="export"]').click();
  const csv = await readFile(await (await downloaded).path(), 'utf8'); assert.ok(csv.includes(sampleA.players[0].name));
  const protectedRequests = [...requestEvidence];
  assert.ok(protectedRequests.length > 5); assert.ok(protectedRequests.every(request => request.organization === orgA));
  assert.ok(protectedRequests.filter(request => request.method !== 'GET').every(request => request.csrfPresent));
  passed('Authenticated import, dossier, shortlist, research completion and real CSV download use club header and mutation CSRF');

  await page.locator('#nav [data-view="account"]').click();
  await expect(page.locator('.members-table tbody tr')).toHaveCount(1);
  await page.locator('#organization-form [name="name"]').fill('Fictieve Club B');
  await page.locator('#organization-form [type="submit"]').click();
  await expect(page.locator('#organization-select option')).toHaveCount(2);
  await expect(page.locator('#organization-role')).toContainText('Eigenaar');
  const orgB = await page.locator('#organization-select').inputValue(); assert.notEqual(orgA, orgB);
  await page.locator('#nav [data-view="radar"]').click();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(0); await expect(page.locator('#shortlist-count')).toHaveText('0');
  await noContent(page, sampleA.players[0].name);
  await upload(page, sampleB);
  await noContent(page, sampleA.players[0].name);
  await club(page, orgA);
  await expect(page.locator('.player-table')).toContainText(sampleA.players[0].name);
  await noContent(page, sampleB.players[0].name); await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('[data-open="import-p01"]').first().click();
  await expect(page.locator('#dossier-dialog')).toBeVisible();
  await page.keyboard.press('Escape'); await club(page, orgB);
  await expect(page.locator('#dossier-dialog')).not.toBeVisible(); await expect(page.locator('#dossier-content')).toBeEmpty();
  await noContent(page, sampleA.players[0].name);
  passed('Two club imports reuse snapshot/player IDs without leakage; club switch clears old dossier DOM and separate decisions/tasks');

  await club(page, orgA);
  const delayedSwitch = await holdCatalog(page, orgA);
  await page.locator('#nav [data-view="import"]').click(); await delayedSwitch.captured;
  await club(page, orgB); await delayedSwitch.deliver();
  await page.locator('#nav [data-view="radar"]').click();
  await expect(page.locator('.player-table')).toContainText(sampleB.players[0].name); await noContent(page, sampleA.players[0].name);
  await club(page, orgA);
  const delayedLogout = await holdCatalog(page, orgA);
  await page.locator('#nav [data-view="import"]').click(); await delayedLogout.captured;
  await page.locator('#organization-bar [data-action="logout"]').click();
  await expect(page.locator('#auth-form')).toBeVisible(); await delayedLogout.deliver();
  await expect(page.locator('#auth-form')).toBeVisible(); await noContent(page, sampleA.players[0].name);
  await expect(page.locator('#dossier-content')).toBeEmpty(); await expect(page.locator('#import-jobs')).toHaveCount(0);
  await login(page, 'browserowner');
  passed('Real club-A catalog responses deliberately delayed past club switch and logout cannot repopulate another club or signed-out DOM');

  await club(page, orgA); await page.locator('#nav [data-view="account"]').click();
  await page.locator('#invite-form [name="role"]').selectOption('viewer');
  await page.locator('#invite-form [type="submit"]').click();
  await expect(page.locator('#invite-code')).toBeVisible(); const inviteCode = await page.locator('#invite-code').inputValue();
  await page.locator('#nav [data-view="radar"]').click();
  await expect(page.locator('#invite-code')).toHaveCount(0);
  viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  viewer = await viewerContext.newPage(); observe(viewer); await viewer.goto(base);
  await viewer.locator('[data-action="auth-mode"]').click();
  await viewer.locator('#auth-form [name="inviteToken"]').fill(inviteCode);
  await viewer.locator('#auth-form [name="displayName"]').fill('Synthetische lezer');
  await viewer.locator('#auth-form [name="username"]').fill('browserviewer');
  await viewer.locator('#auth-form [name="password"]').fill(PASSWORD);
  await viewer.locator('#auth-form [type="submit"]').click();
  await expect(viewer.locator('#organization-role')).toContainText('Alleen lezen');
  await viewer.locator('#dataset-select').selectOption('import');
  await expect(viewer.locator('[data-save="import-p01"]')).toBeDisabled();
  await viewer.locator('#nav [data-view="import"]').click(); await expect(viewer.locator('#import-file')).toBeDisabled();
  await viewer.locator('#nav [data-view="account"]').click(); await expect(viewer.locator('#invite-form')).toHaveCount(0);
  const viewerStatus = await viewer.evaluate(async ({ orgA, orgB }) => {
    const s = await (await fetch('/api/session')).json();
    const call = async (path, options = {}) => (await fetch(path, options)).status;
    return {
      missing: await call('/api/state'), other: await call('/api/catalog', { headers: { 'X-Omniscout-Organization': orgB } }),
      write: await call('/api/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Omniscout-Organization': orgA, 'X-Omniscout-CSRF': s.csrf }, body: JSON.stringify({ playerId: 'p01', action: 'follow', reason: 'positive' }) }),
      members: await call('/api/auth/members', { headers: { 'X-Omniscout-Organization': orgA } }),
      noCsrf: await call('/api/auth/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Should not exist' }) })
    };
  }, { orgA, orgB });
  assert.deepEqual(viewerStatus, { missing: 400, other: 403, write: 403, members: 403, noCsrf: 403 });
  passed('Second browser accepts owner-issued viewer invite; UI disables writes and HTTP rejects missing/other club, viewer writes/members and missing CSRF');

  await page.locator('#nav [data-view="account"]').click();
  await expect(page.locator('.members-table tbody tr')).toHaveCount(2);
  const viewerRow = page.locator('.members-table tbody tr').filter({ hasText: 'browserviewer' });
  await viewerRow.locator('[name="role"]').selectOption('scout'); await viewerRow.locator('[type="submit"]').click();
  await expect(page.locator('.members-table tbody tr').filter({ hasText: 'browserviewer' }).locator('[name="role"]')).toHaveValue('scout');
  await viewer.reload(); await expect(viewer.locator('#organization-role')).toContainText('Scout');
  await expect(viewer.locator('[data-save="import-p01"]')).toBeEnabled();
  await page.locator('.members-table tbody tr').filter({ hasText: 'browserviewer' }).locator('[name="role"]').selectOption('viewer');
  await page.locator('.members-table tbody tr').filter({ hasText: 'browserviewer' }).locator('[type="submit"]').click();
  await viewer.reload(); await expect(viewer.locator('#organization-role')).toContainText('Alleen lezen');
  await expect(viewer.locator('[data-save="import-p01"]')).toBeDisabled();
  passed('Owner role management changes actual scout/viewer authorization and refreshed UI controls');

  await page.locator('#password-form [name="currentPassword"]').fill(PASSWORD);
  await page.locator('#password-form [name="newPassword"]').fill(NEW_PASSWORD);
  await page.locator('#password-form [type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Wachtwoord gewijzigd');
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  for (const secret of [PASSWORD, NEW_PASSWORD, inviteCode, sampleA.players[0].name, 'club-A onderzoeksvraag']) assert.equal(storage.includes(secret), false);
  await page.screenshot({ path: join(reportDir, 'accounts-owner-desktop.png'), fullPage: true });
  await page.locator('#organization-bar [data-action="logout"]').click();
  await expect(page.locator('#auth-form[data-mode="login"]')).toBeVisible();
  await noContent(page, sampleA.players[0].name); await expect(page.locator('#organization-select')).toBeHidden();
  await page.locator('#auth-form [name="username"]').fill('browserowner'); await page.locator('#auth-form [name="password"]').fill(PASSWORD);
  await page.locator('#auth-form [type="submit"]').click(); await expect(page.locator('#auth-error')).toBeVisible();
  await login(page, 'browserowner', NEW_PASSWORD); await expect(page.locator('#shortlist-count')).toHaveText('1');
  passed('Password change invalidates old password; logout removes visible club data; new login restores backend state without secrets/imports in localStorage');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#nav [data-view="account"]').click();
  await expect(page.locator('#password-form')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(reportDir, 'accounts-mobile.png'), fullPage: true });
  await page.locator('#nav [data-view="radar"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(reportDir, 'accounts-mobile-import.png'), fullPage: true });
  passed('Account/club controls and imported radar fit a 390px mobile viewport');

  await stop(); await start();
  await page.reload(); await expect(page.locator('#auth-form[data-mode="login"]')).toBeVisible();
  await noContent(page, sampleA.players[0].name); await expect(page.locator('.player-table')).toHaveCount(0);
  await login(page, 'browserowner', NEW_PASSWORD);
  await expect(page.locator('#organization-select option')).toHaveCount(2);
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#nav [data-view="tasks"]').click(); await expect(page.locator('.task-card .status-tag')).toHaveText('Afgerond');
  await viewer.reload(); await expect(viewer.locator('#auth-form')).toBeVisible(); await login(viewer, 'browserviewer');
  await expect(viewer.locator('#organization-role')).toContainText('Alleen lezen');
  passed('Real server restart logs out both browsers while accounts, clubs, imports and completed research persist on disk');
  await page.locator('#nav [data-view="account"]').click();
  await expect(page.locator('.members-table tbody tr')).toHaveCount(2);
  await page.locator('.members-table tbody tr').filter({ hasText: 'browserviewer' }).locator('[data-remove-member]').click();
  await page.locator('#remove-member-form [type="submit"]').click();
  await expect(page.locator('.members-table tbody tr')).toHaveCount(1);
  await viewer.reload(); await expect(viewer.locator('#organization-select option')).toHaveText('Nog geen club');
  await expect(viewer.locator('.player-table')).toHaveCount(0); await noContent(viewer, sampleA.players[0].name);
  passed('Owner removal revokes the other browser club membership immediately; refreshed UI has no old catalog, dossier or club access');

  await stop();
  const legacyPath = join(temp, 'synthetic-legacy.json'), invalidLegacy = '{invalid synthetic legacy JSON';
  await writeFile(legacyPath, invalidLegacy);
  await start({ dataDir: join(temp, 'migration-case'), legacyStatePath: legacyPath });
  const recoveryContext = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const recovery = await recoveryContext.newPage(); observe(recovery); await recovery.goto(base);
  await expect(recovery.locator('#auth-form[data-mode="setup"]')).toBeVisible();
  await recovery.locator('#auth-form [name="displayName"]').fill('Synthetische herstelbeheerder');
  await recovery.locator('#auth-form [name="organizationName"]').fill('Fictieve herstelclub');
  await recovery.locator('#auth-form [name="username"]').fill('recoveryowner');
  await recovery.locator('#auth-form [name="password"]').fill(PASSWORD);
  await recovery.locator('#auth-form [type="submit"]').click();
  await expect(recovery.locator('#main')).toContainText('Clubgegevens konden niet worden geladen');
  await recovery.locator('#nav [data-view="account"]').click();
  await expect(recovery.locator('#migration-recovery')).toBeVisible();
  await expect(recovery.locator('#password-form')).toBeVisible();
  await expect(recovery.locator('.members-table tbody tr')).toHaveCount(1);
  await recovery.locator('[data-action="recover-migration"]').click();
  await expect(recovery.locator('#migration-status')).toContainText('Herstel nog niet voltooid');
  assert.equal(await readFile(legacyPath, 'utf8'), invalidLegacy);
  await recovery.screenshot({ path: join(reportDir, 'accounts-migration-recovery.png'), fullPage: true });
  const repaired = emptyState(); repaired.brief.task = 'Synthetische herstelde clubvraag uit de oude opslag.';
  const repairedBytes = JSON.stringify(repaired, null, 2) + '\n'; await writeFile(legacyPath, repairedBytes);
  await recovery.locator('[data-action="recover-migration"]').click();
  await expect(recovery.locator('#migration-status')).toContainText('De overname is voltooid');
  await expect(recovery.locator('#migration-recovery')).toHaveCount(0);
  await recovery.locator('#nav [data-view="brief"]').click();
  await expect(recovery.locator('#brief-form [name="task"]')).toHaveValue(repaired.brief.task);
  assert.equal(await readFile(legacyPath, 'utf8'), repairedBytes);
  passed('Corrupt legacy setup keeps owner/account/member management reachable; UI retries fail safely, then actual repaired source migrates without source-byte changes');
  await recoveryContext.close();
  assert.deepEqual(pageErrors, []); passed('No uncaught browser page errors in the complete native accounts workflow');
} catch (error) {
  const message = error.stack || error.message; errors.push(message); logs.push(`FAIL: ${message}`); console.error('FAIL:', message); process.exitCode = 1;
  await page?.screenshot({ path: join(reportDir, 'accounts-failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser?.close(); await stop();
  await writeFile(join(reportDir, 'browser-accounts.json'), JSON.stringify({ mode: 'native_browser_to_loopback_accounts_backend', executedAt: new Date().toISOString(), browser: process.env.BROWSER_CHANNEL || 'chromium', checks, errors, pageErrors, passed: !errors.length && !pageErrors.length }, null, 2) + '\n');
  await writeFile(join(reportDir, 'browser-accounts.txt'), logs.join('\n') + '\n');
  const target = resolve(temp); assert.ok(target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/'));
  await rm(target, { recursive: true, force: true });
}
