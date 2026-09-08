# Omni-Scout — scoutingtool

**Versie 0.1.0-alpha · 8 september 2026 · lokale single-club onderzoekswerkplek**

Dit archief bevat werkende broncode, geen uitsluitend ontwerpdocument. Het is hier lokaal gebouwd en getest. **Er is geen Codex-cloudtaak gestart, niets naar GitHub gepusht en niets publiek gedeployd.** Bij controle gaf de GitHub-koppeling geen toegankelijke repository of installatie terug. `scoutingtool` kon daardoor niet worden gelezen of gevuld.

## Direct bekijken

Open `preview.html` in een browser. Alle 400 spelersrecords en alle 11 competitievermeldingen zijn fictieve softwaretestdata. De preview heeft geen server, echte importworker, live dataprovider of AI-model. Beoordelingen en onderzoeksvragen blijven in browsergeheugen en, wanneer de browser dit toestaat, localStorage. Er wordt niets verstuurd.

De preview wordt altijd gegenereerd uit synthetische fixtures, nooit uit een bestaande database met eigen imports.

## De volledige lokale app starten

Python 3.10 of nieuwer. Voor de app zijn geen pip- of npm-pakketten nodig.

```sh
python server.py --demo
```

Open de lokale URL die in de terminal verschijnt (`http://127.0.0.1:8765`). Op Windows werkt ook `START_WINDOWS.bat`; op macOS/Linux `bash START_MAC_LINUX.sh`.

Zonder demodata, met een eigen schone database:

```sh
python server.py --db data/eigen-club.sqlite
```

Stop met Ctrl+C. SQLite bewaart de gegevens in de gekozen database. Een server op je computer is niet automatisch vanaf je telefoon bereikbaar; de server luistert bewust alleen op localhost. Gebruik voor mobiel bekijken de losse preview of de meegeleverde screenshot. Publiceer deze alpha niet door hem aan alle netwerkinterfaces te binden.

## Wat werkt

- Responsief desktop- en mobiel scherm, zoeken op naam/club/competitie, land, rol, competitieniveau, leeftijd, minuten en bekendheid in deze lokale werkruimte.
- Overzicht per continent; beschikbare bronrecords worden vooraf geladen. Geen claim van complete werelddekking.
- Aparte lijsten voor meer gedocumenteerde bronrecords en spelers die eerst moeten worden verkend. De eerste lijst betekent niet: bewezen goede voetballer.
- Dossiers met meetdefinities, bron, bewijslocatie, vier tijdsbegrippen, tegenbewijs, onzekerheden en een concrete onderzoeksopdracht.
- Transparante per-90-berekeningen en, bij minimaal vijf voldoende gedocumenteerde records, een percentiel binnen dezelfde competitie, rol, seizoen, bron en meetdefinitie. Geen globale kwaliteitsranglijst.
- Een eenvoudige speeltijdmelding alleen bij vergelijkbare vensters. Dit is geen ontwikkelingsvoorspelling.
- Lokaal clubprofiel, beslissingen met aparte afwijsreden, onderzoeksvragen en logboek.
- JSON-import, rechtenverklaring, veldenvalidatie, een transactionele importwachtrij, maximaal drie handmatig aangevraagde pogingen, idempotentie en revisiebewaring.
- Dossierexport met een afzonderlijke exportrechtencontrole.
- Rechtenverval en te recente beschikbaarheidsdatums schermen records af.
- Gegevens blijven lokaal. Er worden geen externe modellen, scrapers of providers aangeroepen.

## Bewust nog niet geleverd

**Dit is niet de gehele versie-2-bouwbrief als productieproduct.** Zie `docs/ACCEPTANCE_STATUS.md` voor de afbakening.

Geen multi-tenant authenticatie/rollen/SSO, toegangsbeleid voor meerdere clubs, cloudhosting, providerabonnement, geautomatiseerde wereldwijde gegevensinzameling, beeldanalyse, getraind voorspelmodel, transferhaalbaarheidsberekening, volledig historisch backtestplatform of juridische/productieaudit. De vrije clubvraag wordt opgeslagen; alleen de gekozen rol kan als filter worden toegepast. Er is geen semantische tactische matching.

