# Werkpakketten voor ontwikkelworkers

**Uitvoeringsstatus 8 september 2026: afgerond binnen de huidige Codex-sessie.** A, B en C zijn daadwerkelijk als subagents gestart; B heeft daarna het onafhankelijke werkpakket D uitgevoerd. Eén integrator beheerde server, opslag, gedeelde contracten, native browsertests en commits. Bestandsgebieden waren gescheiden binnen één eigen werkbranch. Geen Cloudflare-runtimeworker gestart. De onderstaande oorspronkelijke opdrachten zijn behouden; bewijs staat in `reports/current/`.

## Integrator — contracten en oplevering

Controleer eerst de bestanden en de bestaande checkout, voer de baseline-tests uit en leg één importschema vast voordat andere workers gedeelde velden aannemen. Verdeel wijzigingen via aparte werkbranches/worktrees wanneer beschikbaar. De integrator beheert gedeelde contracten, integratie, eindtests en een eventuele commit/PR. Geen parallelle wijzigingen aan dezelfde bestanden zonder afstemming.

## Worker A — import en gegevensmodel

Bestudeer `reference/python-prototype/scout.py`, `docs/IMPORT_SCHEMA.md` binnen die referentiemap, `samples/import-demo.json` en de tests. Ontwerp en implementeer een begrensde JSON-import voor de Node-app met schema-versie, bronmetadata, rechtenverklaring, snapshots en provenance. Onbekend blijft null. Dezelfde naam is geen identiteitssleutel. Een broncorrectie is geen spelersontwikkeling. Validatie vóór schrijven; herhaalde import is idempotent; herstelbare fouten behouden eerder geldige gegevens. Voeg uitsluitend synthetische tests toe.

Bestandsgebied na contractafstemming: nieuwe modules onder `src/import/` en bijbehorende tests. De integrator koppelt de bestaande serverroutes.

## Worker B — verwerking, coverage en bronadapters

Ontwerp de adaptergrens en een lokale, begrensde verwerkingstaak met status, foutmelding, retries en idempotentiesleutel. Een lokale worker hoeft geen cloudworker te zijn. Leg dekking apart vast voor uitslagen, opstellingen, minuten, spelersstatistieken, events, tracking en video. Het register kan uitbreiden naar alle landen/niveaus, maar toont alleen wat werkelijk aanwezig is. Geen onbevoegde scrapers, live providerrequests of credentials.

Bestandsgebied na contractafstemming: nieuwe modules onder `src/ingestion/` en tests. Houd de bestaande synthetische Cloudflare-demo geïsoleerd van echte importgegevens.

## Worker C — importinterface en scoutingoverzicht

Behoud de werkende desktop-/mobiele interface. Voeg bestandselectie, importpreview, validatiefouten, conflictweergave, bevestiging, echte jobstatus en een duidelijk onderscheid tussen demo en eigen import toe. Behoud filterbare landen en lagere niveaus, documented/exploration-lijsten, bronverwijzingen, tegenbewijs en volgende onderzoeksactie. Niet alleen nieuwe statische pagina's tekenen.

Bestandsgebied na contractafstemming: `public/`. Blokkeer niet op live data. Gebruik overeengekomen synthetische API-fixtures totdat A/B integreren. Geen eigen afwijkend importschema.

## Worker D — integratietests en beveiligingscontrole

Schrijf en voer echte lokale browser-/backendtests uit wanneer de omgeving dat toestaat. Toets herladen, opslag, export, queuefouten en rollback. Voeg negatieve tests toe voor HTML/script-invoer, verkeerde bronrechten, ongeldige IDs, ontbrekende minuten, dubbele import en snapshots na peildatum. Controleer dat geen echte data of sleutels in Git komen. Maak onderscheid tussen lokaal single-usergebruik en nog ontbrekende multi-tenantbeveiliging.

Bestandsgebied: `tests/`, `tools/` en nieuwe rapporten. Geen beheerbeleid omzeilen wanneer de browser localhost blokkeert. Een mislukte of geblokkeerde test blijft zichtbaar.

## Integratiemoment

A/B leveren stabiele contracten; C sluit daarop aan; D test de gecombineerde toepassing. De integrator draait alle tests opnieuw en beschrijft open risico's. Oude testresultaten zijn referentiemateriaal, geen bewijs voor gewijzigde code. Commit/PR en deployment worden uitsluitend gemeld na echte bevestiging.
