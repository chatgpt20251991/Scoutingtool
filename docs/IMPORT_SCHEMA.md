# Lokale JSON-import — Node-contract v1

De Node-app is het hoofdproject. `samples/import-demo.json` is een uitvoerbaar voorbeeld met uitsluitend drie fictieve volwassen spelers, drie fictieve competities en zelfgemaakte observaties. De Python-app onder `reference/python-prototype/` blijft ongewijzigde referentie; het Python-importformaat is niet hetzelfde als dit Node-formaat.

## Bestand en begrenzing

Een UTF-8 JSON-object van maximaal **1 MiB**, geen archief of CSV. Envelope:

```json
{"schemaVersion":1,"snapshotId":"club-upload-v1","correctionOf":null,"asOf":"2026-09-08T02:00:00.000Z","source":{},"competitions":[],"players":[]}
```

Eén bron, 1–100 competities, 0–3.000 spelers, maximaal 30 bewijsobjecten per speler. De lokale opslag accepteert maximaal 200 onveranderlijke snapshots. Geen automatisch verwijderen van oude provenance om die grens vrij te maken. Objectdiepte is maximaal 12; onbekende velden, niet-eindige getallen en gereserveerde prototype-sleutels worden geweigerd. Preview toont maximaal 100 fouten en 100 waarschuwingen. IDs bevatten 1–80 ASCII-letters, cijfers, `_` of `-`; namen zijn nooit sleutels.

## Bron en rechten

`source` vereist `id`, `name` (160 tekens), `status` (`synthetic` of `approved`), `rightsAttested:true`, `allowedUses`, `validFrom`, `expiresAt` en `rightsNote` (2.000 tekens). `allowedUses` bevat expliciet `ingest`, `store`, `display`, `analysis`; `export` is afzonderlijk optioneel. `approved` betekent **door de importeur verklaard, niet onafhankelijk geverifieerd**. Deze bron vereist een einddatum. Alleen een zelfgemaakte synthetische bron mag `expiresAt:null` gebruiken. Een bron-ID kan niet wisselen tussen deze twee statussen.

Rechten moeten op de peildatum geldig zijn en bij preview, queue-uitvoering en iedere uitlezing nog actueel zijn. Historische peildatums omzeilen verlopen actuele rechten niet. Geprojecteerde bronrechten zijn de doorsnede van de historische en de actuele verklaring; een ingetrokken exportrecht blokkeert ook historische export. De originele verklaring blijft onveranderd in het snapshot. Dit prototype verifieert geen contract en voert geen automatische retentieverwijdering uit.

## Competities

Vereist: `id`, `name`, `country`, `region`, `tier` (1–30 of null), `season`, `sourceId`, `synthetic`, `lastReceivedAt` en `coverage`. `sourceId` verwijst naar de bron in dezelfde upload. `synthetic` volgt bronstatus. Gebruik voor een nieuw seizoen een nieuw competitie-ID: anders zouden oude spelerscijfers onzichtbaar een ander seizoen krijgen.

`coverage` heeft alle zeven sleutels: `results`, `lineups`, `minutes`, `playerStats`, `events`, `tracking`, `video`. Iedere waarde is `available`, `partial`, `not_connected`, `unavailable`, `unknown`, `not_in_license` of `delayed`. Beschikbaarheid betreft deze bron; een ontbrekende aansluiting betekent niet dat er geen talent of andere data bestaat.

Optioneel: `lat`, `lon` (geografisch bereik of null), `expectedMatches`, `observedMatches`, `observedPlayers` (niet-negatieve gehele getallen tot 1.000.000 of null). Ontbrekende aantallen worden als null geprojecteerd. Waargenomen wedstrijden mogen een bekende verwachte noemer niet overschrijden. Geen compleetheidspercentage zonder bekende noemer.

## Spelers en meetdefinitie

Vereist: `id`, `provider`, `providerId`, `identityStatus`, `sourceId`, `competitionId`, `name`, `club`, `dob`, `role`, `synthetic`, vier tijdvelden en `stats`. `preferredFoot` is optionele tekst. `dob` is een echte kalenderdatum `YYYY-MM-DD`; alleen 18–100 jaar op de peildatum wordt geaccepteerd. Rollen zijn `GK`, `CB`, `FB`, `CM`, `W`, `ST`.

`identityStatus` is `provider_id` of `verified`; ook `verified` blijft de verklaring van de importeur. `needs_review` blokkeert import. Dezelfde naam bij verschillende provideridentiteiten geeft een waarschuwing en houdt beide spelers gescheiden. Een eerder gekoppeld intern ID, provider-ID, bron of geboortedatum kan niet stilzwijgend worden omgekoppeld. Er is geen cross-provider identity-resolution workflow.

`stats` vereist `snapshotId` (uniek, onveranderlijk **waarnemings-ID**, onderscheiden van de envelope-ID), `definition:"omniscout-counts-v1"`, `minutes`, `matches` en de vier tijdvelden. `coverageVersion` is een optioneel ID. Minuten zijn 0–100.000 of null; wedstrijden 0–1.000 of null; maximaal 130 minuten per opgegeven wedstrijd is een foutdetectiegrens. Beide moeten expliciet worden opgegeven. Onbekende minuten veroorzaken nooit een waarde per 90 minuten.

