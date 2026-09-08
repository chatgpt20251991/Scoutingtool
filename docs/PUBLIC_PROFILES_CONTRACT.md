# Openbare spelersprofielen — v0.5 contract

Dit is een aparte, alleen-lezen bronweergave naast de bestaande demo en clubimport. Zij gebruikt Wikidata CC0-structuurdata voor volwassen voetbalprofielen. Een openbare bronclaim is geen gemeten scoutingprestatie, actuele contractbevestiging of onafhankelijke identiteitscontrole. Namen worden niet als sleutels gebruikt.

## Module en schema

`src/providers/wikidata.mjs` exporteert `createWikidataProvider({fetchImpl,now})` met `search(query)` en `load(ids)`, plus `validatePublicProfiles(snapshot)`. De provider gebruikt uitsluitend de vaste HTTPS ActionAPI, een beschrijvende User-Agent, begrensde seriële requests en geen credentials. De validator geeft een gecontroleerde kopie terug; hij is geen HTML-escapingfunctie.

Het formaat is `omniscout-public-profiles`, versie 1. De envelope bevat provider, CC0-licentielink, definitieve ophaaltijd, aangevraagde Q-ID's, profielen, uitsluitingen en waarschuwingen. Ieder profiel bevat naam, precieze geboortedatum, bron-/revisielinks, revisienummer, bronwijzigingstijd, ophaaltijd, positieclaims en teamclaims met mogelijke gedeeltelijke datums. Actuele club en competitie blijven null; minuten en wedstrijden blijven null. Er is geen talentscore.

Alle aangevraagde ID's worden precies eenmaal verantwoord als profiel of uitsluiting. Onvolledige API-antwoorden, ongeldige labels of mislukte labelbatches leveren een zichtbare fout en vervangen geen eerder geldige cache. Expliciet ontbrekende items, onzekere leeftijd, minderjarigen en niet als voetballer verklaarde items worden uitgesloten. De bronvoorwaarden en precieze parsingregels staan in `WIKIDATA_PROVIDER.md`.

## HTTP en context

| Methode / route | Gedrag |
|---|---|
| GET /api/public-profiles | Bevoegd clublid leest de eigen tijdelijke momentopname, of null. Antwoord bevat provider, snapshot, supportsFetch en stale. |
| GET /api/public-profiles/search?q=... | Bevoegd clublid zoekt expliciet op de openbare bron. Zoekresultaten zijn nog niet op volwassen leeftijd/sport toegelaten. |
| POST /api/public-profiles/load | Scout/eigenaar stuurt alleen ids (1–10). Sessie, club, Origin en CSRF worden gecontroleerd; autorisatie volgt opnieuw na wachten op de bron. Antwoord is de gecontroleerde snapshot. |

De HTTP-laag accepteert maximaal vier gelijktijdige bronacties en dertig zoek-/ophaalverzoeken per minuut over de hele server. De provider begrenst ook zijn eigen netwerkwerk, omvang, tijdslimiet en wachttijden. Er is geen automatisch opnieuw proberen of periodieke inzameling. Geen account, clubnaam, scoutingnotitie of dossier wordt aan Wikidata gestuurd.

Cache-inhoud is gescheiden per club en uitsluitend in procesgeheugen. Zij verdwijnt bij serverherstart en is geen scoutingimport of onderdeel van een club-/serverback-up. Een snapshot ouder dan één dag krijgt een waarschuwing. Toekomstige ophaaltijden worden door de HTTP-route en CLI geweigerd. Bronuitval behoudt eerder geldige inhoud; fictieve spelers worden nooit als vervanging ingeschoven.

## Interface en standalone

De navigatie onderscheidt Echte spelers, Fictieve radar en Importradar. Het echte scherm heeft eigen tellingen, filters, datum en bronmelding. Gedateerde teamvermeldingen blijven bronclaims; ontbrekende einddatums bewijzen geen huidige club. Het scherm maakt geen fictieve competitie of prestatiekolom aan.

De HTML-builder kan een gevalideerde snapshot veilig insluiten. Externe tekst wordt als JSON geserialiseerd, met onder andere alle kleiner-dan-tekens als Unicode-escapes, en vervolgens als tekst gerenderd. Een HTML met echte gegevens opent standaard het echte scherm; de gewone demonstratie blijft afzonderlijk beschikbaar. Er zijn geen automatische netwerkrequests bij het offline openen.

Opgehaalde profielbestanden en de daarvan gemaakte HTML staan buiten Git. De bronrepository bevat code en uitdrukkelijk fictieve testresponses. Native browsertests gebruiken een geïnjecteerde provider en echte HTTP-/file-routes; de release bevat daarnaast een afzonderlijk vastgelegde werkelijke bronophaling en visuele controle van de echte spelers.

## Uitvoering

B bouwt provider/parser/validator; A onderzoekt primaire bronvoorwaarden en test onafhankelijk; C bouwt interface en echte native browsertests; root integreert HTTP, CLI, veilige standalone-builder, eindtests en GitHub. PR #1 en #2 zijn op 8 september 2026 samengevoegd; main bevat v0.4 op `64d9ea4ef4a819ac5e8b3397d46122b73ea5c32d`. De v0.5-branch is `codex/omniscout-real-profiles`.
