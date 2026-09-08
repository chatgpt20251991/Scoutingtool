import test from 'node:test';
import assert from 'node:assert/strict';
import { createWikidataProvider, validatePublicProfiles } from '../src/providers/wikidata.mjs';
import { renderStandalone } from '../tools/standalone.mjs';

// Entirely invented API fixtures. These are not downloaded public player data.
const NOW = '2026-09-08T12:00:00.000Z';
const MODIFIED = '2026-09-01T00:00:00Z';
const PERSON = 'Q9000000001', TEAM = 'Q9000000091';
const item = id => ({ snaktype: 'value', datatype: 'wikibase-item', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id } } });
const time = (date, precision = 11) => ({ snaktype: 'value', datatype: 'time', datavalue: { type: 'time', value: { time: `+${date}T00:00:00Z`, precision, calendarmodel: 'http://www.wikidata.org/entity/Q1985727', timezone: 0, before: 0, after: 0 } } });
const claim = mainsnak => ({ rank: 'normal', mainsnak });
const person = (id = PERSON, dob = '2000-09-08') => ({ id, type: 'item', lastrevid: 900000001, modified: MODIFIED, labels: { en: { language: 'en', value: 'Invented review fixture' } }, claims: { P31: [claim(item('Q5'))], P106: [claim(item('Q937857'))], P569: [claim(time(dob))] } });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json; charset=utf-8' } });
const provider = fetchImpl => createWikidataProvider({ now: () => NOW, fetchImpl });
const load = entities => provider(async () => response({ entities })).load(Object.keys(entities));
function snapshot() {
  return { format: 'omniscout-public-profiles', version: 1, provider: 'wikidata', license: { name: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }, retrievedAt: NOW, requestedIds: [PERSON], excluded: [], warnings: [], profiles: [{ id: PERSON, name: 'Invented review fixture', dob: '2000-09-08', sourceUrl: `https://www.wikidata.org/wiki/${PERSON}`, revision: 900000001, revisionUrl: `https://www.wikidata.org/w/index.php?title=${PERSON}&oldid=900000001`, sourceModifiedAt: MODIFIED, retrievedAt: NOW, positions: [], teams: [], currentClub: null, competition: null, stats: { minutes: null, matches: null }, synthetic: false }] };
}

test('review: source requests cannot follow supplied URLs or smuggle search terms into API parameters', async () => {
  const calls = [], query = 'fixture&action=delete https://127.0.0.1/private';
  const source = provider(async (address, options) => {
    calls.push({ url: new URL(address), options });
    return response({ search: [{ id: PERSON, label: 'Invented result', description: '<script>external text</script>', url: 'https://127.0.0.1/private', concepturi: 'file:///private' }] });
  });
  const result = await source.search(query);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://www.wikidata.org');
  assert.equal(calls[0].url.pathname, '/w/api.php');
  assert.equal(calls[0].url.searchParams.get('action'), 'wbsearchentities');
  assert.equal(calls[0].url.searchParams.get('search'), query);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.match(calls[0].options.headers['user-agent'], /OmniScout.+github\.com/);
  assert.deepEqual(Object.keys(result.results[0]).sort(), ['description', 'id', 'label']);
  assert.equal(result.results[0].description, '<script>external text</script>');
});

test('review: invalid or sparse ID lists fail before any source request', async () => {
  let calls = 0;
  const source = provider(async () => { calls++; return response({ entities: {} }); });
  for (const ids of [[], Array(1), [PERSON, PERSON], [null], ['Q01'], ['https://example.org/Q1'], [PERSON, undefined], Array.from({ length: 11 }, (_, i) => `Q${i + 1}`)]) {
    await assert.rejects(source.load(ids), error => error.status === 400);
  }
  assert.equal(calls, 0);
});

test('review: unknown competition, club and performance never become zero or invented facts', async () => {
  const entity = person();
  entity.claims.P54 = [claim(item(TEAM))];
  entity.claims.P54[0].qualifiers = { P1129: [{ datavalue: { value: { amount: '+99' } } }], P1351: [{ datavalue: { value: { amount: '+18' } } }] };
  const source = provider(async address => {
    const requested = new URL(address).searchParams.get('ids');
    return response({ entities: requested === PERSON ? { [PERSON]: entity } : { [TEAM]: { id: TEAM, type: 'item', labels: { en: { language: 'en', value: 'Invented team' } } } } });
  });
  const result = await source.load([PERSON]);
  const profile = result.profiles[0];
  assert.equal(profile.currentClub, null);
  assert.equal(profile.competition, null);
  assert.deepEqual(profile.stats, { minutes: null, matches: null });
  assert.equal(profile.teams[0].start, null);
  assert.equal(profile.teams[0].end, null);
  assert.equal(profile.synthetic, false);
  assert.equal('score' in profile, false);
  assert.equal('season' in profile, false);
});

