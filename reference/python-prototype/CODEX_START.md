# Startopdracht voor Codex — scoutingtool

Bouw voort op de aanwezige Omni-Scout alpha, niet op een nieuwe lege mock-up.

1. Lees AGENTS.md, README.md, docs/PRODUCT_BRIEF.md en docs/ACCEPTANCE_STATUS.md. Inspecteer bestaande bestanden en git-status vóór wijzigingen.
2. Maak een afzonderlijke branch voor de volgende ontwikkelstap. Draai de bestaande tests werkelijk; bewaar de resultaten.
3. Integreer als eerste een productiegeschikte authenticatie- en organisatielaag met tenant-scoping voor dossiers, imports, taken, beslissingen, logboeken en exports. De huidige toepassing is lokaal voor één club; verwijder de localhost-beperking niet zonder deze beveiliging.
4. Verdeel pas daarna de werkzaamheden: identiteit/bronnencontract; gelicentieerde provideradapter; radar en bewijsworkflow; mobiele/desktop-UX; onafhankelijke integratietests. Eén verantwoordelijke integreert alles.
5. Bewaar het wereldwijde ontdekdoel inclusief lagere divisies. Maak dekking per gegevenstype zichtbaar. Verkenningsrecords mogen niet verdwijnen door onbekende waarden.
6. Nieuwe echte providers pas na bronrechten, credentials en kostenbevestiging. Geen scraping van afgesloten databases, geen verzonnen voetbaldata, geen stiekeme API-uitgaven.
7. Bewijs de complete keten met een legitieme kleine dataset: import → identiteit → radar → bron/tegenbewijs → opdracht → beoordeling → export. Geef afzonderlijk aan wat met synthetische fixtures is getest.
8. Publiceer een controleerbare PR met gewijzigde bestanden, testlogs, screenshots en open punten. Deploy niet publiek zolang authenticatie, tenant-isolatie en gegevensbeleid ontbreken.

Rapporteer uitsluitend wat daadwerkelijk is uitgevoerd. Geen automatisch gestarte taken of toegezegde blijvende workers veronderstellen. Vraag alleen om werkelijk ontbrekende bronrechten, credentials of deploymentbeslissingen; doe alle overige implementatie en tests zelfstandig binnen de beschikbare omgeving.
