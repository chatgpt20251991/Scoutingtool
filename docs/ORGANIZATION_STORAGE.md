# Lokale organisatieopslag — versie 0.3

`createOrganizationManager({dataDir, legacyStatePath, now})` uit `src/organizations/index.mjs` beheert één lokaal gegevenspad. Authenticatie en controle van lidmaatschap blijven verplicht in de server vóór iedere aanroep. Een UUID is een opslagadres, geen toegangsbewijs. Dit is een lokaal bestandsmodel, geen productiehosting of bescherming tegen een beheerder die bestanden op dezelfde computer kan veranderen.

## Gebruik en isolatie

`await manager.get(orgId)` geeft `{store, importQueue}` volgens de bestaande interfaces. Organisatie-ID's zijn geldige UUID's met variantbits en versies 1–8, intern omgezet naar kleine letters. Nil-ID's, extra padtekens en traversal worden geweigerd. De opslag staat op `dataDir/organizations/<uuid>/state.json`. Elke organisatie krijgt een eigen store en queue; besluiten, opdrachten, brief, audit, importdatasets, snapshots, job-ID's en idempotentiesleutels worden nooit tussen stores gedeeld. Demo en import blijven ook binnen iedere organisatie afzonderlijke werkgebieden.

Gelijktijdige `get`-aanroepen hergebruiken één store/queue. Beheeraanroepen en publieke store-/queueaanroepen worden lokaal geserialiseerd. Gewone statewrites gebruiken de bestaande storetransactie: schrijf naar een uniek tijdelijk bestand, flush, rename, pas daarna in-memory state vervangen. Mislukte mutaties blijven onzichtbaar. Een queue kan verder verwerken terwijl andere organisaties worden gebruikt. Symbolische koppelingen/junctions in beheerde mappen, gekoppelde statebestanden en hardlinks naar statebestanden worden geweigerd. Dit voorkomt geen gelijktijdige sabotage van lokale bestanden door een andere OS-gebruiker met dezelfde rechten.

`dataDir: null` maakt volledig gescheiden geheugenstores. Die verdwijnen na stoppen. Het eenmalige migratieregister heeft in deze modus eveneens alleen de levensduur van de manager. Er worden maximaal 50 stores per manager geopend; autorisatie begrenst daarnaast het maken van organisaties.

`await manager.idle()` wacht tot alle geopende queues klaar zijn en geeft blijvende queuefouten door. `await manager.close()` accepteert geen nieuwe aanroepen meer, wacht reeds geaccepteerde aanroepen en queues af, en geeft daarna de lock vrij. Meerdere `close()`-aanroepen delen hetzelfde resultaat. Ook eerder teruggegeven store-/queuehandles weigeren nieuwe handelingen na sluiten.

## Proceslock en crashherstel

Bij openen wordt `dataDir/.organization-manager.lock` exclusief aangemaakt, met PID, willekeurige eigenaarcode en aanmaaktijd. Een tweede manager in hetzelfde proces én een tweede Node-proces worden geweigerd. Sluiten verwijdert de lock uitsluitend als de eigenaarcode nog overeenkomt.

Een bestaande lock wordt **nooit automatisch verwijderd**, ook niet als het opgeslagen PID dood lijkt. Een hergebruikt PID, een halfgeschreven lock en twee gelijktijdige herstelpogingen zijn zonder aanvullende procescoördinatie niet veilig te onderscheiden. Na een normale stop hoort de lock weg te zijn. Na een crash:

1. Stop andere Omni-Scout-processen die dit gegevenspad kunnen gebruiken.
2. Lees alleen de metadata in `.organization-manager.lock` en controleer in het OS het PID en het bijbehorende proces. Bij twijfel niet verwijderen.
3. Bewaar een lokale kopie van het gegevenspad en verwijder uitsluitend het gecontroleerde lockbestand. Laat accounts, statebestanden en migratieregister staan.
4. Start één server. Herstelbare oude `running`-jobs volgen de bestaande begrensde queueherstartprocedure.

De applicatie hoort `close()` aan te roepen bij normaal stoppen. Een stroomstoring, geforceerde procesbeëindiging of systeemcrash vereist bovenstaande controle. Geen lock automatisch overnemen is een bewuste beperking van dit lokale ontwerp.

## Eenmalige migratie van versie 1

De server roept na de eerste account-/organisatieaanmaak `await manager.claimLegacy(firstOrganizationId)` aan voordat die werkruimte bruikbaar wordt. Alleen het expliciet door de integrator aangeleverde `legacyStatePath` wordt gelezen; de manager zoekt geen andere bestanden. Het oude bestand blijft byte voor byte staan.