Het clubprofiel is één lokale werkruimte, niet een beveiligingsgrens tussen meerdere clubs. De HTTP-interface is voor lokale ontwikkeling en heeft geen login. **Verwerk in deze alpha geen vertrouwelijke gegevens van verschillende organisaties.** De oorspronkelijke productie-eis voor tenant-isolatie staat open.

De drempels van 450 minuten, vijf wedstrijden, 30 dagen actualiteit en vijf vergelijkingsrecords zijn expliciete softwareheuristieken. Zij zijn niet sportwetenschappelijk of commercieel gevalideerd. Alle publieke 'onmisbare scoutingtool'-claims vereisen een aparte pilot en validatie.

## Eigen data importeren

Lees `docs/IMPORT_SCHEMA.md`. Start met `samples/import-demo.json` voor een onschadelijke test. Dit bestand blijft bewust `is_demo: true`.

In de app: **Bronnen & imports → bestand kiezen → rechten bevestigen → in wachtrij plaatsen → verwerk één import.** De queue draait niet door als dit venster of proces wordt gesloten. Iedere uitvoering verwerkt maximaal één job. Voor lokale automatisering kan een apart proces of scheduler later dit commando aanroepen:

```sh
python worker.py --db data/scout.sqlite
```

Die scheduler is niet ingesteld en er is hier geen blijvende worker gestart.

Een source-id kan niet van demo naar echte data worden omgezet. Gebruik een aparte nieuwe bron voor rechtmatig verkregen echte gegevens. Imports zijn upserts, geen volledige vervanging: afwezige spelers worden niet verwijderd. Verwijder-/bewaartermijnbeleid moet vóór productie worden geïmplementeerd.

## Tests opnieuw uitvoeren

```sh
python -m unittest discover -s tests -v
node --check web/app.js
```

Uitgevoerde resultaten staan in `evidence/unit-http-tests.txt`. De JavaScript-syntaxcontrole vereist Node, de app zelf niet.

Optionele browsercontrole (Playwright en een Chromium-installatie nodig):

```sh
python tests/browser_check.py
```

Het buildmilieu blokkeerde directe browsernavigatie naar bestanden en localhost. De browsercontrole is daarom uitgevoerd met een geïnjecteerde DOM en een fetch-brug naar de echte lokale HTTP-/SQLite-app. Dat test scherminteractie en backendverwerking, maar is **geen native netwerk-end-to-endtest, hostingtest of externe securityaudit**. Zie `evidence/browser-tests.json`, screenshots en `docs/TEST_REPORT.md`.

## Naar Codex en GitHub

Repositorydoel zoals opgegeven: `scoutingtool`. De GitHub-owner is in deze sessie niet vastgesteld. Er is geen fictieve repository-URL of taak-ID toegevoegd.

Plaats de inhoud van deze map in de juiste repository wanneer toegang beschikbaar is. Lees eerst bestaande repositorybestanden; vervang geen bestaand project ongezien. Geef Codex vervolgens `CODEX_START.md` als opdracht. `AGENTS.md` bewaakt bewijs, scope en testdiscipline. Het installeren/aanmaken van een repository is niet hetzelfde als een Codex-taak starten.

## Bestanden

`scout.py` bevat validatie, SQLite, berekeningen en onderzoekslogica. `server.py` levert de HTTP-interface. `worker.py` verwerkt één import. `seed.py` maakt fixtures. `web/` bevat de interface. `tests/` bevat uitvoerbare tests. De oorspronkelijke bouwbrief blijft intact in `docs/PRODUCT_BRIEF.md`.

## Gebruik en rechten

De projectcode is voor verdere ontwikkeling door de opdrachtgever; er is geen open-source licentie aan derden verleend. Er zijn geen externe lettertypen, spelersfoto's of commerciële voetbalgegevens in dit pakket opgenomen. De code is geen juridisch advies of bewijs van rechtmatige verwerking van toekomstige imports.
