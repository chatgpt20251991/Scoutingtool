# START HIER — Omni-Scout naar Codex en workers

> Uitgevoerd op 8 september 2026: volledige lokale bronovername, Node-importuitbreiding, echte subagentwerkpakketten en native browser-naar-backendtests. Actuele status: `docs/IMPLEMENTATION_STATUS.md` en `reports/current/`. GitHub-publicatie blijft geblokkeerd door integratie-HTTP 403 en ontbrekende Git-aanmelding. Onderstaande opdracht en verpakkingsstatus zijn behouden als oorspronkelijke context; het nieuwe vervolg staat in `docs/NEXT_CODEX_TASK.md`.

Datum: 8 september 2026. Repositorydoel: `chatgpt20251991/Scoutingtool`.

## Feitelijke overdrachtsstatus

Dit is een lokaal samengesteld, repositoryklaar bronpakket. Het is **niet** automatisch doorgestuurd naar Codex, niet naar GitHub geschreven en niet op een worker gedeployd.

De laatste echte controle vond de openbare repository, nog leeg. De schrijfpoging voor `AGENTS.md` kreeg **HTTP 403 — Resource not accessible by integration**. Er is geen commit-ID, pull request, Codex-taak-ID of actieve worker. Deze instructie is geen taakstart.

## Opdracht aan de uitvoerende Codex-sessie

Neem dit volledige project over en bouw verder op de bestaande code. Maak niet opnieuw alleen een bouwbrief of een visueel model. Je hebt twee complete, verschillende implementaties: de nieuwste Node-versie in de hoofdmap en de eerdere Python-versie onder `reference/python-prototype/`. Importeer en behoud ze beide; vermeng de twee applicaties niet ongecontroleerd.

Lees eerst `AGENTS.md`, `docs/BUILD_BRIEF.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/NEXT_CODEX_TASK.md`, `handoff/WORKER_OPDRACHTEN.md` en `handoff/VERSIEKAART.md`. De uitgebreide bouwbrief v2 bewaart de totale ambitie, niet alleen de eerste proef.

### Stap 1 — controleer de bestanden en de bestemming

Voer `python handoff/verify_bundle.py` uit vóór je bestanden wijzigt. Controleer daarna de echte repositorycheckout, remote, branch en lokale wijzigingen. De GitHub-repository is openbaar: geen sleutels, eigen clubdata of persoonlijke dossiers toevoegen. Overschrijf geen niet-gecommitteerd werk. Gebruik de aangewezen repository, geen andere repository met een vergelijkbare naam.

Bij een lege repository: importeer de projectinhoud. Bij een inmiddels gevulde repository: vergelijk eerst en integreer zonder bestaande wijzigingen te verwijderen. Gebruik een eigen werkbranch, bijvoorbeeld `codex/omniscout-handoff`, zodra dat met de werkelijke repositorytoegang kan. Gebruik nooit force-push.

Voer `npm run verify` uit vanuit de hoofdmap. De eerdere Python-versie heeft haar eigen tests: `python -m unittest discover -s tests -v`, uitgevoerd vanuit `reference/python-prototype/`.

### Stap 2 — verdeel daadwerkelijke ontwikkeltaken

Gebruik de werkpakketten in `handoff/WORKER_OPDRACHTEN.md`. Start alleen onafhankelijke workers wanneer deze Codex-omgeving daar werkelijk ondersteuning voor biedt; voer de taken anders in dezelfde sessie uit. Noem alleen taken actief waarvoor een werkelijke startbevestiging bestaat. Laat één integrator gedeelde contracten en wijzigingen beheren. De term ontwikkelworker is hier iets anders dan een Cloudflare-runtimeworker.

### Stap 3 — bouw de volgende werkende verticale uitbreiding

Behoud de bestaande desktop-/mobiele radar, shortlist, vergelijking, dossiers, onderzoeksacties en het beslislog. Voeg aan de Node-hoofdapp een gecontroleerde JSON-import en een lokale verwerkingstaak toe. Gebruik de Python-implementatie en haar tests als referentie, niet als automatisch bewezen productiecomponent.

Behandel minstens: schema-versies, nullwaarden, meetdefinities, bronrechten, beschikbaarheidsdatums, seizoenen, snapshots, identiteitsconflicten, broncorrecties, idempotentie en een herstelbaar mutatielog. Geef vóór import een controleoverzicht en schrijf niets wanneer validatie faalt. Scheid demo en import strikt.

Wereldwijde verborgen-talentenradar en lagere, regionale en amateurdivisies blijven kernfuncties. Filters moeten echte aangesloten dekking weergeven. Niet aangesloten competities zijn geen talentloze competities. Houd gedocumenteerde kandidaten en interessante maar onvoldoende onderzochte kandidaten apart. Toon geen wereldwijde topspelersranglijst uit niet-vergelijkbare data.

### Stap 4 — test de hele route

Voer echte browser-naar-backendtests uit in een toegestane browseromgeving. Test import, dossier, shortlist, vergelijking, onderzoek, export, herladen en duurzame opslag samen. De eerdere browserrapporten hadden expliciete netwerkbeperkingen; hergebruik ze niet als bewijs dat deze integratietest al is geslaagd. Omzeil geen beheerbeleid.

Test ongeldige bestanden, overschrijding van maximale grootte, ontbrekende en nul-minuten, bronrechtenverval, toekomstige gegevens, identieke namen, dubbele imports, bronnencorrecties, HTML/script-inhoud als data en fouten tijdens opslag. Bewaar uitgevoerde commando's en ruwe logs.

### Stap 5 — overdracht afronden en vervolg voorbereiden

Maak een commit en PR wanneer de echte GitHub-toegang dit toelaat. Lever de werkelijke identifiers. Het pushen van broncode is hier gevraagd; koop geen diensten en publiceer geen echte klantgegevens. Wijzig niet zelfstandig accountmachtigingen.

De bestaande Cloudflare-handler is alleen een niet-gedeployde demo. Maak bij verdere workerbouw onderscheid tussen lokale queue, testomgeving en live hosting. Start geen publiek toegankelijke productieomgeving, betaalde provider of periodieke inzameling zonder geldige autorisatie, gebruiksrechten en veilige configuratie. Voeg geen LLM-provider toe zonder de vereiste sleutel- en kostenbeslissing.

## Concrete oplevering

Werkende broncode, uitgevoerde tests, importdocumentatie, migratie-/rollbacknotities, gerealiseerde GitHub-commit/PR wanneer toegestaan, en de precieze resterende blokkades. Rapporteer code, taakstart, data-aansluiting en deployment apart. Geen claims als bugvrij, productiegeschikt, wereldwijd complete data of wetenschappelijk bewezen talentvoorspelling.

## Wat zit in dit pakket?

De Node-hoofdapp, de volledige eerdere Python-app, beide oorspronkelijke ZIPs ongewijzigd, beide bouwbrieven, beide interactieve demo's, alle meegeleverde testlogs en screenshots, nieuwe hertestlogs, de worker-opdrachten en een SHA-256-bestandsmanifest.

## Bekende status op het moment van verpakken

Node: `npm run verify` slaagde met 55 tests. Python: 62 unittest-tests slaagden. Browsercontroles zijn bij deze overdracht niet opnieuw uitgevoerd. Dit verifieert softwaregedrag, niet scoutingkwaliteit. Geen echte dataprovider of AI-model aangesloten. Geen externe Codex- of worker-taak gestart.
