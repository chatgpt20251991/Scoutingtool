# Omni-Scout · Scoutingtool

**Versie 0.2.0 — lokaal onderzoeksprototype, 8 september 2026.** Node is het hoofdproject; de volledige eerdere Python-app blijft ongewijzigd onder `reference/python-prototype/`. De oorspronkelijke ZIPs, bouwbrieven, demo's en screenshots zijn behouden.

De radar bevat 12 fictieve spelers en 8 fictieve competities. De nieuwe, afzonderlijke importdataset begint leeg. Er zijn geen live dataproviders, AI-modellen of productieaccounts aangesloten.

## Starten

Node.js 22+; geen externe npm-afhankelijkheden voor de applicatie.

```sh
npm start
```

Open http://127.0.0.1:4173. Windows: `START_WINDOWS.cmd`. De server luistert uitsluitend op loopback. Gebruik één proces per `.local/state.json`.

## Nieuwe lokale import

Open **Bronimport**, download het synthetische voorbeeld of kies `samples/import-demo.json`, controleer rechten, seizoenen, peildatum, aantallen en waarschuwingen, en bevestig de import. Een geslaagde preview schrijft niets. De lokale queue controleert opnieuw en toont de werkelijke taakstatus. Kies **Lokale import** om de geïmporteerde radar, dossiers, shortlist, vergelijking en onderzoeksopdrachten te gebruiken.

Demo en import hebben gescheiden catalogi, besluiten, opdrachten en clubvragen. Imports worden uitsluitend in het lokale statebestand opgeslagen; browseropslag bevat geen importdossiers. CSV en JSON-export respecteren afzonderlijke actuele bronrechten. Rollback behoudt snapshots, eerdere provenance en het mutatielog.

De versie controleert schema's, rechtenverklaringen, timestamps, identiteit, nullwaarden, meetdefinities, seizoenen, snapshots, correcties, idempotentie en opslagfouten. Maximaal 1 MiB per upload, 100 competities, 3000 spelers, 20 actieve jobs, 200 bewaarde jobs en 200 snapshots. Een rechtenverklaring of geldig provider-ID is geen onafhankelijke verificatie.

Lees [het importschema](docs/IMPORT_SCHEMA.md), [het API-contract](docs/IMPORT_CONTRACT.md) en [migratie en rollback](docs/MIGRATION_ROLLBACK.md). Het eerdere Python-importformaat wordt niet ongemerkt als hetzelfde schema behandeld.

## Verificatie

```sh
npm ci --ignore-scripts
npm run verify
```

De Python-referentie heeft haar eigen tests, uitgevoerd vanuit `reference/python-prototype/`:

```sh
python -m unittest discover -s tests -v
```

De nieuwe native browserroute staat in `tools/browser-e2e.mjs`: echte browsernavigatie naar de Node-backend, upload, dossier, shortlist, vergelijking, onderzoek, download, herladen, serverherstart, mobiel en rollback. `tools/offline-smoke.mjs` controleert afzonderlijk de standalone demo en de edge-handler. Deze optionele ontwikkelcontroles vereisen Playwright en een beschikbare Chromium-browser; zet zo nodig `OMNISCOUT_PLAYWRIGHT_PATH` naar het Playwright-pakket en `BROWSER_CHANNEL=msedge`.

```sh
npm run test:browser
node tools/offline-smoke.mjs
```

Actuele uitgevoerde commando's en ruwe resultaten staan in `reports/current/`. Oudere bestanden in `reports/`, `handoff/checks/` en de Python-`evidence/` zijn historisch bewijs. Het oorspronkelijke `HANDOFF_MANIFEST.json` controleert het ongewijzigde invoerpakket; na ontwikkeling worden gewijzigde projectbestanden terecht als gewijzigd gerapporteerd.

## GitHub, werkpakketten en hosting

Doel: `chatgpt20251991/Scoutingtool`, openbaar en bij start leeg. De volledige bronovername is lokaal gecommit; ontwikkeling gebeurt op `codex/omniscout-handoff`. A/B/C zijn daadwerkelijk als subagents uitgevoerd, D als onafhankelijk vervolgwerkpakket; één integrator beheert gedeelde bestanden en commits.

Publicatie blijft geblokkeerd: Git heeft geen bruikbare HTTPS-aanmelding en de gekoppelde GitHub-integratie weigert blob-schrijfacties met HTTP 403 `Resource not accessible by integration`. Er is geen gepubliceerde commit, PR of GitHub Actions-run voor deze levering. De exacte lokale commit wordt na afronding in het eindrapport vermeld.

De bestaande Cloudflare-handler blijft een afzonderlijke alleen-lezen synthetische demo. De lokale edge-handler is getest, maar Wrangler/workerd en deployment zijn niet uitgevoerd. Er zijn geen publieke omgeving, periodieke inzameling, credentials, providerkosten of LLM toegevoegd.

## Productgrenzen

Behoud onzekerheid en tegenbewijs. Null is geen nul. Zonder betrouwbare minuten volgt geen waarde per 90. Niet-aangesloten competities zijn geen talentloze competities. De gedocumenteerde en verkennende lijsten gebruiken uitlegbare demonstratieregels; geen universele talentscore of bewezen voorspelling.

De lokale sessiebeveiliging is geen productieauthenticatie, tenantisolatie of tamper-proof audit. Gebruik synthetische, niet-vertrouwelijke testgegevens. Accounts/organisatiescheiding, retentie, een aantoonbaar toegestane provider en relevante beoordeling blijven afzonderlijke vervolgstappen. Er is nog geen opensourcelicentie namens de eigenaar verleend.
