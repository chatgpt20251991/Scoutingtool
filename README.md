# Omni-Scout · Scoutingtool

**Versie 0.5.0 — lokaal onderzoeksprototype, 8 september 2026.** Node is het hoofdproject; de volledige Python-app blijft ongewijzigd onder `reference/python-prototype/`. Oorspronkelijke ZIPs, bouwbrieven, demo's en screenshots zijn behouden.

De radar bevat 12 fictieve spelers en 8 fictieve competities. De afzonderlijke importdataset begint leeg. Via **Echte spelers** kun je nu expliciet openbare Wikidata-profielen zoeken en ophalen. Dit zijn echte brongegevens, met revisies en onbekende wedstrijdstatistieken. Er is geen live wedstrijdfeed of AI-model aangesloten.

## Starten

Node.js 22+; geen externe npm-afhankelijkheden voor het draaien van de applicatie.

```sh
npm start
```

Open http://127.0.0.1:4173. Windows: `START_WINDOWS.cmd`. Maak bij de eerste start je account en eerste club aan. De server luistert uitsluitend op loopback en vergrendelt de gegevensmap voor één proces. Accounts staan in `.local/accounts.json`; iedere club heeft eigen opslag onder `.local/organizations/`.

## Accounts en clubwerkruimten

Kies een club via de clubkiezer. In **Account & club** kun je een nieuwe lege club maken, leden uitnodigen, rollen beheren, opslagstatistieken bekijken en je wachtwoord wijzigen. Een uitnodiging verloopt na 48 uur en kan één nieuwe of bestaande account aan de club toevoegen. Bestaande accounts controleren eerst club en rol en bevestigen daarna; een bestaand clublid krijgt hierdoor geen hogere rol. Eigenaren kunnen openstaande uitnodigingen bekijken en intrekken. Deel de code zelf; de app verstuurt geen e-mail. `viewer` leest, `scout` verwerkt scoutinggegevens en imports, `owner` beheert ook leden. De laatste eigenaar blijft beschermd.

Elke API-aanvraag controleert de sessie en het actuele clublidmaatschap, ook voor exports en jobs. Wachtwoorden worden met scrypt gehasht; sessies gebruiken HttpOnly-cookies en afzonderlijke CSRF-controle. Wachtwoordwijziging trekt alle oude sessies in. Na serverherstart moet iedereen opnieuw aanmelden, terwijl accounts en clubgegevens bewaard blijven. Clubwissel en afmelden wissen eerder geladen clubinhoud uit de interface.

Bestaande v0.2-opslag wordt eenmalig naar de eerste club gemigreerd; het oorspronkelijke `.local/state.json` blijft behouden. Bij een fout blijft de claim aan die club gebonden en is gecontroleerd herstel nodig. Lees [accountbeveiliging](docs/AUTH_SECURITY.md) en [opslag, proceslock en migratieherstel](docs/ORGANIZATION_STORAGE.md).

## Back-ups, herstel en bewaarinventarisatie

Eigenaren maken in **Account & club** een versleutelde back-up van de gekozen club. Bewaar de wachtzin zelf; de app kan deze niet herstellen. Het bestand bevat zowel demo- als importwerk, zonder accounts of andere clubs. Bestand en wachtzin leveren eerst een controleoverzicht op; alleen expliciete bevestiging vervangt de scoutinggegevens van dezelfde club. De preview vervalt na vijf minuten en bij tussentijdse wijzigingen moet je opnieuw controleren. De vorige state blijft lokaal als herstelkopie bewaard.

De bewaarinventarisatie toont oudere gegevens, actieve afhankelijkheden, wachtende jobs en bronrechtenblokkades. Ze verwijdert niets en start geen opgeslagen jobs. Actuele opslag- en exportrechten worden voor alle bewaarde bronversies gecontroleerd bij back-up en herstel.

