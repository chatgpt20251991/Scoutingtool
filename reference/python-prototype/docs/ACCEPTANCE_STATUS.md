# Eerlijke acceptatiestatus — 0.1.0-alpha

De volledige v2-bouwbrief blijft de productambitie. Deze levering is een lokale eerste verticale slice, geen volledige uitvoering van alle werkpakketten.

| Onderdeel | Status |
|---|---|
| Wereldradar, land/continent/niveau/rol/minuten/leeftijd | Werkend op beschikbare lokale records |
| Lagere divisies als ontdekdoel | In filters en dekkingsregister; democompetities zijn fictief |
| Bron, meetdefinitie, bewijs en onzekerheden | Werkend; bronclaims zijn niet onafhankelijk geverifieerd |
| Verkenning naast gedocumenteerde records | Werkend met expliciete heuristieken |
| Per-90 en vergelijkbare cohortpercentielen | Werkend; geen talent-/competitieovergangsmodel |
| Clubvraag | Opslaan en rolfilter; geen AI-interpretatie of tactische match |
| Onderzoeksopdracht en beslissing | Werkend, lokaal, niet extern verstuurd |
| Budgetafwijzing gescheiden van kwaliteit | Werkend en getest |
| Demo / eigen import scheiding | Werkend en getest |
| JSON-bronadapter en importworker | Werkend, één lokale job per uitvoering |
| Licentiestatus, exportrecht, ingangsdata | Softwarecontrole op verklaring; geen juridische audit |
| Identiteit | Stabiele providersleutel, geen naamfusie; cross-provider handmatige afhandeling nog open |
| Revisies / audit | Bewaard; geen complete peildatumreconstructie of verwijderbeleid |
| Tenant-authenticatie / rollen / clubisolatie | NIET GEBOUWD; geen multi-club gebruik toegestaan |
| Productiehosting, TLS, monitoring, echte cloudworkers | NIET GEDEPLOYD |
| Sportmonks, Wyscout of andere live provider | NIET AANGESLOTEN |
| OpenAI API / taalmodel / modelcredentials | NIET GEBRUIKT OF AANGEMAAKT |
| Getraind talent-/potentiemodel | NIET GEBOUWD, niet gevalideerd |
| Wereldwijde echte dataset | NIET AANWEZIG |
| GitHub commit / PR | NIET UITGEVOERD; repository niet zichtbaar via huidige koppeling |
| Codex-taak gestart | NEE; geen taak-ID of taaksessie beschikbaar |
| Onafhankelijke scoutingpilot / meerwaarde | NIET UITGEVOERD |

## V2 acceptatievoorwaarden

De bestaande tests toetsen onder andere onbekende waarden, geen naamfusie, broninhoud als tekst, revisiebewaring, rechtenverval, tegenbewijs, afwijsredenen, retry-idempotentie, beschikbaarheidsdatums, ouderdom en exportrechten.

Niet volledig afgedekt: tenant-lekken (tenantlaag ontbreekt), productie-rollenbeleid, claim-publicatiegoedkeuring, medische privacy en rechtencontrole door een mens, observeren van een verdedigingslinie uit video, volledige historische revisiereconstructie, quota over externe diensten en juridische compliance. Een positieve test van een kleiner deel is geen afvinken van de gehele oorspronkelijke acceptatievoorwaarde.
