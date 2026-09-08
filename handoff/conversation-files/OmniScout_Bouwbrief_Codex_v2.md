# Omni-Scout — product- en bouwbrief voor Codex

Datum: 7 september 2026
Versie: 2 — wereldwijde verborgen-talentenradar expliciet als kernfunctie.
Status: ontwerp en onderzoeksopdracht. Geen gerealiseerde applicatie, aangesloten databron, getraind voorspelmodel, uitgevoerde pilot of gestarte Codex-taak.
Werknaam: Omni-Scout; beschikbaarheid van merk en domein is niet onderzocht.

## 1. Productbesluit

Bouw een clubspecifieke scouting-onderzoekslaag boven toegestane databronnen en het eigen clubarchief. Het product ontdekt kandidaten, koppelt claims aan bewijs, toont onzekerheden en tegenbewijs, en stelt de volgende nuttige scoutingactie voor.

De kernvraag is: welke speler verdient voor deze club nu meer onderzoek, waarom, en welke observatie kan het oordeel veranderen?

De productambitie omvat nadrukkelijk een wereldwijde verborgen-talentenradar, ook voor lagere, regionale en amateurdivisies. De radar verenigt daadwerkelijk beschikbare, toegestane gegevens in één overzicht en signaleert spelers die voor de betreffende club nieuw of onvoldoende onderzocht zijn. Alle divisies zijn een uitbreidingsambitie, geen claim van bestaande of gegarandeerd volledige werelddekking. De eerste twee competities zijn een bewijsproef, niet de eindgrens van het product.

Niet als eerste bouwen: een wereldwijde concurrent van Wyscout, een eigen full-match-trackingmodel, een transfermarktplaats, een universele talentscore, psychologische profilering of een app waarin spelers betalen voor een hogere ranking.

Een combinatie van bestaande functies is geen bewijs van uniciteit. De commerciële hypothese is dat een beter geïntegreerde bewijs- en onderzoeksworkflow aantoonbaar meer bruikbare ontdekkingen per scoutuur oplevert. Deze hypothese moet worden getest.

## 2. Eerste doelgroep en afbakening

- Gebruiker: scout en recruitmentanalist.
- Budgethouder: hoofd scouting, recruitmentmanager of technisch directeur.
- Ontwerppartners: twee of drie professionele clubs.
- Eerste cohort: spelers van 18–23 jaar, één vooraf gedefinieerde veldrol, twee competities met gecontroleerde datadekking.
- Eerste geografische klantfocus: Nederland en België; geen aanname dat de regels of budgetten daar hetzelfde zijn.
- Registratie en arbeidsrechtelijke haalbaarheid worden per bestemmingsclub beoordeeld. Onbekende informatie blijft onbekend.
- Circa 200–500 spelers is een planningshypothese, geen reeds aanwezige dataset.

Kies de competities pas na bevestiging van datarechten, volledigheid, actualiteit, voldoende geschikte spelers en relevantie voor de klantvraag.

## 3. Productcontract

### Invoer

1. Clubvraag: gezochte rol, tactische taken, harde vereisten, budgetscope, tijdshorizon en acceptabele onzekerheden.
2. Toegestane gestructureerde gegevens, met provider-ID's, meetdefinities en geldige gebruiksrechten.
3. Clubrapporten, scoutobservaties en eventueel video waarvoor verwerking is toegestaan.
4. Relevante openbare bronnen uitsluitend na beoordeling van voorwaarden, privacygrondslag en opslagrechten.

### Uitvoer

Een beperkte dagelijkse of wekelijkse actielijst, geen onbegrensde stroom spelersnamen. Elk dossier bevat:

- reden van signalering en relatie met de clubvraag;
- feiten met bron, tijdstip en meetdefinitie;
- interpretaties, zichtbaar gescheiden van feiten;
- onzekerheden, tegenbewijs en omstandigheden waarin de claim niet geldt;
- status van financiële en registratiehaalbaarheid;
- volgende voorgestelde actie met onderzoeksvraag en verwachte besliswaarde;
- menselijke beoordeling en correctiemogelijkheid.

De eerste productbeslissing is bijvoorbeeld `meer_video_bekijken`, `live_observeren`, `informatie_verifiëren`, `volgen` of `niet_prioriteren`. De software neemt geen autonome contractbeslissing en benadert geen speler of club zonder expliciete autorisatie.