De geregistreerde definitie beschrijft ongewogen, niet-negatieve gehele tellingen in hetzelfde aangeleverde meetvenster: `progressivePasses`, `interceptions`, `progressiveCarries`, `chancesCreated`, `nonPenaltyGoals`, `saves`, `shotsOnTarget`, `passesCompleted`, `passesAttempted`, `duelsWon`, `duelsTotal`. Elk is 0–1.000.000 of null; weggelaten tellingen worden uitsluitend bij catalogusprojectie null. Deel/totaalparen mogen niet inconsistent zijn. De software voert geen providerdefinitieconversie, wedstrijdduurcorrectie, universele ranking of analyse van drukbestendigheid uit. De tellingen zijn een lokaal adaptercontract; een toekomstige provider moet zijn definitie aantoonbaar op dit contract laten aansluiten.

## Tijden en bewijs

Vier tijdvelden: `eventAt`, `publishedAt`, `retrievedAt`, `availableAt`. ISO 8601 met tijdzone en seconden is vereist; `publishedAt` mag expliciet null zijn. Geldt: gebeurtenis ≤ ophalen ≤ beschikbaar ≤ envelope-peildatum ≤ actuele tijd; bekende publicatie ligt tussen gebeurtenis en ophalen. Deze controle geldt onafhankelijk voor speler, stats en ieder bewijsobject. Competitie-ontvangst mag niet na de peildatum liggen.

Optionele `evidence` bevat objecten met `id`, `sourceId`, `kind` (`positive`, `counter`, `claim`, `unknown`), `title` (200 tekens), `text` (2.000 tekens), `locator` (1.000 tekens) en vier tijdvelden. IDs zijn onveranderlijk en mogen niet botsen met stats- of andere bewijs-IDs. Tekst, inclusief HTML, instructietekst en locators, blijft onbetrouwbare broninhoud. Er worden geen URLs opgehaald. Tegenbewijs wordt bewaard; `claim` is geen gemeten feit. Rechten gelden voor de gedeclareerde bron; geen bestand- of video-upload.

## Preview, bevestiging, revisies en rollback

`previewImport` schrijft niets en levert `valid`, gestructureerde `errors`/`warnings`, `summary` met bronrechten, seizoenen, aantallen en dekking, plus een SHA-256-`digest` over canoniek gesorteerde JSON. Bevestiging moet diezelfde digest meesturen. De queue controleert opnieuw vóór één atomaire opslagmutatie. Dezelfde envelope-ID met dezelfde digest is idempotent; een andere inhoud onder dat ID geeft een conflict. Een afgekeurde import verandert eerdere gegevens niet.

Iedere geaccepteerde upload bewaart het volledige originele payload, digest en werkelijke importtijd. Wijzigingen vereisen een nieuwe envelope-ID en nieuwe waarnemings-IDs voor gewijzigde stats/bewijs. Gebruik voor een correctie `correctionOf` met het actieve voorafgaande snapshot. Een correctie is een **volledige vervanging van de leden van dat snapshot**; geef dus ook de behouden spelers en competities opnieuw mee. De correctie heeft een latere peildatum. Gewijzigde bestaande spelers mogen evenmin via een gewone upload worden teruggedateerd.

Op een historische peildatum wordt de destijds beschikbare revisie geselecteerd. Een latere correctie verandert de eerdere projectie niet. De envelope-peildatum begrenst ook snapshotmetadata. Losse niet-gecorrigeerde uploads zijn aanvullingen: afwezigheid verwijdert geen eerdere speler. De catalogus gebruikt alleen imported records en bevat bron-/snapshotprovenance. De app genereert uit revisies geen speeltijd- of talenttrend; trendvensters zijn in v1 geen toegestaan importveld.

Rollback voegt een gebeurtenis toe en sluit dat snapshot uit bij alle projecties. Het oorspronkelijke payload en de historie blijven bewaard. Een rollback van een correctie maakt de vorige actieve revisie opnieuw zichtbaar. Draai eerst afhankelijke correcties terug. Herhaald terugdraaien is idempotent; opnieuw importeren van hetzelfde teruggedraaide ID wordt geblokkeerd. Een nieuw ID is vereist voor bewuste herinvoer. Dit is lokaal herstel, geen tamper-proof audit of juridisch verwijderproces.

## Grenzen van de historische claim

De aangeleverde `availableAt` is een verklaring, geen onafhankelijk bewijs dat een externe provider dat record toen leverde. `importedAt` bewaart wanneer deze lokale app de upload werkelijk accepteerde. Dit is een deterministische revisieprojectie, geen gevalideerde historische backtestdataset. Geen productieaccounts, tenantisolatie, live provider, scraping, betaalde API, cloud-ingestion of deployment wordt hierdoor gerealiseerd.