Voor een volledige serverkopie is er een afzonderlijk beheercommando voor een gestopte server. Dit bevat accounts en clubgegevens en herstelt uitsluitend naar een nieuwe datamap; sessies en uitnodigingen worden niet hersteld. Lees [clubherstel](docs/WORKSPACE_RECOVERY.md), [versleuteling](docs/BACKUP_ENCRYPTION.md) en [serverback-up en herstelcommando's](docs/SERVER_BACKUP.md).

## Echte spelers via Wikidata

Kies **Echte spelers**, zoek een naam, controleer het Q-ID en haal maximaal tien geselecteerde profielen op. De app controleert of de bron een volwassen voetballer met een precieze, onbetwiste geboortedatum beschrijft. Gelijknamige items blijven afzonderlijk. Een scout/eigenaar haalt op; een lezer kan zoeken en de eerder opgehaalde momentopname bekijken.

Deze aparte weergave bevat naam, geboortedatum, vermelde posities, gedateerde teamclaims en revisielinks. Een teamclaim bewijst geen huidige club. Minuten, wedstrijden, actuele competitie en gemeten prestaties blijven onbekend. Er wordt geen demonstratiescore aan echte personen gekoppeld. De tijdelijke bronkopie blijft binnen de gekozen clubcontext in procesgeheugen en verdwijnt bij serverherstart.

Wikidata structurele data worden onder CC0 aangeboden. Alleen na een expliciete actie wordt de vaste openbare API benaderd; accounts, clubnotities en dossiers worden niet meegestuurd. Afbeeldingen of externe bronpagina's worden niet opgehaald. Lees [bronkeuzes, grenzen en CLI](docs/WIKIDATA_PROVIDER.md).

Voor een zelfstandige HTML met echte brongegevens:

```sh
node tools/fetch-public-profiles.mjs --ids Q615,Q11571 --output /pad/buiten/git/profielen.json
node tools/build-public-profiles.mjs --input /pad/buiten/git/profielen.json --output /pad/buiten/git/echte-spelers.html
```

Gebruik nieuwe bestanden in een bestaande uitvoermap. De HTML toont een vaste momentopname en kan offline worden geopend. De oorspronkelijke `OmniScout-preview.html` blijft de fictieve demonstratie; de nieuwe CLI genereert een apart bestand met echte profielen. Opgehaalde persoonsgegevens worden buiten de openbare Git-repository bewaard. Dit is nog geen import in de scoutingdataset.

## Gecontroleerde lokale import

Open **Bronimport**, download het synthetische voorbeeld of kies `samples/import-demo.json`, controleer rechten, seizoenen, peildatum, aantallen en waarschuwingen, en bevestig. Een geslaagde preview schrijft niets. De lokale queue controleert opnieuw en toont de werkelijke taakstatus. Kies **Lokale import** voor de geïmporteerde radar, dossiers, shortlist, vergelijking en onderzoeksopdrachten.

Iedere club heeft gescheiden demo- en importcatalogi, besluiten, opdrachten en clubvragen. Browseropslag bevat geen accountgegevens, imports of uitnodigingscodes. CSV en JSON-export respecteren afzonderlijke actuele bronrechten. Rollback behoudt snapshots, provenance en het mutatielog.

De versie controleert schema's, rechtenverklaringen, timestamps, identiteit, nullwaarden, meetdefinities, seizoenen, snapshots, correcties, idempotentie en opslagfouten. Maximaal 1 MiB per upload, 100 competities, 3000 spelers, 20 actieve jobs, 200 bewaarde jobs en 200 snapshots per club. Een rechtenverklaring of geldig provider-ID is geen onafhankelijke verificatie.

Lees [het importschema](docs/IMPORT_SCHEMA.md), [het API-contract](docs/IMPORT_CONTRACT.md) en [migratie en rollback](docs/MIGRATION_ROLLBACK.md). Het Python-importformaat wordt niet ongemerkt als hetzelfde schema behandeld.

## Verificatie

```sh
npm ci --ignore-scripts
npm run verify
npx playwright install chromium
npm run test:browser
npm run test:accounts
npm run test:recovery
npm run test:profiles
npm run test:offline
npm run test:cli
```

`tools/browser-accounts.mjs` test de standaard accountserver, twee clubs, rollen, import, onderzoek, CSV, mobiel en herstart. `tools/browser-e2e.mjs` behoudt de uitgebreide importregressie via een expliciet gekozen legacy-testserver. `tools/offline-smoke.mjs` controleert de standalone demo en edge-handler. Playwright is een vastgezette ontwikkelafhankelijkheid. Gebruik desgewenst een aanwezige Edge met `BROWSER_CHANNEL=msedge`; `OMNISCOUT_PLAYWRIGHT_PATH` is een optioneel extern pakketpad.

De Python-referentie heeft eigen tests, uitgevoerd vanuit `reference/python-prototype/`:

```sh
python -m unittest discover -s tests -v
```

Actuele commando's en ruwe resultaten staan in `reports/v0.5/`. Eerder bewijs blijft in `reports/v0.3/` en `reports/current/` bewaard. Oudere bestanden in `reports/`, `handoff/checks/` en Python-`evidence/` zijn historisch bewijs. Het oorspronkelijke `HANDOFF_MANIFEST.json` controleert het invoerpakket; gewijzigde projectbestanden worden na ontwikkeling terecht als gewijzigd gerapporteerd.

## GitHub, ontwikkelworkers en hosting

De volledige bronovername is gepubliceerd in [PR #1](https://github.com/chatgpt20251991/Scoutingtool/pull/1), branch `codex/omniscout-accounts`. Publicatie via de gekoppelde GitHub-integratie werkt nu. De v0.2-bronboom in commit `3f54df2fdee7ba285249c86b84846fad0eb4b63e` is exact gelijk aan de eerder geteste lokale bronboom; de bijbehorende GitHub Actions-run is geslaagd. V0.3 is gepubliceerd als commit `54e6dfd6c05b8bb2d35629ec98300902f7af5ceb` met geslaagde CI. PR #1 en #2 zijn op verzoek samengevoegd: main bevat v0.4 in commit `64d9ea4ef4a819ac5e8b3397d46122b73ea5c32d`. V0.5 bouwt verder op `codex/omniscout-real-profiles`. De actuele PR en het eindrapport geven de definitieve commit en CI-status.

A/B/C zijn daadwerkelijk als subagents uitgevoerd; D controleerde de integratie onafhankelijk. Eén integrator beheert gedeelde bestanden en commits. GitHub Actions voert Node-, Python- en native Chromium-browsertests uit en bewaart browserbewijs als artifact.

De Cloudflare-handler blijft een afzonderlijke alleen-lezen synthetische demo. De lokale edge-handler is getest, maar Wrangler/workerd en deployment zijn niet uitgevoerd. De Wikidata-aansluiting doet alleen expliciete openbare profielaanvragen. Er zijn geen publieke omgeving, periodieke inzameling, credentials, providerkosten of LLM toegevoegd.

## Productgrenzen

Behoud onzekerheid en tegenbewijs. Null is geen nul. Zonder betrouwbare minuten volgt geen waarde per 90. Niet-aangesloten competities zijn geen talentloze competities. De gedocumenteerde en verkennende lijsten gebruiken uitlegbare demonstratieregels; geen universele talentscore of bewezen voorspelling.

Accounts en clubscheiding zijn lokaal getest. Publieke TLS-hosting, MFA, wachtwoordherstel, daadwerkelijke retentieverwijdering, externe identiteitscontrole en een onafhankelijke productieaudit ontbreken nog. Actieve schijfgegevens en lokale vorige-statekopieën zijn niet versleuteld; de download- en serverback-ups zijn dat wel. De echte profielweergave gebruikt openbare bronclaims; gebruik voor overige ontwikkeling synthetische testgegevens. Er is nog geen opensourcelicentie namens de eigenaar verleend. Het concrete vervolg staat in [NEXT_CODEX_TASK.md](docs/NEXT_CODEX_TASK.md).
