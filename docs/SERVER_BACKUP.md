# Offline back-up en herstel van de actieve lokale server

De volledige serverback-up is een beheerdershandeling buiten de webinterface. Stop de Node-server eerst. Een club-eigenaar kan via de clubinterface geen accounts of andere clubs downloaden. De CLI maakt tijdens ontwikkeling alleen synthetische testkopieën; er is geen automatische back-up van de persoonlijke installatie gestart.

De back-up bevat alle lokale accounts met hun wachtwoordhashes, organisaties, lidmaatschappen en de actieve scoutingopslag van alle clubs. Binnen iedere club blijven demo en import gescheiden. De uitvoer is een `.osbackup`-bestand met een versleutelde JSON-envelope; namen, notities, hashes en de bestandsmanifesten staan binnen de versleuteling. De wachtzin wordt niet als argument, in een omgevingsvariabele, in logs of in de back-up bewaard. Er is geen wachtzinherstel.

## Bereik en uitsluitingen

Dit is een back-up van de actieve serverstaat, geen volledige archiefkopie van iedere ooit aanwezige bron of herstelversie. De preview toont deze expliciete uitsluitingen:

| Uitsluiting | Betekenis |
|---|---|
| `sessions` | Iedereen meldt na herstel opnieuw aan. |
| `invitations` | Openstaande codes worden niet hersteld; geef zo nodig nieuwe uitnodigingen uit. |
| `private_recovery_copies` | Eerdere lokale noodkopieën van clubherstel blijven uitsluitend op de oorspronkelijke machine. |
| `legacy_source` | Het oorspronkelijke v0.2-`state.json` wordt niet meegenomen. De al overgenomen actieve clubgegevens wel. |
| `original_migration_registry` | Het oude migratieregister wordt vervangen door een expliciet `absent`-register in de nieuwe installatie; daar staat geen oude bron klaar voor hernieuwde overname. |
| `internal_migration_and_restore_receipts` | Interne ontvangstbewijzen worden gecontroleerd en verwijderd uit de kopie. Scoutinghistorie, provenance en bestaande auditactoren blijven behouden. |

Versleutelde back-ups omvatten accountgeheimen in de vorm van wachtwoordhashes. Bewaar zowel het bestand als de wachtzin zorgvuldig en afzonderlijk. De herstelde actieve `.local`-bestanden en oude lokale noodkopieën zijn zelf niet versleuteld door deze functie. Windows-ACL's en passende schijfbeveiliging blijven verantwoordelijkheid van de beheerder.

## CLI

Gebruik Node.js 22+ vanuit het hoofdproject. Hieronder zijn `C:\Private\...` voorbeeldpaden; maak vooraf een eigen privémap buiten Git. De uitvoermap en de bovenliggende herstelmap moeten bestaan. Het hersteldoel zelf mag nog niet bestaan.

```powershell
node tools/server-backup.mjs create --data-dir "C:\Private\OmniScout\.local" --output "C:\Private\Backups\omniscout.osbackup"
node tools/server-backup.mjs inspect --input "C:\Private\Backups\omniscout.osbackup"
node tools/server-backup.mjs restore --input "C:\Private\Backups\omniscout.osbackup" --destination "C:\Private\OmniScout-restored\.local" --confirm DIGEST_UIT_INSPECT
```

Zonder `--passphrase-file` vraagt een interactieve terminal de wachtzin zonder tekens te tonen. Gebruik 15–128 Unicode-tekens, maximaal 512 UTF-8-bytes. Een verloren wachtzin kan niet via een accountwachtwoord worden vervangen.

Voor een niet-interactieve, lokaal beheerde uitvoering mag `--passphrase-file "C:\Private\backup-phrase.txt"` worden toegevoegd. Dit bestand bevat precies één regel met de wachtzin, eventueel gevolgd door één regelafsluiting. Het moet buiten iedere Git-werkmap staan. De CLI weigert bestanden onder een bovenliggende `.git`, koppelingen, meerdere regels en te grote bestanden. Op POSIX worden groeps- en wereldrechten geweigerd; gebruik `0600`. Op Windows bewijst de Node-bestandsmodus geen private ACL: stel met Windows-bestandsbeveiliging in dat alleen de beheerder het bestand kan lezen. Verwijder een tijdelijk wachtzinbestand na gebruik volgens het lokale beheerbeleid.

`create` schrijft uitsluitend naar een nieuw bestand buiten de actieve datamap. Bestaande uitvoer wordt niet overschreven. `inspect` toont alleen de digest, aantallen en uitsluitingen, zonder clubnamen, dossiers, accounts of hashes. `restore` vereist de exacte digest uit `inspect`; herstel naar een bestaande map wordt ook geweigerd wanneer deze leeg is. De CLI geeft geen plaintextwachtzinnen of ruwe dossierinhoud terug.

## Controle vóór back-up

De module verkrijgt dezelfde exclusieve `.organization-manager.lock` als de server. Een bestaande lock wordt nooit overgenomen, ook niet wanneer het opgegeven proces niet lijkt te draaien. Volg na een crash de procedure in `ORGANIZATION_STORAGE.md`. Alleen deze tijdelijke lock verandert tijdens de back-up; oorspronkelijke account-, club-, migratie- en bronbestanden blijven ongewijzigd.