## 4. Gebruikersschermen

### Wereldradar en dekking

Eén doorzoekbaar overzicht van aangesloten landen, competities, niveaus, seizoenen en spelers. Filters omvatten rol, leeftijd, speelminuten, prestaties, ontwikkeling, datadiepte en bekendheid binnen de eigen club. Toon een aparte verkenningslijst voor spelers met interessante signalen en onvoldoende bewijs. Toon per competitie welke gegevens werkelijk zijn ingelezen, hoe recent ze zijn en welke ontbreken. Een niet aangesloten competitie levert niet de conclusie op dat er geen talent speelt. Zie hoofdstuk 14 voor het volledige featurecontract.

### Vandaag

Toon maximaal het ingestelde aantal relevante veranderingen. Een onveranderd spelersprofiel veroorzaakt geen nieuwe melding. Orden meldingen op relevantie, urgentie en bewijskwaliteit. Maak het onderscheid zichtbaar tussen bewezen signalen en verkennende hypotheses.

### Clubvraag

Leg rol en taken expliciet vast, niet alleen positie of formatie. Een linksback die binnenkomt in de opbouw vraagt andere bewijzen dan een linksback die de buitenlijn bezet. Laat een scout de interpretatie van een natuurlijke-taalvraag bevestigen.

### Spelersdossier

Gebruik drie hoofdzones: waarom interessant, welk bewijs ondersteunt of weerspreekt dit, en wat moet de scout nu doen? Een totaalscore mag onzekerheid niet verbergen. Toon huidige prestaties, ontwikkelhypothese, rolfit, haalbaarheid en bewijskwaliteit afzonderlijk.

### Onderzoeksopdracht

Formuleer één concrete, toetsbare vraag. Voorbeeld: beoordeel het verdedigen van ruimte achter de laatste lijn in twee volledige wedstrijden met relevante situaties. Leg ook vast wanneer de beelden onvoldoende zijn om een oordeel te geven.

### Beslislogboek

Bewaar wie wat heeft gezien, waarom een kandidaat is afgewezen of doorgezet, en welke verandering herbeoordeling rechtvaardigt. Een financiële afwijzing wordt nooit automatisch een label 'slechte speler'.

## 5. Datamodel

Begin met een relationele database. Een afzonderlijke graph database is geen MVP-vereiste. Gebruik expliciete relaties en uitbreidbare provideradapters.

Kernobjecten:

| Object | Belangrijkste velden |
|---|---|
| Organization | tenant_id, naam, rollen, toegangsbeleid |
| RecruitmentBrief | tenant_id, versie, rol, taken, constraints, budgetscope, horizon |
| Player | intern_id, provider_ids, aliassen, identiteit_status |
| Source | source_id, provider, licentie, toegestane_doelen, bewaartermijn, actualiteitsbeleid |
| Observation | speler, bron, wedstrijd, gemeten_waarde, eenheid, definitie, context |
| Claim | speler, statement, type, bewijsreferenties, tegenbewijsreferenties, status |
| Signal | brief, speler, signaaltype, onderbouwing, vervaldatum |
| EvidenceTask | onderzoeksvraag, eigenaar, inputrechten, kostenplafond, status |
| Assessment | beoordelaar, onafhankelijke_eerste_indruk, rubric, oordeel, uitleg |
| Decision | brief, speler, actie, afwijsreden, herbeoordelingstrigger |
| Outcome | tijdshorizon, waargenomen_uitkomst, context, ontbrekende_gegevens |
| AuditEvent | actor, handeling, object, tijd, versie |

### Verplichte tijdvelden

Maak onderscheid tussen:

- `event_at`: wanneer iets in de voetbalwereld gebeurde;
- `published_at`: wanneer de oorspronkelijke bron het publiceerde, indien bekend;
- `retrieved_at`: wanneer onze toepassing het ophaalde;
- `available_at`: vanaf wanneer de informatie aantoonbaar voor het systeem beschikbaar was.

Historische tests mogen alleen gegevens gebruiken die op de betreffende peildatum beschikbaar waren. Een vandaag opgehaald historisch endpoint is niet automatisch een zuivere historische momentopname.

