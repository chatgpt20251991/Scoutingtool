import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikidataProvider, validatePublicProfiles } from '../src/providers/wikidata.mjs';

// Entirely synthetic ActionAPI responses. Tests never call a live network.
const NOW = '2026-09-08T12:00:00.000Z';
const json = (data, options = {}) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' }, ...options });
const ref = id => ({ snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id, 'numeric-id': Number(id.slice(1)) } } });
const date = (value, precision = 11, extra = {}) => ({ snaktype: 'value', datatype: 'time', datavalue: { type: 'time', value: { time: `+${value}T00:00:00Z`, precision, before: 0, after: 0, timezone: 0, calendarmodel: 'http://www.wikidata.org/entity/Q1985727', ...extra } } });
const claim = (mainsnak, extra = {}) => ({ rank: 'normal', mainsnak, ...extra });
function entity(id = 'Q1001', dob = '2000-01-02') {
  return { id, type: 'item', labels: { nl: { language: 'nl', value: `FICTIEVE testspeler ${id}` } }, lastrevid: 123456, modified: '2026-09-07T10:00:00Z', claims: { P31: [claim(ref('Q5'))], P106: [claim(ref('Q937857'))], P569: [claim(date(dob))] } };
}
function provider(entities, extra = {}) { return createWikidataProvider({ now: () => NOW, fetchImpl: async () => json({ entities }), ...extra }); }

test('search uses the fixed encoded ActionAPI request and safe bounded fields', async () => {
  let calls = 0;
  const p = createWikidataProvider({ fetchImpl: async (target, options) => {
    calls++; const url = new URL(target);
    assert.equal(url.origin + url.pathname, 'https://www.wikidata.org/w/api.php');
    assert.equal(url.searchParams.get('search'), 'FICTIEF & ? https://other.invalid');
    assert.equal(url.searchParams.get('action'), 'wbsearchentities'); assert.equal(url.searchParams.get('maxlag'), '5');
    assert.equal(url.searchParams.get('limit'), '10'); assert.equal(url.searchParams.get('language'), 'nl');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.match(options.headers['user-agent'], /^OmniScout\/0\.5 \(\+https:\/\/github.com\/chatgpt20251991\/Scoutingtool\)$/);
    assert.ok(options.signal instanceof AbortSignal);
    return json({ search: [{ id: 'Q1001', label: 'FICTIEVE naam', description: 'FICTIEVE bronomschrijving', url: 'https://ignored.invalid' }] });
  } });
  for (const bad of ['', 'a', 'x'.repeat(121), '\nquery', null, ['query']]) await assert.rejects(p.search(bad), e => e.status === 400);
  assert.equal(calls, 0);
  assert.deepEqual(await p.search(' FICTIEF & ? https://other.invalid '), { provider: 'wikidata', results: [{ id: 'Q1001', label: 'FICTIEVE naam', description: 'FICTIEVE bronomschrijving' }] });
});

