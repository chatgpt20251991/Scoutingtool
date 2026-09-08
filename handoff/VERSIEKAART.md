# Versiekaart — geen van beide implementaties weggooien

| Locatie | Rol | Inhoud |
|---|---|---|
| Projecthoofdmap | Huidig hoofdproject | Laatst geleverde Node.js-app, 12 fictieve spelers, 8 fictieve competities, frontend, lokale API, store, tests en alleen-lezen edge-demo. |
| `reference/python-prototype/` | Eerdere referentie-implementatie | Eerder geleverde Python/SQLite-app, 400 fictieve spelersrecords, 11 fictieve competitievermeldingen, lokale import/queue en eigen tests. Geen afhankelijkheid van de Node-app. |
| `handoff/original-packages/` | Ongewijzigde originelen | Beide ZIPs byte-voor-byte bewaard. |
| `handoff/conversation-files/` | Oorspronkelijke losse bijlagen | Bouwbrief v1/v2, demo's, testverslag en screenshots. |
| `handoff/checks/` | Nieuwe hertests | `npm run verify` en Python unittest daadwerkelijk opnieuw uitgevoerd bij deze overdracht. |
| `reports/` en referentie-`evidence/` | Oude bewijsbestanden | Behouden oorspronkelijke logs en schermafbeeldingen, inclusief hun testbeperkingen. |

De twee projecten zijn nog NIET samengevoegd. De Node-hoofdapp erft de importmogelijkheden van de referentie-app niet door het naast elkaar plaatsen van bestanden. Dit samenvoegen is een expliciet werkpakket voor Codex.

Bij tegenstrijdige historische overdrachtsstatussen geldt `START_HERE_CODEX.md` plus `handoff/TRANSFER_STATUS.json` als nieuwste administratieve status. Productambitie: `docs/BUILD_BRIEF.md` (v2). Eerdere bestanden blijven ongewijzigd zodat context en beperkingen behouden blijven.

Alle demospelers zijn synthetisch. De grotere Python-demo is geen extra echte werelddekking. Geen live provider, betaling of productiehosting is verricht voor dit pakket.
