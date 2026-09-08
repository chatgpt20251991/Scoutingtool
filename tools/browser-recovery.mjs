/** Native browser -> real loopback account API -> encrypted synthetic club backups. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/server.mjs';
import { openBackup } from '../src/backup/crypto.mjs';

const require = createRequire(import.meta.url), packagePath = process.env.OMNISCOUT_PLAYWRIGHT_PATH || 'playwright';
const { chromium } = require(packagePath), { expect } = require(join(packagePath, 'test'));
const reports = resolve('reports/v0.4'), temp = await mkdtemp(join(tmpdir(), 'omniscout-recovery-browser-'));
await mkdir(reports, { recursive: true });
const sample = JSON.parse(await readFile(new URL('../samples/import-demo.json', import.meta.url), 'utf8'));
sample.players[0].name = 'Synthetisch herstelprofiel';
const PASSWORD = 'Synthetic recovery login 2026!', PASSPHRASE = 'Synthetic encrypted backup phrase 2026!';
const BASELINE = 'SYNTHETIC BASELINE RESEARCH NOTE', CHANGED = 'SYNTHETIC LATER RESEARCH NOTE';
const checks = [], errors = [], pageErrors = [], logs = [], evidence = {};
let app, browser, context, page, readerContext, reader, base, organizationA, organizationB;
const passed = name => { checks.push(name); logs.push(`PASS: ${name}`); console.log('PASS:', name); };
const observe = target => target.on('pageerror', error => pageErrors.push(error.message));
async function screenshot(target, filename) {
  await target.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await target.screenshot({ path: join(reports, filename), fullPage: true, maskColor: '#26384b', mask: [target.locator('input[type="password"]'), target.locator('[name="inviteToken"]'), target.locator('#invite-code'), target.locator('#backup-file')] });
}
async function account(target) { await target.locator('#nav [data-view="account"]').click(); await expect(target.locator('#invite-preview-form [name="inviteToken"]')).toBeEnabled(); }
async function club(target, id) { await target.locator('#organization-select').selectOption(id); await expect(target.locator('#organization-select')).toBeEnabled(); await expect(target.locator('#organization-select')).toHaveValue(id); }
async function session(target) { return target.evaluate(async () => (await fetch('/api/session')).json()); }
async function login(target, username) {
  await expect(target.locator('#auth-form')).toBeVisible();
  await target.locator('#auth-form [name="username"]').fill(username); await target.locator('#auth-form [name="password"]').fill(PASSWORD);
  await target.locator('#auth-form [type="submit"]').click(); await expect(target.locator('#organization-select')).toBeVisible(); await expect(target.locator('#dataset-select')).toBeEnabled();
}
async function invitation(role) {
  await page.locator('#invite-form [name="role"]').selectOption(role);
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/invites');
  await page.locator('#invite-form [type="submit"]').click(); assert.equal((await response).status(), 201);
  await expect(page.locator('#invite-code')).toBeVisible(); return page.locator('#invite-code').inputValue();
}
async function preview(target, bytes, passphrase = PASSPHRASE) {
  await expect(target.locator('#backup-file')).toBeEnabled();
  await target.locator('#backup-file').setInputFiles({ name: 'synthetic-test.osbackup', mimeType: 'application/json', buffer: Buffer.from(bytes) });
  await target.locator('#backup-preview-form [name="passphrase"]').fill(passphrase);
  const response = target.waitForResponse(result => new URL(result.url()).pathname === '/api/backup/preview' && result.request().method() === 'POST');
  await target.locator('#backup-preview-form [type="submit"]').click(); return response;
}
async function activeState() { return app.organizationManager.capture(organizationA); }
async function accept(target, token) {
  await expect(target.locator('#invite-preview-form [name="inviteToken"]')).toBeEnabled();
  await target.locator('#invite-preview-form [name="inviteToken"]').fill(token);
  const response = target.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/invite-preview');
  await target.locator('#invite-preview-form [type="submit"]').click(); assert.equal((await response).status(), 200); await expect(target.locator('#invite-accept-form')).toBeVisible();
}
try {
  app = await createApp({ dataDir: temp }); await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
  base = `http://127.0.0.1:${app.server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); observe(page); await page.goto(base);
  await expect(page.locator('#auth-form[data-mode="setup"]')).toBeVisible();
  await page.locator('#auth-form [name="displayName"]').fill('Synthetische back-upbeheerder');
  await page.locator('#auth-form [name="organizationName"]').fill('Synthetische Club Alpha');
  await page.locator('#auth-form [name="username"]').fill('recoveryowner');
  await page.locator('#auth-form [name="password"]').fill(PASSWORD); await page.locator('#auth-form [type="submit"]').click();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(12); organizationA = await page.locator('#organization-select').inputValue();
  await page.locator('[data-save="p01"]').click(); await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#nav [data-view="import"]').click();
  await page.locator('#import-file').setInputFiles({ name: 'synthetic-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) });
  await expect(page.locator('#import-confirm-form')).toBeVisible(); await page.locator('#import-confirm-check').check();
  await page.locator('#import-confirm-form [type="submit"]').click(); await expect(page.locator('#import-jobs')).toContainText('Geslaagd');
  await page.locator('#nav [data-view="radar"]').click(); await page.locator('[data-save="import-p01"]').click();
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#nav [data-view="brief"]').click(); await page.locator('#brief-form [name="task"]').fill(BASELINE);
  await page.locator('#brief-form [type="submit"]').click(); await expect(page.locator('#toast')).toContainText('Clubvraag opgeslagen'); await account(page);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#backup-create-form [name="passphrase"]').fill(PASSPHRASE); await page.locator('#backup-create-form [type="submit"]').click();
  const downloaded = await downloadPromise; assert.match(downloaded.suggestedFilename(), /\.osbackup$/);
  const encryptedBytes = await readFile(await downloaded.path(), 'utf8'), envelope = JSON.parse(encryptedBytes);
  assert.equal(envelope.format, 'omniscout-encrypted');
  for (const secret of [PASSPHRASE, BASELINE, sample.players[0].name, 'Synthetische Club Alpha']) assert.equal(encryptedBytes.includes(secret), false);
  const bundle = await openBackup(envelope, PASSPHRASE);
  assert.equal(bundle.organization.id, organizationA); assert.equal(bundle.state.decisions.length, 1); assert.equal(bundle.state.importWorkspace.decisions.length, 1);
  assert.equal(bundle.state.importWorkspace.brief.task, BASELINE); assert.equal('users' in bundle.state, false);
  await expect(page.locator('#backup-create-form [name="passphrase"]')).toHaveValue('');
  passed('Actual .osbackup download is authenticated encryption without plaintext club metadata; decrypts to the selected club with both demo/import research and no accounts');

  const beforePreview = await activeState();
  let response = await preview(page, encryptedBytes, 'Wrong synthetic backup phrase 2026!'); assert.equal(response.status(), 400);
  await expect(page.locator('#backup-error')).toBeVisible(); await expect(page.locator('#backup-restore-form')).toHaveCount(0);
  assert.equal((await activeState()).digest, beforePreview.digest);
  await page.locator('#backup-file').setInputFiles({ name: 'broken.osbackup', mimeType: 'application/json', buffer: Buffer.from('{not valid JSON') });
  await page.locator('#backup-preview-form [name="passphrase"]').fill(PASSPHRASE); await page.locator('#backup-preview-form [type="submit"]').click();
  await expect(page.locator('#backup-error')).toContainText('geen geldig JSON'); assert.equal((await activeState()).digest, beforePreview.digest);
  response = await preview(page, encryptedBytes); assert.equal(response.status(), 200);
  await expect(page.locator('#backup-restore-form')).toBeVisible(); await expect(page.locator('#backup-preview-form [name="passphrase"]')).toHaveValue('');
  assert.equal(await page.locator('#backup-file').evaluate(input => input.files.length), 0);
  assert.equal((await activeState()).digest, beforePreview.digest);
  await page.locator('#backup-restore-form [type="submit"]').click();
  assert.equal((await activeState()).digest, beforePreview.digest); await expect(page.locator('#backup-restore-check')).not.toBeChecked();
  await screenshot(page, 'recovery-preview-desktop.png');
  passed('Wrong passphrase and malformed file fail visibly without writes; valid preview clears file/password and unconfirmed restore preserves current state');

  const otherTab = await context.newPage(); observe(otherTab); await otherTab.goto(base);
  await expect(otherTab.locator('#dataset-select')).toHaveValue('import'); await otherTab.locator('#nav [data-view="brief"]').click();
  await otherTab.locator('#brief-form [name="task"]').fill(CHANGED); await otherTab.locator('#brief-form [type="submit"]').click();
  await expect(otherTab.locator('#toast')).toContainText('Clubvraag opgeslagen'); const changedState = await activeState();
  const staleResponse = page.waitForResponse(result => new URL(result.url()).pathname === '/api/backup/restore');
  await page.locator('#backup-restore-check').check(); await page.locator('#backup-restore-form [type="submit"]').click();
  assert.equal((await staleResponse).status(), 409); await expect(page.locator('#backup-error')).toBeVisible();
  await expect(page.locator('#backup-restore-form')).toHaveCount(0); assert.equal((await activeState()).digest, changedState.digest); await otherTab.close();
  passed('A real edit from another browser tab makes an old restore preview stale; HTTP 409 preserves the newer research state');

  response = await preview(page, encryptedBytes); assert.equal(response.status(), 200); await expect(page.locator('#backup-restore-form')).toBeVisible();
  const restoreResponse = page.waitForResponse(result => new URL(result.url()).pathname === '/api/backup/restore');
  await page.locator('#backup-restore-check').check(); await page.locator('#backup-restore-form [type="submit"]').click();
  const restored = await (await restoreResponse).json(); assert.equal(restored.restored, true);
  await expect(page.locator('#recovery-message')).toContainText('Clubgegevens hersteld');
  assert.equal((await activeState()).state.importWorkspace.brief.task, BASELINE);
  const previousCopy = JSON.parse(await readFile(join(temp, 'organizations', organizationA, 'recovery', `${restored.recoveryId}.json`), 'utf8'));
  assert.equal(previousCopy.state.importWorkspace.brief.task, CHANGED);
  assert.equal((await app.organizationManager.stats(organizationA)).counts.recoveryCopies, 1);
  assert.equal((await session(page)).organizations.find(org => org.id === organizationA).role, 'owner');
  passed('Explicit restore replaces scouting state, retains account roles and writes a durable private previous-state copy containing the replaced research');

  const retentionBefore = await activeState(); const retentionResponse = page.waitForResponse(result => new URL(result.url()).pathname === '/api/retention/preview');
  await page.locator('#retention-form [name="days"]').fill('1'); await page.locator('#retention-form [name="days"]').press('Enter');
  const retention = await (await retentionResponse).json(); evidence.retentionCounts = retention.counts;
  assert.equal(retention.destructive, false); assert.equal(retention.days, 1); assert.equal(retention.counts.returnedItems, retention.items.length);
  assert.ok(retention.items.length <= 200); assert.equal((await activeState()).digest, retentionBefore.digest);
  await expect(page.locator('#retention-report')).toContainText('niets verwijderd');
  await screenshot(page, 'recovery-retention-desktop.png');
  passed('Keyboard-submitted retention report returns actual bounded counts/dependencies and leaves the entire persisted state unchanged');

  const viewerCode = await invitation('viewer');
  readerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } }); reader = await readerContext.newPage(); observe(reader); await reader.goto(base);
  await reader.locator('[data-action="auth-mode"]').click();
  await reader.locator('#auth-form [name="inviteToken"]').fill(viewerCode); await reader.locator('#auth-form [name="displayName"]').fill('Synthetische bestaande scout');
  await reader.locator('#auth-form [name="username"]').fill('existingreader'); await reader.locator('#auth-form [name="password"]').fill(PASSWORD);
  await reader.locator('#auth-form [type="submit"]').click(); await expect(reader.locator('#organization-role')).toContainText('Alleen lezen'); await account(reader);
  await expect(reader.locator('#backup-panel')).toHaveCount(0); await expect(reader.locator('#retention-panel')).toHaveCount(0);
  const denied = await reader.evaluate(async org => {
    const s = await (await fetch('/api/session')).json(), headers = { 'X-Omniscout-Organization': org, 'X-Omniscout-CSRF': s.csrf, 'Content-Type': 'application/json' };
    const results = [];
    for (const path of ['/api/backup/create', '/api/backup/preview', '/api/backup/restore']) results.push((await fetch(path, { method: 'POST', headers, body: '{}' })).status);
    results.push((await fetch('/api/retention/preview?days=1', { headers })).status); return results;
  }, organizationA); assert.deepEqual(denied, [403, 403, 403, 403]);
  passed('Viewer account has no backup/retention controls and real HTTP rejects create, preview, restore and retention access');

  await page.locator('#organization-form [name="name"]').fill('Synthetische Club Beta'); await page.locator('#organization-form [type="submit"]').click();
  await expect(page.locator('#organization-select option')).toHaveCount(2); await expect(page.locator('#organization-select')).toBeEnabled();
  organizationB = await page.locator('#organization-select').inputValue(); assert.notEqual(organizationA, organizationB);
  response = await preview(page, encryptedBytes); assert.ok([400, 403, 409].includes(response.status()));
  await expect(page.locator('#backup-restore-form')).toHaveCount(0);
  assert.equal((await app.organizationManager.capture(organizationB)).state.decisions.length, 0);
  passed('The downloaded Alpha backup cannot be previewed/restored into Beta; the other club remains empty');

  const joinCode = await invitation('scout');
  await expect(page.locator('#outstanding-invitations li')).toHaveCount(1);
  assert.equal((await page.locator('#outstanding-invitations').textContent()).includes(joinCode), false);
  await accept(reader, joinCode); await expect(reader.locator('#invite-accept-form')).toContainText('Synthetische Club Beta');
  assert.equal((await session(reader)).organizations.length, 1);
  await reader.locator('#invite-accept-check').focus(); await reader.locator('#invite-accept-check').press('Space');
  await reader.locator('#invite-accept-form [type="submit"]').press('Enter');
  await expect(reader.locator('#organization-select option')).toHaveCount(2); await expect(reader.locator('#organization-select')).toHaveValue(organizationB);
  await expect(reader.locator('#organization-role')).toContainText('Scout'); await expect(reader.locator('#backup-panel')).toHaveCount(0);
  await page.locator('[data-action="account-refresh"]').click(); await expect(page.locator('#outstanding-invitations li')).toHaveCount(0);
  const elevationCode = await invitation('owner'); await accept(reader, elevationCode);
  await expect(reader.locator('#invite-accept-form')).toContainText('bestaande rol blijft behouden');
  await reader.locator('#invite-accept-check').check(); await reader.locator('#invite-accept-form [type="submit"]').click();
  await expect(reader.locator('#recovery-message')).toContainText('bestaande clubrol is behouden');
  assert.equal((await session(reader)).organizations.find(org => org.id === organizationB).role, 'scout');
  passed('Existing account previews club/role without joining, explicitly joins Beta, and an owner invitation cannot elevate its existing scout membership');

  const revokedCode = await invitation('viewer'); await expect(page.locator('#outstanding-invitations li')).toHaveCount(1);
  await page.locator('[data-revoke-invitation]').click(); await page.locator('#revoke-invitation-form [type="submit"]').click();
  await expect(page.locator('#outstanding-invitations li')).toHaveCount(0); await expect(page.locator('#recovery-message')).toContainText('ingetrokken');
  await reader.locator('#invite-preview-form [name="inviteToken"]').fill(revokedCode); await reader.locator('#invite-preview-form [type="submit"]').click();
  await expect(reader.locator('#invite-accept-form')).toHaveCount(0); await expect(reader.locator('.recovery-section .import-error')).toBeVisible();
  passed('Outstanding invitations show no raw codes; owner revocation prevents preview/acceptance by an existing account');

  await club(page, organizationA);
  response = await preview(page, encryptedBytes); assert.equal(response.status(), 200); await expect(page.locator('#backup-preview')).toBeVisible();
  await page.locator('#nav [data-view="radar"]').click(); await account(page); await expect(page.locator('#backup-preview')).toHaveCount(0);
  response = await preview(page, encryptedBytes); assert.equal(response.status(), 200); await expect(page.locator('#backup-preview')).toBeVisible();
  await club(page, organizationB); await expect(page.locator('#backup-preview')).toHaveCount(0);
  assert.equal(await page.locator('#backup-file').evaluate(input => input.files.length), 0);
  await expect(page.locator('#backup-preview-form [name="passphrase"]')).toHaveValue('');
  await club(page, organizationA); response = await preview(page, encryptedBytes); assert.equal(response.status(), 200);
  const lastPreviewId = (await response.json()).previewId;
  await page.locator('#organization-bar [data-action="logout"]').click(); await expect(page.locator('#auth-form')).toBeVisible();
  await expect(page.locator('#backup-preview')).toHaveCount(0); await expect(page.locator('#dossier-content')).toBeEmpty();
  assert.equal((await page.locator('body').textContent()).includes(BASELINE), false);
  await login(page, 'recoveryowner'); await account(page);
  const replay = await page.evaluate(async ({ organization, previewId }) => {
    const s = await (await fetch('/api/session')).json();
    return (await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Omniscout-Organization': organization, 'X-Omniscout-CSRF': s.csrf }, body: JSON.stringify({ previewId, confirm: true }) })).status;
  }, { organization: organizationA, previewId: lastPreviewId }); assert.equal(replay, 409);
  const browserStorage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  for (const secret of [PASSWORD, PASSPHRASE, BASELINE, sample.players[0].name, viewerCode, joinCode, elevationCode, revokedCode, envelope.ciphertext.slice(0, 48)]) assert.equal(browserStorage.includes(secret), false);
  passed('Navigation, club switch and logout clear file/passphrase/preview DOM; logout also prevents preview replay and browser storage contains no codes, backups or research');

  await page.setViewportSize({ width: 390, height: 844 }); await account(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot(page, 'recovery-mobile.png');
  await expect(page.locator('#backup-create-form [type="submit"]')).toBeVisible();
  assert.deepEqual(pageErrors, []); passed('Recovery/account forms fit 390px, native keyboard actions work and no uncaught browser JavaScript errors occurred');
} catch (error) {
  const message = error.stack || error.message; errors.push(message); logs.push(`FAIL: ${message}`); console.error('FAIL:', message); process.exitCode = 1;
  await screenshot(page, 'recovery-failure.png').catch(() => {});
} finally {
  await browser?.close(); await app?.close();
  const result = { mode: 'native_browser_to_loopback_recovery_api', executedAt: new Date().toISOString(), browser: process.env.BROWSER_CHANNEL || 'chromium', checks, errors, pageErrors, evidence, passed: !errors.length && !pageErrors.length };
  await writeFile(join(reports, 'browser-recovery.json'), JSON.stringify(result, null, 2) + '\n'); await writeFile(join(reports, 'browser-recovery.txt'), logs.join('\n') + '\n');
  const target = resolve(temp); assert.ok(target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/')); await rm(target, { recursive: true, force: true });
}
