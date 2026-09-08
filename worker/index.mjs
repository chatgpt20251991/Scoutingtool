import { CATALOG } from '../src/fixtures.mjs';
import { findPlayers } from '../src/engine.mjs';
/** Deployable read-only synthetic demo. Not a live ingestion worker. No secrets or paid API calls. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Deze edge-demo is alleen-lezen. Productie-authenticatie en database moeten eerst worden gebouwd.' }, 501);
    if (url.pathname === '/api/health') return json({ ok: true, mode: 'synthetic_demo', liveSources: 0, persistence: 'none', productionReady: false });
    if (url.pathname === '/api/session') return json({ mode: 'synthetic_demo', readOnly: true, supportsImport: false, authenticated: false });
    if (url.pathname === '/api/catalog') return json(CATALOG);
    if (url.pathname === '/api/players') {
      const f = Object.fromEntries(url.searchParams);
      f.lowerOnly = f.lowerOnly === 'true'; f.newOnly = f.newOnly === 'true';
      return json({ asOf: CATALOG.asOf, mode: CATALOG.mode, results: findPlayers(CATALOG, f) });
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Geen lokale backend op deze edge-demo; browser-preview blijft beschikbaar.' }, 404);
    if (!env?.ASSETS) return json({ error: 'ASSETS-binding ontbreekt.' }, 503);
    const upstream = await env.ASSETS.fetch(request);
    const response = new Response(upstream.body, upstream);
    response.headers.set('X-Content-Type-Options', 'nosniff'); response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    return response;
  }
};
