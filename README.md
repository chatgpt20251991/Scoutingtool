# Omni-Scout · Scoutingtool

**Versie 0.3.0 — lokaal onderzoeksprototype, 8 september 2026.** Node is het hoofdproject; de volledige Python-app blijft ongewijzigd onder `reference/python-prototype/`. Oorspronkelijke ZIPs, bouwbrieven, demo's en screenshots zijn behouden.

De radar bevat 12 fictieve spelers en 8 fictieve competities. De afzonderlijke importdataset begint leeg. Er zijn geen live dataproviders, AI-modellen of productieaccounts aangesloten.

## Starten

Node.js 22+; geen externe npm-afhankelijkheden voor het draaien van de applicatie.

```sh
npm start
```

Open http://127.0.0.1:4173. Windows: `START_WINDOWS.cmd`. Maak bij de eerste start je account en eerste club aan. De server luistert uitsluitend op loopback en vergrendelt de gegevensmap voor één proces. Accounts staan in `.local/accounts.json`; iedere club heeft eigen opslag onder `.local/organizations/`.

## Accounts en clubwerkruimten

Kies een club via de clubkiezer. In **Account & club** kun je een nieuwe lege club maken, leden uitnodigen, rollen beheren, opslagstatistieken bekijken en je wachtwoord wijzigen. Een uitnodiging maakt één nieuwe account aan en verloopt na 48 uur. Deel de code zelf; de app verstuurt geen e-mail. `viewer` leest, `scout` verwerkt scoutinggegevens en imports, `owner` beheert ook leden. De laatste eigenaar blijft beschermd.

Elke API-aanvraag controleert de sessie en het actuele clublidmaatschap, ook voor exports en jobs. Wachtwoorden worden met scrypt gehasht; sessies gebruiken HttpOnly-cookies en afzonderlijke CSRF-controle. Wachtwoordwijziging trekt alle oude sessies in. Na serverherstart moet iedereen opnieuw aanmelden, terwijl accounts en clubgegevens bewaard blijven. Clubwissel en afmelden wissen eerder geladen clubinhoud uit de interface.

Bestaande v0.2-opslag wordt eenmalig naar de eerste club gemigreerd; het oorspronkelijke `.local/state.json` blijft behouden. Bij een fout blijft de claim aan die club gebonden en is gecontroleerd herstel nodig. Lees [accountbeveiliging](docs/AUTH_SECURITY.md) en [opslag, proceslock en migratieherstel](docs/ORGANIZATION_STORAGE.md).

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
npm run test:offline
npm run test:cli
```

`tools/browser-accounts.mjs` test de standaard accountserver, twee clubs, rollen, import, onderzoek, CSV, mobiel en herstart. `tools/browser-e2e.mjs` behoudt de uitgebreide importregressie via een expliciet gekozen legacy-testserver. `tools/offline-smoke.mjs` controleert de standalone demo en edge-handler. Playwright is een vastgezette ontwikkelafhankelijkheid. Gebruik desgewenst een aanwezige Edge met `BROWSER_CHANNEL=msedge`; `OMNISCOUT_PLAYWRIGHT_PATH` is een optioneel extern pakketpad.

De Python-referentie heeft eigen tests, uitgevoerd vanuit `reference/python-prototype/`:

```sh
python -m unittest discover -s tests -v
```

Actuele commando's en ruwe resultaten staan in `reports/v0.3/` en `reports/current/`. Oudere bestanden in `reports/`, `handoff/checks/` en Python-`evidence/` zijn historisch bewijs. Het oorspronkelijke `HANDOFF_MANIFEST.json` controleert het invoerpakket; gewijzigde projectbestanden worden na ontwikkeling terecht als gewijzigd gerapporteerd.

## GitHub, ontwikkelworkers en hosting

De volledige bronovername is gepubliceerd in [PR #1](https://github.com/chatgpt20251991/Scoutingtool/pull/1), branch `codex/omniscout-accounts`. Publicatie via de gekoppelde GitHub-integratie werkt nu. De v0.2-bronboom in commit `3f54df2fdee7ba285249c86b84846fad0eb4b63e` is exact gelijk aan de eerder geteste lokale bronboom; de bijbehorende GitHub Actions-run is geslaagd. De accountuitbreiding wordt in dezelfde PR aangeleverd. De actuele PR en het eindrapport geven de definitieve commit en CI-status.

A/B/C zijn daadwerkelijk als subagents uitgevoerd; D controleerde de integratie onafhankelijk. Eén integrator beheert gedeelde bestanden en commits. GitHub Actions voert Node-, Python- en native Chromium-browsertests uit en bewaart browserbewijs als artifact.

De Cloudflare-handler blijft een afzonderlijke alleen-lezen synthetische demo. De lokale edge-handler is getest, maar Wrangler/workerd en deployment zijn niet uitgevoerd. Er zijn geen publieke omgeving, periodieke inzameling, credentials, providerkosten of LLM toegevoegd.

## Productgrenzen

Behoud onzekerheid en tegenbewijs. Null is geen nul. Zonder betrouwbare minuten volgt geen waarde per 90. Niet-aangesloten competities zijn geen talentloze competities. De gedocumenteerde en verkennende lijsten gebruiken uitlegbare demonstratieregels; geen universele talentscore of bewezen voorspelling.

Accounts en clubscheiding zijn lokaal getest. Publieke TLS-hosting, MFA, wachtwoordherstel, versleutelde back-ups, retentie/verwijdering, externe identiteitscontrole en een onafhankelijke productieaudit ontbreken nog. Gebruik synthetische, niet-vertrouwelijke testgegevens. Bestaande accounts toevoegen aan een andere bestaande club is nog geen afzonderlijke workflow. Er is nog geen opensourcelicentie namens de eigenaar verleend. Het concrete vervolg staat in [NEXT_CODEX_TASK.md](docs/NEXT_CODEX_TASK.md).
