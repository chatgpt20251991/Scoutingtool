# Lokale accounts en clubrollen

Dit is een beveiligingsuitbreiding van het lokale onderzoeksprototype. De Node-server blijft uitsluitend op loopback. Deze accountmodule bewijst geen geschiktheid voor publieke hosting of vertrouwelijke klantgegevens.

## Accountcontract

`src/auth/index.mjs` exporteert `createAuth({path, now})` volgens `ACCOUNTS_CONTRACT.md`. Zonder pad staan alle gegevens alleen in het geheugen. Met een pad worden accounts, organisaties, lidmaatschappen en uitnodigingsdigests opgeslagen in een bestand met schemaversie 1. Onleesbare, te grote of ongeldige bestaande bestanden veroorzaken een fout; de module maakt er geen lege installatie van.

Gebruikersnamen bestaan uit 3–64 ASCII-letters, cijfers, punten, streepjes of underscores en beginnen met een letter of cijfer. Hoofdletters worden omgezet naar kleine letters. Wachtwoorden bevatten 15–128 Unicode-codepunten, maximaal 512 UTF-8-bytes. Spaties blijven onderdeel van het wachtwoord. Ongeldige Unicode en NUL worden geweigerd. Weergavenamen en organisatienamen bevatten 1–100 codepunten zonder controletekens.

Wachtwoorden krijgen een onafhankelijke willekeurige salt van 16 bytes en worden met de ingebouwde asynchrone Node-scrypt afgeleid: `N=131072`, `r=8`, `p=1`, sleutel 32 bytes, maximaal 160 MiB cryptografisch werkgeheugen. De hashvergelijking gebruikt `timingSafeEqual`. Deze keuze volgt de scrypt-ondergrens van [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) en de salt- en API-richtlijnen in de [Node crypto-documentatie](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), geraadpleegd op 8 september 2026. Hashwerk wordt binnen één instantie geserialiseerd om gelijktijdige geheugendruk te begrenzen.

Aanmelding geeft bij onbekende gebruikersnamen en onjuiste wachtwoorden dezelfde fout. Bij een geldig invoerformaat wordt ook voor een onbekende naam scrypt uitgevoerd. Per gebruikersnaam zijn maximaal 8 opeenvolgende pogingen binnen 15 minuten toegestaan; een geslaagde aanmelding wist die teller. Globaal zijn maximaal 120 pogingen per 15 minuten toegestaan. Ongeldige namen delen één begrensde teller. De tellers staan alleen in geheugen en worden bij herstart gewist. De globale limiet geldt ook voor geslaagde pogingen en wachtwoordverificatie bij wijziging.

## Sessies en lidmaatschap

Sessietokens en uitnodigingscodes bevatten 32 cryptografisch willekeurige bytes. Alleen SHA-256-digests van deze tokens worden bewaard. Sessies en hun afzonderlijke CSRF-nonces staan uitsluitend in het procesgeheugen. Een sessie verloopt absoluut na 12 uur, zonder stilzwijgende verlenging. Een herstart logt iedereen uit. Bij maximaal 100 actieve sessies verdringt een geslaagde nieuwe aanmelding de oudste sessie. Uitloggen verwijdert de betreffende sessie. Een geslaagde wachtwoordwijziging maakt alle sessies van die gebruiker ongeldig en geeft één nieuwe sessie terug; bij een opslagfout blijven het oude wachtwoord en de bestaande sessies geldig.

De module geeft de ruwe sessietoken uitsluitend bij het maken van een sessie aan de HTTP-laag terug, zodat die een HttpOnly-cookie kan plaatsen. `session()` geeft de token niet terug. De HTTP-laag beheert daarnaast cookieattributen, dezelfde-origincontroles, CSRF-controles en de organisatieheader. Deze controles worden in de HTTP-integratie getest.

