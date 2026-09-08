import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import edgeWorker from '../worker/index.mjs';

// Actual file navigation plus a local HTTP adapter around the edge handler.
// This does not exercise Wrangler/workerd or claim a Cloudflare deployment.
const require = createRequire(import.meta.url);
const playwrightPackage = process.env.OMNISCOUT_PLAYWRIGHT_PATH || process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = require(playwrightPackage);
const { expect } = require(`${playwrightPackage}/test`);
const root = fileURLToPath(new URL('../', import.meta.url));
const reports = resolve(process.env.OMNISCOUT_REPORT_DIR || resolve(root, 'reports/current'));
await mkdir(reports, { recursive: true });
const results = [], pageErrors = [], requests = [];
let browser, server;
function passed(name) { results.push({ test: name, status: 'passed' }); console.log(`PASS: ${name}`); }
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/modules/engine.mjs', ['modules/engine.mjs', 'text/javascript; charset=utf-8']],
  ['/modules/fixtures.mjs', ['modules/fixtures.mjs', 'text/javascript; charset=utf-8']]
]);
async function startEdgeAdapter() {
  server = http.createServer(async (req, res) => {
    try {
      const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers });
      const response = await edgeWorker.fetch(request, { ASSETS: { async fetch(assetRequest) {
        const asset = assets.get(new URL(assetRequest.url).pathname);
        if (!asset) return new Response('Not found', { status: 404 });
        return new Response(await readFile(resolve(root, 'dist', asset[0])), { headers: { 'content-type': asset[1] } });
      } } });
      requests.push({ method: req.method, path: req.url, status: response.status });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}
async function smoke(context, url, name) {
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push({ surface: name, message: error.message }));
  await page.goto(url);
  await expect(page.locator('#dataset-select')).toBeEnabled();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(12);
  await expect(page.locator('.demo-banner')).toContainText('Fictieve testomgeving');
  await expect(page.locator('.demo-banner')).toContainText('0 live databronnen');
  await expect(page.locator('#dataset-select')).toHaveValue('demo');
  await expect(page.locator('#dataset-select option[value="import"]')).toBeDisabled();
  passed(`${name}: 12 synthetic players and import dataset unavailable`);
  await page.locator('#nav [data-view="import"]').click();
  await expect(page.locator('#main')).toContainText('Start de lokale Node-app voor bronimport');
  await expect(page.locator('#import-file')).toHaveCount(0);
  await expect(page.locator('#import-confirm')).toHaveCount(0);
  passed(`${name}: import view explains Node requirement without upload/confirm controls`);
  await page.locator('#nav [data-view="radar"]').click();
  await page.locator('[data-save="p01"]').click();
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#nav [data-view="shortlist"]').click();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#shortlist-count')).toHaveText('1');
  await page.locator('#nav [data-view="shortlist"]').click();
  await expect(page.locator('.player-table tbody tr')).toHaveCount(1);
  passed(`${name}: shortlist actions and browser persistence survive reload`);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: mobile page overflow`);
  await page.locator('#nav [data-view="import"]').click();
  await expect(page.locator('#main')).toContainText('Start de lokale Node-app');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: mobile import page overflow`);
  await page.screenshot({ path: resolve(reports, `offline-${name}-mobile.png`), fullPage: true });
  passed(`${name}: 390px mobile shortlist/import have no page overflow`);
  return page;
}
try {
  browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL || process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.BROWSER_CHANNEL || process.env.PLAYWRIGHT_CHANNEL } : {}), headless: true });
  const standalone = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await smoke(standalone, pathToFileURL(resolve(root, 'OmniScout-preview.html')).href, 'standalone');
  await standalone.close();
  const base = await startEdgeAdapter();
  const edgeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const edgePage = await smoke(edgeContext, base, 'edge-handler');
  const api = await edgePage.evaluate(async () => {
    const catalogResponse = await fetch('/api/catalog?dataset=import');
    const catalog = await catalogResponse.json();
    const importResponse = await fetch('/api/import/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return { catalogMode: catalog.mode, count: catalog.players.length, mutationStatus: importResponse.status, mutation: await importResponse.json() };
  });
  assert.equal(api.catalogMode, 'synthetic_demo'); assert.equal(api.count, 12);
  assert.equal(api.mutationStatus, 501); assert.match(api.mutation.error, /alleen-lezen/);
  passed('edge-handler: synthetic-only catalog and import mutation rejected with HTTP 501');
  assert.deepEqual(pageErrors, []);
  passed('standalone and edge-handler: no browser JavaScript page errors');
} catch (error) {
  results.push({ test: 'smoke execution', status: 'failed', error: error.stack || error.message });
  console.error(error.stack || error.message); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  const report = { at: new Date().toISOString(), browser: 'Playwright Chromium channel msedge, headless', mode: 'actual file:// navigation and local HTTP adapter for edge handler; no Cloudflare runtime/deployment', results, pageErrors, requests };
  await writeFile(resolve(reports, 'offline-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${results.filter(result => result.status === 'passed').length} passed; ${results.filter(result => result.status === 'failed').length} failed`);
}
