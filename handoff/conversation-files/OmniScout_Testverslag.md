# Testverslag Omni-Scout 0.1.0

Datum levering: 8 september 2026. Dit verslag gaat uitsluitend over software met fictieve testgegevens.

## Resultaten

| Controle | Werkelijk resultaat |
|---|---|
| Node-syntaxcontrole | Geslaagd; zie `syntax-check.txt` en `verification-run.txt`. |
| Logica, API, opslag en workerhandler | 55 geslaagd, 0 mislukt, 0 overgeslagen. |
| Chromium-interfacecontroles | 13 geslaagd, geen onverwachte JavaScript-fouten in deze routes. |
| Zelfstandige HTML-build | Bestand en edge-assets gegenereerd. Geen publicatie. |
| GitHub-write | Mislukt: HTTP 403, Resource not accessible by integration. |
| Codex-task / GitHub Actions / deployment | Niet gestart of uitgevoerd. |

## Uitgevoerde commando's

```sh
npm run check
node --test --test-reporter=tap tests/*.test.mjs
npm run preview:build
python tools/browser-tests.py --content-only
npm run verify
```

Node v22.16.0. Browser: lokaal aanwezige Chromium via Python Playwright. De browsertest gebruikt 1512 pixels desktopbreedte en 390 pixels mobiele breedte.

## Wat de 55 Node-tests bestrijken

Onbekende waarden versus nul, per-90-rekenen, leeftijd op peildatum, minderjarigen uitsluiten, bronrechten, datumgrenzen, bronactualiteit, identiteit, kleine steekproeven, rolgegevens, vergelijkbare feedversies, tegenbewijs, filters, CSV-formule-injectie en snapshotvalidatie. Daarnaast lokale Host/Origin/sessietokencontroles, invoerlimieten, vaste bestandsroutes, verplichte beslisredenen/onderzoeksuitkomsten, taak-idempotentie, fouten bij beschadigde opslag, vijftien geserialiseerde gelijktijdige mutaties en alleen-lezen gedrag van de edge-handler.

De tests controleren specifieke gevallen, niet iedere mogelijke fout of alle productiebeveiliging. De worker is met een nagebootste ASSETS-binding getest, niet in Cloudflare/workerd.

## Wat de 13 browsercontroles bestrijken

De twaalf fictieve spelers worden getoond; zoeken en onbekende waarden; dossier met tegenbewijs en broninfo; taak aanmaken; schriftelijke uitkomst en afronden; shortlist bij schermwisseling; vergelijking en Escape; clubvraag toepassen; dekking en niet-aangesloten competitie; mutatielog; mobiele bediening zonder documentoverflow; laden van de zelfstandige HTML zonder externe assets; geen ongehanteerde JavaScript-fouten in de gecontroleerde routes.

De mobiele kandidatenlijst gebruikt kaarten zodat rol, leeftijd, land, niveau, minuten, rolstatistiek en bewijsklasse zichtbaar blijven.

## Belangrijke testgrens

De beheerde browseromgeving gaf `net::ERR_BLOCKED_BY_ADMINISTRATOR` bij navigatie naar lokale HTTP- en bestandsadressen. Dat beleid is niet omzeild. De geslaagde interfacechecks laden de zelfstandige HTML rechtstreeks in browsergeheugen (`page.set_content`). In die omgeving was browseropslag niet beschikbaar; de zichtbare tijdelijke-geheugenmodus is gebruikt.

HTTP-routes en echte schijfopslag zijn apart met Node getest. **De combinatie browser → lokale HTTP-server → schijf is hier niet end-to-end geverifieerd.** Browseropslag na herladen, werkelijk openen via dubbelklik, browsergestuurde CSV-download en Windows-uitvoering zijn daardoor geen voltooide testclaims. Het script zonder `--content-only` is meegeleverd om die vervolgstap in een geschikte omgeving uit te voeren.

Zie `browser-http-limitation.txt` voor de oorspronkelijke fout en `browser-tests.json`/`browser-test-run.txt` voor de geslaagde beperkte run.

## Wat deze resultaten niet bewijzen

Geen bugvrijheid, volledige toegankelijkheid, productiebeveiliging, multi-tenantisolatie, echte datalicentie, volledige werelddekking of betere voorspelling van voetbaltalent. Die zaken moeten afzonderlijk worden ontworpen en gecontroleerd. Er zijn geen echte scoutcases of toekomstige spelersuitkomsten gebruikt.
