# Volgende ontwikkelstap na lokale accounts en clubwerkruimtes

**8 september 2026 · richting na v0.3.** Node blijft het hoofdproject; de volledige Python-app blijft ongewijzigde referentie. De lokale importuitbreiding is opgevolgd door accounts, rollen, clubopslag, eenmalige legacy-overname en een bijbehorende interface. Dit is geen publiek gehost productieplatform.

GitHub is inmiddels bereikbaar: [PR #1](https://github.com/chatgpt20251991/Scoutingtool/pull/1) bestaat en de gepubliceerde v0.2-commit `3f54df2fdee7ba285249c86b84846fad0eb4b63e` heeft geslaagde CI. De actuele integratiebranch is `codex/omniscout-accounts`. De integrator moet de uiteindelijke v0.3-tests en publicatie nog afzonderlijk vastleggen; neem de voorgaande CI-uitkomst niet over als bewijs voor een latere commit. Kijk voor feitelijk uitgevoerde controles in `reports/current/` en `IMPLEMENTATION_STATUS.md`.

## Eerst: gecontroleerde back-up, herstel en retentie

Maak een lokaal beheerwerkpakket waarmee een eigenaar gegevensverlies kan voorkomen en herstel kan beoordelen vóór er bestaande opslag wordt gewijzigd.

1. Definieer een versiegebonden back-upformaat met manifest, bestandsomvang en integriteitscontroles. Maak onderscheid tussen export van één club en volledige serverherstelkopieën met accountopslag. Een clubexport mag geen accounts, uitnodigingsdigests of gegevens van andere clubs bevatten. Sessie- en CSRF-geheimen worden nooit opgenomen.
2. Bouw een consistente lokale kopie terwijl accountmutaties en importverwerking gecontroleerd zijn stilgezet of uitgedraaid. Een verzameling op willekeurige tijdstippen gekopieerde bestanden is geen aantoonbaar consistente back-up. Bewaar de bestaande bron ongewijzigd.
3. Laat herstel eerst in een geïsoleerde stagingmap valideren: schema, paden, hashes, organisatie-ID's, lidmaatschappen, importrechten, snapshots, jobs en limieten. Blokkeer padtraversal en koppelingen. Toon een concreet herstelplan en vervang bestaande gegevens pas na een expliciete eigenaarsactie; behoud een bruikbare terugweg.
4. Maak retentie per gegevenssoort en bron expliciet. Begin met een niet-destructieve voorvertoning van wat behouden, geblokkeerd of verwijderd zou worden. Houd rekening met gedeelde provenance, correcties, onderzoeksnotities, snapshots, wachtende jobs en exports. Een opslaglimiet is geen verwijderbeleid en een technisch ontwerp bewijst geen juridische grondslag.
5. Test daadwerkelijk herstel naar een nieuwe datamap en herstart. Negatieve gevallen omvatten beschadigde of incomplete bestanden, een volle schijf, afgebroken herstel, verlopen rechten, verkeerde club, twee gelijktijdige herstelverzoeken en herhaalde uitvoering. Rapporteer zowel teruggevonden gegevens als eventuele beperkingen.

Voor wachtwoordherstel is een afzonderlijk bevoegdheidsontwerp nodig. Gebruik geen verborgen standaardaccount, universeel noodwachtwoord of endpoint waarmee een willekeurige lokale browser eigenaar kan worden.

## Daarna: bestaande accounts uitnodigen voor een bestaande club

De huidige uitnodiging maakt één nieuwe account aan. Een bestaande account kan wel een nieuwe lege club maken, maar kan nog geen uitnodiging voor een andere bestaande club accepteren. Werk deze ontbrekende samenwerking uit met een gerichte uitbreiding:

- Een aangemelde gebruiker accepteert een geldige uitnodiging na een expliciete controle van club en toegekende rol. De server bepaalt gebruiker, club en rol; de client kan geen ander account of hogere rol invullen.
- Accepteren maakt uitsluitend een lidmaatschap. Het kopieert of combineert geen scoutinggegevens en verandert geen wachtwoord. Herhaald accepteren, een reeds bestaand lidmaatschap, een verlopen code en een ingetrokken uitgevende eigenaar hebben vastgelegde, geteste uitkomsten.
- Een uitnodiging wordt atomisch verbruikt. Rollen van een bestaand lid worden niet stilzwijgend verhoogd door opnieuw accepteren. Geef een eigenaar ook zicht op openstaande uitnodigingen en een expliciete intrekkingsactie, zonder eerder getoonde ruwe codes terug te geven.
- Controleer beide clubs in browser- en API-tests: gelijke speler-, job- en verzoek-ID's blijven gescheiden, exports blijven bevoegd, de clubwissel wist vorige dossierinhoud en verwijderen of degraderen werkt ook in bestaande sessies.

## Productieauthenticatie en hosting als afzonderlijk pakket

De lokale scrypt-accounts, rollen en mappen per club vervangen geen productieontwerp. Beoordeel vóór publieke hosting een beheerde identiteitsprovider of passend accountmodel, TLS, MFA, veilige account- en wachtwoordherstelstromen, sessie-intrekking over meerdere processen, transactionele opslag, beheerrollen, logging, monitoring, back-upbeveiliging en onafhankelijke beveiligingstoetsing.

Leg eerst het hostingdoel, de toegestane gegevens, beheerbevoegdheden en operationele verantwoordelijkheden vast. Publiceer geen lokale accountserver door alleen de loopbackbeperking te verwijderen. Een CI-run of codepublicatie is geen deployment en bewijst geen beveiligde productieomgeving.

## Dataproviders en scoutingwaarde

Sluit een provider pas aan nadat die concrete bron, het gebruik en de verwerking zijn geautoriseerd en de benodigde configuratie beschikbaar is. Leg rechten, doeleinden, datadekking, tijdsvelden, retentie, rate limits en kosten vooraf vast. Geen ongeautoriseerde scraping, betaald gebruik, live request of LLM-aanroep. Gebruik de bestaande adaptergrens en houd demo en import gescheiden.

De oorspronkelijke ambitie blijft wereldwijd verborgen talent zichtbaar maken, inclusief lagere, regionale en amateurdivisies. Breid dekking aantoonbaar uit; presenteer geen fictieve profielen als echte spelers en geen ontbrekende bron als ontbrekend talent. Behoud onzekerheid, tegenbewijs, expliciete identiteit en onbekende statistieken. Gebruik prospectieve, onafhankelijke evaluatie om te onderzoeken of de volgende scoutingactie meer waarde oplevert. Voeg geen universele talentscore of ongevalideerde wereldranglijst toe.

## Werkverdeling en oplevering

Verdeel de volgende stap in aparte eigendomsgebieden: opslag/back-up, herstel/retentie, accountuitnodigingen, interface en onafhankelijke integratiecontrole. Eén integrator beheert gedeelde API-contracten, commits, remote-synchronisatie en eindverificatie. Gebruik workers wanneer beschikbaar; een geschreven opdracht is op zichzelf geen lopende taak.

Voer de controles uit die bij de uiteindelijke wijziging horen, bewaar ruwe resultaten en rapporteer afzonderlijk geïmplementeerde code, uitgevoerde tests, daadwerkelijke GitHub-commit/PR/CI, openstaande blokkades en deploymentstatus. Controleer de remote op nieuw werk vóór publicatie en gebruik geen force-push om andermans wijzigingen te vervangen. Dit vervolgdocument start geen hosting, providerverwerking of nieuwe taak.