De migratie leest maximaal 512 MiB, accepteert alleen versie-1 scoutingopslag en controleert werkgebieden, limieten, snapshots/digests, historische importvalidatie en jobstructuur. Rechten van een historische snapshot worden op het oorspronkelijke importtijdstip gevalideerd; actuele leesrechten blijven daarna onverminderd gelden. Alleen de bekende scoutingvelden worden overgenomen. Gestructureerde credentialvelden zoals passwords, API-keys, sessietokens, accounts en cookies worden op alle geneste niveaus uitgesloten. Dit is geen automatische detectie van een geheim dat iemand in vrije notitietekst heeft getypt. Prototype-sleutels en te diep geneste JSON worden geweigerd.

Migratie overschrijft nooit een niet-leeg doel, ook niet als er alleen een clubvraag of importwerkgebied staat. Herstel gebruikt vier duurzame stappen:

1. Als de bron bestaat, krijgt `legacy-claim.json` vóór bronvalidatie een `pending`-record met organisatie-ID en voorlopig `digest: null`. Daardoor blijft ook een beschadigde oude bron aan de eerste organisatie gebonden.
2. Na geslaagde bronvalidatie wordt de SHA-256 van de ongewijzigde bron vastgelegd.
3. De volledige gesaniteerde state en een intern `_legacyMigration`-ontvangstbewijs worden in dezelfde storetransactie geschreven.
4. Het register krijgt status `complete`. Registerwrites gebruiken een geflushte tijdelijke file en atomische rename. Directory-flush wordt geprobeerd waar het OS dat ondersteunt; Windows levert daarvoor niet altijd een bruikbare directoryhandle.

Een fout vóór de statecommit behoudt het lege doel. Een nog ongeldige bron mag handmatig worden hersteld zolang de eerste organisatie behouden blijft en nog geen geldige bronhash is vastgelegd. Vanaf de vastgelegde bronhash gebruikt opnieuw proberen dezelfde organisatie en dezelfde bytes. Een gewijzigde of ontbrekende bron bij een nog niet geschreven state blokkeert dan migratie. Als de state al is geschreven maar het laatste registerwrite faalt, herkent een retry/herstart het ontvangstbewijs en voltooit alleen het register. Besluiten en imports worden niet opnieuw toegevoegd. Toegang tot een organisatie met een `pending`-claim wordt geweigerd totdat de eigenaar het herstel uitvoert.

Een ontbrekend oud bestand wordt als `absent` vastgelegd. Het later neerzetten van een statebestand kan daardoor geen oude gegevens ongemerkt naar een volgende organisatie kopiëren. Een reeds voltooide claim retourneert een idempotent resultaat; een claim vanuit een ander organisatie-ID krijgt 409. Beschadigde bestanden worden nooit automatisch gewist.

De uitkomst is `{claimed, organizationId, reason}`. Mogelijke redenen: `migrated`, `already_claimed`, `no_legacy_state`, `recovered_completed_claim`. Een intern receipt of digest hoort niet in de publieke state-export; de server blijft alleen de expliciete scoutingvelden exporteren. Migratie kent aan oude auditregels geen fictieve nieuwe actor toe.

## Statistieken voor de accountinterface

`await manager.stats(orgId)` bevat geen namen, broninhoud, notities, credentials of bestandspaden:

```json
{
  "mode": "local_file",
  "organizationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "counts": {
    "demo": {"decisions": 0, "tasks": 0, "audit": 0},
    "import": {"decisions": 0, "tasks": 0, "audit": 0},
    "snapshots": 0,
    "importHistory": 0,
    "jobs": 0,
    "pendingJobs": 0,
    "failedJobs": 0
  },
  "limits": {
    "organizations": 50,
    "tasksPerDataset": 2000,
    "auditEvents": 20000,
    "snapshots": 200,
    "importJobs": 200,
    "pendingImportJobs": 20,
    "importAttempts": 3,
    "importBytes": 1048576
  },
  "migration": "complete"
}
```

`mode` is `local_file` of `memory`; `migration` is `none`, `absent` of `complete` voor leesbare werkgebieden. Snapshot- en jobaantallen tellen ook behouden historie; ze beweren geen actuele spelersdekking of resterende schijfruimte.

## Uitgevoerd bewijs

`node --test tests/organizations.test.mjs` gebruikt uitsluitend synthetische gegevens en eigen tijdelijke mappen. De suite toetst organisatie-/idempotentie-isolatie, herstart, twee processen, vergrendeling na crash, padkoppelingen, lege bronnen, bronbehoud, corruptie, credentialuitsluiting, normale writefouten en beide migratiecommitfasen. De integrator voert daarna de gecombineerde server- en browsertests uit en bewaart het actuele totaal in het eindrapport. Deze tests bewijzen geen productiegeschiktheid, disk-encryptie, retentiebeleid of back-upherstel na defecte hardware.
