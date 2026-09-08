# Worker D — onafhankelijke integratiecontrole

Datum: 8 september 2026. Uitgevoerd op de geïntegreerde Node-app in deze checkout; uitsluitend synthetische fixtures. Dit rapport beschrijft werkelijk uitgevoerde controles, geen toekomstige testopdracht.

## Uitkomst en gevonden regressies

De negen nieuwe integratie-/beveiligingscontroles en zeventien queue-/adaptercontroles slagen. Tijdens deze review gevonden en door de verantwoordelijke workers opgelost:

1. **Historische export kon oude exportrechten gebruiken.** Een latere bronverklaring zonder exportrecht moest ook CSV en logboekexport op een eerdere peildatum blokkeren. Worker A laat de zichtbare bronrechten nu afhangen van zowel historische als actuele toestemming. De HTTP-regressie controleert beide exports op status 403.
2. **Een hergebruikt competitie-ID kon een ander seizoen krijgen.** Daardoor konden oudere spelerswaarnemingen bij nieuwere seizoensmetadata terechtkomen. Worker A vereist nu een nieuw competitie-ID voor een nieuw seizoen. De reviewtest faalde vóór deze aanpassing en slaagt erna.
3. **Een bevestigde JSON-string kon een job zonder snapshot-ID opleveren.** De importvalidator ondersteunt tekst, maar de queue verwacht een objectenvelop. Root blokkeert de verkeerde vorm in de HTTP-route; Worker B blokkeert die ook bij direct modulegebruik. String-, array- en null-invoer leveren geen job op.
4. **Ongeldige objecten voor rechten en enumwaarden konden een TypeError veroorzaken.** Voorbeelden: `allowedUses: {includes: "not-a-function"}` en `role: {toString: 0}`. Worker A voegde typecontroles toe. Deze gevallen krijgen nu een normale preview met validatiefouten; de HTTP-test controleert dat er niets wordt opgeslagen.

Geen nog open concrete implementatiefout uit deze negen reviewtests. De integrator voert de volledige eindverificatie en commit uit.

## Werkelijk uitgevoerde laatste workercontrole

```text
node --test tests/ingestion.test.mjs tests/import-review.test.mjs
tests 26
suites 0
pass 26
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 1010.1785
exit code 0
```

De negen reviewtests behandelen historische exportrechten; verkeerde bevestigingsvorm; ongeldige rechten/enumwaarden; verlopen rechten bij historische cataloguslezing; seizoenidentiteit; behoud van oude dossiers en tegenbewijs bij broncorrecties; gelijknamige maar afzonderlijke identiteiten; HTML-/formuletekst als gegevens; en afhankelijke rollback met behouden historie.

De zeventien queue-/adaptertests omvatten echte bestandspersistentie en heropening, gelijktijdige dubbele bevestigingen, atomair falende opslag zonder gedeeltelijke import, expliciete retries, maximaal drie pogingen, herstartherstel, bronverval tussen bevestigen en uitvoeren, 20 actieve jobs, 200 bewaarde jobs, en zeven onafhankelijke dekkingsdimensies. Er is geen providerverzoek of betaalde dienst nodig voor deze tests.

Eerdere reviewruns bleven zichtbaar in de uitgevoerde opdrachtuitvoer: eerst 6/7 met de seizoenfout, daarna 8/9 met de ongeldige rechtenverzameling. Bovenstaand resultaat betreft de herstelde code.

## Browserbewijs en afbakening

Root beheert de browsercontrole. Het gelezen [browser-e2e.json](browser-e2e.json) registreert tien geslaagde controlefasen via een werkelijk draaiende loopback-backend en Edge/Chromium: preview/bevestiging, dossier met HTML-achtige tekst, onderzoek, CSV-download, herladen, scheiding van demo/import, idempotentie, mobiel scherm, serverherstart en rollback. Het rapport vermeldt `native_browser_to_loopback_backend`, `passed: true` en geen browserfouten. Worker D heeft dit artefact gelezen; de browseruitvoering zelf behoort tot de integratorcontrole.

HTTP- en moduletests zijn geen zelfstandige DOM-XSS-test. De review bevestigt JSON-contenttypes, `nosniff`, scriptbeleid, downloadheaders en formule-escaping; de daadwerkelijke browserrendering is apart vastgelegd in het genoemde browserrapport.

## Integriteit van meegeleverde bronbestanden

De 34 bestanden uit het oorspronkelijke Python-bronarchief zijn één voor één met SHA-256 vergeleken met `reference/python-prototype/`: **34 gecontroleerd, 0 afwijkingen**. De twee bewaarde originele ZIP-pakketten zijn eveneens bytegelijk aan de uitgepakte gebruikersbundel:

| Archief | SHA-256 | Ongewijzigd |
|---|---|---|
| scoutingtool_0.1.0_alpha_broncode.zip | 86089E823C92617467E6E222BBC8FDCAAB0180608FF56FB18177CB51F4D1A3E5 | Ja |
| Scoutingtool_v0.1.0.zip | A0C6040C06CFFE7CB4887A08D00311B8998CEF6F9F8D767C919D76E2365C0119 | Ja |

De scan op gangbare OpenAI-/GitHub-/AWS-sleutelvormen en private-keyheaders gaf geen treffers in de bekeken tekstbestanden onder `src`, `public`, `tests`, `docs`, `tools`, `handoff`, `reference` en `.github`. De scan rapporteerde alleen bestandsnamen en drukte geen mogelijke geheime waarden af. De bewaarde binaire archieven zijn op integriteit gecontroleerd; deze patrooncontrole is geen universele geheimendetector. De nieuwe importfixture en tests gebruiken de meegeleverde fictieve spelersgegevens, geen echte klantdossiers.

`git diff --check` gaf exitcode 0. Git meldde alleen lokale LF/CRLF-normalisatiewaarschuwingen.

## Resterende productgrenzen

- Lokale JSON-opslag voor één gebruiker en één serverproces; geen multi-tenantaccounts, gedeelde database of manipulatiebestendige audit.
- Bronrechten en datadekking zijn verklaringen van de importeur. De code controleert velden, gebruiksdoelen en tijdstempels; externe licenties of echte spelersidentiteiten zijn hiermee niet onafhankelijk geverifieerd.
- Geen live provider, cloudqueue, productiedeployment of gevalideerde voorspelling van scoutingkwaliteit.
- Grenzen en foutstatussen van de lokale queue zijn getest. Een volledig onbeschikbare schijf kan geen nieuwe foutstatus duurzaam bewaren; herstel van opslag blijft dan nodig.

Worker D heeft geen commit of publicatie uitgevoerd. Het daadwerkelijke uiteindelijke commit-ID en de repository-/deploymentstatus worden door de integrator apart gerapporteerd.
