# JSON-importcontract v0.1

De import is begrensd op 4 MB via HTTP, 100 competities en 3.000 spelers per bestand. Alle records worden vóór schrijfacties gecontroleerd. Het voorbeeld `samples/import-demo.json` gebruikt alleen fictieve data.

## `source`

Vereist: `id`, `name`, `is_demo` (boolean), `rights_attested` (true), `license_description`, `license_expires_at` (ISO 8601 met tijdzone) en `permissions` met ingest/store/display/analyze. Export vereist afzonderlijk `export: true`.

Dit is een door de importeur verklaard rechtenregister, geen verificatie van de licentie door Omni-Scout. Houd de onderliggende toestemming buiten de demo gereed voor controle. Zet verlopen of onjuiste rechten niet willekeurig verder in de toekomst.

## `competitions`

Per competitie: `id`, `name`, `country`, `continent`, `level` (werkelijke piramidepositie, integer 1–30 of null), `season`, `checked_at` en `coverage`.

Dekkingsdimensies: fixtures, lineups, minutes, player_stats, events, tracking en full_video. Voor iedere dimensie een van: available, partial, unknown, not_connected, not_licensed, unavailable, delayed.

`unavailable` betekent hier dat deze bron geen gegevens aanlevert, niet dat deze informatie wereldwijd niet bestaat. Er worden geen compleetheidspercentages getoond zonder een bekende noemer.

## `players`

Per speler: provider-gebonden `id`, `name`, `club`, `competition_id`, `birth_date`, `role`, `identity_status`, `minutes`, `appearances`, `metrics`, `metric_definition`, `evidence_locator`, `event_at`, `published_at`, `retrieved_at`, `available_at`.

Roles: GK, CB, CM, WG, ST. De alpha controleert meerderjarigheid op basis van de aangeleverde geboortedatum (18–60). Dit is geen onafhankelijke identiteitsverificatie.

`minutes` en `appearances` mogen null zijn. Toegestane metricnamen: saves, interceptions, progressive_passes, chances_created, non_penalty_goals. Waarden zijn niet-negatieve eindige getallen of null. Ontbrekende metrics blijven onbekend; het systeem leidt geen drukbestendigheid uit goals af.

`identity_status`: provider_id, verified, needs_review. `verified` is de claim van de importeur. Gelijknamige spelers worden niet gefuseerd. Mogelijke dubbelen gaan naar verkenning en tellen niet als nieuwe zekere identiteit. Er is nog geen volwaardige identity-resolution workflow.

`published_at` mag null zijn. De overige tijden zijn verplicht met tijdzone. De alpha vereist event ≤ retrieved ≤ available ≤ nu; publicatie mag niet later zijn dan beschikbaarheid. Een vandaag opgehaald historisch endpoint is geen historische snapshot. De filter op available_at voorkomt toekomstdata, maar de alpha is nog geen reconstructie-engine voor iedere oude revisie.

`counterevidence` is optionele tekst (maximaal 2.000 tekens). Die blijft als broninhoud zichtbaar en wordt nooit als instructie uitgevoerd. Bewijslocaties worden als tekst getoond; de app haalt geen URL of video op.

## Trendvensters

Optioneel: `previous_window` en `recent_window` met minutes, matches, revision en coverage. Alleen bij dezelfde revision, volledige dekking en hetzelfde aantal wedstrijden (minimaal drie) is een eenvoudige speeltijdvergelijking toegestaan. Grotere speeltijd is geen gemeten talentgroei.

## Idempotentie en wijzigingen

Dezelfde volledige importinhoud heeft dezelfde queue-hash. Nieuwe versies met gewijzigde inhoud worden als nieuwe job verwerkt. Source-id + player-id is de bronsleutel; naam is geen sleutel. Records worden bijgewerkt, niet bij afwezigheid verwijderd. Gewijzigde spelerspayloads worden in revisions bewaard. Bronrechten mogen worden bijgewerkt, maar demo/real-status mag niet van betekenis veranderen.

## Niet aanwezig

Geen CSV-adapter, automatisch ophalen van providerdata, cross-provider samenvoegen, video-upload, peildatum-backtest met revisiekeuze of rechtmatig-heidsverklaring door de software. Dit zijn vervolgpakketten.