Lidmaatschap wordt bij iedere autorisatie uit de actuele accountopslag gelezen. Een reeds bestaande sessie krijgt daardoor meteen de gewijzigde rol of verliest toegang na verwijdering. `viewer` leest; `scout` leest en schrijft scoutinggegevens; `owner` mag ook leden en uitnodigingen beheren. De ledenlijst is alleen voor eigenaren beschikbaar. Iedere aangemelde gebruiker mag een nieuwe, lege organisatie maken en wordt daarvan eigenaar. Een verwijderde gebruiker kan dus nog aanmelden en een eigen lege organisatie maken, maar krijgt geen toegang tot de verwijderde club.

De laatste eigenaar kan niet worden gedegradeerd of verwijderd. De eerste installatie en alle accountmutaties worden binnen dezelfde instantie geserialiseerd. Een gelijktijdige tweede installatie of tweede demotie kan daarmee geen extra installatie of organisatie zonder eigenaar maken.

## Uitnodigingen en opslag

Een eigenaar kan een code voor `owner`, `scout` of `viewer` uitgeven. De code wordt alleen bij aanmaak getoond, verloopt na 48 uur en kan precies één nieuwe account aanmaken. Invoer van een andere rol of organisatie tijdens registratie heeft geen effect. Ongeldige, verlopen en gebruikte codes geven dezelfde fout. Een dubbele gebruikersnaam consumeert een geldige uitnodiging niet. Het aanmaken van de account, lidmaatschap en consumeren van de code gebeurt in één opgeslagen wijziging. Verwijdering of degradatie van de uitgevende eigenaar verwijdert diens nog openstaande uitnodigingen voor die club.

Er wordt geen e-mail verstuurd. Codes worden handmatig gedeeld en horen niet in logs, bronbeheer of browseropslag. De huidige API ondersteunt nieuwe accounts via een uitnodiging; een bestaande account aan een tweede bestaande club toevoegen is nog geen afzonderlijke workflow.

De grenzen zijn 100 gebruikers, 50 organisaties, 100 actieve uitnodigingen, 100 actieve sessies en 128 wachtende accountoperaties. De accountlezer weigert bestanden groter dan 2 MiB en controleert relaties, rollen, unieke identiteiten, hashparameters, uitnodigingstijden en de aanwezigheid van een eigenaar voor iedere organisatie.

Een wijziging wordt eerst naar een uniek tijdelijk bestand in dezelfde map geschreven, geflusht en gesloten en daarna atomisch hernoemd. Pas na geslaagde opslag verandert de interne accountstatus. Tijdelijke bestanden krijgen waar het platform dit ondersteunt bestandsmodus `0600`; de map krijgt bij aanmaak `0700`. Windows-toegang blijft mede afhankelijk van de bestaande gebruikers- en map-ACL's. Er is geen versleuteling van accountnamen, rollen of wachtwoordhashes op schijf, geen onbeperkt herstel na stroomuitval en geen bescherming tegen een bevoegde lokale bestandswijziging.

De aanroeper moet vóór het openen van persistente accountopslag de exclusieve datamapvergrendeling van de organisatiemanager vasthouden en die gedurende de levensduur van de server behouden. De accountmodule heeft zelf geen tweede procesvergrendeling. Twee los aangemaakte instanties mogen hetzelfde bestand dus niet tegelijk wijzigen. De eerste lokale gebruiker die de installatie voltooit, wordt eigenaar; de toepassing bewijst daarbij geen externe identiteit.

## Resterende grenzen

Nog niet aanwezig: MFA, een externe identiteitsprovider, wachtwoordherstel, een accountblokkadelijst of beheerconsole, gelekte-wachtwoordcontrole, een onafhankelijke beveiligingsaudit, publiek transport met TLS, sessiebeheer over meerdere processen, een database met transacties over account- en scoutingopslag, versleutelde back-ups, herstelproeven en tamper-proof auditing. Aanmeldlimieten verminderen gokpogingen maar kunnen ook een lokale aanmelding tijdelijk hinderen. Productiehosting vereist een afzonderlijk ontwerp en validatie; verwijder de loopbackbeperking niet om deze lokale uitvoering publiek te maken.