test('adult profile preserves revision, partial team dates and null unknowns; requests are spaced', async () => {
  const item = entity(), times = [];
  item.labels = { nl: { language: 'mul', 'for-language': 'nl', value: 'FICTIEVE gedeelde naam' } };
  item.claims.P413 = [claim(ref('Q2001'))];
  item.claims.P54 = [claim(ref('Q3001'), { rank: 'preferred', qualifiers: { P580: [date('2019-00-00', 9)], P582: [date('2022-03-00', 10)] } }), claim(ref('Q3002'))];
  const p = provider({}, { fetchImpl: async target => {
    times.push(Date.now()); const url = new URL(target);
    assert.equal(url.searchParams.get('languagefallback'), '1'); assert.equal(url.searchParams.get('languages'), 'nl|en');
    if (times.length === 1) { assert.equal(url.searchParams.get('props'), 'labels|claims|info'); return json({ entities: { Q1001: item } }); }
    assert.equal(url.searchParams.get('props'), 'labels|info');
    return json({ entities: { Q2001: { id: 'Q2001', type: 'item', labels: { en: { language: 'en', value: 'FICTIEVE positie' } } }, Q3001: { id: 'Q3001', type: 'item', labels: { nl: { language: 'nl', value: 'FICTIEF team' } } }, Q3002: { id: 'Q3002', type: 'item', labels: {} } } });
  } });
  const snapshot = await p.load(['Q1001']), player = snapshot.profiles[0];
  assert.ok(times[1] - times[0] >= 950, `Request spacing was ${times[1] - times[0]} ms`);
  assert.equal(player.name, 'FICTIEVE gedeelde naam'); assert.equal(player.synthetic, false);
  assert.equal(player.sourceUrl, 'https://www.wikidata.org/wiki/Q1001'); assert.equal(player.revisionUrl, 'https://www.wikidata.org/w/index.php?title=Q1001&oldid=123456');
  assert.deepEqual(player.stats, { minutes: null, matches: null }); assert.equal(player.currentClub, null); assert.equal(player.competition, null);
  assert.deepEqual(player.positions, [{ id: 'Q2001', label: 'FICTIEVE positie' }]);
  assert.deepEqual(player.teams, [{ id: 'Q3001', label: 'FICTIEF team', start: '2019', end: '2022-03' }, { id: 'Q3002', label: 'Q3002', start: null, end: null }]);
  assert.equal(snapshot.warnings.length, 1); assert.equal(snapshot.license.name, 'CC0-1.0');
  assert.deepEqual(validatePublicProfiles(snapshot), snapshot);
});

test('birthday boundary excludes minors, future dates and age 101, but accepts 18 and 100', async () => {
  const entities = { Q1001: entity('Q1001', '2008-09-08'), Q1002: entity('Q1002', '2008-09-09'), Q1003: entity('Q1003', '1926-09-08'), Q1004: entity('Q1004', '1925-09-08'), Q1005: entity('Q1005', '2030-01-01') };
  const snapshot = await provider(entities).load(Object.keys(entities));
  assert.deepEqual(snapshot.profiles.map(p => p.id), ['Q1001', 'Q1003']);
  assert.deepEqual(snapshot.excluded.map(p => p.id), ['Q1002', 'Q1004', 'Q1005']);
});

test('final retrieval timestamp follows all label requests and age is rechecked at completion', async () => {
  let clock = '2026-09-08T23:59:59.000Z';
  const entities = { Q1001: entity(), Q1002: entity('Q1002', '1925-09-09') };
  for (const item of Object.values(entities)) item.claims.P413 = [claim(ref('Q2001'))];
  const p = provider({}, { now: () => clock, fetchImpl: async target => {
    if (new URL(target).searchParams.get('props').includes('claims')) return json({ entities });
    clock = '2026-09-09T00:00:01.000Z';
    return json({ entities: { Q2001: { id: 'Q2001', type: 'item', labels: { en: { language: 'en', value: 'FICTIEVE positie' } } } } });
  } });
  const snapshot = await p.load(['Q1001', 'Q1002']);
  assert.equal(snapshot.retrievedAt, clock); assert.equal(snapshot.profiles[0].retrievedAt, clock);
  assert.deepEqual(snapshot.profiles.map(item => item.id), ['Q1001']); assert.deepEqual(snapshot.excluded.map(item => item.id), ['Q1002']);
});

test('DOB rejects partial, invalid, Julian, uncertain and conflicting claims; deprecated conflicts are ignored', async () => {
  const entities = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`Q${1001 + i}`, entity(`Q${1001 + i}`)]));
  entities.Q1001.claims.P569 = [claim(date('2000-00-00', 9))];
  entities.Q1002.claims.P569 = [claim(date('2000-02-30'))];
  entities.Q1003.claims.P569 = [claim(date('2000-01-02', 11, { calendarmodel: 'http://www.wikidata.org/entity/Q1985786' }))];
  entities.Q1004.claims.P569.push(claim(date('2001-01-02')));
  entities.Q1005.claims.P569[0].qualifiers = { P1480: [ref('Q5727902')] };
  entities.Q1006.claims.P569 = [claim({ snaktype: 'somevalue', datatype: 'time' })];
  entities.Q1007.claims.P569 = [claim(date('2000-01-02', 11, { before: 1 }))];
  entities.Q1008.claims.P569.push(claim(date('2001-01-02'), { rank: 'deprecated' }));
  entities.Q1009.claims.P569.push(claim(date('2000-01-02'), { rank: 'preferred' }));
  const snapshot = await provider(entities).load(Object.keys(entities));
  assert.deepEqual(snapshot.profiles.map(p => p.id), ['Q1008', 'Q1009']); assert.equal(snapshot.excluded.length, 7);
});

