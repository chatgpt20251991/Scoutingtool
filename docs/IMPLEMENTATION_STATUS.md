# Feitelijke implementatiestatus

**8 september 2026 · versie 0.5.0.** Node is het hoofdproject. De volledige Python-referentie, oorspronkelijke archieven en bijlagen zijn behouden. De langetermijnambitie in `BUILD_BRIEF.md` is geen claim dat die complete productroadmap al is uitgevoerd.

| Onderdeel | Actuele status |
|---|---|
| Bronovername | Gehele geleverde code behouden; 45 oorspronkelijke referentie-/archief-/bijlagebestanden opnieuw byte voor byte gecontroleerd. |
| Accounts en clubs | Lokale scrypt-accounts, rollen, gescheiden stores/queues, sessies en eenmalige legacy-overname. |
| Uitnodigingen | Nieuwe én bestaande accounts; club-/rolpreview, bevestiging, atomisch eenmalig verbruik, bestaande rol behouden; eigenaar kan codes intrekken. |
| Clubback-up | Versleuteld bestand met demo/import van één club; geen accounts, andere clubs of sessies. |
| Clubherstel | Eigenaar, actuele rechten, vijf minuten geldige sessiegebonden preview; gewijzigde state blokkeert herstel. Vorige state blijft privé bewaard. |
| Serverback-up | Afzonderlijke offline CLI met exclusieve lock, actieve accounts en alle clubs, strikt manifest en herstel naar een nieuwe datamap. |
| Uitsluitingen | Serverkopie herstelt geen sessies, uitnodigingen, oude lokale herstelkopieën of oorspronkelijke legacy-bronbestanden. |
| Retentie | Alleen inventarisatie van ouderdom, afhankelijkheden, pending jobs en rechtenblokkades; geen verwijdering of planning. |
| Import/scouting | Gecontroleerde JSON-import, duurzame jobs, snapshots, correcties, rollback, radar, onderzoek en toegestane exports blijven werken. |
| Interface | Desktop/mobiel; wachtzinnen, bestanden, previews en oude codes worden bij contextwisselingen gewist; formulieren wachten op laden van de club. |
| Ontwikkelworkers | V0.5: A primaire bronvoorwaarden en onafhankelijke review; B Wikidata-adapter en integratiereview; C echte-profielinterface en browserregressies. De integrator beheert HTTP, CLI en publicatie. |
| GitHub | V0.3 commit `54e6dfd6c05b8bb2d35629ec98300902f7af5ceb` met geslaagde CI in PR #1. PR #1/#2 samengevoegd in main `64d9ea4ef4a819ac5e8b3397d46122b73ea5c32d`; v0.5 branch `codex/omniscout-real-profiles`. |
| Echte openbare profielen | Expliciete Wikidata-zoek/ophaalroute, bronrevisies, volwassen toelating, vaste offline profielkopie. Geen wedstrijdstatistieken of actuele clubclaims. |
| Hosting/data/AI | Wikidata-profielbron aangesloten; geen publieke deployment, wedstrijdprovider, LLM of betaald gebruik. |

## Verificatie en gevonden fouten

De actuele gecombineerde commando's, totalen en ruwe uitvoer staan in `reports/v0.5/results.json` en de bijbehorende logs. De nieuwe native browsersuite heeft acht profielcontroles met een geïnjecteerde synthetische bron; herstel/uitnodigingen elf, accountbeheer twaalf, bestaande import tien en standalone/edge tien. Daarnaast is de buiten Git opgeslagen HTML met tien werkelijk opgehaalde profielen apart in Edge gecontroleerd. De Python-referentie behoudt 62 tests. De CLI-startproef controleert werkelijk een bezette poort en vrijgegeven datamaplock. Node-eindresultaten omvatten ook synthetisch volledig serverherstel met opnieuw aanmelden en gescheiden scoutinggegevens.

De onafhankelijke review test intrekking van eigenaarschap tijdens herstel, verlopen sessies, maximaal vier previews/verzoeken, wachtzingrenzen en rechtenverval tijdens verwerking. Een grote wachtzin wordt nu vóór Unicode-arrayallocatie geweigerd. Serverherstel hercontroleert bronrechten na ontsleuteling en vlak vóór publicatie. Hoofdlettervarianten delen op Windows dezelfde herstelguard; een bestand dat met twee punten begint telt niet als een pad buiten de actieve datamap.

De browserproeven vonden formulieren die tijdens asynchroon clubladen te vroeg beschikbaar waren, en vorige uitnodigingscodes/previews die kort bleven staan bij een nieuw verzoek. Beide races zijn hersteld en opnieuw getest. Eerdere mislukte proeven blijven afzonderlijk bewaard. Filesystemfouten zoals ENOSPC worden gecontroleerd geïnjecteerd; er is geen gebruikersschijf expres gevuld. Een geslaagde test is geen productieaudit of bewijs van scoutingkwaliteit.

V0.5-review corrigeerde ook onvolledige bronbatches, verkeerde labelidentiteiten, onzekere geboortedata, tegenstrijdige gedeeltelijke teamdatums en transporten die annulering negeren. Een regressie met de ingestelde applicatieklok vond drie scoutingtijdvelden die nog de systeemklok gebruikten; deze volgen nu dezelfde klok als audit en back-upvalidatie. De oorspronkelijke foutlogs zijn behouden. Eén accountbrowsertest liep bij parallelle uitvoering tegen een wachttijd aan; een geïsoleerde herhaling slaagde zonder code- of timeoutwijziging. De oorzaak daarvan is niet bewezen.

## Resterend werk

Publieke TLS-hosting, MFA, wachtwoordherstel, externe identiteitscontrole, transactionele opslag voor meerdere processen, monitoring en onafhankelijke productiebeveiliging zijn nog nodig voor publieke inzet. Actieve schijfgegevens en vorige-statekopieën zijn niet door de app versleuteld. Beheer van volle herstelmappen, externe back-upopslag, operationele herstelproeven en daadwerkelijke retentieverwijdering blijven vervolgwerk.

Echte openbare profielgegevens zijn via Wikidata aangesloten. Voor recente wedstrijdstatistieken, minuten en aantoonbare competitieselecties ontbreekt nog een concrete geautoriseerde sportprovider met configuratie. De oorspronkelijke radar blijft expliciet synthetisch; de aparte echte-profielweergave kent geen fictieve prestatiecijfers. Bronclaims worden niet onafhankelijk geverifieerd. Zie `NEXT_CODEX_TASK.md`.

De uiteindelijke GitHub-commit en CI-uitkomst worden in de PR en het externe opleverrapport vastgelegd; een gecommitteerd document kan zijn eigen toekomstige commit-ID niet bevatten. Oudere overdrachtsbijlagen beschrijven het verpakkingsmoment.
