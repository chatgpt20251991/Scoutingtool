const API = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'OmniScout/0.5 (+https://github.com/chatgpt20251991/Scoutingtool)';
const MAX_BODY = 8 * 1024 * 1024;
const QID = /^Q[1-9][0-9]{0,11}$/;
const LICENSE = Object.freeze({ name: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' });
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const unavailable = () => fail(503, 'Wikidata is niet beschikbaar of gaf een ongeldig antwoord. Probeer later opnieuw.', { code: 'WIKIDATA_UNAVAILABLE' });
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const abort = () => { reject(unavailable()); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function text(value, max, allowEmpty = false) {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0) && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function qid(value) { return typeof value === 'string' && QID.test(value); }
function timestamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z'); }
function currentTime(now) {
  const value = now();
  const iso = value instanceof Date ? value.toISOString() : value;
  if (!timestamp(iso)) throw fail(500, 'Ongeldige klok voor openbare profielen.');
  return iso;
}
function calendarDate(value, partial = false) {
  if (typeof value !== 'string' || !(partial ? /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/ : /^\d{4}-\d{2}-\d{2}$/).test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))) return false;
  if (day === undefined) return true;
  const date = new Date(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function ageAt(dob, at) {
  const date = at.slice(0, 10), year = Number(date.slice(0, 4)) - Number(dob.slice(0, 4));
  return year - (date.slice(5) < dob.slice(5) ? 1 : 0);
}
function idsInput(ids) {
  const invalid = () => { throw fail(400, 'Kies 1 tot 10 unieke Wikidata-ID’s in de vorm Q123.'); };
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(ids);
  if (Reflect.ownKeys(descriptors).length !== ids.length + 1) invalid();
  const values = [];
  for (let index = 0; index < ids.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !qid(descriptor.value)) invalid();
    values.push(descriptor.value);
  }
  if (new Set(values).size !== values.length) invalid();
  return values;
}
function exact(value, keys) { return plain(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
function impossiblePeriod(start, end) {
  if (start === null || end === null) return false;
  const earliest = start.length === 4 ? `${start}-01-01` : start.length === 7 ? `${start}-01` : start;
  const [year, month] = end.split('-').map(Number);
  const monthDays = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const latest = end.length === 4 ? `${end}-12-31` : end.length === 7 ? `${end}-${monthDays[month - 1]}` : end;
  return earliest > latest;
}

/** Strict data validation, not HTML escaping: render returned source text with textContent. */
export function validatePublicProfiles(input) {
  let nodes = 0, chars = 0;
  const seen = new WeakSet();
  function clone(value, depth = 0) {
    if (++nodes > 20000 || depth > 12) throw fail(400, 'Ongeldige of te grote openbare profielkopie.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') { chars += value.length; if (chars > 1024 * 1024) throw fail(400, 'Openbare profielkopie is te groot.'); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || seen.has(value) || (!Array.isArray(value) && !plain(value))) throw fail(400, 'Ongeldige openbare profielkopie.');
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(descriptors[key], 'value'))) throw fail(400, 'Onveilige openbare profielkopie.');
    let result;
    if (Array.isArray(value)) {
      if (value.length > 200 || keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) || Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(descriptors, index))) throw fail(400, 'Ongeldige lijst in openbare profielkopie.');
      result = Array.from({ length: value.length }, (_, index) => clone(descriptors[index].value, depth + 1));
    } else {
      result = {};
      for (const key of keys) { if (!descriptors[key].enumerable) throw fail(400, 'Ongeldig verborgen profielveld.'); result[key] = clone(descriptors[key].value, depth + 1); }
    }
    seen.delete(value);
    return result;
  }
  const state = clone(input), invalid = () => { throw fail(400, 'Ongeldig openbaar profielschema of onveilige herkomst.'); };
  if (!exact(state, ['format', 'version', 'provider', 'license', 'retrievedAt', 'requestedIds', 'profiles', 'excluded', 'warnings']) || state.format !== 'omniscout-public-profiles' || state.version !== 1 || state.provider !== 'wikidata'
    || !exact(state.license, ['name', 'url']) || state.license.name !== LICENSE.name || state.license.url !== LICENSE.url || !timestamp(state.retrievedAt)) invalid();
  idsInput(state.requestedIds);
  if (!Array.isArray(state.profiles) || state.profiles.length > 10 || !Array.isArray(state.excluded) || state.excluded.length > 10 || !Array.isArray(state.warnings) || state.warnings.length > 100 || state.warnings.some(value => !text(value, 500))) invalid();
  const accounted = [];
  for (const p of state.profiles) {
    if (!exact(p, ['id', 'name', 'dob', 'sourceUrl', 'revisionUrl', 'revision', 'sourceModifiedAt', 'retrievedAt', 'positions', 'teams', 'currentClub', 'competition', 'stats', 'synthetic']) || !qid(p.id) || !text(p.name, 240) || !calendarDate(p.dob)
      || ageAt(p.dob, state.retrievedAt) < 18 || ageAt(p.dob, state.retrievedAt) > 100 || p.sourceUrl !== `https://www.wikidata.org/wiki/${p.id}` || !Number.isSafeInteger(p.revision) || p.revision < 1
      || p.revisionUrl !== `https://www.wikidata.org/w/index.php?title=${p.id}&oldid=${p.revision}` || !timestamp(p.sourceModifiedAt) || Date.parse(p.sourceModifiedAt) > Date.parse(state.retrievedAt)
      || p.retrievedAt !== state.retrievedAt || p.currentClub !== null || p.competition !== null || p.synthetic !== false || !exact(p.stats, ['minutes', 'matches']) || p.stats.minutes !== null || p.stats.matches !== null
      || !Array.isArray(p.positions) || p.positions.length > 5 || !Array.isArray(p.teams) || p.teams.length > 10) invalid();
    if (p.positions.some(item => !exact(item, ['id', 'label']) || !qid(item.id) || !text(item.label, 240)) || new Set(p.positions.map(item => item.id)).size !== p.positions.length) invalid();
    for (const team of p.teams) if (!exact(team, ['id', 'label', 'start', 'end']) || !qid(team.id) || !text(team.label, 240) || (team.start !== null && !calendarDate(team.start, true)) || (team.end !== null && !calendarDate(team.end, true)) || impossiblePeriod(team.start, team.end)) invalid();
    if (new Set(p.teams.map(item => JSON.stringify([item.id, item.start, item.end]))).size !== p.teams.length) invalid();
    accounted.push(p.id);
  }
  for (const item of state.excluded) {
    if (!exact(item, ['id', 'reason']) || !qid(item.id) || !text(item.reason, 500)) invalid();
    accounted.push(item.id);
  }
  if (accounted.length !== state.requestedIds.length || new Set(accounted).size !== accounted.length || accounted.some(id => !state.requestedIds.includes(id))) invalid();
  return state;
}