### Bewijscontract

Elke feitelijke claim verwijst naar één of meer beschikbare bewijsobjecten. Een bewijsobject bevat bron-ID, permissiestatus, tijdstempels, locator, definitie en eventueel een checksum van rechtmatig opgeslagen materiaal. Bewaar geen volledige webpagina of video wanneer de licentie dat niet toestaat.

Classificeer informatie als gemeten feit, menselijke observatie, externe bewering, modelinterpretatie of onbekend. Kopieën van hetzelfde persbericht zijn niet meerdere onafhankelijke bevestigingen.

## 6. Analyse en prioritering

### MVP

Gebruik uitlegbare filters en signalen: veranderingen in speelminuten, basisplaatsen, selectie, rol of beschikbare clubobservaties. Corrigeer alleen voor context die werkelijk is gemeten. Geen drukbestendigheid uit alleen doelpunten en assists afleiden.

Werk met twee lijsten:

- bewezen kandidaten met voldoende relevant bewijs;
- verkennende kandidaten die extra observatie verdienen maar nog onvoldoende zijn gemeten.

Een onbekende waarde is geen nul. Onzekerheid is geen bewijs van lage kwaliteit. Verkennende kandidaten mogen niet automatisch uit alle selecties verdwijnen.

### Latere modellen

Pas na dataset- en baselinevalidatie: contextgecorrigeerde prestaties, ontwikkelcurves en overgangsmodellen tussen competities. Gebruik tijdgescheiden evaluatie, duidelijke doelvariabelen, onzekerheidsintervallen en detectie van situaties buiten het trainingsbereik.

Marktwaarde is niet identiek aan transfersom of voetbalvermogen. Toekomstige speelminuten zijn mede afhankelijk van trainerskeuzes en beschikbaarheid. Een geslaagde historische transfer bewijst niet dat dezelfde speler bij iedere andere club had gefunctioneerd.

### Actieplanner

Start met een expliciete regelset die prioriteit geeft aan bewijs dat een relevante beslissing kan veranderen. Gebruik geen verzonnen numerieke kans op informatieopbrengst. Kalibreer latere schattingen op uitgevoerde onderzoeksopdrachten.

Reserveer eventueel een vooraf gekozen experimenteel deel van de scoutcapaciteit voor onderbelichte kandidaten. Het percentage is een testparameter, geen bewezen optimum.

## 7. Technische opzet

Maak onderscheid tussen bouwagents en productieprocessen.

Codex kan aan afgebakende implementatietaken werken. De uiteindelijke applicatie vereist zelfstandig gedeployde infrastructuur, monitoring, credentials en budgetten. Een open Codex-sessie is geen productiebackend.

Voorstel: webinterface, Python-analysetaken, relationele database, objectopslag voor toegestane bestanden en een job queue. Edge-workers kunnen verzoeken en lichte taken afhandelen. Zware videoanalyse hoort in aparte daarvoor geschikte verwerking, niet in een gewone korte edge-request.

Begin met één orkestrator en deterministische functies. Splits specialisten pas af wanneer een afzonderlijke taak of evaluatie dat rechtvaardigt.

Logische verwerkingsstappen:

1. providerinformatie ophalen;
2. identiteit en dubbele waarnemingen controleren;
3. meetdefinities en context normaliseren;
4. signaalregels toepassen;
5. relevante broninformatie ophalen en claims structureren;
6. tegenbewijs en ontbrekende informatie zoeken;
7. dossier en onderzoeksactie voorstellen;
8. menselijke beoordeling vastleggen.

Deze stappen hoeven niet acht afzonderlijke taalmodelagents te zijn. Rekenen, datumvergelijkingen en harde filters worden door geteste code uitgevoerd. Taalmodellen helpen met lezen, vertalen, zoeken en uitleggen.

## 8. Betrouwbaarheid en beveiliging

