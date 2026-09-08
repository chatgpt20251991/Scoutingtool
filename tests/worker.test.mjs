import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
test('edge health never claims to be a live ingestion worker', async () => { const r = await worker.fetch(new Request('https://demo.example/api/health'), {}); const data = await r.json(); assert.equal(data.liveSources, 0); assert.equal(data.persistence, 'none'); });
test('edge demo refuses writes until production state and auth exist', async () => { const r = await worker.fetch(new Request('https://demo.example/api/tasks', { method: 'POST' }), {}); assert.equal(r.status, 501); });
test('edge filters the same fixture engine as the local version', async () => { const r = await worker.fetch(new Request('https://demo.example/api/players?quality=exploration'), {}); assert.equal((await r.json()).results.length, 4); });
test('edge missing asset bindings fail visibly', async () => { const r = await worker.fetch(new Request('https://demo.example/'), {}); assert.equal(r.status, 503); });
test('edge asset responses have security headers', async () => { const r = await worker.fetch(new Request('https://demo.example/'), { ASSETS: { fetch: async () => new Response('<h1>test</h1>') } }); assert.equal(r.status, 200); assert.equal(r.headers.get('X-Frame-Options'), 'DENY'); });