function statements(entity, property) {
  const values = entity.claims[property];
  return Array.isArray(values) ? values.filter(value => plain(value) && ['normal', 'preferred'].includes(value.rank)) : [];
}
function entityValue(snak) {
  const value = snak?.datavalue?.value;
  return snak?.snaktype === 'value' && snak.datatype === 'wikibase-item' && snak.datavalue.type === 'wikibase-entityid' && value?.['entity-type'] === 'item' && qid(value.id) ? value.id : null;
}
function timeValue(snak, dayOnly = false) {
  const value = snak?.datavalue?.value;
  if (snak?.snaktype !== 'value' || snak.datatype !== 'time' || snak.datavalue.type !== 'time' || !plain(value) || !['http://www.wikidata.org/entity/Q1985727', 'https://www.wikidata.org/entity/Q1985727'].includes(value.calendarmodel)
    || !Number.isInteger(value.precision) || (dayOnly ? value.precision !== 11 : ![9, 10, 11].includes(value.precision)) || (value.before ?? 0) !== 0 || (value.after ?? 0) !== 0 || (value.timezone ?? 0) !== 0
    || typeof value.time !== 'string' || !/^\+\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(value.time)) return null;
  const date = value.time.slice(1, 11).slice(0, value.precision === 9 ? 4 : value.precision === 10 ? 7 : 10);
  return calendarDate(date, !dayOnly) ? date : null;
}
function labelFor(entity, id, warnings) {
  for (const key of ['nl', 'en']) {
    const label = entity?.labels?.[key];
    if (entity?.id === id && entity.type === 'item' && entity.missing === undefined && plain(label) && text(label.value, 240) && text(label.language, 35)) return label.value;
  }
  warnings.push(`${id}: geen bruikbaar Nederlands of Engels label beschikbaar; het bron-ID wordt getoond.`);
  return id;
}
function qualifyDate(statement, property, id, warnings) {
  const qualifiers = statement.qualifiers?.[property];
  if (qualifiers === undefined) return null;
  if (!Array.isArray(qualifiers) || qualifiers.length === 0) { warnings.push(`${id}: ongeldige teamdatum blijft onbekend.`); return null; }
  const dates = qualifiers.map(value => timeValue(value));
  if (dates.some(value => value === null) || new Set(dates).size !== 1) { warnings.push(`${id}: onzekere of tegenstrijdige teamdatum blijft onbekend.`); return null; }
  return dates[0];
}
function buildProfile(entity, id, retrievedAt, warnings) {
  if (!plain(entity) || entity.missing !== undefined || entity.id !== id || entity.type !== 'item' || !plain(entity.claims)) return { reason: 'Bronitem ontbreekt of is geen bruikbaar Wikidata-item.' };
  if (!statements(entity, 'P31').some(claim => entityValue(claim.mainsnak) === 'Q5')) return { reason: 'Geen directe, niet-verouderde verklaring dat dit een mens is.' };
  if (!statements(entity, 'P106').some(claim => entityValue(claim.mainsnak) === 'Q937857')) return { reason: 'Geen directe, niet-verouderde verklaring van het beroep voetballer.' };
  const births = statements(entity, 'P569');
  if (births.length === 0) return { reason: 'Geboortedatum ontbreekt; volwassen leeftijd niet vastgesteld.' };
  const dates = births.map(claim => ['P1480', 'P1319', 'P1326', 'P1310'].some(key => claim.qualifiers?.[key] !== undefined) ? null : timeValue(claim.mainsnak, true));
  if (dates.some(date => date === null) || new Set(dates).size !== 1) return { reason: 'Geboortedatum is onvolledig, onzeker, tegenstrijdig of niet Gregoriaans.' };
  const dob = dates[0], age = ageAt(dob, retrievedAt);
  if (age < 18 || age > 100) return { reason: 'Leeftijd valt buiten de toegestane band van 18 tot en met 100 jaar.' };
  if (!Number.isSafeInteger(entity.lastrevid) || entity.lastrevid < 1 || !timestamp(entity.modified) || Date.parse(entity.modified) > Date.parse(retrievedAt)) return { reason: 'Controleerbare revisie of bronwijzigingsdatum ontbreekt.' };
  const positions = [...new Set(statements(entity, 'P413').map(claim => entityValue(claim.mainsnak)).filter(Boolean))];
  const teams = [], seen = new Set();
  for (const claim of statements(entity, 'P54')) {
    const team = entityValue(claim.mainsnak);
    if (!team) continue;
    let start = qualifyDate(claim, 'P580', id, warnings), end = qualifyDate(claim, 'P582', id, warnings);
    if (impossiblePeriod(start, end)) { start = null; end = null; warnings.push(`${id}: teamperiode heeft tegenstrijdige begin- en einddatums; beide blijven onbekend.`); }
    const key = JSON.stringify([team, start, end]);
    if (!seen.has(key)) { seen.add(key); teams.push({ id: team, label: team, start, end }); }
  }
  if (positions.length > 5) warnings.push(`${id}: meer dan vijf positieclaims; alleen de eerste vijf worden getoond.`);
  if (teams.length > 10) warnings.push(`${id}: meer dan tien teamclaims; alleen de eerste tien worden getoond.`);
  return { profile: { id, name: labelFor(entity, id, warnings), dob, sourceUrl: `https://www.wikidata.org/wiki/${id}`, revisionUrl: `https://www.wikidata.org/w/index.php?title=${id}&oldid=${entity.lastrevid}`, revision: entity.lastrevid,
    sourceModifiedAt: entity.modified, retrievedAt, positions: positions.slice(0, 5).map(position => ({ id: position, label: position })), teams: teams.slice(0, 10), currentClub: null, competition: null, stats: { minutes: null, matches: null }, synthetic: false } };
}