- Tenant-isolatie geldt ook voor zoekindexen, exports, embeddings, logs en caches.
- Andere clubs krijgen nooit toegang tot vertrouwelijke shortlists of scoutnotities.
- Geen training op clubgegevens zonder afzonderlijke passende afspraken.
- Externe inhoud is onbetrouwbare invoer. Instructies in documenten of webpagina's mogen geen tools, rechten of systeemgedrag wijzigen.
- Beperk uitgaande verzoeken; bescherm tegen ongeautoriseerde URL-fetches, schadelijke uploads en geheimen in logging.
- Gebruik idempotente jobs, retries met limieten, een foutenwachtrij en uitgavenplafonds.
- Een feedstoring verlaagt de actualiteitsstatus; zij mag geen fictieve trend veroorzaken.
- Correcties worden geversioneerd. Een betwiste identiteit wordt niet stilzwijgend samengevoegd.
- Houd rollen, audittrail, export, correctie- en verwijderprocessen beschikbaar.

## 9. Datarechten en regelgeving: vóór productie

Maak per bron een rechtenmatrix voor ophalen, opslaan, tonen, videoverwerking, afgeleide analyse, modeltraining, export en eventueel doorleveren. Een clubabonnement of API-sleutel geeft niet automatisch toestemming voor gebruik in een meerklantenplatform.

Laat de privacygrondslag, informatieplichten, bewaartermijnen en eventuele DPIA beoordelen. Openbaar vindbare spelersinformatie is niet automatisch vrij herbruikbaar.

Laat beoordelen of de beoogde selectie- en rankingfunctie onder hoog-risico AI voor werving/selectie valt. Menselijke eindcontrole is geen automatische uitzondering. Onderzoek dit vóór commercieel gebruik, niet na het ontwerpen van de volledige applicatie.

De MVP verwerkt geen medische dossiers, psychologische voorspellingen uit uiterlijk of socialmedia-profielen, biometrische identificatie of minderjarigen. Latere uitbreiding vereist een aparte beoordeling en passende waarborgen.

Registratieregels en salariseisen zijn bestemming-, seizoen- en situatieafhankelijk. De toepassing geeft een controlelijst en bronstatus; een bevoegd persoon verifieert de definitieve haalbaarheid.

## 10. Parallelle bouwopdrachten voor Codex

### Werkpakket A: fundament

Organisaties, login, rollen, database, auditlog en tenant-isolatie. Definieer eerst gedeelde schema's en interfaces.

### Werkpakket B: bronadapter

Eén provideradapter of toegestane clubimport; meetdefinities, timestamps, identiteit, kwaliteitscontrole en foutenafhandeling. Geen ongeautoriseerde scraper.

### Werkpakket C: signalering en dossiers

Uitlegbare signalen, aparte verkenningslijst, claims met bewijs, onbekend-statussen en versieerbare beoordelingen. Geen getrainde potentiemodelclaim.

### Werkpakket D: gebruikersworkflow

Clubvraag, Vandaag, dossier, onderzoeksopdracht en beslislogboek. Mobiel leesbaar en ook bruikbaar op desktop. Een scout kan interpretaties corrigeren.

### Werkpakket E: integratie en toetsing

End-to-endtest, ontbrekende-data-tests, prompt-injectiontests, rechtencontrole, data-lekkagecontrole, exporttests en gebruikerstest met echte toegestane bronnen.

Gebruik aparte branches/worktrees met één integratieverantwoordelijke. Een test is pas uitgevoerd wanneer het commando, resultaat en eventuele foutlog beschikbaar zijn. Vermeld nooit 'bugvrij' op basis van alleen gegenereerde testcode.

## 11. Minimale acceptatietests

1. Een nieuwe club kan geen gegevens van een andere club opvragen, ook niet via een gemanipuleerde object-ID.
2. Ontbrekende statistieken blijven onbekend in database, uitleg en rangschikking.
3. Twee spelers met dezelfde naam worden niet automatisch één speler.
4. Een artikel met een instructie om een score aan te passen verandert geen beleidsregels.
5. Een externe bewering over een contract wordt niet als bevestigd feit weergegeven.
6. Een datumcorrectie in een bron kan een oude beslissing niet onzichtbaar herschrijven.
7. Een claim zonder toegankelijk bewijs kan niet als geverifieerd worden gepubliceerd.
8. Licentieverval blokkeert nieuw gebruik volgens het bronbeleid.
9. Een geldige negatieve observatie blijft zichtbaar naast positieve beelden.
10. Een budgetafwijzing wordt niet als negatief talentlabel gebruikt.
11. Een jobretry veroorzaakt geen dubbele observatie, melding of rekening.
12. Een peildatumtest gebruikt geen later beschikbare informatie.
13. Een high-line-beoordeling zonder zicht op de verdedigingslinie levert 'onvoldoende bewijs' op.
14. Een verlopen databron toont ouderdom en waarschuwt bij gebruik.
15. Een gebruiker kan een dossier exporteren met feiten, interpretaties, bronverwijzingen en onzekerheden.