test('review: related-item identity mismatch never attaches another item label to the requested QID', async () => {
  const entity = person(); entity.claims.P54 = [claim(item(TEAM))];
  const source = provider(async address => response({ entities: new URL(address).searchParams.get('ids') === PERSON ? { [PERSON]: entity } : { [TEAM]: { id: 'Q9000000092', type: 'item', labels: { en: { language: 'en', value: 'Wrong source identity' } } } } }));
  try {
    const result = await source.load([PERSON]);
    assert.equal(result.profiles[0].teams[0].label, TEAM);
    assert.ok(result.warnings.length > 0);
  } catch (error) { if (error.status !== 503) throw error; }
});

test('review: impossible team intervals remain unknown and cannot enter a validated snapshot', async () => {
  const entity = person();
  entity.claims.P54 = [{ ...claim(item(TEAM)), qualifiers: { P580: [time('2025-00-00', 9)], P582: [time('2024-12-31')] } }];
  const source = provider(async address => response({ entities: new URL(address).searchParams.get('ids') === PERSON ? { [PERSON]: entity } : { [TEAM]: { id: TEAM, type: 'item', labels: { en: { language: 'en', value: 'Invented team' } } } } }));
  const result = await source.load([PERSON]), team = result.profiles[0].teams[0];
  assert.equal(team.start, null); assert.equal(team.end, null);
  assert.ok(result.warnings.some(value => /tegenstrijd|ongeldig|onmogelijk/i.test(value)));
  const bad = snapshot(); bad.profiles[0].teams = [{ id: TEAM, label: 'Invented team', start: '2025', end: '2024-12-31' }];
  assert.throws(() => validatePublicProfiles(bad), error => error.status === 400);
  const uncertain = snapshot(); uncertain.profiles[0].teams = [{ id: TEAM, label: 'Invented team', start: '2024-12-31', end: '2024' }];
  assert.doesNotThrow(() => validatePublicProfiles(uncertain));
});

test('review: exact adult birthday boundary and uncertain birth claims fail conservatively', async () => {
  const entities = {};
  const add = (index, change) => { const id = `Q90000000${String(index).padStart(2, '0')}`; const entry = person(id, '2008-09-08'); change?.(entry); entities[id] = entry; return id; };
  const adult = add(1), minor = add(2, e => e.claims.P569 = [claim(time('2008-09-09'))]);
  const yearOnly = add(3, e => e.claims.P569 = [claim(time('2000-00-00', 9))]);
  const julian = add(4, e => e.claims.P569[0].mainsnak.datavalue.value.calendarmodel = 'http://www.wikidata.org/entity/Q1985786');
  const conflict = add(5, e => e.claims.P569.push(claim(time('2000-09-08'))));
  const lowerBound = add(6, e => e.claims.P569[0].qualifiers = { P1319: [time('2008-09-09')] });
  const upperBound = add(7, e => e.claims.P569[0].qualifiers = { P1326: [time('2009-09-08')] });
  const disputed = add(8, e => e.claims.P569[0].qualifiers = { P1310: [item('Q9000000099')] });
  const approximate = add(9, e => e.claims.P569[0].qualifiers = { P1480: [item('Q5727902')] });
  const result = await load(entities);
  assert.deepEqual(result.profiles.map(p => p.id), [adult]);
  assert.deepEqual(new Set(result.excluded.map(p => p.id)), new Set([minor, yearOnly, julian, conflict, lowerBound, upperBound, disputed, approximate]));
});

test('review: malformed revision, false entity identity and unknown-valued DOB are excluded', async () => {
  const entities = {};
  for (const [index, change] of [e => e.modified = '2027-01-01T00:00:00Z', e => e.lastrevid = 1.5, e => e.id = TEAM, e => e.claims.P569[0].mainsnak.snaktype = 'somevalue', e => e.claims.P569[0].rank = 'deprecated'].entries()) {
    const id = `Q90000000${index + 20}`; entities[id] = person(id); change(entities[id]);
  }
  const result = await load(entities);
  assert.equal(result.profiles.length, 0); assert.equal(result.excluded.length, 5);
});

test('review: incomplete upstream batches fail instead of replacing valid profiles with an empty successful snapshot', async () => {
  const source = provider(async () => response({ entities: {} }));
  await assert.rejects(source.load([PERSON]), error => error.status === 503);
  const partial = provider(async () => response({ entities: { [PERSON]: person() } }));
  await assert.rejects(partial.load([PERSON, TEAM]), error => error.status === 503);
  const missing = provider(async () => response({ entities: { [PERSON]: { id: PERSON, missing: true } } }));
  const result = await missing.load([PERSON]);
  assert.equal(result.profiles.length, 0);
  assert.deepEqual(result.excluded.map(p => p.id), [PERSON]);
});

