"""Generate synthetic, explicitly labelled fixtures. No real player claims or network calls."""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
asof = '2026-09-08T02:00:00.000Z'
base = dict(eventAt='2026-09-05T18:00:00.000Z', publishedAt='2026-09-06T10:00:00.000Z', retrievedAt='2026-09-07T08:00:00.000Z', availableAt='2026-09-07T08:00:00.000Z')
configs = [
 ('nl3','Nederland','Europa',3,52.1,5.3,'mixed'),('be3','België','Europa',3,50.8,4.4,'deep'),
 ('ma3','Marokko','Afrika',3,33,-7,'partial'),('sn3','Senegal','Afrika',3,14.6,-17.3,'partial'),
 ('br4','Brazilië','Zuid-Amerika',4,-14,-48,'deep'),('jp3','Japan','Azië',3,36,138,'deep'),
 ('us3','Verenigde Staten','Noord-Amerika',3,38,-98,'mixed'),('au2','Australië','Oceanië',2,-25,134,'none')]
comps=[]
for i,(id,country,region,tier,lat,lon,depth) in enumerate(configs):
    cov = dict(results='available',lineups='available',minutes='available',playerStats='available',events='partial',tracking='unavailable',video='not_in_license')
    if depth=='partial': cov.update(minutes='partial',playerStats='partial',events='unavailable',video='unknown')
    if depth=='none': cov={x:'not_connected' for x in cov}
    if depth=='deep': cov.update(events='available',video='partial')
    comps.append(dict(id=id,name=f'Testdivisie {id.upper()}',country=country,region=region,tier=tier,season='2026 • synthetisch',lat=lat,lon=lon,coverage=cov,lastReceivedAt=None if depth=='none' else base['retrievedAt'],synthetic=True,expectedMatches=None,observedMatches=0,observedPlayers=0,sourceId='fixture-v1'))
records=[
 ('p01','Noah Vermeer','Havenstad Demo FC','nl3','CB','2005-03-18',810,9,{'interceptions':22,'progressivePasses':44,'passesCompleted':370,'passesAttempted':430,'duelsWon':54,'duelsTotal':82},True),
 ('p02','Sami Azzouri','Atlas Demo Club','ma3','CM','2006-07-12',540,6,{'progressivePasses':41,'passesCompleted':266,'passesAttempted':318},True),
 ('p03','Idrissa Ndao','Baobab Demo FC','sn3','W','2005-11-25',None,4,{'chancesCreated':None},False),
 ('p04','Luca Ferreira','Aurora Demo EC','br4','FB','2004-02-09',990,11,{'progressiveCarries':46,'interceptions':16,'duelsWon':62,'duelsTotal':101},True),
 ('p05','Ren Takamori','Minato Demo Club','jp3','CM','2003-09-13',1170,13,{'progressivePasses':72,'passesCompleted':622,'passesAttempted':704},True),
 ('p06','Elias De Winter','Noord Demo United','be3','GK','2004-04-20',900,10,{'saves':43,'shotsOnTarget':56},False),
 ('p07','Mateo Rivas','Union Demo Athletic','us3','ST','2003-01-28',720,8,{'nonPenaltyGoals':5,'chancesCreated':8},True),
 ('p08','Amine Safri','Rif Demo Sport','ma3','FB','2006-01-07',180,3,{'progressiveCarries':10},True),
 ('p09','Jules Van Dalen','Rivier Demo FC','nl3','CM','2004-06-14',1080,12,{'progressivePasses':68,'passesCompleted':508,'passesAttempted':601},False),
 ('p10','Malik Sarré','Dakar Demo Athletic','sn3','CB','2005-05-19',None,5,{'interceptions':None},False),
 ('p11','Davi Monteiro','Costa Demo EC','br4','W','2005-08-11',630,7,{'chancesCreated':17,'progressiveCarries':25},True),
 ('p12','Theo Marchal','Vallei Demo Club','be3','ST','2004-10-03',84,2,{'nonPenaltyGoals':2},False)]
