# Volgende ontwikkelstap na echte openbare profielen

**8 september 2026 · na v0.5.** De Node-app kan nu echte volwassen voetbalprofielen bij Wikidata zoeken en ophalen. De aparte profielweergave en gegenereerde offline HTML hebben bronrevisies, expliciete onbekenden en geen fictieve prestatiecijfers. De oorspronkelijke Python-bronnen blijven behouden. Actueel bewijs staat in `reports/v0.5/`.

## Wedstrijddata als eerstvolgende productstap

Voor minuten, wedstrijden, recente clubs, competitie-/seizoensdekking en gemeten prestaties is een passende voetbalbron nodig. De eigenaar moet de concrete provider of toegestane export aangeven; een naam-/profielbron bewijst die cijfers niet. Gebruik alleen de daadwerkelijk toegestane toegang en beoordeel rechten, kosten, verwerking, retentie en publieke/private presentatie.

Bouw daarna een gerichte adapter tegen het bestaande importschema. Leg meetdefinities en tijdsvensters vast, behoud nullwaarden, provenance en afzonderlijke provider-ID's. Test correcties, tegenstrijdige identiteiten, deadlines, rate limits, bronrechtenverval, ontbrekende gegevens en atomische verwerking. Een Wikidata-QID mag niet automatisch op naam aan een andere provider worden gekoppeld. Voeg geen universele talentscore of onbewezen clubfit toe.

De eerste echte profielen zijn een verbindingstest met expliciet gekozen bekende spelers. Dit is geen selectie van verborgen talent, dekking van alle landen of complete lagere-divisieradar. Voor die ambitie moeten concrete bronnen en competities aantoonbaar worden aangesloten.

## Van profiel naar onderzoekswerk

Het openbare scherm is nu alleen-lezen; zijn tijdelijke cache hoort niet bij clubback-ups. Ontwerp bewust hoe een scout een gecontroleerde bronidentiteit vastlegt als onderzoekskandidaat zonder onbetrouwbare actuele club-, competitie- of prestatievelden te verzinnen. Houd originele revisies en menselijke beoordeling naast elkaar. Voeg daarvoor een expliciet opslag-/importcontract en back-up-/rechtenregels toe.

## Operationeel en publiek gebruik

Bestaande back-ups, gecontroleerd herstel en bewaarinventarisatie blijven aanwezig. Beheer van tien private herstelkopieën, externe back-upopslag, operationele herstelproeven en daadwerkelijke retentieverwijdering zijn nog vervolgwerk. De bewaarinventarisatie verwijdert niets.

Leg vóór publieke hosting het doel, toegestane gegevens, beheerrollen en verantwoordelijkheden vast. TLS, MFA, veilig wachtwoordherstel, transactionele opslag, monitoring en onafhankelijke beveiligingsreview zijn nog nodig. De loopbackgrens wordt niet simpelweg verwijderd. Actieve schijfgegevens en lokale vorige-statekopieën zijn niet door de app versleuteld.

## Oplevering

Behoud de bestaande code, voer relevante tests werkelijk uit en leg raw logs vast. Gebruik onafhankelijke workers met afgesproken bestanden. Publiceer alleen synthetische tests en broncode, geen opgehaalde profielbestanden, accounts of clubdossiers. Rapporteer de werkelijke commit, PR/merge en CI, bronophalingen, resterende afhankelijkheden en deployment afzonderlijk. Dit document start geen betaalde bron, publieke omgeving of geplande inzameling.
