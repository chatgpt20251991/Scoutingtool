# Architectuur van versie 0.4.0

**8 september 2026.** Node.js 22+ is het hoofdproject, met ingebouwde Node-modules en zonder externe npm-afhankelijkheden voor de toepassing. De volledige Python-app blijft ongewijzigd als referentie in `reference/python-prototype/`. De productambitie in `BUILD_BRIEF.md` blijft het langetermijnontwerp; de huidige toepassing is een lokaal onderzoeksprototype met accounts, clubrollen, gescheiden organisaties en gecontroleerde JSON-import.

GitHub-publicatie is hervat: [PR #1](https://github.com/chatgpt20251991/Scoutingtool/pull/1) bestaat, en de gepubliceerde v0.2-commit `3f54df2fdee7ba285249c86b84846fad0eb4b63e` heeft een geslaagde CI-run. V0.3 is gepubliceerd als `54e6dfd6c05b8bb2d35629ec98300902f7af5ceb` met geslaagde CI. V0.4 bouwt verder op `codex/omniscout-recovery`. De integrator rapporteert afzonderlijk de uiteindelijke v0.4-commit, publicatie en uitgevoerde eindtests; de v0.2-CI-uitkomst bewijst die nog niet.

## Drie uitvoeringsvormen

**Lokale Node-toepassing.** `npm start` start `src/server.mjs` op loopback. Accounts zijn standaard verplicht. `src/accounts-server.mjs` controleert sessie, organisatie, rol, Host, Origin en CSRF voordat het verzoek de scouting-API bereikt. Iedere organisatie krijgt een eigen store en importqueue. Binnen iedere organisatie blijven de fictieve demo en de lokale import afzonderlijke datasets.

**Zelfstandige HTML.** `tools/build-preview.mjs` bundelt vormgeving, fixtures, analyselogica en interface. `window.OMNI_INLINE` voorkomt netwerkgebruik. De zelfstandige demo gebruikt uitsluitend fictieve gegevens en kan demovoorkeuren en demohandelingen in browseropslag of zichtbaar tijdelijk geheugen bewaren. Dit is geen accountserver of opslagplaats voor geïmporteerde clubdossiers. In accountmodus leidt een aanmeldfout niet tot een stille omschakeling naar deze demo.

**Edge-demo.** `worker/index.mjs` biedt alleen-lezen toegang tot de synthetische catalogus. Servermutaties worden geweigerd. Deze afzonderlijke configuratie bevat geen lokale accounts, clubimport of periodieke inzameling. Cloudflare-deployment is niet uitgevoerd.

## Gegevensstroom en autorisatie

```text
browser → loopback Host/Origin → sessiecookie + organisatieheader
                                      |
                                      v
                             actuele rol + CSRF bij mutaties
                                      |
                                      v
                         store en importqueue van die club
                                      |
                                      v
                    afzonderlijke demo- of importdataset
                                      |
                                      v
                  bronrechten / identiteit / peildatum / schema
                                      |
                                      v
                 uitlegbare signalen / onbekenden / tegenbewijs
                                      |
                                      v
                  menselijk dossier / onderzoek / beslissing
```

De server controleert `X-Omniscout-Organization` tegen het actuele lidmaatschap. Een organisatieveld in een verzoekbody verleent geen toegang. Een `viewer` mag lezen en toegestane exports ophalen; een `scout` mag ook scoutinggegevens en imports wijzigen; een `owner` beheert daarnaast leden en uitnodigingen. Intrekking of degradatie werkt bij volgende autorisatie ook voor bestaande sessies. De laatste eigenaar blijft beschermd.

De analyseregels zijn voorbeelden, geen gevalideerd voorspelmodel. Null blijft onbekend, per-90-waarden vereisen betrouwbare minuten en historische analyses respecteren beschikbare informatie op de peildatum. Competitiepercentielen vormen geen universele talentscore. Een ontbrekende databron betekent geen afwezigheid van talent. Externe tekst wordt behandeld als gegevens en kan geen rechten of beleid wijzigen.

## Belangrijkste modules

| Module | Verantwoordelijkheid |
|---|---|
| `src/auth/index.mjs` | Eerste eigenaar, login, scrypt-wachtwoordhashes, sessies, uitnodigingen, organisaties, rollen en begrensde atomaire accountopslag. |
| `src/accounts-server.mjs` | HTTP-accountgrens, HttpOnly/SameSite-cookie, preauth- en sessie-CSRF, rolcontrole, clubselectie en routering naar de bevoegde clubopslag. |
| `src/organizations/index.mjs` | Eigen store en queue per gevalideerd organisatie-ID, datamapvergrendeling, eenmalige legacy-overname en gesaneerde opslagstatistieken. |
| `src/backup/crypto.mjs` | Begrensde, geauthenticeerde versleuteling van club- en serverback-ups. |
| `src/backup/workspace.mjs` | Strikte statevalidatie, bronrechten, consistent clubback-upformaat en niet-destructieve retentiepreview. |
| `src/backup/server.mjs`, `tools/server-backup.mjs` | Offline servermanifest, versleutelde volledige actieve opslag en herstel naar een nieuwe datamap. |
| `src/server.mjs` | Scoutingroutes, invoervalidatie, datasetkeuze, bronrechtcontroles, auditactor, exports en expliciete statische routes; accountmodus is de standaard. |
| `src/store.mjs` | Geordende scoutingmutaties, opslag via tijdelijk bestand en rename, gescheiden demo- en importwerkgebied. |
| `src/import/index.mjs` | Begrensde JSON-validatie, preview, identiteiten, provenance, snapshots, correcties, catalogus en rollback. |
| `src/ingestion/` | Lokale JSON-adapter, opgeslagen importjobs, idempotentie, begrensde retries, herstartherstel en dekkingsinformatie. |
| `src/engine.mjs` | Deterministische filters, dossierbouw, ontbrekende data, meetcontext, rechten, tijden, CSV en uitlegbare demonstratiesignalen. |
| `src/fixtures.mjs` | Twaalf fictieve volwassenen en acht fictieve competitie-instellingen; geen aangesloten externe bron. |
| `public/` | Login/setup, clubselectie, accounts, import, scoutingworkflow en expliciete zelfstandige demonstratiemodus. |

## Lokale opslag en migratie

```text
.local/
  accounts.json                    accounts, hashes, rollen, uitnodigingsdigests
  .organization-manager.lock       exclusief gebruik van de datamap
  legacy-claim.json                ontvangstbewijs van eenmalige overname
  state.json                       eventueel oorspronkelijk v0.2-bestand
  organizations/
    <organisatie-uuid>/
      state.json                   demo/import, besluiten, taken, audit en jobs
      recovery/<uuid>.json         maximaal tien private vorige states na herstel
```

De datamapvergrendeling wordt verkregen voordat persistente accountopslag wordt geopend. Eén serverproces beheert één datamap. Normaal afsluiten wacht op verwerking en geeft de vergrendeling vrij. Een achtergebleven lock wordt niet automatisch overschreven; de expliciete herstelprocedure staat in `ORGANIZATION_STORAGE.md`.

Bij eerste installatie probeert de organisatiemanager het oorspronkelijke versie-1-statebestand precies eenmaal over te nemen naar de eerste club. De bron blijft ongewijzigd. Schema, snapshots en jobs worden gecontroleerd, accountgeheimen worden uitgesloten en een bestaande niet-lege bestemming wordt niet overschreven. Een mislukte migratie krijgt een zichtbare herstelstatus; een eigenaar kan de herstelroute gebruiken. Het ontvangstbewijs voorkomt dubbele overname bij herstart of herhaling.

Account- en scoutingbestanden worden afzonderlijk atomisch bijgewerkt. Een mislukte accountschrijfoperatie verandert de accountstatus in het geheugen niet. Dit zijn geen databasetransacties over alle bestanden of processen. Schijfgegevens zijn niet versleuteld; lokale bestandsrechten en back-upbeveiliging blijven noodzakelijk. Versleutelde club- en serverback-ups hebben afzonderlijke gecontroleerde herstelroutes; retentie is alleen een voorvertoning. Zie `WORKSPACE_RECOVERY.md`, `SERVER_BACKUP.md` en `BACKUP_ENCRYPTION.md`.

Sessies bestaan uitsluitend in procesgeheugen en verlopen na maximaal 12 uur. Wachtwoorden worden met willekeurige salts en scrypt afgeleid; bewaarde sessie- en uitnodigingstokens zijn digests. Een wachtwoordwijziging roteert de sessie en trekt alle oude sessies in. Na herstart moet iedereen opnieuw aanmelden. De veiligheidskeuzes en beperkingen staan in `AUTH_SECURITY.md`.

## API van de lokale accountserver

| Methode | Pad | Doel en toegang |
|---|---|---|
| GET | `/api/health`, `/api/session` | Publieke werkmodus en aanmeldstatus; geen sessietoken in JSON. |
| POST | `/api/auth/setup`, `/api/auth/login`, `/api/auth/register` | Eerste installatie, aanmelden en nieuwe account via uitnodiging; preauth-CSRF en lokale Origin vereist. |
| POST | `/api/auth/logout`, `/api/auth/password` | Aangemelde gebruiker; sessie-CSRF vereist. |
| POST | `/api/auth/organizations` | Aangemelde gebruiker maakt een nieuwe lege club. |
| GET / POST | `/api/auth/members`, `/api/auth/invites` | Eigenaar van de gekozen club leest leden of maakt een uitnodiging. |
| PATCH / DELETE | `/api/auth/members/:userId` | Eigenaar wijzigt een rol of verwijdert een lid. |
| POST | `/api/auth/recover-migration` | Eigenaar herhaalt een gecontroleerde legacy-overname. |
| POST | `/api/auth/invite-preview`, `/api/auth/accept-invite` | Aangemelde account controleert en accepteert een uitnodiging. |
| GET / DELETE | `/api/auth/invitations`, `/api/auth/invitations/:id` | Eigenaar bekijkt of trekt openstaande uitnodigingen in. |
| POST | `/api/backup/create`, `/api/backup/preview`, `/api/backup/restore` | Eigenaar; clubgebonden versleutelde back-up en eenmalige bevestigde herstelpreview. |
| GET | `/api/retention/preview` | Eigenaar; bewaarinventarisatie zonder writes of verwijderen. |
| GET | `/api/workspace/stats` | Bevoegd clublid; aantallen, grenzen en opslagmodus zonder dossierinhoud. |
| GET | `/api/import/sample` | Publiek fictief voorbeeld. |
| POST | `/api/import/preview`, `/api/import/confirm`, `/api/import/rollback` | Scout/eigenaar van de gekozen club. |
| GET | `/api/import/jobs` | Bevoegd clublid; uitsluitend jobs van de gekozen club. |
| POST | `/api/import/jobs/:id/retry` | Scout/eigenaar; begrensde retry van een eigen clubjob. |
| GET | `/api/catalog`, `/api/coverage`, `/api/state`, `/api/players`, `/api/players/:id` | Bevoegd clublid; demo/import blijft afzonderlijk. |
| POST / PATCH / PUT | `/api/decisions`, `/api/tasks`, `/api/tasks/:id`, `/api/brief` | Scout/eigenaar; gevalideerde scoutingmutaties met auditactor. |
| GET | `/api/export`, `/api/export/state` | Bevoegd clublid; actuele bronrechten bepalen of export is toegestaan. |

Beschermde scoutingroutes vereisen zowel een geldige sessiecookie als een organisatieheader. Iedere mutatie vereist de actuele `X-Omniscout-Csrf`. Importdetails en limieten staan in `IMPORT_SCHEMA.md` en `IMPORT_CONTRACT.md`; accountdetails staan in `ACCOUNTS_CONTRACT.md`. De edge-demo implementeert slechts een beperkte synthetische lees-API.

## Bewust nog niet aanwezig

Publieke productieauthenticatie, TLS-hosting, MFA, externe identiteitscontrole, wachtwoordherstel, een gedeelde database voor meerdere serverprocessen, operationele externe back-upopslag en daadwerkelijk retentie-/verwijderbeleid, tamper-proof auditing en onafhankelijke beveiligingsbeoordeling blijven vervolgwerk.

Ook echte providers, geautomatiseerde broninzameling, objectopslag, videotracking, LLM-gebruik, monitoring/incidentafhandeling, kostenbeheer, betalingen, beoordeelde commerciële datarechten en prospectieve scoutingvalidatie zijn niet aangesloten. De ambitie blijft wereldwijd bruikbare onderzoeksaanleidingen zichtbaar maken, inclusief lagere en amateurdivisies, met aantoonbare dekking en menselijke beoordeling. De concrete volgende bouwstappen staan in `NEXT_CODEX_TASK.md`.