Synthetische fixtures zijn toegestaan voor softwaretests, maar worden duidelijk als fictief gelabeld en tellen nooit als bewijs van scoutingkwaliteit.

## 12. Commerciële toets

Voer eerst een beperkte vergelijking met de bestaande clubwerkwijze uit. Leg vooraf vast welke spelers al bekend zijn. Laat beoordelaars dezelfde criteria hanteren en waar mogelijk de herkomst van de aanbeveling niet zien.

Meet afzonderlijk:

- benodigde scouttijd per bruikbaar dossier;
- aanvullende kandidaten die voor de club echt nieuw en relevant zijn;
- feitelijke fouten en onbewezen claims;
- hoeveel onderzoeksopdrachten daadwerkelijk een beslissing veranderen;
- bereidheid tot betalen en feitelijke betaalde verlenging.

Voorgestelde doorgaancriteria, te bevestigen met de ontwerpclubs: twee betalende clubs, minimaal 30% minder analysetijd bij ten minste gelijkwaardige blind beoordeelde dossierkwaliteit, aantoonbaar nieuwe relevante kandidaten, en geen kritieke ongefundeerde claims in de afgesproken controlebatch. Dit zijn beslisdrempels, geen gerealiseerde prestaties.

Meet voetbaluitkomsten later op vooraf vastgestelde termijnen. Shortlistacceptatie is geen bewijs dat iemand een betere prof zal worden. Een afwijzing is geen bewijs dat een speler niet kan slagen.

Prijsproef: afgebakende pilot van EUR 1.500–3.000 per club, daarna een te testen abonnement van EUR 750–1.500 per club per maand, exclusief toepasselijke belastingen en eventuele afzonderlijke datalicenties. Dit zijn voorgestelde testprijzen, geen bewezen marktprijzen.

## 13. Referenties en feiten die de positionering beïnvloeden

Onderstaande URLs zijn bronverwijzingen voor verificatie; geen verleende API-toegang of datalicentie.

- Hudl Wyscout: bestaande wereldwijde video- en datadekking. `https://www.hudl.com/en_gb/products/wyscout`
- Hudl / Sports Interactive, 2 juli 2026: integratie van menselijke scoutinginformatie, eventdata en fysieke metrics. `https://www.hudl.com/blog/hudl-sports-interactive-partnership-fmdb-pro`
- TransferLab: bestaande spelervergelijking, leeftijdscurves en recruitmentanalyse. `https://www.lcp.com/en/sports/solutions/transferlab`
- SciSports: bestaande club- en loopbaanmatching. `https://www.scisports.com/the-revolutionary-new-career-advice-app-to-make-the-most-of-your-players-career/`
- SkillCorner: bestaande tracking en off-ball-analyse. `https://skillcorner.com/sports/football`
- Eyeball: bestaande internationale jeugdscouting. `https://www.eyeball.club/helpcentre-jd/`
- IBM / Sevilla FC: Scout Advisor voor zoeken in scoutingrapporten. `https://newsroom.ibm.com/2024-01-23-Sevilla-FC-Transforms-the-Player-Recruitment-Process-with-the-Power-of-IBM-watsonx-Generative-AI`
- TransferRoom: bestaande haalbaarheids-, markt- en registratietools. `https://knowledge.transferroom.com/how-to-use-intelligence-for-clubs`
- Sportmonks prijzen en voorwaarden: beperkte startdekking is niet wereldwijde professionele videodata; directe herverkoop kent beperkingen. `https://www.sportmonks.com/football-api/plans-pricing/` en `https://www.sportmonks.com/terms-of-service/`
- OpenAI Codex en agents: `https://openai.com/index/introducing-the-codex-app/` en `https://developers.openai.com/api/docs/guides/agents`
- Cloudflare Workers: `https://developers.cloudflare.com/workers/` en `https://developers.cloudflare.com/workers/platform/limits/`
- FIFA, bescherming minderjarigen, 19 februari 2026: `https://inside.fifa.com/legal/news/new-edition-guide-submitting-minor-application`
- UWV, werkvergunning voetbal: `https://www.uwv.nl/nl/werkvergunning/topsport` — gebruik gepubliceerde bedragen nooit zonder controle van het vermelde seizoen.
- Autoriteit Persoonsgegevens, handreiking scraping, april 2025: `https://www.autoriteitpersoonsgegevens.nl/documenten/handreiking-scraping-door-particulieren-en-private-organisaties`
- Europese Commissie, AI Act: `https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai`
- Curnyn et al., 2025, relatieve leeftijd en biologische rijping in Schotse academies: `https://researchportal.bath.ac.uk/en/publications/the-influence-of-relative-age-and-biological-maturation-on-player/`
- Jordet et al., 2020, scanning en wedstrijdprestaties: `https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.553813/full`


