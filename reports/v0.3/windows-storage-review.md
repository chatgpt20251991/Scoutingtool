# Windows-opslagcontrole

8 september 2026. De eerste volledige verificatie eindigde op 151/152 geslaagde tests. De organisatieherstarttest kreeg `EPERM` bij het atomisch vervangen van `state.json`. Het oorspronkelijke bewijs staat in `node-verify-initial-failure.txt`.

Er is geen achtergebleven eigen readhandle of dubbele store aangetoond: de gebruikte `readFile`-/`writeFile`-aanroepen worden afgewacht, storemutaties zijn geserialiseerd en de manager wacht queues af bij sluiten. De oorspronkelijke externe vergrendelaar kon niet uit de foutmelding worden vastgesteld. Een antivirusscanner is een mogelijke verklaring, geen bewezen oorzaak.

## Uitgevoerde wijziging

`src/store.mjs` gebruikt nu `replaceFileAtomically()`: alleen op Windows worden `EPERM`, `EACCES` en `EBUSY` maximaal zesmaal geprobeerd, met 20/40/80/160/320 ms backoff, samen maximaal 620 ms extra wachttijd. Iedere poging gebruikt hetzelfde tijdelijke bestand en dezelfde bestemming. De bestemming wordt nooit verwijderd; de mutatiecallback draait eenmaal en in-memory state verandert uitsluitend na geslaagde rename. Andere fouten blijven direct zichtbaar. Tijdelijke bestanden worden exclusief met `wx` aangemaakt.

`tests/store.test.mjs` bevat zes regressies. Naast deterministische retry-/fouttests gebruiken twee tests een echt Windows-bestandshandle via .NET `FileShare.ReadWrite`, waarbij delete-sharing bewust ontbreekt. Een kortdurende lock leidt tot één succesvolle commit. Een blijvende lock levert een begrensde fout, behoudt oude disk- en geheugenstate en laat na vrijgeven een nieuwe write toe.

## Werkelijke belastingstests

Een eerste run met de nieuwe tests eindigde op 41/42: een onafgebroken externe leeslus hield de rename langer geblokkeerd dan het retrybudget. Een volgende run met periodieke inspectie slaagde op 42/42. Drie extra gelijktijdige runs raakten onder hoge belasting opnieuw het begrensde foutpad. De stressregressie is daarna aangescherpt op het bedoelde contract: wacht alle writes af, houd iedere geslaagde/geweigerde write afzonderlijk bij, controleer dat disk en geheugen exact de geslaagde commits bevatten, en controleer herstel nadat externe lezers stoppen. Een langdurige externe lock mag een zichtbare fout blijven geven; die fout wordt niet als een opgeslagen wijziging voorgesteld.

Vervolgens zijn drie onafhankelijke Node-processen gelijktijdig werkelijk uitgevoerd met:

```text
node --test tests/store.test.mjs tests/organizations.test.mjs
```

| Run | Tests | Geslaagde stresswrites | Zichtbare begrensde sharingfouten | Herstel | Testduur |
|---|---:|---:|---:|---|---:|
| 1 | 25/25, 0 skips | 160/160 | 0 | geslaagd | 4836.1077 ms |
| 2 | 25/25, 0 skips | 159/160 | 1 | geslaagd | 4523.1296 ms |
| 3 | 25/25, 0 skips | 160/160 | 0 | geslaagd | 5247.979 ms |

Alle drie processen eindigden met exitcode 0. De oorspronkelijke volledige stdout van deze drie processen is niet afzonderlijk opgeslagen; de orchestratietool gaf de exacte laatste 1250 tekens per proces door. Daarom zijn er geen achteraf gereconstrueerde bestanden die zich voordoen als volledige ruwe stresslogs. Bovenstaande aantallen, diagnostics en tijden komen uit die daadwerkelijk ontvangen tooluitvoer.

De daaropvolgende volledige `npm run verify` van de integrator is gecontroleerd in het bewaarde `node-verify.txt`: **158/158 tests geslaagd, 0 mislukkingen, 0 skips**, testduur 77491.3592 ms; de previewbuild slaagde eveneens. In die run meldde de stresscase 158/160 gecommitte writes en twee zichtbare begrensde sharingfouten, met exacte overeenkomst tussen disk en geheugen en geslaagd herstel. Het volledige ruwe bewijs voor deze eindrun is wel aanwezig.

Deze wijziging verkleint de invloed van kortdurende Windows-bestandslocks. Ze claimt niet dat permanente bestandslocks, ontbrekende OS-rechten of defecte opslag automatisch worden opgelost. Geen verdere codewijziging of nieuwe testrun is uitgevoerd bij het vastleggen van dit rapport.
