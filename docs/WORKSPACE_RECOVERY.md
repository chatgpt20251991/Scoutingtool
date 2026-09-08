# Clubback-ups, herstel en bewaarinventarisatie — v0.4

Een clubback-up bevat de scoutingstate van één organisatie, inclusief demo én import, oorspronkelijke snapshots, bewaarde importjobs, opdrachten, besluiten, clubvragen en actor-ID's. Accounts, rollen, sessies, uitnodigingen en interne migratie-/herstelmetadata staan er niet in. De server versleutelt deze bundel afzonderlijk; `src/backup/workspace.mjs` verzorgt inhoudscontrole, geen encryptie of authenticatie.

## Inhoudscontract

`createWorkspaceBackup({organizationId, organizationName, state, now})` levert `{format:'omniscout-workspace', version:1, organization:{id,name}, createdAt, state, digest, summary}`. `inspectWorkspaceBackup(bundle,{organizationId,now})` geeft `{state,digest,summary}` terug nadat de inhoud opnieuw is gecontroleerd. Een andere organisatie wordt geweigerd. De digest betreft alle velden van de scoutingstate, deterministisch gerangschikt. `stateDigest(state)` berekent deze SHA-256; een digest op zichzelf bewijst geen toestemming of betrouwbare broninhoud.

De aanvullende export `validateWorkspaceState(state,{now,allowPending=false,checkRights=true})` geeft `{state,digest,summary:{counts,bytes}}`. Dit is de gedeelde strikte validator voor de manager en administratieve back-upcontrole. Onbekende velden worden geweigerd, niet weggefilterd. Alleen de manager of de expliciete administratieve bundelgrens mag vooraf de bekende interne rootvelden `_legacyMigration` en `_workspaceRestore` verwijderen.

Plain JSON is begrensd tot 32 MiB, maximaal 24 nestniveaus en één miljoen bezochte waarden. Arrays moeten volledig en gewoon zijn; getters, circulaire waarden, prototypevelden, niet-JSON-waarden, onbekende schema's en onbekende geneste velden worden geweigerd. De grens geldt ook voor de volledige bundel met metadata; een state vlak onder 32 MiB kan met metadata te groot worden. Iedere ontbrekende referentie of afwijkende digest is een fout; er worden geen records stilzwijgend weggelaten.

Validatie controleert besluiten, taken, auditverwijzingen, clubvragen, bron-/speler-/competitie-identiteiten, snapshotdigests en historische importtijdstippen. Import-/rollbackhistorie wordt in volgorde opnieuw toegepast om ontbrekende of gewijzigde snapshots en geschonden correctieafhankelijkheden te ontdekken. Jobs hebben een begrensde structuur, passende status/resultaatverwijzingen en hun originele payload/digest. Een payload kan geldig blijven als een latere correctie of rollback de actuele catalogus heeft veranderd; zijn eerdere correctievoorouders moeten aanwezig blijven.

Voor **alle** bewaarde snapshot- én jobpayloads zijn op het moment van maken, inspecteren en herstellen actuele verklaarde `store`- en `export`-rechten vereist. Dat omvat mislukte jobs, teruggedraaide snapshots en oudere bronversies. Een oudere toegestane bronversie omzeilt geen nieuwere ingetrokken exportrechten. Historische schema-/rechtenvalidatie gebeurt daarnaast op het oorspronkelijke import-/jobtijdstip. De software verifieert bronverklaringen niet onafhankelijk.

Een clubback-up mag geen `queued`- of `running`-jobs bevatten. Zij starten dus niet ongemerkt na herstel. Bestaande jobs worden voor een gewone back-up eerst door de huidige queue afgewerkt; blijvende queuefouten worden zichtbaar doorgegeven.

## Samenvatting

De bundelsamenvatting is:

```text
{ organizationId, organizationName, createdAt,
  counts: {
    demo: { decisions, tasks, audit },
    import: { decisions, tasks, audit },
    snapshots, importHistory, jobs, sources, players, competitions
  }, bytes }
```

Inspectie berekent de samenvatting opnieuw en weigert een afwijkende aangeleverde samenvatting. De aantallen spelers/competities omvatten unieke ID's in bewaarde imports, ook historie; het is geen actuele dekkingsclaim. `bytes` is de UTF-8-grootte van de JSON-state zonder encryptie/envelop. De huidige werkruimtesamenvatting uit alleen `validateWorkspaceState` bevat `{counts,bytes}`.

## Consistente opname

`await manager.capture(orgId)` sluit aan op de bestaande manager-serialisatie, wacht de onderliggende queue af en levert `{state,digest}`. De state is een onafhankelijke kopie zonder de twee bekende interne receipts. Onbekende velden blijven fouten. Capture zelf controleert de structuur maar staat het lezen van inmiddels vervallen bronrechten toe; de daaropvolgende create/inspect/restore controleert rechten verplicht.

`await manager.capture(orgId,{drain:false})` is uitsluitend bedoeld voor een bewaarinventarisatie. Het leest een bestaande store, of laadt de state zonder een queue te initialiseren. Een opgeslagen pending job wordt hierdoor niet gestart en het statebestand wordt niet herschreven. Bij een al actieve queue kan die queue natuurlijk onafhankelijk verder verwerken; de opname bevat één consistente storeversie. Pending jobs blijven in deze modus zichtbaar.

Beide capturemodi weigeren een nog onvoltooide legacy-migratie en ongeldige of te grote state. De 32-MiB-grens kan daardoor ook een bewaarinventarisatie blokkeren; dat wordt expliciet gemeld, niet opgelost door records weg te laten.