## 14. Kernfunctie: wereldwijde verborgen-talentenradar

### Doel en betekenis van verborgen talent

De gebruiker wil expliciet in één oogopslag spelers en statistieken uit zo veel mogelijk divisies wereldwijd kunnen overzien, vooral ook de lagere niveaus. Bouw daarom een ontdekfunctie naast het bestaande clubarchief: niet alleen bekende namen controleren, maar nieuwe onderzoekskandidaten vinden.

Gebruik controleerbare labels: nieuw voor deze club, weinig onderzocht door deze club, onvoldoende gedocumenteerd of relevante recente verandering. Claim nooit dat een speler bij geen enkele andere scout bekend is. Weinig publiciteit, een lage geschatte marktwaarde of weinig data is op zichzelf geen bewijs van veel talent.

### Dekking als afzonderlijk gegevensproduct

Voeg een `CoverageRecord` toe per bron, competitie, seizoen en gegevenstype. Bewaar onder meer:

- stabiele competitie-ID, land/regio, seizoen en werkelijk competitieniveau; verwar een competitienaam niet met de plaats in de piramide;
- bron en rechtenstatus, aangesloten/niet aangesloten en reden;
- afzonderlijke beschikbaarheid van wedstrijden, opstellingen, minuten, spelerstatistieken, eventdata, tracking en volledige video;
- aantallen daadwerkelijk waargenomen wedstrijden en spelers; compleetheidspercentages alleen met een bekende noemer;
- laatst gecontroleerd, laatst ontvangen, bronvertraging, storingen en onbekende velden.

Gebruik geen enkel label 'gedekt' dat al deze dimensies samenvoegt. Een competitie met uitsluitend uitslagen heeft geen volledige spelersanalyse. 'Nog niet aangesloten', 'niet in licentie', 'niet beschikbaar bij deze bron', 'tijdelijk vertraagd' en 'beschikbaarheid onbekend' zijn verschillende statussen. Afwezigheid bij één aanbieder bewijst niet dat informatie nergens bestaat.

### Zoeken en signaleren

Laat gedeployde verwerking de toegestane bronnen vooraf bijwerken en zoekresultaten voorberekenen. Eén snel overzicht is het resultaat van opgeslagen en geïndexeerde informatie, niet van een belofte dat bij iedere klik alle wedstrijden op aarde live worden bekeken. Toon de peildatum. Respecteer bronlimieten en budgetten.

Signaleer onder meer leeftijds- en rolgerelateerde uitschieters, veranderingen in speeltijd en positie, relevante ontwikkeling over meerdere wedstrijden en nieuwe informatie bij eerdere afwijzingen. Gebruik alleen contextvariabelen die werkelijk beschikbaar zijn. Een verbeterde datadekking mag niet worden aangezien voor verbeterde prestaties.

Begin met vergelijkingen binnen vergelijkbare rollen, competities en voldoende grote waarnemingsgroepen. Toon minuten, aantallen wedstrijden, gebruikte definities en vergelijkingsgroep naast statistieken per 90 minuten. Een uitschieter uit één korte invalbeurt is een verkennend signaal, geen bewezen talentrangschikking. Scheid penalty's en spelhervattingen wanneer de bron dat betrouwbaar mogelijk maakt; anders blijft die uitsplitsing onbekend.

