# Architectuur van versie 0.1.0

## Drie uitvoeringsvormen

**Lokale toepassing.** `public/app.js` vraagt `/api/session` op. Bij een geldige lokale sessie gaan beslissingen, taken en clubvraag naar de loopback-API. `src/store.mjs` serialiseert mutaties naar `.local/state.json`. Eén gebruiker, één proces; geen productie-account of tenant.

**Zelfstandige HTML.** `tools/build-preview.mjs` bundelt vormgeving, fixtures, analyselogica en interface in één bestand. `window.OMNI_INLINE` voorkomt netwerkgebruik. Browseropslag wordt gebruikt als dat is toegestaan, anders zichtbaar tijdelijk geheugen. De onderliggende presentatie- en rekenlogica is dezelfde, maar dit is geen serverdatabase.

**Edge-demo.** `worker/index.mjs` biedt alleen-lezen toegang tot de synthetische catalogus. Writes worden geweigerd. De interface heeft daar geen lokale backend en gebruikt browseropslag. Er is geen echte deployment uitgevoerd.

## Gegevensstroom

```text
synthetische catalogus + lokaal scoutlog
             |
             v
bronrechten / identiteit / peildatum controleren
             |
             v
rolgegevens / steekproef / ontbrekende data
             |
             v
uitlegbare voorbeeldsignalen + tegenbewijs
             |
             v
gedocumenteerd OF verkennend dossier
             |
             v
menselijke onderzoeksopdracht / shortlist / beslissing
```

De drempels zijn voorbeeldregels. Geen modeltraining, inferentie-API, crawling of voorspelde transferkans. Percentielen van verschillende competities worden niet samengevoegd tot een wereldranglijst. De standaardvolgorde is een informatievolgorde, geen ranglijst van talent.

## Belangrijkste modules

`engine.mjs` bevat functies voor betrouwbare nul/unknown-verwerking, per-90-waarden, leeftijd op peildatum, bronrechten, tijdsgrenzen, identiteit, dossierbouw, filters, CSV en een snapshotvalidatiehelper. Die helper is nog geen volledige upload/importworkflow.

`fixtures.mjs` bevat twaalf fictieve volwassenen en acht fictieve competitie-instellingen. Het bestand wordt reproduceerbaar gemaakt met `tools/create-fixtures.py`. Een locatie op de kaart is geen aangesloten externe bron.

`server.mjs` valideert HTTP-invoer, biedt expliciete bestandsroutes, controleert lokale Host/Origin en vereist het lokale sessietoken voor mutaties. Geen willekeurige bestandenserver, geen externe URL-fetchfunctie, geen CORS-openstelling.

`store.mjs` bewaart mutaties in volgorde en schrijft via tijdelijk bestand plus rename. Een ongeldig statusbestand veroorzaakt een fout. Het is geen database met transactie-isolatie over meerdere processen en geen beveiligde kluis.

## API van de lokale server

| Methode | Pad | Doel |
|---|---|---|
| GET | `/api/health` | Werkmodus, geen live/productieclaim. |
| GET | `/api/session` | Lokaal sessietoken voor browsermutaties. |
| GET | `/api/catalog` | Synthetische catalogus. |
| GET | `/api/state` | Lokale beslissingen, taken, vraag en log. |
| GET | `/api/players` | Gefilterde dossiers. |
| GET | `/api/players/:id` | Eén dossier. |
| POST | `/api/decisions` | Menselijke status/reden vastleggen. |
| POST | `/api/tasks` | Idempotente interne onderzoeksopdracht. |
| PATCH | `/api/tasks/:id` | Status en schriftelijke uitkomst. |
| PUT | `/api/brief` | Gestructureerde clubvraag bewaren. |
| GET | `/api/export` | CSV van shortlist met fictieve status en provenance. |

De edge-demo implementeert slechts health/catalog/players voor lezen. Deze tabel is dus geen belofte dat alle lokale functies als cloud-API bestaan.

## Bewust nog niet aanwezig

Productie-login, organisaties, rollen, row-level tenantbeleid, multi-userdatabase, providerimport, uploadverwerking, objectopslag, videotracking, queues, geplande ingestion, monitoring/incidentafhandeling, uitgavenbeheer, betalingen, professionele rechten-/privacybeoordeling en scoutingvalidatie.

## Documentatie van externe platforms

Geraadpleegd bij de configuratie op 8 september 2026; deze verwijzingen verlenen geen toegang of licentie.

- Cloudflare static assets en `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/binding/
- Wrangler configuratie: https://developers.cloudflare.com/workers/wrangler/configuration/
- GitHub koppelen/selecteren in ChatGPT: https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt

De worker gebruikt `run_worker_first: true` om de headerlogica ook voor assets te laten uitvoeren. Cloudflare-routering is niet in een echte deployment gecontroleerd. Kies en vergrendel een passende Wrangler-versie pas in de volgende geautoriseerde infrastructuurstap.
