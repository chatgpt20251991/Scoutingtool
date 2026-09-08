# Feitelijke implementatiestatus

**8 september 2026 · versie 0.2.0.** De volledige productambitie in `BUILD_BRIEF.md` blijft de roadmap; deze levering implementeert de eerstvolgende lokale importuitbreiding uit het startdocument.

| Onderdeel | Actuele status |
|---|---|
| Volledige bronovername | Lokaal gecommit, Node hoofdproject, Python-referentie en originele ZIPs behouden. |
| Ontwikkelworkers | A import, B verwerking, C interface uitgevoerd; D onafhankelijke integratiecontrole uitgevoerd. |
| JSON-import | Begrensd, versie 1, preview zonder schrijven, expliciete bevestiging, synthetisch voorbeeld. |
| Herkomst en snapshots | Rechten, tijden, seizoenen, identiteitsconflicten, onveranderlijke waarnemingen, correcties en rollback. |
| Lokale verwerking | Duurzame begrensde queue, status, idempotentie, maximaal drie pogingen en herstartherstel. |
| Scoutingworkflow | Importdataset gekoppeld aan radar, dossiers, shortlist, vergelijking, onderzoek en exports. |
| Demo/import | Catalogus en scoutingopslag gescheiden; geen importfallback naar browseropslag. |
| Browser/API/opslag | Native loopback-route werkelijk getest, inclusief mobiel, CSV-download, herstart en rollback. |
| Node/Python-tests | Werkelijk uitgevoerd; finale aantallen en ruwe logs in `reports/current/`. |
| Datadekking | Zeven dimensies per bron, competitie en seizoen; uitsluitend de aangeleverde import/declaratie. |
| Wereldwijde echte data | Niet aangesloten. Demo en voorbeeldimport zijn fictief. |
| GitHub/PR/CI | Publicatie geblokkeerd door ontbrekende Git-aanmelding en integratie-HTTP 403. Geen remote commit/PR/CI geclaimd. |
| Cloudflare | Alleen-lezen synthetische handler getest via lokale adapter; geen runtime-deployment. |
| Productieauth/tenants | Niet geïmplementeerd; lokaal één gebruiker en één serverproces. |
| Provider/AI/kosten | Geen externe provider, LLM, credential of betaalde verwerking toegevoegd. |

## Resterend werk

GitHub-integratietoegang moet door de eigenaar in de bestaande omgeving beschikbaar worden gemaakt voordat de aangemaakte Git-geschiedenis kan worden gepubliceerd en een PR kan worden geopend. Er zijn geen accountmachtigingen aangepast.

Voor echte klanttoepassing blijven productieauthenticatie, organisatiescheiding, retentie, rechten-/identiteitscontrole, toegestane dataproviders en prospectieve beoordeling nodig. Softwaretests bewijzen geen betere scoutingkwaliteit of historisch beschikbare providerdata. Snapshotbeschikbaarheid en bronrechten zijn gecontroleerde verklaringen, geen onafhankelijke verificatie.

Zie `IMPORT_SCHEMA.md`, `MIGRATION_ROLLBACK.md`, `NEXT_CODEX_TASK.md` en `reports/current/worker-d-review.md` voor concrete contracten en grenzen. Oude statussen in oorspronkelijke handoffbijlagen beschrijven het verpakkingsmoment, niet deze uitgevoerde sessie.
