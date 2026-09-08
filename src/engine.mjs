/** Deterministic, explainable research rules. No trained talent model or LLM calls. */
export const ROLE_LABELS = Object.freeze({ GK: 'Keeper', CB: 'Centrale verdediger', FB: 'Vleugelverdediger', CM: 'Middenvelder', W: 'Buitenspeler', ST: 'Spits' });
export const ACTION_LABELS = Object.freeze({ follow: 'Volgen', video: 'Video onderzoeken', live: 'Live observeren', verify: 'Informatie controleren', archive: 'Niet prioriteren' });
export const REASON_LABELS = Object.freeze({ evidence: 'Bewijs ontbreekt', role: 'Rol past niet', budget: 'Budget / beschikbaarheid', positive: 'Interessant voor vervolg', other: 'Andere reden' });
export const COVERAGE_FIELDS = Object.freeze(['results', 'lineups', 'minutes', 'playerStats', 'events', 'tracking', 'video']);
export const COVERAGE_LABELS = Object.freeze({ results: 'Uitslagen', lineups: 'Opstellingen', minutes: 'Minuten', playerStats: 'Spelerstats', events: 'Events', tracking: 'Tracking', video: 'Video' });
export const COVERAGE_STATES = Object.freeze({ available: 'Beschikbaar', partial: 'Gedeeltelijk', not_connected: 'Niet aangesloten', unavailable: 'Niet beschikbaar bij deze bron', unknown: 'Onbekend', not_in_license: 'Niet in licentie', delayed: 'Vertraagd' });
const DAY = 86400000;
export const numeric = value => typeof value === 'number' && Number.isFinite(value);
export const per90 = (value, minutes) => numeric(value) && value >= 0 && numeric(minutes) && minutes > 0 ? value * 90 / minutes : null;
export const percentage = (part, total) => numeric(part) && numeric(total) && total > 0 && part >= 0 && part <= total ? 100 * part / total : null;
export const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function ageOn(dob, asOf) {
  if (!validDate(dob) || !validDate(asOf)) return null;
  const d = new Date(dob), n = new Date(asOf);
  if (d > n) return null;
  return n.getUTCFullYear() - d.getUTCFullYear() - (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate()) ? 1 : 0);
}
export function sourceAllowed(source, asOf, use = 'analysis') {
  if (!source || !validDate(asOf) || !['synthetic', 'approved'].includes(source.status)) return false;
  if (!source.allowedUses?.includes(use) || !validDate(source.validFrom) || new Date(source.validFrom) > new Date(asOf)) return false;
  return source.expiresAt === null || (validDate(source.expiresAt) && new Date(source.expiresAt) > new Date(asOf));
}
export function visibleAt(record, asOf) {
  return !!record && validDate(asOf) && ['eventAt', 'availableAt', 'retrievedAt'].every(k => validDate(record[k]) && Date.parse(record[k]) <= Date.parse(asOf)) && Date.parse(record.availableAt) >= Date.parse(record.retrievedAt) && (record.publishedAt == null || (validDate(record.publishedAt) && Date.parse(record.publishedAt) <= Date.parse(record.availableAt)));
}
export function identityKey(record) {
  if (!record?.provider || !record?.providerId) throw new Error('Provider en provider-ID zijn vereist; namen worden niet automatisch samengevoegd.');
  return JSON.stringify([record.provider, record.providerId]);
}
export function freshness(lastReceivedAt, asOf, maxDays = 14) {
  if (!validDate(lastReceivedAt) || !validDate(asOf)) return 'unknown';
  const delta = Date.parse(asOf) - Date.parse(lastReceivedAt);
  return delta < 0 ? 'future' : delta > maxDays * DAY ? 'stale' : 'current';
}
export function minutesChange(player, asOf) {
  const r = player.recent, p = player.previous;
  if (!visibleAt(r, asOf) || !visibleAt(p, asOf) || r.definition !== p.definition || r.coverageVersion !== p.coverageVersion || r.matches !== p.matches || !numeric(r.minutes) || !numeric(p.minutes) || r.minutes < 0 || p.minutes < 0) return null;
  return r.minutes - p.minutes;
}
const ROLE_RULES = Object.freeze({
  GK: { metric: 'savePct', label: 'Reddingen', threshold: 72, unit: '%', question: 'Beoordeel positionering en besluitvorming bij hoge ballen in twee volledige wedstrijden. Het reddingspercentage corrigeert niet voor schotkwaliteit.' },
  CB: { metric: 'interceptions90', label: 'Intercepties', threshold: 1.8, unit: '/90', question: 'Beoordeel de startpositie en het verdedigen van ruimte achter de laatste lijn in twee volledige wedstrijden.' },
  FB: { metric: 'carries90', label: 'Progressieve dribbels', threshold: 3.4, unit: '/90', question: 'Onderzoek de keuzes in balbezit én de positie direct na balverlies in twee volledige wedstrijden.' },
  CM: { metric: 'progressive90', label: 'Progressieve passes', threshold: 5, unit: '/90', question: 'Bekijk of voorwaartse passing ook onder directe druk lukt. De huidige telgegevens meten druk niet.' },
  W: { metric: 'chances90', label: 'Gecreëerde kansen', threshold: 1.7, unit: '/90', question: 'Bekijk zowel geslaagde als mislukte acties en beoordeel keuzes zonder bal in twee volledige wedstrijden.' },
  ST: { metric: 'npg90', label: 'Goals zonder penalty', threshold: 0.38, unit: '/90', question: 'Onderzoek vrijlopen en bijdrage zonder bal. Goals alleen onderbouwen geen geschiktheid voor een hoger niveau.' }
});
export function buildDossier(player, catalog, asOf = catalog.asOf) {
  if (!player) return null;
  const source = catalog.sources.find(s => s.id === player.sourceId);
  const competition = catalog.competitions.find(c => c.id === player.competitionId);
  const age = ageOn(player.dob, asOf);
  if (age === null || age < 18 || !sourceAllowed(source, asOf) || !sourceAllowed(source, asOf, 'display') || !visibleAt(player, asOf)) return null;
  const active = visibleAt(player.stats, asOf);
  const s = active ? player.stats : {};
  const minutes = numeric(s.minutes) && s.minutes >= 0 ? s.minutes : null;
  const matches = numeric(s.matches) && s.matches >= 0 ? s.matches : null;
  const metrics = {
    progressive90: per90(s.progressivePasses, minutes), interceptions90: per90(s.interceptions, minutes),
    carries90: per90(s.progressiveCarries, minutes), chances90: per90(s.chancesCreated, minutes),
    npg90: per90(s.nonPenaltyGoals, minutes), savePct: percentage(s.saves, s.shotsOnTarget),
    passPct: percentage(s.passesCompleted, s.passesAttempted), duelPct: percentage(s.duelsWon, s.duelsTotal)
  };
  const rule = ROLE_RULES[player.role];
  const fresh = freshness(competition?.lastReceivedAt, asOf);
  const sampleEnough = minutes !== null && minutes >= 450 && matches !== null && matches >= 5;
  const evidence = (player.evidence || []).filter(e => visibleAt(e, asOf) && sourceAllowed(catalog.sources.find(x => x.id === e.sourceId), asOf, 'display'));
  const quality = sampleEnough && rule && numeric(metrics[rule.metric]) && fresh === 'current' ? 'documented' : 'exploration';
  const signals = [];
  if (rule && numeric(metrics[rule.metric]) && metrics[rule.metric] >= rule.threshold) signals.push({ type: 'role', title: `${rule.label} valt op binnen de testregel`, detail: `Drempel ${rule.threshold}${rule.unit}; demonstratieregel, niet wetenschappelijk gevalideerd. Geen vergelijking tussen competitieniveaus.`, availableAt: s.availableAt });
  const change = minutesChange(player, asOf);
  if (change !== null && change >= 120) signals.push({ type: 'minutes', title: 'Meer speeltijd in vergelijkbare meetvensters', detail: `${change} extra minuten over ${player.recent.matches} wedstrijden; brondefinitie en dekkingsversie zijn gelijk.`, availableAt: player.recent.availableAt });
  for (const e of evidence.filter(x => x.kind === 'positive')) signals.push({ type: 'observation', title: e.title, detail: player.synthetic ? 'Menselijke observatie in de testset; dit is geen onafhankelijke voorspelling.' : 'Aangeleverde observatie; inhoud en identiteit zijn niet onafhankelijk geverifieerd. Geen voorspelling.', availableAt: e.availableAt });
  const gaps = [];
  if (minutes === null) gaps.push('Speelminuten onbekend: geen statistieken per 90 minuten berekend.');
  else if (!sampleEnough) gaps.push('Kleine steekproef: minimaal 450 minuten én 5 wedstrijden nodig voor de gedocumenteerde lijst.');
  if (!rule || !numeric(metrics[rule.metric])) gaps.push('De rolrelevante meetwaarde ontbreekt. Geen vervangende talentwaarde berekend.');
  if (fresh !== 'current') gaps.push('De bron is verouderd of de actualiteit is onbekend. Eerst nieuwe gegevens verifiëren.');
  if (competition?.coverage.video !== 'available') gaps.push('Volledige wedstrijdbeelden zijn niet als beschikbaar bevestigd.');
  gaps.push('Beschikbaarheid, totale kosten en registratievoorwaarden zijn niet geverifieerd.');
  if (change === null && player.recent && player.previous) gaps.push('Speeltijdvensters zijn niet vergelijkbaar of nog niet beschikbaar. Geen ontwikkeling afgeleid.');
  const counters = evidence.filter(x => x.kind === 'counter');
  const nextQuestion = quality === 'exploration' && minutes === null ? 'Verifieer identiteit en speelminuten en vraag met toestemming een volledige wedstrijdobservatie aan.' : rule?.question || 'Verzamel passende, controleerbare observaties voor deze spelersrol.';
  return { player, source, competition, age, metrics, minutes, matches, quality, freshness: fresh, evidence, signals, counters, gaps, nextQuestion, roleMetric: rule, minutesChange: change, asOf };
}
export function findPlayers(catalog, filters = {}, clubState = {}, asOf = catalog.asOf) {
  const q = String(filters.search || '').trim().toLocaleLowerCase('nl');
  const minAge = filters.minAge === '' || filters.minAge == null ? 18 : Number(filters.minAge);
  const maxAge = filters.maxAge === '' || filters.maxAge == null ? 35 : Number(filters.maxAge);
  if (!Number.isFinite(minAge) || !Number.isFinite(maxAge)) return [];
  return catalog.players.map(p => buildDossier(p, catalog, asOf)).filter(Boolean).filter(d => {
    const p = d.player, c = d.competition;
    return (!q || `${p.name} ${p.club} ${c?.country} ${c?.name}`.toLocaleLowerCase('nl').includes(q)) &&
      (!filters.role || p.role === filters.role) && (!filters.region || c?.region === filters.region) &&
      (!filters.competition || p.competitionId === filters.competition) &&
      (!filters.quality || d.quality === filters.quality) && d.age >= minAge && d.age <= maxAge &&
      (!filters.lowerOnly || (numeric(c?.tier) && c.tier >= 3)) &&
      (!filters.newOnly || !(clubState.decisions || []).some(x => x.playerId === p.id)) &&
      (!filters.shortlistOnly || (clubState.decisions || []).filter(x => x.playerId === p.id).at(-1)?.action === 'follow');
  }).sort((a, b) => String(b.player.availableAt).localeCompare(String(a.player.availableAt)) || a.player.name.localeCompare(b.player.name));
}
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function dossierCSV(dossiers) {
  const rows = [['Naam', 'Club', 'Competitie', 'Niveau', 'Rol', 'Leeftijd', 'Minuten', 'Bewijsroute', 'Bron', 'Peildatum', 'Vervolgonderzoek', 'Dataset']];
  for (const d of dossiers) rows.push([d.player.name, d.player.club, d.competition?.name, d.competition?.tier, ROLE_LABELS[d.player.role], d.age, d.minutes, d.quality, d.source.name, d.asOf, d.nextQuestion, d.player.synthetic ? 'FICTIEF - softwaretest' : 'Import - verklaring bronhouder; niet onafhankelijk geverifieerd']);
  return '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
}
export function validateSnapshot(input, asOf) {
  const errors = [];
  if (!input || !Array.isArray(input.players) || !Array.isArray(input.sources) || !Array.isArray(input.competitions)) return ['Snapshot vereist players, sources en competitions.'];
  if (input.players.length > 5000) errors.push('Maximaal 5000 spelers per lokale testimport.');
  const ids = new Set(), providerIds = new Set();
  for (const p of input.players) {
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)) errors.push('Ongeldig of dubbel intern spelers-ID.');
    ids.add(p.id);
    try { const key = identityKey(p); if (providerIds.has(key)) errors.push('Dubbele provideridentiteit; geen automatische samenvoeging.'); providerIds.add(key); } catch (e) { errors.push(e.message); }
    if (!p.name || typeof p.name !== 'string' || p.name.length > 160) errors.push('Ongeldige spelersnaam.');
    const age = ageOn(p.dob, asOf);
    if (age === null || age < 18) errors.push('Onbekende leeftijd of minderjarige: niet toegestaan in dit prototype.');
    if (!ROLE_LABELS[p.role]) errors.push('Onbekende spelersrol.');
    if (!input.competitions.some(c => c.id === p.competitionId)) errors.push('Competitie ontbreekt.');
    const source = input.sources.find(s => s.id === p.sourceId);
    if (!sourceAllowed(source, asOf) || !sourceAllowed(source, asOf, 'display')) errors.push('Bronrechten ontbreken of zijn verlopen.');
    if (!visibleAt(p, asOf)) errors.push('Identiteitsgegevens ontbreken op de peildatum.');
    if (p.stats) for (const [key, value] of Object.entries(p.stats)) if (!['eventAt', 'publishedAt', 'retrievedAt', 'availableAt', 'definition', 'coverageVersion'].includes(key) && value !== null && (!numeric(value) || value < 0)) errors.push(`Ongeldige meetwaarde: ${key}.`);
  }
  for (const c of input.competitions) {
    if (c.tier !== null && (!Number.isInteger(c.tier) || c.tier < 1)) errors.push('Competitieniveau moet een positief geheel getal of null zijn.');
    for (const field of COVERAGE_FIELDS) if (!COVERAGE_STATES[c.coverage?.[field]]) errors.push(`Dekkingsstatus ontbreekt: ${field}.`);
  }
  return [...new Set(errors)];
}
