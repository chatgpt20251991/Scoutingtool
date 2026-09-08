# Uitgevoerde eindverificatie — 8 september 2026

Node 24.15.0, Python 3.12.10 en Microsoft Edge 152.0.4191.66, lokaal op Windows. Appvereiste blijft Node 22+. De browser gebruikte de reeds gebundelde Playwright-installatie, zonder runtime-afhankelijkheid voor de applicatie toe te voegen.

| Controle | Werkelijk resultaat | Ruw bestand |
|---|---|---|
| Onaangetast handoffpakket | 101/101 manifestbestanden gelijk | bundle-integrity.txt |
| Baseline Node | 55 tests geslaagd | baseline-node.txt |
| Baseline Python | 62 tests geslaagd | baseline-python.txt |
| npm ci --ignore-scripts | Exit 0; lockbestand bruikbaar | npm-ci.txt |
| npm run verify | 101 tests geslaagd, 0 fouten; syntax en preview/dist-build geslaagd | verify-final.txt |
| Python-referentie opnieuw | 62 tests geslaagd, 0 fouten | python-final.txt |
| npm run test:browser | 10 fasen geslaagd, geen page errors; native loopback-backend | browser-e2e-final.txt, browser-e2e.json |
| node tools/offline-smoke.mjs | 10 controles geslaagd; standalone en lokaal nagebootste edge-assets | offline-final.txt, offline-smoke.json |
| Onafhankelijke review | 9 regressiecontroles, onderdeel van de 101 Node-tests | worker-d-review.md |

Browseromgeving voor reproduceerbaarheid: `OMNISCOUT_PLAYWRIGHT_PATH` wees naar de gebundelde `playwright`-pakketmap; `BROWSER_CHANNEL=msedge`. Bij een reguliere ontwikkelinstallatie kan Playwright via normale moduleresolutie beschikbaar zijn. Geen browserbeleid gewijzigd en geen fetch bridge/content-only vervanging gebruikt voor de backendroute.

De backendroute omvat echte bestandsselectie, preview, fouten, bevestiging, jobstatus, dossier, scriptachtige broninhoud als tekst, shortlist, vergelijking, onderzoeksuitkomst, browserdownload, herladen, gescheiden datasets, geen importinhoud in localStorage, dubbel importeren, mobiel, serverherstart en rollback met bewaarde historie. Node-tests vullen dit aan met rechtenverval, historische export, seizoenen, identiteitsconflicten, null/0-minuten, queue-retries, foutieve opslag en herstel.

Eerdere mislukte browserpogingen zijn behouden in `browser-e2e-first/second/third.txt`: het nieuwe testharnas had eerst een verkeerde expect-import en selecteerde daarna verkeerde of verborgen fixtureknoppen. Het uiteindelijke testharnas en de volledige route slagen; deze oudere bestanden worden niet als geslaagde tests geteld. `post-change-manifest.txt` laat verwachte verschillen na codewijzigingen zien. Het oorspronkelijke manifest is bedoeld voor het ongewijzigde invoerpakket, niet als vaste eis voor doorontwikkelde code.

De Python-app en beide originele ZIPs zijn onafhankelijk op bytebehoud gecontroleerd. Een gerichte credentialpatroonscan gaf geen treffers; dit is geen alomvattende securityaudit. Alleen synthetische fixtures en technische testuitvoer zijn opgenomen.

GitHub-publicatie: een Git-push faalde wegens ontbrekende HTTPS-aanmelding. Een echte `github_create_blob`-aanroep voor `chatgpt20251991/Scoutingtool` gaf HTTP 403 `Resource not accessible by integration`. Repo-metadata toont openbaar; metadatarechten bewijzen geen werkende integratieschrijfrechten. Geen accountmachtigingen aangepast, geen force-push en geen remote commit/PR/CI geclaimd.

Er is geen productiehosting of live provider gestart. De edge-rooktest voert de handler via een lokale HTTP/ASSETS-adapter uit en bewijst geen Wrangler/workerd- of Cloudflare-runtimewerking. Softwaretests bewijzen evenmin scoutingkwaliteit, onafhankelijk gecontroleerde rechten of historische providerbeschikbaarheid.

De eerste diff-check (diff-check.txt) meldde CRLF-regeleinden na een tijdelijke lokale Git-instelling. Na herstel van de bestaande regeleindeninstelling slaagt git diff --check met exit 0 (diff-check-final.txt); er zijn alleen Git-regeleindenmeldingen. De eindcontrole git ls-remote origin slaagde met nul refs: de remote is nog leeg.
