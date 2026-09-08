# Openbare Wikidata-profielen

De v0.5-provider staat los van de importcatalogus en scoutingberekeningen. Hij haalt geselecteerde openbare Wikidata-claims op en maakt daarvan een beperkt profieloverzicht. Zoekresultaten zijn kandidaten; pas laden controleert mens, voetbalberoep, leeftijd en herkomst. Een zoekresultaat is dus geen bevestigde volwassen voetballer. Namen worden niet gebruikt om items automatisch samen te voegen.

Wikidata publiceert zijn gestructureerde gegevens onder CC0. De provider neemt de vaste licentieverwijzing op in iedere snapshot. Dit is geen garantie van juistheid, actuele clubdeelname, volledigheid of wereldwijde voetbaldatadekking. Zie [Wikidata Data access](https://www.wikidata.org/wiki/Wikidata:Data_access).

## Module en contract

`src/providers/wikidata.mjs` exporteert:

```js
const provider = createWikidataProvider({ fetchImpl: fetch, now: () => new Date().toISOString() });
await provider.search(query); // { provider: 'wikidata', results: [{ id, label, description }] }
await provider.load(ids);     // onderstaande snapshot
validatePublicProfiles(snapshot); // strict gecontroleerde, onafhankelijke clone
```

Een zoekterm heeft 2–120 tekens; resultaten maximaal tien. `load` vereist 1–10 unieke ID's die voldoen aan `Q[1-9][0-9]{0,11}`. Sparse arrays, accessors, vreemde typen en caller-URL's zijn geen geldige ID-lijst.

```text
snapshot = {
  format: 'omniscout-public-profiles', version: 1, provider: 'wikidata',
  license: { name: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  retrievedAt, requestedIds,
  profiles: [{
    id, name, dob, sourceUrl, revisionUrl, revision, sourceModifiedAt, retrievedAt,
    positions: [{ id, label }],
    teams: [{ id, label, start: null | date, end: null | date }],
    currentClub: null, competition: null,
    stats: { minutes: null, matches: null }, synthetic: false
  }],
  excluded: [{ id, reason }], warnings: [string]
}
```

Iedere gevraagde ID verschijnt precies eenmaal bij `profiles` of `excluded`. `synthetic:false` duidt het externe profieltype aan; het is geen handtekening of onafhankelijke verificatie van de onderliggende claims. Testfixtures zijn uitdrukkelijk fictieve API-antwoorden en halen niets live op.

De snapshotvalidator accepteert uitsluitend deze velden, vaste licentie en vaste Wikidata-bronlinks. Hij controleert referenties, typen, kalenderdatums, revisienummer, gelijke ophaaltijdstippen, volwassen leeftijd op `retrievedAt`, ontbrekende statistieken en aantoonbaar onmogelijke teamperiodes. `sourceModifiedAt` mag niet later zijn dan `retrievedAt`. De provider kiest het definitieve ophaaltijdstip na alle labelverzoeken en controleert leeftijd en revisie dan opnieuw. Een historische snapshot blijft historisch: de validator vergelijkt hem niet met de huidige computerklok en verifieert zijn inhoud niet opnieuw bij Wikidata. De JSON-structuur is begrensd op diepte 12, 20.000 waarden en 1 MiB totale tekst; onbekende velden, gevaarlijke sleutels, getters, cycles en sparse arrays worden geweigerd.

Brontekst blijft tekst. Gebruik `textContent` of contextgeschikte escaping in de interface; deze validator is geen HTML-sanitizer. De module bewaart geen sessies, accountgegevens, querygeschiedenis, externe API-tokens, bestanden of persistente cache. De root-integratie beheert authenticatie, snapshots en eventuele uitvoerbestanden.

## Claims en onzekerheid

Een profiel vereist directe niet-deprecated verklaringen `P31=Q5` en `P106=Q937857`. Subklassen worden niet doorlopen en het beroep bewijst geen huidige professionele of actieve status. Normal en preferred zijn bruikbare bronranks; geen van beide is een bewijs van actualiteit.

Alle niet-deprecated `P569`-claims moeten dezelfde werkelijk geldige Gregoriaanse dagdatum met precisie 11 geven. Jaar- of maandprecisie, onbekende waarden, conflicterende datums, andere kalenders, onzekerheidsmarges en de kwalificaties `P1480`, `P1319`, `P1326` of `P1310` leiden tot uitsluiting. De leeftijd moet bij ophalen 18 tot en met 100 zijn. Dit controleert consistentie van gepubliceerde claims; het bewijst niet dat een gepubliceerde geboortedatum juist is. Zie [Wikidata Dates](https://www.wikidata.org/wiki/Help:Dates/en).

`P413` levert maximaal vijf unieke positieclaims. `P54` levert maximaal tien teamclaims met eventuele `P580`/`P582`-datums. Jaar (`YYYY`), maand (`YYYY-MM`) en dag (`YYYY-MM-DD`) blijven hun eigen precisie houden. Onzekere of onderling strijdige kwalificatiedatums blijven null, met een waarschuwing. Bij een aantoonbaar onmogelijke periode worden beide grenzen null; overlappende gedeeltelijke datums zijn niet automatisch tegenstrijdig. Meer bronclaims worden zichtbaar als afkapping gemeld. De volgorde volgt de bron en is geen relevantierangschikking.

Een P54-claim kan vroeger of nu gelden. Daarom blijven huidige club en competitie altijd null, ook bij preferred rank of ontbrekende einddatum. De module verzint geen minuten, wedstrijden, seizoen, rolfit, prestaties of talentscore om het importschema te vullen. Ruwe claims, afbeeldingen, profielbeschrijvingen, externe referentiepagina's en andere persoonsgegevens worden niet in de snapshot overgenomen. De revisie-URL verwijst terug naar het bronitem; labels van gerelateerde items zijn leeslabels en hebben in dit beperkte formaat geen eigen revisiereceipt.

Labels worden opgevraagd met `languages=nl|en&languagefallback=1`. De module kiest eerst het bruikbare `nl`-veld en daarna `en`; de werkelijke teruggegeven taal kan bijvoorbeeld `mul` zijn. Het overzicht claimt geen Nederlandse vertaling. Zonder bruikbaar label toont het de QID met waarschuwing. Maximaal 100 unieke gerelateerde items krijgen een labelverzoek, in batches van maximaal 50; overige geselecteerde relaties behouden hun QID. Zie [MediaWiki: Presenting Wikidata knowledge](https://www.mediawiki.org/wiki/API:Presenting_Wikidata_knowledge).

## Netwerk en fouten

Alle verzoeken gebruiken uitsluitend `https://www.wikidata.org/w/api.php`, Action API `wbsearchentities` of `wbgetentities`, GET, `maxlag=5`, JSON en een beschrijvende `OmniScout/0.5` User-Agent met de repository als contactlink. Redirects, credentials en caching zijn uitgeschakeld. Caller-input wordt als queryparameter gecodeerd; een gebruiker kan geen providerhost, sleutel of URL instellen.

Per providerinstantie worden maximaal vier bewerkingen toegelaten en opeenvolgend uitgevoerd. Tussen de start van twee bronverzoeken zit minimaal één seconde. Ieder bronverzoek heeft een deadline van vijftien seconden en maximaal 8 MiB gedecodeerde responsebytes; `Content-Length` wordt vooraf gecontroleerd indien aanwezig. Alleen JSON-contenttype, geldige UTF-8 en geldig JSON worden gelezen. Iedere gevraagde entity-key moet aanwezig zijn; een expliciet ontbrekend item is een uitsluiting, een onvolledige batch is een fout. Een afgebroken netwerkverzoek of ongeldig antwoord geeft een algemene zichtbare 503 zonder upstream details of fictieve vervanggegevens.

HTTP 429, expliciete Retry-After bij 503 en een JSON `maxlag`/`ratelimited`-fout geven een zichtbare 429 met `retryAfterSeconds`. De instantie bewaart de opgegeven wachttijd; zonder bruikbare header geldt 60 seconden bij HTTP 429 en vijf seconden bij maxlag. Er volgt geen automatische herhaling. Ook een maxlag-fout met HTTP 200 wordt herkend. De vijfde gelijktijdige bewerking krijgt eveneens 429. Deze grenzen en de User-Agent volgen de principes van [MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette).

## Verificatie

De eerste uitvoering van `node --test tests/wikidata.test.mjs` op 8 september 2026 slaagde **11/11**, zonder skips, in 6.448,5492 ms. Na review en de extra controle van het definitieve ophaaltijdstip is `node --test tests/wikidata.test.mjs tests/wikidata-review.test.mjs` daadwerkelijk uitgevoerd: **25/25 geslaagd**, geen skips, 10.469,5527 ms. De ruwe uitvoer staat in `reports/v0.5/wikidata-provider.txt`.

Dit omvat de vaste API-requestvorm, label fallback, echte requestspacing, verjaardaggrenzen, afwijkende geboortedatums, bronrevisies, begrensde relaties, body/type/decodefouten, maxlag/Retry-After, vier bewerkingen en strikte snapshotvalidatie. De onafhankelijke review controleert ook identiteit bij labels, onvolledige batches, tegenstrijdige gedeeltelijke teamperiodes, het deadlinegedrag bij een transport of reader die het AbortSignal negeert, en schadelijke tekst bij standalone JSON-embedding. Alle antwoorden zijn geïnjecteerde fictieve fixtures; de testset vraagt geen echte spelergegevens op. Live resultaten en de gecombineerde releasecontrole krijgen eigen uitvoer bij de integrator.
