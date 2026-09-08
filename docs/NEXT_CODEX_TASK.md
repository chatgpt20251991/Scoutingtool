# Eerstvolgende ontwikkelstap na de lokale import

De eerste importuitbreiding uit `START_HERE_CODEX.md` is uitgevoerd. Node blijft hoofdproject; de Python-app is referentie. Uitgevoerde tests en beperkingen staan in `reports/current/` en `IMPLEMENTATION_STATUS.md`.

1. Herstel via de eigenaar de bestaande GitHub-integratietoegang voor `chatgpt20251991/Scoutingtool`. Publiceer daarna de bestaande lokale geschiedenis zonder force-push. Omdat de repository bij start leeg was, kan de oorspronkelijke importcommit als `main` dienen en de uitbreiding op `codex/omniscout-handoff` als PR worden aangeboden. Controleer eerst opnieuw de remote op inmiddels toegevoegd werk.
2. Bouw productieauthenticatie en organisatiescheiding als apart gecontroleerd pakket met negatieve tests voor API, jobs, exports, logs, caches en opslag. Een lokaal sessietoken is daarvoor onvoldoende.
3. Werk bewaarbeleid, bronrechtenlevenscyclus en identiteitshandeling uit. Het huidige maximum bewaart historie en weigert extra invoer; het voert geen juridisch verwijderproces uit.
4. Sluit pas daarna een concreet toegestane, begrensde provider aan via de adaptergrens. Geen live request zonder de benodigde autorisatie, gebruiksrechten, limieten en configuratie. Houd demo en import gescheiden.
5. Beoordeel de scoutingwaarde prospectief en onafhankelijk. Voeg geen universele talentscore of verzonnen wereldwijde dekking toe.

Geen publieke hosting, periodieke inzameling, betaalde provider of LLM is in deze levering gestart. Dit vervolgdocument start op zichzelf geen nieuwe taak.
