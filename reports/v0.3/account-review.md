# Worker D — onafhankelijke controle van lokale accounts

Datum: 8 september 2026. Scope: de geïntegreerde accountgrens in `src/accounts-server.mjs`, routering in `src/server.mjs`, de authmodule van Worker A en de organisatieopslag van Worker B. Node is het hoofdproject. Alle gebruikte accounts, clubs, spelers en notities zijn synthetische tests. Er zijn geen externe accounts, providers of productiedata benaderd.

De controle leverde twee concrete integratiefouten op. Beide zijn hersteld en met echte HTTP-/bestandstests opnieuw gecontroleerd. Binnen de hieronder getoetste scope blijft geen reproduceerbare bevinding open. Dit is geen volledige security-audit of productiegeschiktheidsclaim.

## Gevonden en hersteld

1. **P1 — ingelogde mutaties werden door het CSRF-formaat geweigerd.** `issueSession()` leverde een base64url-CSRF van 43 tekens, terwijl beide servergrenzen 64 hextekens vereisten. Daardoor kon setup slagen en iedere volgende write alsnog 403 krijgen. Worker A genereert de sessie-CSRF nu als 32 willekeurige bytes in hexformaat; bearer- en uitnodigingstokens blijven apart. De review voert setup en een echte `PUT /api/brief` uit en weigert de oude/onjuiste nonce.

2. **P1 — beschadigde oude state kon na herstel aan een latere organisatie worden toegewezen.** Setup leverde bij een migratiefout een herstelsessie, terwijl bronvalidatie nog vóór het duurzame claimrecord gebeurde. Een later gemaakte organisatie kon daardoor bij bronherstel de oude state claimen. Na expliciete afstemming met de integrator reserveert Worker B de eerste organisatie nu vóór validatie van een bestaande bron. Een `pending`-record met `digest: null` laat bronherstel toe, maar behoudt de organisatiegrens. Zodra validatie slaagt wordt de bronhash vastgelegd. Een HTTP-test herstart de app na mislukte setup, herstelt de synthetische bron, weigert herstel naar organisatie B, en bewijst dat alleen A de oude besluiten krijgt. De oorspronkelijke bronbytes blijven behouden.

De opslagfix is tijdens deze review uitgevoerd in de eerder aan Worker B toegewezen module, tests en opslagdocumentatie. De review veranderde geen auth- of serverimplementatie; de CSRF-fix is door Worker A uitgevoerd.

## Werkelijk uitgevoerde regressies

Nieuw bestand: `tests/account-review.test.mjs`, acht tests met een daadwerkelijk luisterende Node-server op een tijdelijke loopbackpoort. Dekking:

- Default `createApp()` vereist aanmelden voor catalogus, dossiers, state, coverage, jobs, opslagstatistieken en exports. Valse organisatie-/gebruikersheaders geven geen toegang. Alleen expliciete publieke assets, health en het synthetische importvoorbeeld zijn openbaar.
- Preauth-CSRF is aan de HttpOnly-cookie gebonden, verschillende browsers delen geen nonce, de nonce verloopt en een andere origin wordt geweigerd. De na login uitgegeven nonce werkt voor echte mutaties.
- Organisatie A en B blijven gescheiden bij reads, exports, jobs en imports. `organizationId`/`tenantId` in een JSON-body overschrijven de geautoriseerde header niet. Een job-ID uit A kan vanuit B niet worden gebruikt; joblijsten bevatten geen opgeslagen importpayload.
- Dezelfde bestaande sessie verliest writes onmiddellijk na rolwijziging naar viewer en verliest toegang tot A na verwijdering. Een nog geldige eigen organisatie B blijft bereikbaar. Auditregels gebruiken de geauthenticeerde gebruikers-ID's.
- De laatste eigenaar kan zichzelf niet verwijderen/degraderen. Een gedegradeerde tweede eigenaar behoudt geen beheerrechten via een oude sessie; diens ongebruikte uitnodigingen verliezen geldigheid. Een uitnodiging is eenmalig en een bodyveld `role: owner` verhoogt de toegekende viewerrol niet.
- Wachtwoordwijziging trekt alle bestaande sessiecookies van die gebruiker in. Logout trekt de huidige cookie in; hergebruik ontsluit geen state, exports of jobs. Een publieke sessierespons daarna bevat geen gebruiker of organisaties.
- Sessie-expiratie, afwijkende Host/origin, cross-site Fetch-metadata en dubbele sessiecookies worden geweigerd. Voor de Host-test is de native HTTP-client gebruikt omdat Node fetch de aangeleverde Host normaliseert.
- Herstart behoudt de organisatiegegevens maar accepteert oude cookies niet. Een tweede app kan het vergrendelde gegevenspad niet tegelijk openen. De accountfile bevat het testwachtwoord en de sessietoken niet als plaintext.
- Mislukte legacy-migratie blijft vóór en na herstart aan de eerste organisatie gebonden; toegang tot de nog niet herstelde state en stats is geblokkeerd.

De organisatie-suite heeft daarnaast 19 tests voor geheugen-/bestandsisolatie, identieke retained job-/request-ID's, concurrent openen, twee echte processen, crashlocks, graceful close, corruptie, gekoppelde paden, credentialuitsluiting en schrijfproblemen in beide migratiefasen.

Uitgevoerd commando:

```text
node --test tests/account-review.test.mjs tests/organizations.test.mjs
```

Werkelijke terminaluitkomst:

```text
tests 27
suites 0
pass 27
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 8395.5556
```

Een eerdere reviewrun had 7/8 successen: de Host-test gebruikte Node fetch, dat de testheader normaliseerde. De test is naar de native HTTP-client aangepast; dit was een onjuist testtransport, geen genegeerde applicatiefout. De finale run hierboven bevat geen skips of mislukkingen.

## Grenzen en vervolgcontrole door de integrator

De onafhankelijke review draaide geen browser. Verbergen van vorige clubgegevens in de DOM, late asyncresponses na clubwissel en de volledige logoutinterface blijven de browsercontrole van de integrator/Worker C. De integrator draait ook de volledige gecombineerde Node-suite en publiceert alleen de werkelijk gemaakte commit-/PR-identifiers.

Het systeem blijft één lokaal gegevenspad per serverproces. Na een ongecontroleerde crash blijft de proceslock bewust staan totdat het bijbehorende proces gecontroleerd is; herstel staat in `docs/ORGANIZATION_STORAGE.md`. Er is geen hosting, disk-encryptie, tamper-proof audit, onafhankelijk geverifieerde bronrechtentoets of retentie-/back-upsysteem toegevoegd. De testgegevens bewijzen geen scoutingkwaliteit of volledige werelddekking.