players=[]
for idx,(id,name,club,cid,role,dob,minutes,matches,metrics,growth) in enumerate(records):
    stamp={**base, 'availableAt': f'2026-09-0{7-(idx%3)}T12:00:00.000Z', 'retrievedAt': f'2026-09-0{7-(idx%3)}T12:00:00.000Z', 'publishedAt': f'2026-09-0{7-(idx%3)}T10:00:00.000Z', 'eventAt':'2026-09-04T18:00:00.000Z'}
    s=dict(minutes=minutes,matches=matches,**{m:None for m in ['progressivePasses','interceptions','progressiveCarries','chancesCreated','nonPenaltyGoals','saves','shotsOnTarget','passesCompleted','passesAttempted','duelsWon','duelsTotal']},**stamp,definition='fixture-role-counts-v1',coverageVersion='v1')
    s.update(metrics)
    evidence=[dict(id=f'{id}-e1',sourceId='fixture-v1',kind='positive',title={'GK':'Positieve observatie van meevoetballen','CB':'Opvallende observatie in defensieve organisatie','FB':'Interessante observatie bij doorschuiven','CM':'Voorwaartse passing verdient vervolgonderzoek','W':'Interessante observatie van loopacties','ST':'Vrijlopen verdient vervolgonderzoek'}[role],text='Volledig fictieve scoutobservatie voor het testen van de workflow. Geen echte wedstrijd, speler of video.',locator=f'fixture:{id}/observatie-1',**stamp),dict(id=f'{id}-e2',sourceId='fixture-v1',kind='counter',title='Tegenbewijs: beoordeling is nog onvolledig',text='Dezelfde kwaliteit is in de fictieve observatie niet onder alle omstandigheden zichtbaar. Geschiktheid voor een hoger niveau is niet vastgesteld.',locator=f'fixture:{id}/observatie-2',**stamp)]
    recent=dict(matches=5,minutes=390 if growth else 320,definition='fixture-minutes-v1',coverageVersion='v1',**stamp)
    previous=dict(matches=5,minutes=210 if growth else 300,definition='fixture-minutes-v1',coverageVersion='v1',eventAt='2026-08-01T12:00:00.000Z',publishedAt='2026-08-02T12:00:00.000Z',retrievedAt='2026-08-03T12:00:00.000Z',availableAt='2026-08-03T12:00:00.000Z')
    if id=='p08': recent['coverageVersion']='v2'
    if id in ['p03','p10']: recent['minutes']=None;previous['minutes']=None
    players.append(dict(id=id,provider='synthetic-v1',providerId=id,sourceId='fixture-v1',name=name,club=club,competitionId=cid,role=role,dob=dob,preferredFoot=['Rechts','Links','Onbekend'][idx%3],synthetic=True,identityStatus='synthetic_fixture',stats=s,recent=recent,previous=previous,evidence=evidence,**stamp))
for c in comps:
    c['observedPlayers']=sum(p['competitionId']==c['id'] for p in players)
    c['observedMatches']=None if not c['observedPlayers'] else 12
catalog=dict(schemaVersion=1,asOf=asof,mode='synthetic_demo',datasetNotice='Alle spelers, clubs, competities, statistieken en observaties zijn fictieve softwaretestgegevens. Geen live scoutingdekking.',sources=[dict(id='fixture-v1',name='Omni-Scout synthetische testset v1',status='synthetic',allowedUses=['analysis','display','export'],validFrom='2026-01-01T00:00:00.000Z',expiresAt=None,rightsNote='Zelfgemaakte fictieve fixtures; geen externe voetbaldata.')],competitions=comps,players=players)
(root/'src'/'fixtures.mjs').write_text('/* SYNTHETIC SOFTWARE TEST DATA. NOT REAL SCOUTING EVIDENCE. */\nexport const CATALOG = '+json.dumps(catalog,ensure_ascii=False,indent=2)+';\n')