export function createWikidataProvider({ fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw new TypeError('Een fetch-functie en klokfunctie zijn vereist.');
  let serial = Promise.resolve(), pending = 0, lastRequest = 0, retryUntil = 0;
  function backoff(response, fallback = 60) {
    const header = response.headers.get('retry-after');
    let seconds = header && /^\d+$/.test(header.trim()) ? Number(header) : header && Number.isFinite(Date.parse(header)) ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : fallback;
    if (!Number.isFinite(seconds) || seconds < 1) seconds = fallback;
    seconds = Math.min(seconds, Math.floor((Number.MAX_SAFE_INTEGER - Date.now()) / 1000));
    retryUntil = Math.max(retryUntil, Date.now() + seconds * 1000);
    return fail(429, 'Wikidata vraagt een wachttijd. Er is niets automatisch opnieuw geprobeerd.', { code: 'WIKIDATA_BACKOFF', retryAfterSeconds: seconds });
  }
  async function request(parameters) {
    if (Date.now() < retryUntil) throw fail(429, 'Wikidata-wachttijd is nog actief. Probeer later opnieuw.', { code: 'WIKIDATA_BACKOFF', retryAfterSeconds: Math.ceil((retryUntil - Date.now()) / 1000) });
    await pause(Math.max(0, 1000 - (Date.now() - lastRequest)));
    const url = new URL(API);
    for (const [key, value] of Object.entries({ format: 'json', formatversion: '2', maxlag: '5', ...parameters })) url.searchParams.set(key, value);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    let reader;
    try {
      lastRequest = Date.now();
      const response = await withAbort(fetchImpl(url.href, { method: 'GET', headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), controller.signal);
      if (controller.signal.aborted) throw unavailable();
      if (response.status === 429) throw backoff(response);
      if (!response.ok) { if (response.status === 503 && response.headers.get('retry-after')) throw backoff(response, 5); throw unavailable(); }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) throw unavailable();
      const length = response.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) throw unavailable();
      if (!response.body || typeof response.body.getReader !== 'function') throw unavailable();
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true }); let body = '', bytes = 0;
      while (true) {
        const { done, value } = await withAbort(reader.read(), controller.signal);
        if (controller.signal.aborted) throw unavailable();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY) throw unavailable();
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      const result = JSON.parse(body);
      if (!plain(result)) throw unavailable();
      if (result.error) { if (result.error.code === 'maxlag' || result.error.code === 'ratelimited') throw backoff(response, 5); throw unavailable(); }
      return result;
    } catch (error) {
      controller.abort();
      reader?.cancel().catch(() => {});
      if (error?.code === 'WIKIDATA_BACKOFF') throw error;
      throw unavailable();
    } finally { clearTimeout(timer); }
  }
  function run(operation) {
    if (pending >= 4) return Promise.reject(fail(429, 'Er lopen al vier Wikidata-bewerkingen. Probeer later opnieuw.', { retryAfterSeconds: 1 }));
    pending += 1;
    const result = serial.then(operation);
    serial = result.catch(() => {});
    return result.finally(() => { pending -= 1; });
  }
  return {
    search(query) {
      if (!text(query, 120) || query.trim().length < 2) return Promise.reject(fail(400, 'Geef een zoekterm van 2 tot 120 tekens.'));
      return run(async () => {
        const data = await request({ action: 'wbsearchentities', search: query.trim(), language: 'nl', uselang: 'nl', type: 'item', limit: '10' });
        if (!Array.isArray(data.search) || data.search.length > 10) throw unavailable();
        const results = [], ids = new Set();
        for (const item of data.search) {
          if (!plain(item) || !qid(item.id) || !text(item.label, 240) || (item.description !== undefined && !text(item.description, 500, true)) || ids.has(item.id)) throw unavailable();
          ids.add(item.id); results.push({ id: item.id, label: item.label, description: item.description || '' });
        }
        return { results, provider: 'wikidata' };
      });
    },
    load(ids) {
      let requestedIds;
      try { requestedIds = idsInput(ids); } catch (error) { return Promise.reject(error); }
      return run(async () => {
        const data = await request({ action: 'wbgetentities', ids: requestedIds.join('|'), props: 'labels|claims|info', languages: 'nl|en', languagefallback: '1' });
        if (!plain(data.entities) || requestedIds.some(id => !Object.hasOwn(data.entities, id))) throw unavailable();
        const primaryAt = currentTime(now), preliminary = [], warnings = [];
        for (const id of requestedIds) {
          const result = buildProfile(data.entities[id], id, primaryAt, []);
          if (result.profile) preliminary.push(result.profile);
        }
        const related = [...new Set(preliminary.flatMap(profile => [...profile.positions, ...profile.teams].map(item => item.id)))];
        if (related.length > 100) warnings.push('Meer dan 100 gerelateerde bronitems: overige team- en positielabels blijven als bron-ID zichtbaar.');
        const labels = {};
        for (let index = 0; index < Math.min(related.length, 100); index += 50) {
          const batch = related.slice(index, Math.min(index + 50, 100));
          const resolved = await request({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels|info', languages: 'nl|en', languagefallback: '1' });
          if (!plain(resolved.entities) || batch.some(id => !Object.hasOwn(resolved.entities, id))) throw unavailable();
          for (const id of batch) labels[id] = labelFor(resolved.entities[id], id, warnings);
        }
        // Label fetches take time. Recheck age/revision against the final capture
        // timestamp instead of attaching an earlier time to a completed snapshot.
        const retrievedAt = currentTime(now), profiles = [], excluded = [];
        for (const id of requestedIds) {
          const result = buildProfile(data.entities[id], id, retrievedAt, warnings);
          if (result.profile) profiles.push(result.profile); else excluded.push({ id, reason: result.reason });
        }
        for (const profile of profiles) for (const item of [...profile.positions, ...profile.teams]) {
          item.label = labels[item.id] || item.id;
          if (!Object.hasOwn(labels, item.id) && !related.includes(item.id)) warnings.push(`${item.id}: label niet opgehaald; het bron-ID wordt getoond.`);
        }
        const boundedWarnings = [...new Set(warnings)];
        if (boundedWarnings.length > 100) boundedWarnings.splice(99, Infinity, 'Verdere bronwaarschuwingen zijn wegens de weergavelimiet samengevoegd.');
        return validatePublicProfiles({ format: 'omniscout-public-profiles', version: 1, provider: 'wikidata', license: { ...LICENSE }, retrievedAt, requestedIds, profiles, excluded, warnings: boundedWarnings });
      });
    }
  };
}
