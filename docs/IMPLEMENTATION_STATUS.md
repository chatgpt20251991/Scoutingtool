# Feitelijke implementatiestatus

**8 september 2026 · versie 0.3.0.** De productambitie in `BUILD_BRIEF.md` blijft de roadmap. De Node-hoofdapp bevat nu de importuitbreiding plus lokale accounts en clubwerkruimten.

| Onderdeel | Actuele status |
|---|---|
| Volledige bronovername | Node hoofdproject, Python-referentie en originele ZIPs behouden; gepubliceerd in PR #1. |
| Ontwikkelworkers | A accountbeveiliging, B organisatieopslag, C interface; D onafhankelijke integratiecontrole. |
| Accounts | Eerste installatie, scrypt, login/logout, 12-uursessies, wachtwoordwijziging met intrekking van oude sessies. |
| Organisaties en rollen | Eigen store/queue per club, owner/scout/viewer, eenmalige uitnodiging voor nieuwe accounts, bescherming laatste eigenaar. |
| Toegangscontrole | Standaard verplicht voor alle beschermde API's, imports, jobs en exports; actuele lidmaatschappen en aparte CSRF-controle. |
| Interface | Clubkiezer, ledenbeheer, lokale opslagstatistieken, mobiel; vorige clubinhoud gewist bij wissel, afmelden of ingetrokken toegang. |
| Migratie/opslag | Eenmalige gebonden overname v0.2, origineel behouden; hersteljournal en exclusieve proceslock. |
| JSON-import | Begrensde versie-1 import, preview, expliciete bevestiging, rechten, tijd, identiteit, nulls en meetdefinities. |
| Verwerking en herstel | Duurzame begrensde queue, idempotentie, retries, onveranderlijke snapshots en rollback. |
| Scoutingworkflow | Radar, dossiers, shortlist, vergelijking, onderzoek en exports; demo/import afzonderlijk binnen iedere club. |
| Datadekking | Zeven dimensies per bron/competitie/seizoen; uitsluitend werkelijk geïmporteerde declaraties. Geen live werelddata. |
| GitHub | Schrijven via de gekoppelde integratie werkt. PR #1, branch codex/omniscout-accounts; geen force-push. |
| CI | V0.2 remote commit 3f54df2fdee7ba285249c86b84846fad0eb4b63e geslaagd; v0.3 controleert ook echte Chromium-browserroutes. Definitieve run in opleverrapport. |
| Cloudflare | Alleen-lezen synthetische handler lokaal getest; geen workerd/Wrangler-deployment. |
| Provider/AI/kosten | Geen externe provider, LLM, credential of betaalde verwerking toegevoegd. |

## Verificatie en gevonden fouten

Uitgevoerde commando's en ruwe resultaten staan in `reports/v0.3/`. De accountsuite heeft twaalf controles; de legacy-import- en standalone/edge-browsersuites ieder tien. De CLI-proef bevestigt dat een bezette poort een fout geeft en de datamaplock vrijgeeft. Python behoudt 62 tests. Gebruik `node-verify.txt` voor het definitieve Node-totaal; eerdere mislukte pogingen blijven afzonderlijk zichtbaar.

De onafhankelijke accountreview vond en herstelde een CSRF-formaatverschil en een migratieclaim die bij beschadigde oude gegevens onvoldoende aan de eerste club gebonden was. De browserregressie vond twee klokmetingen die 1 ms konden verschillen, waardoor de standaardpeildatum soms als toekomstig werd geweigerd. De server gebruikt nu één tijdstip per aanvraag en heeft hiervoor een regressietest. De eerste volledige Node-run vond daarnaast een Windows EPERM bij het vervangen van het statebestand; een begrensde Windows-retry herstelt tijdelijke deelblokkades en houdt permanente fouten zichtbaar zonder stateverlies. Echte Windows-bestandslocks zijn getest; het oorspronkelijke foutlog is behouden.

## Resterend werk

Dit is een lokaal account- en opslagmodel. Publieke TLS-hosting, MFA, wachtwoordherstel, versleutelde back-ups met herstelproeven, retentie/verwijdering, een externe identiteitsprovider, tamper-proof audit en onafhankelijke productiebeveiligingscontrole ontbreken. Bestaande accounts kunnen nog niet via een uitnodiging bij een andere bestaande club komen.

Voor echte gegevens blijven aantoonbare bronrechten, identiteitsbeoordeling en een concreet geautoriseerde provider nodig. Softwaretests bewijzen geen betere scoutingkwaliteit. Historische beschikbaarheid en bronrechten zijn gecontroleerde verklaringen, geen onafhankelijke verificatie. Zie `NEXT_CODEX_TASK.md` voor het vervolg.

De PR en het eindrapport geven de daadwerkelijk gepubliceerde laatste commit en CI-status; dit document kan zijn eigen toekomstige commit-ID niet bevatten. Historische overdrachtsbijlagen beschrijven het verpakkingsmoment.