Accounts worden gevalideerd tegen het bestaande versie-1-schema. Alle clubs uit de accountopslag moeten in het manifest voorkomen. Een nieuw aangemaakte club zonder ooit geschreven statebestand wordt expliciet als een leeg werkgebied opgenomen; dit past bij de bestaande luie opslag. Een bestaande ongeldige state wordt nooit als leeg gerepareerd. Verweesde clubmappen, onbekende bestanden, onvoltooide migraties, afwijkende ontvangstbewijzen en onveilige paden veroorzaken een fout. Een herstelmap zonder bijbehorend actief statebestand wordt eveneens geweigerd.

De CLI start geen importqueue en verwerkt geen wachtende jobs. `queued` of `running` blokkeert de back-up; verwerk of herstel die jobs eerst via de normale toepassing en stop vervolgens opnieuw de server. De actuele opslag- en exportrechten worden gecontroleerd voor alle bewaarde payloads, ook rollbackgeschiedenis en jobinhoud. Een back-up omzeilt verlopen of ingetrokken rechten niet.

Accounts zijn begrensd tot 2 MiB, de gelezen actieve bronbestanden gezamenlijk tot 32 MiB, het plaintext-back-updocument tot 32 MiB en de versleutelde envelope tot 46 MiB. Het accountmodel begrenst de server tot 100 accounts en 50 clubs. Private herstelmappen zijn alleen als uitgesloten, bekende mappen toegestaan met maximaal tien verwachte kopiebestanden. Hun historische inhoud wordt niet als actieve data ingelezen.

## Herstel en manifest

Het interne formaat `omniscout-server`, versie 1, bevat accounts, clubstaten, een genormaliseerd migratieregister, uitsluitingen en een manifest. Iedere manifestregel heeft een vast verwacht bestandspad, UTF-8-byteomvang en SHA-256-hash. Een digest bindt het hele plaintext-document. De AES-256-GCM-envelope uit `src/backup/crypto.mjs` beschermt de versleutelde inhoud tegen wijziging; een juist versleuteld maar semantisch ongeldig manifest wordt alsnog geweigerd.

Herstel valideert eerst de ontsleutelde inhoud, alle relaties en actuele bronrechten. Daarna wordt naar een unieke stagingmap naast het nieuwe doel geschreven. Bestanden worden geflusht en teruggelezen ter controle; de betrokken mappen en na publicatie ook de bovenliggende map worden geflusht waar het besturingssysteem dit ondersteunt. Een aparte exclusieve lock voorkomt dat twee samenwerkende herstelprocessen tegelijk hetzelfde doel publiceren; op Windows delen hoofdlettervarianten dezelfde lock. Vlak vóór publicatie worden de actuele bronrechten opnieuw gecontroleerd. Na de laatste controle dat het doel niet bestaat, wordt de volledige stagingmap met een directory-rename gepubliceerd. De originele bronmap wordt niet verwijderd, gewijzigd of overgenomen.

Bij een fout vóór publicatie blijft het bestaande doel onaangeraakt en worden alleen gecontroleerde, door deze herstelpoging gemaakte stagingpaden opgeruimd. Als zo'n pad ondertussen is gewijzigd of vervangen, blijft het voor handmatige controle staan. Normale afronding verwijdert de eigen lock. Een achtergebleven herstelguard na een crash vereist dezelfde zorgvuldige procescontrole als een serverlock; verwijder nooit op goed geluk locks of mappen van andere processen.

Deze lokale uitvoering gaat uit van een beheerde filesystemomgeving tijdens de handeling. De guard coördineert Omni-Scout-processen; hij beschermt niet tegen een bevoegd lokaal proces dat tegelijk willekeurige bestanden of lege doelmappen vervangt. Geen gegevens op schijf zijn beschermd tegen de systeembeheerder. Houd andere schrijvers tijdens back-up en herstel uit de betrokken mappen. Directory-rename en fileflush bewijzen geen volledig herstel na iedere stroom- of hardwarefout; een apart operationeel herstelplan blijft nodig.

## Na herstel

Start de Node-app met de herstelde datamap als actieve `.local`-opslag en controleer login, rollen, clubselectie, bronrechten en scoutinginhoud. Verplaats of vervang een bestaande installatie niet automatisch met deze CLI. Er wordt geen server gestart of productieomgeving gepubliceerd. De tests controleren een werkelijk gestarte `createApp` met de nieuwe datamap, opnieuw aanmelden en gescheiden clubinhoud; de integrator rapporteert de werkelijk uitgevoerde testresultaten afzonderlijk.

De publieke module-API is `createServerBackup({dataDir,passphrase,now})`, `previewServerBackup({envelope,passphrase,now})` en `restoreServerBackup({envelope,passphrase,destination,confirmDigest,now})`. De preview retourneert `{digest,counts,exclusions}`; herstel voegt `restored:true` toe. Dit document kent geen juridische bewaartermijn toe en start geen periodieke of externe verwerking.
