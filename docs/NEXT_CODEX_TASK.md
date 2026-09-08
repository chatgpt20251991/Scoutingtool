# Volgende ontwikkelstap na back-up en gecontroleerd herstel

**8 september 2026 · richting na v0.4.** Node blijft het hoofdproject; de oorspronkelijke Python-referentie, archieven en bijlagen blijven behouden. Lokale accounts, clubscheiding, import, bestaande-accountuitnodigingen, versleutelde club-/serverback-ups, herstelproeven en een bewaarinventarisatie zijn gebouwd. Bewijs staat in `reports/v0.4/`; PR en opleverrapport leggen de definitieve commit en CI vast.

## Herstelbeheer en verantwoord verwijderen

Clubherstel gebruikt een eenmalige preview en bewaart de vorige state privé, maximaal tien kopieën. Een volle herstelmap blokkeert verdere herstelpogingen. Het beheercommando herstelt actieve accounts en clubs uitsluitend naar een nieuwe datamap. Sessies, uitnodigingen, oorspronkelijke legacy-bestanden en oude herstelkopieën zijn expliciet uitgesloten.

Werk verder aan gecontroleerd beheer van oude herstelkopieën, externe opslag van versleutelde back-ups en operationele herstelproeven. Maak zichtbaar welke kopie bij welke vervanging hoort, zonder dossierinhoud aan onbevoegden te tonen. Behoud een bruikbare terugweg. Synthetische tests vervangen geen operationele oefening.

De bewaarinventarisatie verwijdert niets. Ontwerp daadwerkelijke verwijdering met vastgelegde termijnen per bron en gegevenssoort, actieve afhankelijkheden, correctieprovenance, grondslagen en beheerbevoegdheden. Toon een concreet plan en vereis expliciete bevestiging; test gedeeltelijke fouten, herhaling, gelijktijdige wijzigingen en herstart. Verlopen rechten of ouderdom alleen zijn geen juridische conclusie. Een opslaglimiet is geen verwijderbeleid.

## Productieauthenticatie en hosting

Leg hostingdoel, toegestane gegevens, beheerrollen en operationele verantwoordelijkheden vast. Beoordeel een identiteitsprovider of passend accountmodel, TLS, MFA, veilige account-/wachtwoordherstelstromen, sessie-intrekking over processen, transactionele opslag, monitoring en onafhankelijke beveiligingsreview. Verwijder niet eenvoudig de loopbackgrens van de lokale server.

Actieve lokale state en vorige-statekopieën hebben bestandstoegangsbescherming, geen schijfversleuteling. Download- en serverback-ups hebben een eigen wachtzin; een verloren wachtzin kan de app niet terughalen. Voeg geen verborgen standaardaccount of universeel noodwachtwoord toe.

## Concrete dataprovider en scoutingwaarde

Voor aansluiting ontbreekt nog een concrete providerkeuze van de eigenaar. Leg bron, gebruiksrechten, doeleinden, dekking, bewaartermijnen, configuratie en eventuele kosten vast. Gebruik daarna de bestaande adaptergrens en toegestane voorbeelddata, met gecontroleerde import, tijdsvelden, identiteit en afzonderlijke demo/importdatasets. Geen ongeautoriseerde scraping, betaald gebruik of live provider-/LLM-aanroep.

De ambitie blijft wereldwijd verborgen talent zichtbaar maken, inclusief lagere, regionale en amateurdivisies. Breid aantoonbare dekking uit; fictieve profielen blijven fictief en een niet aangesloten competitie betekent geen gebrek aan talent. Onderzoek prospectief en onafhankelijk of onderzoeksacties meer waarde opleveren. Voeg geen universele talentscore of ongevalideerde wereldranglijst toe.

## Werkverdeling en oplevering

Verdeel onafhankelijke werkzaamheden in opslag/herstelbeheer, retentiemodel, provideradapter, interface en integratiecontrole. Eén integrator beheert contracten en commits. Gebruik beschikbare workers met afzonderlijke bestanden; een opdrachtbestand is geen gestarte taak.

Controleer de remote vóór publicatie, behoud andermans werk en gebruik geen force-push. Rapporteer afzonderlijk code, uitgevoerde tests, commit/PR/CI, afhankelijkheden en deployment. Dit document start geen hosting, providerverwerking, terugkerende taak of betaald gebruik.
