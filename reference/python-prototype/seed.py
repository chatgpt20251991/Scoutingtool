"""Reproducible fictional fixture generator. Every entity is a simulation."""
from datetime import datetime, timedelta, timezone
import random
from scout import DIMENSIONS, METRICS


def make_demo(now=None):
    t=datetime.fromisoformat(now.replace('Z','+00:00')) if now else datetime.now(timezone.utc)
    stamp=(t-timedelta(days=2)).isoformat(timespec='seconds')
    rng=random.Random(71026)
    source={'id':'demo-fixtures','name':'Omni-Scout synthetische fixtures','is_demo':True,
            'rights_attested':True,'license_description':'Zelfgegenereerde fictieve softwaretestdata. Geen echte spelers, competities, metingen of rechten op derdenmateriaal.',
            'permissions':{p:True for p in ('ingest','store','display','analyze','export')},
            'license_expires_at':(t+timedelta(days=3650)).isoformat(timespec='seconds')}
    places=[('Nederland','Europa',3),('Portugal','Europa',4),('Marokko','Afrika',3),('Ghana','Afrika',2),
            ('Brazilië','Zuid-Amerika',4),('Colombia','Zuid-Amerika',3),('Japan','Azië',3),
            ('Indonesië','Azië',4),('Verenigde Staten','Noord-Amerika',3),('Nieuw-Zeeland','Oceanië',2)]
    comps=[];players=[]
    first=['Amin','Luca','Samuel','Rayan','Noah','Ilias','Kenji','João','Adam','Omar','Yuri','Daniel']
    last=['Vermeer','Costa','Mensah','Idrissi','Silva','Tanaka','Bakker','Diallo','Moreno','Santos','Park','Navarro']
    for i,(country,continent,level) in enumerate(places):
        cid=f'competition-{i+1}'
        coverage={k:'unavailable' for k in DIMENSIONS}
        coverage.update(fixtures='available',lineups='available',minutes='available',player_stats='partial',events='partial',full_video='unavailable')
        comps.append({'id':cid,'name':f'DEMO {country} • niveau {level}','country':country,'continent':continent,'level':level,'season':'2026-demo','checked_at':stamp,'coverage':coverage})
        for j in range(40):
            role=list(METRICS)[j//8];metric=METRICS[role][0]
            k=j%8;minutes=None if k==7 else (95 if k==6 else rng.randrange(550,1450))
            apps=None if minutes is None else max(1,int(minutes/70)+1)
            value=None if k==7 else {'GK':rng.randrange(30,70),'CB':rng.randrange(15,40),'CM':rng.randrange(40,130),'WG':rng.randrange(10,40),'ST':rng.randrange(2,13)}[role]
            n=i*40+j+1
            age=18+(j+i)%7
            players.append({'id':f'player-{n:04d}','name':f'{first[(i+j)%len(first)]} {last[(i*3+j)%len(last)]} {n:03d}',
                'club':f'DEMO Club {i+1}.{j%4+1}','competition_id':cid,'birth_date':f'{t.year-age-1}-10-12',
                'role':role,'identity_status':'provider_id','minutes':minutes,'appearances':apps,'metrics':{metric:value},
                'metric_definition':'demo-v1: kunstmatige aantallen voor softwaretesten; geen echte voetbalmeting',
                'evidence_locator':f'fixture://competition-{i+1}/player-{n:04d}',
                'event_at':stamp,'published_at':stamp,'retrieved_at':stamp,'available_at':stamp,
                'counterevidence':'Synthetisch scenario: slechts beperkt beeldmateriaal; geen voorspelling van sportieve kwaliteit.',
                'previous_window':{'minutes':160,'matches':4,'revision':'demo-r1','coverage':'available'},
                'recent_window':{'minutes':300 if k%2==0 else 175,'matches':4,'revision':'demo-r1','coverage':'available'}})
    # Explicit blind spot: result-only simulated league, no fictitious player coverage.
    comps.append({'id':'result-only','name':'DEMO resultaat-only competitie','country':'Nederland','continent':'Europa','level':6,'season':'2026-demo','checked_at':stamp,
                  'coverage':{k:('available' if k=='fixtures' else 'unknown') for k in DIMENSIONS}})
    return {'source':source,'competitions':comps,'players':players}