test('human, direct football occupation and source revision are required; missing entities are explicit exclusions', async () => {
  const entities = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Q${1001 + i}`, entity(`Q${1001 + i}`)]));
  entities.Q1001.claims.P31 = []; entities.Q1002.claims.P106 = [claim(ref('Q123'))]; entities.Q1003.claims.P106[0].rank = 'deprecated';
  entities.Q1004.lastrevid = '123456'; entities.Q1005.modified = '2026-09-09T00:00:00Z';
  entities.Q1006 = { id: 'Q1006', missing: true };
  const snapshot = await provider(entities).load(Object.keys(entities));
  assert.equal(snapshot.profiles.length, 0); assert.equal(snapshot.excluded.length, 6);
  assert.ok(snapshot.excluded.every(item => item.reason.length > 0));
});

test('positions and teams are bounded, related labels use at most 100 IDs in batches of 50', async () => {
  const entities = {}, batches = [];
  for (let i = 0; i < 10; i++) {
    const id = `Q${1001 + i}`, e = entity(id);
    e.claims.P413 = Array.from({ length: 6 }, (_, j) => claim(ref(`Q${20000 + i * 100 + j}`)));
    e.claims.P54 = Array.from({ length: 11 }, (_, j) => claim(ref(`Q${30000 + i * 100 + j}`)));
    entities[id] = e;
  }
  const snapshot = await provider({}, { fetchImpl: async target => {
    const url = new URL(target); if (url.searchParams.get('props').includes('claims')) return json({ entities });
    const ids = url.searchParams.get('ids').split('|'); batches.push(ids);
    return json({ entities: Object.fromEntries(ids.map(id => [id, { id, type: 'item', labels: { en: { language: 'en', value: `FICTIEF label ${id}` } } }])) });
  } }).load(Object.keys(entities));
  assert.deepEqual(batches.map(ids => ids.length), [50, 50]); assert.equal(new Set(batches.flat()).size, 100);
  assert.ok(snapshot.profiles.every(p => p.positions.length === 5 && p.teams.length === 10));
  assert.ok(snapshot.warnings.some(value => value.includes('100'))); assert.ok(snapshot.warnings.some(value => value.includes('vijf'))); assert.ok(snapshot.warnings.some(value => value.includes('tien')));
  assert.equal(snapshot.profiles.at(-1).teams.at(-1).label, snapshot.profiles.at(-1).teams.at(-1).id);
});

test('source errors, non-JSON, malformed JSON and UTF-8, large bodies and malformed search fail visibly', async () => {
  const cases = [
    () => new Response('blocked', { status: 403 }), () => new Response('<html>no</html>', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }), () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024 + 1) } }),
    () => new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    () => json({ search: [{ id: 'Q0', label: 'FICTIEF' }] }), () => json({ search: [{ id: 'Q1001', label: 'FICTIEF', description: {} }] }),
    () => json({ error: { code: 'badvalue', info: 'SENSITIVE upstream text must not be returned' } }),
    () => { throw new Error('SENSITIVE fetch failure'); }
  ];
  for (const fetchImpl of cases) {
    const p = createWikidataProvider({ fetchImpl });
    await assert.rejects(p.search('FICTIEF'), e => e.status === 503 && e.code === 'WIKIDATA_UNAVAILABLE' && !e.message.includes('SENSITIVE'));
  }
  await assert.rejects(provider({}, { fetchImpl: async () => json({ entities: [] }) }).load(['Q1001']), e => e.status === 503);
});

test('429 and HTTP-200 maxlag produce visible Retry-After backoff with no automatic retry', async () => {
  for (const factory of [() => new Response('', { status: 429, headers: { 'retry-after': '60' } }), () => json({ error: { code: 'maxlag' } })]) {
    let calls = 0; const p = createWikidataProvider({ fetchImpl: async () => { calls++; return factory(); } });
    await assert.rejects(p.search('FICTIEF'), e => e.status === 429 && e.retryAfterSeconds >= 5);
    await assert.rejects(p.search('FICTIEF'), e => e.status === 429 && e.retryAfterSeconds >= 1);
    assert.equal(calls, 1);
  }
});

test('only four operations are accepted and upstream requests remain sequential', async () => {
  let release, active = 0, peak = 0, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const p = createWikidataProvider({ fetchImpl: async () => {
    calls++; active++; peak = Math.max(peak, active); if (calls === 1) await gate;
    active--; return json({ search: [] });
  } });
  const waiting = Array.from({ length: 4 }, () => p.search('FICTIEF'));
  await assert.rejects(p.search('FICTIEF'), e => e.status === 429);
  release(); const results = await Promise.all(waiting);
  assert.equal(calls, 4); assert.equal(peak, 1); assert.ok(results.every(result => result.results.length === 0));
});

test('QIDs are strict, unique and bounded before any network request', async () => {
  let calls = 0; const p = createWikidataProvider({ fetchImpl: async () => { calls++; return json({}); } });
  for (const ids of [[], ['Q0'], ['Q01'], ['q123'], ['Q123/../../'], ['Q1234567890123'], ['Q1', 'Q1'], Array.from({ length: 11 }, (_, i) => `Q${i + 1}`), 'Q1', [1], [null]]) await assert.rejects(p.load(ids), e => e.status === 400);
  assert.equal(calls, 0);
});

test('snapshot validator rejects forged data, provenance, type confusion and unsafe objects and returns a clone', async () => {
  const original = await provider({ Q1001: entity() }).load(['Q1001']);
  const cloned = validatePublicProfiles(original); cloned.profiles[0].name = 'changed'; assert.notEqual(original.profiles[0].name, 'changed');
  const changes = [s => { s.private = 'secret'; }, s => { s.profiles[0].synthetic = true; }, s => { s.profiles[0].currentClub = 'Q1'; }, s => { s.profiles[0].stats.minutes = 0; }, s => { s.profiles[0].competition = {}; },
    s => { s.profiles[0].sourceUrl = 'javascript:alert(1)'; }, s => { s.profiles[0].revisionUrl += '&redirect=https://other.invalid'; }, s => { s.profiles[0].revision = '123456'; }, s => { s.profiles[0].sourceModifiedAt = '2027-01-01T00:00:00Z'; },
    s => { s.profiles[0].dob = '2010-01-01'; }, s => { s.profiles[0].retrievedAt = '2026-09-07T00:00:00Z'; }, s => { s.requestedIds.push('Q1002'); }, s => { s.excluded.push({ id: 'Q1001', reason: 'duplicate' }); },
    s => { s.license.url = 'https://other.invalid'; }, s => { s.profiles[0].name = {}; }, s => { s.profiles[0].positions = [{ id: 'Q1', label: 'ok', externalUrl: 'https://other.invalid' }]; }];
  for (const change of changes) { const input = structuredClone(original); change(input); assert.throws(() => validatePublicProfiles(input), e => e.status === 400); }
  let read = false; const getter = structuredClone(original); Object.defineProperty(getter, 'secret', { enumerable: true, get() { read = true; return 'secret'; } });
  assert.throws(() => validatePublicProfiles(getter), e => e.status === 400); assert.equal(read, false);
  const cycle = structuredClone(original); cycle.loop = cycle; assert.throws(() => validatePublicProfiles(cycle), e => e.status === 400);
  const dangerous = JSON.parse(JSON.stringify(original).replace('"format":', '"__proto__":{},"format":')); assert.throws(() => validatePublicProfiles(dangerous), e => e.status === 400);
  const sparse = structuredClone(original); sparse.requestedIds = new Array(1); sparse.requestedIds[2] = 'Q1001'; assert.throws(() => validatePublicProfiles(sparse), e => e.status === 400);
});
