# Lokale import: migratie en herstel

De Node-app is het hoofdproject. De Python/SQLite-app onder `reference/python-prototype/` blijft byte-voor-byte referentiemateriaal en wordt niet door Node gestart. Beide oorspronkelijke ZIPs en de losse handoffbijlagen zijn behouden.

## Bestaande installatie bijwerken

1. Stop het bestaande Node-proces; gebruik één proces per lokaal statebestand.
2. Maak buiten Git een kopie van `.local/state.json` als dit bestaat.
3. Werk de applicatie bij en voer `npm run verify` uit. Start met `npm start` op loopback.
4. Bestaande versie-1-demobesluiten, opdrachten en clubvraag blijven op hun bestaande plek. De queue voegt `imports` en `importJobs` toe; eigen scoutingacties komen onder `importWorkspace`. Er is geen automatische conversie van Python/SQLite of van de oude Python-JSON-import.
5. Kies Bronimport, gebruik eerst `samples/import-demo.json`, controleer de preview en bevestig expliciet. Selecteer daarna Lokale import. Standalone HTML en de Cloudflare-demo ondersteunen deze import niet.

Imports worden niet naar browseropslag gekopieerd. Alleen de datasetvoorkeur wordt daar opgeslagen. De lokale JSON-opslag is niet versleuteld en geen productieauthenticatie of tenantisolatie. Gebruik synthetische, niet-vertrouwelijke testgegevens totdat de afzonderlijke productievoorwaarden zijn gerealiseerd.

## Een import terugdraaien

Gebruik Snapshot terugdraaien bij een geslaagde verwerkingsopdracht en bevestig de concrete snapshot. Draai een afhankelijke correctie eerst terug. De importhistorie en oorspronkelijke snapshots blijven bestaan; rollback is een nieuwe gebeurtenis. Eerder geldige snapshots worden opnieuw zichtbaar waar van toepassing. Eerdere scoutbesluiten worden niet herschreven. Export met verwijzingen naar ingetrokken of verlopen profielen wordt geweigerd.

Een teruggedraaide snapshot blijft teruggedraaid bij een identieke herimport. Gebruik voor een nieuwe bewuste invoer een nieuw snapshot-ID volgens het schema. Een correctie is een volledige vervanging van de aangeduide snapshot, met nieuwe waarnemings-ID's voor gewijzigde waarden; het is geen gemeten spelersontwikkeling.

## Opslagfout of onderbroken proces

Een wijziging wordt eerst naar een tijdelijk bestand geschreven en geflusht en vervolgens atomair vervangen. Bij een schrijffout blijft de vorige in-memory status behouden en wordt het tijdelijke bestand opgeruimd. Een gesimuleerde vervangingsfout en herstel zijn daadwerkelijk getest. Er is geen garantie tegen alle vormen van diskcorruptie, stroomuitval of twee gelijktijdige serverprocessen.

Opgeslagen lopende jobs worden bij herstart gecontroleerd en binnen de pogingenlimiet opnieuw ingepland. Import en successtatus worden in dezelfde store-mutatie vastgelegd. Mislukte jobs zijn zichtbaar en kunnen maximaal drie pogingen krijgen. Er zijn maximaal 20 actieve jobs, 200 bewaarde jobs en 200 snapshots. Limieten geven een fout; historie wordt niet stilzwijgend verwijderd.

Bij een onleesbaar statebestand: stop de app, bewaar het beschadigde bestand voor onderzoek en herstel de gemaakte volledige kopie buiten Git. De app wist zo'n bestand niet automatisch. Voor terugkeer naar de oude appversie: stop het proces en herstel zowel de oude code als de daarbij horende statekopie. Alleen code terugzetten is geen volledige datamigratie.

## Grenzen van historische reconstructie

De importeur verklaart event-, publicatie-, ophaal- en beschikbaarheidsdatums. De software controleert volgorde, schema en peildatum, maar verifieert niet onafhankelijk wanneer een externe bron echt beschikbaar was. Historische API-lezingen mogen huidige rechtenbeperkingen niet herstellen. Bron-/competitie-/seizoen-ID's en correcties worden gecontroleerd; cross-provider samenvoeging en historische voetbalvalidatie blijven aparte vervolgstappen.