Plaats percentielen uit verschillende competities niet zonder validatie in één universele kwaliteitsranglijst. Modellen die een overstap naar een hoger niveau inschatten komen pas na onafhankelijke evaluatie met uitsluitend destijds beschikbare gegevens, inclusief mislukte overstappen en duidelijke beperkingen van de steekproef.

### Scherm en resultaatcontract

Een scout kan zonder bekende spelersnaam zoeken. Het scherm toont:

1. de relevante aangesloten competities en zichtbare ontbrekende dekking;
2. kandidaten met voldoende bewijs, apart van verkennende kandidaten;
3. per kandidaat waarom deze nu opvalt, bronverwijzingen, meetperiode en rolcontext;
4. tegenbewijs en ontbrekende informatie;
5. een concrete vervolgactie, zoals volledige beelden beoordelen of een waarneming aanvragen.

Ook verdedigers, middenvelders en keepers moeten via rolpassende signalen gevonden kunnen worden. Ontbreekt voldoende informatie voor een rol, meld dat in plaats van terug te vallen op doelpunten als universele maatstaf.

### Gaten gericht vullen

Onderzoek aanvullende toegestane bronnen zoals bondsgegevens, clubrapporten en partnerbeelden. Waar metingen ontbreken, kan het systeem een gestructureerde observatieopdracht voorbereiden. Versturen of betaald inkopen vereist passende autorisatie. Partnerbijdragen moeten herleidbaar en controleerbaar zijn; beloon bruikbare waarnemingen, geen positieve oordelen.

Geen beelden of statistieken betekent niet dat het taalmodel de ontbrekende prestaties mag afleiden. Houd een speler in de verkenningslijst wanneer het signaal dat rechtvaardigt en maak de resterende onzekerheid zichtbaar.

### Bouwpakket F en aanvullende acceptatietests

Bouwpakket F omvat het dekkingsregister, wereldwijd zoekscherm, verkenningswachtrij en koppeling aan onderzoeksopdrachten. Het eerste werkende bewijs gebruikt beperkte echte dekking; de architectuur ondersteunt uitbreiding via bronadapters.

Aanvullende tests:

- een competitie met alleen uitslagen verschijnt niet als volledig statistisch gedekt;
- ontbrekende dekking produceert geen melding 'geen talent gevonden' voor die hele competitie;
- een speler zonder scoringscijfers kan via andere passende, beschikbare rolgegevens worden gesignaleerd;
- een onbekende minutenwaarde veroorzaakt geen berekende waarde per 90 minuten;
- een korte invalbeurt wordt niet zonder steekproefwaarschuwing boven langdurig gemeten prestaties gezet;
- uitbreiding of correctie van een feed veroorzaakt geen fictieve prestatietrend;
- dezelfde speler in meerdere bronnen of competities wordt niet dubbel als nieuwe ontdekking geteld;
- een onbekende speler voor de club wordt nooit gepresenteerd als wereldwijd onbekend;
- de zoekresultaten tonen gebruikte dekking, actualiteit en ontbrekende vereisten;
- een niet gevalideerde competitieovergang levert geen schijnexacte kans op succes op hoger niveau;
- een nieuwe bron kan via een adapter worden toegevoegd zonder de volledige gebruikersworkflow te herschrijven.

### Verificatie bij deze toevoeging

Sportmonks' eigen API-documentatie vermeldt dat sommige lagere competities en bekertoernooien beperkte dekking hebben en dat ontbrekende gegevens uiteenlopende oorzaken kunnen hebben. Dit onderbouwt de aparte dekkingstatussen; het is geen volledige audit van iedere competitie of aanbieder.

Bron, geraadpleegd 7 september 2026: `https://docs.sportmonks.com/v3/api-faq` (onderdelen over ontbrekende gegevens en competitiedekking).

Status versie 2: bijgewerkte ontwerpbrief. Geen aangesloten wereldwijde dataset, applicatie, gestarte Codex-taak of uitgevoerde acceptatietests. De overige hoofdstukken zijn overgenomen uit versie 1; hun volledige bronnenlijst is voor deze toevoeging niet opnieuw integraal gecontroleerd.
