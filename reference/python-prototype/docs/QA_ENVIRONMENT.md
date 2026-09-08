# QA-omgeving en beperkingen

Uitvoering in deze sessie: Python 3.13.5, Node 22.16.0, systeem-Chromium met Playwright. Python 3.11/3.12 zijn opgenomen als toekomstige CI-matrix maar hier niet uitgevoerd.

De initiële Playwright browserbundel was niet geïnstalleerd. Downloaden mislukte door netwerk/DNS-beperking. Het reeds aanwezige systeem-Chromium werkte wel, maar blokkeerde navigatie naar `http://127.0.0.1` en `file://` door omgevingsbeleid. Daarom gebruiken de uitgevoerde browserchecks een in-memory DOM en een expliciete fetch-brug naar de echte lokaal gestarte HTTP-server. Geen externe URL's of providers zijn via die brug bereikbaar.

Een eerste visuele controle vond op 390 px een horizontale paginaverschuiving van 4 px door een navigatiemarge. Dit is gecorrigeerd. Browserchecks op 390 en 360 px verifiëren nu dat de pagina niet breder is dan de viewport. Scrollbare tabs en navigatie blijven binnen hun eigen containers.

De screenshots tonen de echte interface op synthetische fixtures. De browserintegratietest heeft onder meer een lokale JSON-import verwerkt en een budgetbeslissing en onderzoeksvraag in SQLite opgeslagen. Er is geen native browser-network E2E, clouddeployment, loadtest of professionele pentest uitgevoerd.

De testlog bracht ook SQLite-resourcewaarschuwingen aan het licht. Contextverbindingen sluiten nu expliciet na commit/rollback; twee extra regressietests bewaken sluiten en terugrollen. De finale testlog bevat geen resourcewaarschuwingen.