## Atomisch herstel en lokale herstelkopieën

`await manager.restore(orgId,{state,expectedDigest,actor,backupDigest,authorize})` levert `{restored:true,recoveryId,digest}`. De HTTP-laag koppelt een eenmalige, kortlevende preview aan sessie/gebruiker/club, controleert dezelfde organisatie met `inspectWorkspaceBackup` en levert een actuele eigenaarcontrole via de optionele async `authorize`-callback.

De manager serialiseert de actie, wacht de huidige queue af, weigert onvoltooide migratie, roept autorisatie na het wachten opnieuw aan en vergelijkt de huidige statedigest met de preview. Een wijziging sinds de preview geeft 409. De inkomende state wordt strikt gevalideerd en moet exact de gecontroleerde back-updigest hebben.

Vóór vervanging wordt de volledige vorige lokale state duurzaam opgeslagen onder `organizations/<uuid>/recovery/<recoveryId>.json`. De map en bestanden mogen geen symlinks/junctions of gekoppelde statebestanden zijn. Ook voor het dupliceren van de vorige state worden actuele bronrechten gecontroleerd. De definitieve statewrite behoudt het bestaande legacy-ontvangstbewijs en voegt een `workspace.restored`-auditregel met de huidige gebruikers-ID toe. De manager hercontroleert de eigenaar vlak vóór deze write en de bronrechten in de transactiecallback. Bestaande store-/queuehandles blijven op dezelfde store werken.

Een write gebruikt een tijdelijk bestand, flush en atomische rename; de huidige bestemming wordt nooit vooraf verwijderd. De bestaande begrensde Windows-renameherhaling blijft van toepassing. Bij een mislukte write verandert de vorige state op disk of in geheugen niet. Als de herstelkopie al was geschreven voordat een latere controle/write mislukte, blijft die kopie bewust bewaard. Crash vóór de statecommit laat de vorige state plus eventuele herstelkopie staan; crash na de commit laat de herstelde state en vorige kopie staan. Directory-flush wordt uitgevoerd waar het OS dit ondersteunt; dit vervangt geen hardware- of back-upgarantie.

Er blijven maximaal tien lokale herstelkopieën per organisatie staan, inclusief kopieën van een later mislukte herstelpoging. Een volgende poging wordt geweigerd; historie wordt nooit automatisch verwijderd. Archiveren en vrijmaken vereist gecontroleerd lokaal beheer. Een onbekend bestand in de herstelmap blokkeert verdere automatische writes, zodat beschadigde of afgebroken bestanden niet worden genegeerd. Geheugenmodus bewaart eveneens maximaal tien private vorige states, tot het proces stopt.

De herstelkopieën hebben dezelfde lokale bestandstoegangsbescherming als de actieve state. Ze zijn **geen schijfversleuteling** en geen gedownloade versleutelde `.osbackup`-bestanden. De HTTP-respons bevat alleen een willekeurig recovery-ID en nooit een herstelbestandspad of de vorige broninhoud. `manager.stats()` meldt `counts.recoveryCopies` en `limits.recoveryCopies:10`.

## Alleen een bewaarinventarisatie

`retentionPreview(state,{now,days=365})` accepteert een geheel aantal dagen van 1 tot 3650 en geeft `{asOf,days,cutoff,counts,items,warnings,destructive:false,truncated}`. Er wordt niets geschreven, verwijderd, gepland of gearchiveerd.

`counts` bevat `ageCandidates`, `activeDependencies`, `pendingJobs`, `rightsBlocks`, `totalItems` en `returnedItems`. De lijst toont maximaal 200 relevante items met `{kind,dataset,id,at,ageCandidate,activeDependency,rightsBlocked,reason}`. Oude besluiten, opdrachten, audit, importhistorie, snapshots en bronversies blijven afzonderlijk zichtbaar. De laatste scoutingbeslissing, open taken, provenance, actieve snapshots en correctieverwijzingen hebben expliciete afhankelijkheidsmarkeringen. Bronrechtenblokkades van alle bewaarde payloadversies tellen mee.

De inventaris bevat geen vrije dossiernotities of andere clubgegevens. Leeftijdskandidaten zijn handmatig te beoordelen; ouderdom bewijst geen wettelijke bewaarplicht of toestemming om te verwijderen. Een verlopen bronrecht is een te onderzoeken blokkade, geen melding dat data al zijn verwijderd.

## Uitgevoerd bewijs

Uitgevoerd tijdens implementatie:

```text
node --test tests/organization-recovery.test.mjs tests/backup-workspace.test.mjs tests/organizations.test.mjs
39 tests, 39 pass, 0 fail, 0 skipped
duration_ms 5944.1833
```

Daarin staan twintig nieuwe herstel-/back-upregressies en negentien bestaande organisatietests. De nieuwe controles omvatten alle bewaarde bronrechten, corruptie, grootte, onbekende velden, referenties, pending jobs, niet-schrijfbare retentie, bestaande handles, herstart, stale previews, twee autorisatiecontroles, herstelkopielimiet, symlinks en geïnjecteerde filesystem-`ENOSPC` tijdens zowel recovery-copywrite als definitieve statewrite. De ruimtefout is gecontroleerd geïnjecteerd in de filesystemfunctie; er is geen echte gebruikersschijf opzettelijk volgeschreven. De integrator bewaart vervolgens het gecombineerde actuele HTTP-, crypto- en browserbewijs.