test('review: HTTP-200 API errors and rate limits do not become successful profiles or leaked messages', async () => {
  let calls = 0;
  const source = provider(async () => { calls++; return response({ error: { code: 'maxlag', info: 'private upstream detail' } }); });
  await assert.rejects(source.search('fixture'), error => error.status === 429 && error.retryAfterSeconds >= 1 && !error.message.includes('private upstream detail'));
  await assert.rejects(source.search('fixture'), error => error.status === 429);
  assert.equal(calls, 1);
  for (const value of [{ error: { code: 'unknown', info: 'private upstream detail' } }, [], { search: [{ id: PERSON, label: 'valid' }, { id: PERSON, label: 'duplicate' }] }]) {
    await assert.rejects(provider(async () => response(value)).search('fixture'), error => error.status === 503 && !error.message.includes('private upstream detail'));
  }
});

test('review: oversized chunk streams and malformed UTF-8 are stopped with sanitized errors', async () => {
  let cancelled = false, signal;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  const source = provider(async (_address, options) => { signal = options.signal; return new Response(body, { headers: { 'content-type': 'application/json' } }); });
  await assert.rejects(source.search('fixture'), error => error.status === 503);
  assert.equal(signal.aborted, true); assert.equal(cancelled, true);
  await assert.rejects(provider(async () => new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } })).search('fixture'), error => error.status === 503);
});

test('review: the fifteen-second deadline also stops transports or readers that ignore AbortSignal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const mode of ['fetch', 'reader']) {
      let entered = false, read = false, cancelled = false, signal;
      const source = provider(async (_address, options) => {
        entered = true; signal = options.signal;
        if (mode === 'fetch') return new Promise(() => {});
        return { status: 200, ok: true, headers: new Headers({ 'content-type': 'application/json' }), body: { getReader: () => ({ read: () => { read = true; return new Promise(() => {}); }, cancel: async () => { cancelled = true; } }) } };
      });
      const rejected = assert.rejects(source.search('fixture'), error => error.status === 503);
      await Promise.resolve();
      t.mock.timers.tick(0);
      for (let index = 0; index < 8; index++) await Promise.resolve();
      assert.equal(entered, true);
      if (mode === 'reader') assert.equal(read, true);
      t.mock.timers.tick(15000);
      await rejected;
      assert.equal(signal.aborted, true);
      if (mode === 'reader') assert.equal(cancelled, true);
    }
  } finally { t.mock.timers.reset(); }
});

test('review: validated snapshots reject forged facts, source links, dates, getters and prototype payloads', () => {
  const changes = [p => p.currentClub = 'Invented current club', p => p.competition = 'Invented competition', p => p.stats.minutes = 0, p => p.stats.matches = 0, p => p.stats.rating = 99, p => p.synthetic = true, p => p.sourceUrl = 'https://attacker.invalid/', p => p.revisionUrl += '&redirect=https://attacker.invalid/', p => p.revision = Number.MAX_SAFE_INTEGER + 1, p => p.dob = '2000-02-30', p => p.dob = '2015-01-01', p => p.sourceModifiedAt = '2027-01-01T00:00:00Z', p => p.positions = [{ id: TEAM, label: 'a' }, { id: TEAM, label: 'b' }]];
  for (const change of changes) { const value = snapshot(); change(value.profiles[0]); assert.throws(() => validatePublicProfiles(value), error => error.status === 400); }
  let invoked = false;
  const accessor = snapshot(); Object.defineProperty(accessor.profiles[0], 'name', { enumerable: true, get() { invoked = true; return 'executed'; } });
  assert.throws(() => validatePublicProfiles(accessor), error => error.status === 400); assert.equal(invoked, false);
  const poison = snapshot(); poison.profiles[0] = { ...poison.profiles[0], ...JSON.parse('{"__proto__":{"polluted":true}}') };
  assert.throws(() => validatePublicProfiles(poison), error => error.status === 400); assert.equal({}.polluted, undefined);
  const cyclic = snapshot(); cyclic.self = cyclic; assert.throws(() => validatePublicProfiles(cyclic), error => error.status === 400);
  const initial = snapshot(), checked = validatePublicProfiles(initial); checked.profiles[0].name = 'changed'; assert.equal(initial.profiles[0].name, 'Invented review fixture');
});

test('review: standalone profile embedding preserves hostile labels and replacement metacharacters as inert JSON', async () => {
  const value = snapshot();
  const hostile = '</ScRiPt><script>globalThis.fixturePwned=true</script><!-- & > ' + '$&' + '$' + String.fromCharCode(96) + "$'" + '$$' + '\u2028\u2029';
  value.profiles[0].name = hostile;
  value.warnings = [hostile];
  const html = await renderStandalone({ profiles: value });
  const assignment = html.indexOf('window.OMNI_PUBLIC_PROFILES = ');
  assert.ok(assignment >= 0);
  const start = assignment + 'window.OMNI_PUBLIC_PROFILES = '.length;
  const serialized = html.slice(start, html.indexOf(';\n', start));
  assert.deepEqual(JSON.parse(serialized), value);
  assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.equal((html.match(/<\/script\s*>/gi) || []).length, 1);
  assert.doesNotMatch(html, /<script>globalThis\.fixturePwned/);
});
