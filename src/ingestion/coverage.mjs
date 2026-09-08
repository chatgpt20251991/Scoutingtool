export const COVERAGE_DIMENSIONS = Object.freeze(['results', 'lineups', 'minutes', 'playerStats', 'events', 'tracking', 'video']);
const STATUSES = new Set(['available', 'partial', 'unavailable', 'not_in_license', 'not_connected', 'delayed', 'unknown']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Separate source/competition/season/type records, never a claim of global coverage.
 * Coverage statuses and match totals are source declarations. Imported player
 * counts refer only to records actually present in the supplied visible catalog.
 */
export function coverageRecordsFromCatalog(catalog) {
  const sources = new Map((catalog?.sources || []).map(source => [source.id, source]));
  const players = catalog?.players || [];
  return (catalog?.competitions || []).flatMap(competition => {
    const source = sources.get(competition.sourceId);
    const observedMatches = count(competition.observedMatches);
    const expectedMatches = count(competition.expectedMatches);
    const observedPlayers = players.filter(player => player.competitionId === competition.id && player.sourceId === competition.sourceId).length;
    return COVERAGE_DIMENSIONS.map(type => ({
      id: JSON.stringify([competition.sourceId, competition.id, competition.season, type]),
      sourceId: competition.sourceId, competitionId: competition.id,
      country: competition.country, region: competition.region, tier: competition.tier,
      season: competition.season, type,
      status: source && STATUSES.has(competition.coverage?.[type]) ? competition.coverage[type] : 'unknown',
      rightsStatus: source?.status ?? 'unknown',
      rightsAttested: source?.rightsAttested === true,
      rightsIndependentlyVerified: false,
      connected: Boolean(source),
      synthetic: competition.synthetic === true,
      lastReceivedAt: competition.lastReceivedAt ?? null,
      lastCheckedAt: competition.lastCheckedAt ?? null,
      sourceLagSeconds: null,
      observedPlayers, observedMatches, expectedMatches,
      // Match completeness cannot establish completeness of any measurement.
      matchCompletenessPercent: expectedMatches > 0 && observedMatches !== null && observedMatches <= expectedMatches
        ? Math.round(observedMatches / expectedMatches * 10000) / 100 : null,
      measurementCompletenessPercent: null,
      coverageBasis: 'source_declaration', matchCountBasis: 'source_declaration',
      playerCountBasis: 'catalog_records'
    }));
  });
}
