"""Omni-Scout local alpha. No external network or language-model calls.

Deliberately single-club, loopback-only. Never deploy as a multi-tenant service.
All calculations are transparent heuristics, NOT a validated talent model.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import re
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

VERSION = '0.1.0-alpha'
METRICS = {
    'GK': ('saves', 'Reddingen', 'Doelman'),
    'CB': ('interceptions', 'Intercepties', 'Centrale verdediger'),
    'CM': ('progressive_passes', 'Progressieve passes', 'Middenvelder'),
    'WG': ('chances_created', 'Gecreëerde kansen', 'Vleugelspeler'),
    'ST': ('non_penalty_goals', 'Goals zonder penalty', 'Spits'),
}
DIMENSIONS = ('fixtures', 'lineups', 'minutes', 'player_stats', 'events', 'tracking', 'full_video')
COVERAGE_STATES = {'available', 'partial', 'unknown', 'not_connected', 'not_licensed', 'unavailable', 'delayed'}
DECISIONS = {'follow', 'review_video', 'observe_live', 'verify', 'not_prioritized'}
REASONS = {'role', 'budget', 'registration', 'insufficient_evidence', 'sporting', 'other'}
ID_RE = re.compile(r'^[a-zA-Z0-9_.-]{1,80}$')

class ValidationError(ValueError):
    pass


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def parse_time(value: Any, field: str = 'timestamp') -> datetime:
    if not isinstance(value, str):
        raise ValidationError(f'{field}: ISO-tijdstempel met tijdzone ontbreekt.')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValidationError(f'{field}: ongeldige tijdstempel.') from exc
    if result.tzinfo is None:
        raise ValidationError(f'{field}: tijdzone is verplicht.')
    return result.astimezone(timezone.utc)


def text(value: Any, field: str, maxlen: int = 200, empty: bool = False) -> str:
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value) > maxlen:
        raise ValidationError(f'{field}: tekst van maximaal {maxlen} tekens vereist.')
    if '\x00' in value:
        raise ValidationError(f'{field}: ongeldig teken.')
    return value.strip()


def identifier(value: Any, field: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ValidationError(f'{field}: gebruik letters, cijfers, punt, _ of - (max. 80).')
    return value


def number(value: Any, field: str, maximum: float = 100000, integer: bool = False) -> float | int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= maximum:
        raise ValidationError(f'{field}: ongeldig niet-negatief getal.')
    if integer and int(value) != value:
        raise ValidationError(f'{field}: geheel getal vereist.')
    return int(value) if integer else value


def age_on(dob: str | None, on: date) -> int | None:
    if dob is None:
        return None
    try:
        birth = date.fromisoformat(dob)
    except (ValueError, TypeError) as exc:
        raise ValidationError('birth_date: gebruik YYYY-MM-DD.') from exc
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


def per90(value: float | None, minutes: float | None) -> float | None:
    if value is None or minutes is None or minutes <= 0:
        return None
    return round(value * 90 / minutes, 2)


def permitted(source: dict, purpose: str, now: str | None = None) -> bool:
    current = parse_time(now or utcnow())
    try:
        return (source.get('rights_attested') is True
                and source.get('permissions', {}).get(purpose) is True
                and parse_time(source['license_expires_at']) > current)
    except (KeyError, ValidationError):
        return False


def validate_bundle(raw: Any, now: str | None = None) -> dict:
    """Fail the complete import before any writes. No name-based identity merge."""
    if not isinstance(raw, dict):
        raise ValidationError('Het importbestand moet een JSON-object zijn.')
    b = copy.deepcopy(raw)
    current = parse_time(now or utcnow())
    source = b.get('source')
    if not isinstance(source, dict):
        raise ValidationError('source ontbreekt.')
    identifier(source.get('id'), 'source.id')
    text(source.get('name'), 'source.name')
    text(source.get('license_description'), 'source.license_description', 1000)
    if not isinstance(source.get('is_demo'), bool):
        raise ValidationError('source.is_demo moet true of false zijn.')
    if source.get('rights_attested') is not True:
        raise ValidationError('Bevestiging van verwerkingsrechten ontbreekt.')
    for purpose in ('ingest', 'store', 'display', 'analyze'):
        if not permitted(source, purpose, current.isoformat()):
            raise ValidationError(f'Bron niet toegestaan of verlopen voor: {purpose}.')
    competitions, players = b.get('competitions'), b.get('players')
    if not isinstance(competitions, list) or not 1 <= len(competitions) <= 100:
        raise ValidationError('Lever 1 tot 100 competities aan.')
    if not isinstance(players, list) or len(players) > 3000:
        raise ValidationError('Maximaal 3.000 spelers per import.')
    comp_map = {}
    for c in competitions:
        if not isinstance(c, dict):
            raise ValidationError('Ongeldige competitie.')
        cid = identifier(c.get('id'), 'competition.id')
        if cid in comp_map:
            raise ValidationError('Dubbele competition.id.')
        for field in ('name', 'country', 'continent', 'season'):
            text(c.get(field), f'competition.{field}')
        level = number(c.get('level'), 'level', maximum=30, integer=True)
        if level == 0:
            raise ValidationError('Niveau 0 is ongeldig; onbekend is null.')
        coverage = c.get('coverage')
        if not isinstance(coverage, dict) or any(coverage.get(k) not in COVERAGE_STATES for k in DIMENSIONS):
            raise ValidationError('Geef voor alle zeven dekkingsdimensies een geldige status.')
        if parse_time(c.get('checked_at'), 'checked_at') > current:
            raise ValidationError('checked_at ligt in de toekomst.')
        comp_map[cid] = c
    seen = set()
    for p in players:
        if not isinstance(p, dict):
            raise ValidationError('Ongeldige speler.')
        pid = identifier(p.get('id'), 'player.id')
        if pid in seen:
            raise ValidationError('Dubbele player.id; corrigeer de identiteit vóór import.')
        seen.add(pid)
        text(p.get('name'), 'player.name')
        text(p.get('club'), 'player.club')
        if p.get('competition_id') not in comp_map:
            raise ValidationError('Onbekende competition_id.')
        if p.get('role') not in METRICS:
            raise ValidationError('Rol moet GK, CB, CM, WG of ST zijn.')
        age = age_on(p.get('birth_date'), current.date())
        if age is None or not 18 <= age <= 60:
            raise ValidationError('Deze alpha importeert uitsluitend bevestigde meerderjarigen (18–60).')
        if p.get('identity_status') not in ('provider_id', 'verified', 'needs_review'):
            raise ValidationError('identity_status ontbreekt of is ongeldig.')
        mins = number(p.get('minutes'), 'minutes', 15000)
        apps = number(p.get('appearances'), 'appearances', 150, True)
        if mins is not None and apps is not None and mins > apps * 130:
            raise ValidationError('Minuten en gespeelde wedstrijden zijn niet consistent.')
        metrics = p.get('metrics')
        if not isinstance(metrics, dict) or any(k not in {m[0] for m in METRICS.values()} for k in metrics):
            raise ValidationError('Onbekende meetdefinitie; gebruik alleen de gedocumenteerde metrics.')
        for key, val in metrics.items():
            number(val, key)
        text(p.get('metric_definition'), 'metric_definition', 1000)
        text(p.get('evidence_locator'), 'evidence_locator', 1000)
        times = {k: parse_time(p.get(k), k) for k in ('event_at', 'retrieved_at', 'available_at')}
        if p.get('published_at') is not None:
            published = parse_time(p['published_at'], 'published_at')
            if published > times['available_at']:
                raise ValidationError('Publicatie is later dan beschikbaarheid.')
        if not times['event_at'] <= times['retrieved_at'] <= times['available_at'] <= current:
            raise ValidationError('Tijdstempels moeten event ≤ retrieved ≤ available ≤ nu volgen.')
        text(p.get('counterevidence', ''), 'counterevidence', 2000, True)
        for window in ('previous_window', 'recent_window'):
            w = p.get(window)
            if w is not None:
                if not isinstance(w, dict):
                    raise ValidationError('Ongeldig trendvenster.')
                number(w.get('minutes'), f'{window}.minutes', 15000)
                number(w.get('matches'), f'{window}.matches', 150, True)
                text(w.get('revision'), f'{window}.revision')
                if w.get('coverage') not in COVERAGE_STATES:
                    raise ValidationError('Dekking van trendvenster ontbreekt.')
    return b


SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS competitions(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), competition_id TEXT NOT NULL REFERENCES competitions(id), payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY, player_id TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY, player_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, player_id TEXT NOT NULL, question TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS task_open_unique ON tasks(player_id,question) WHERE status='open';
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, object_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, digest TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
'''


class ClosingConnection(sqlite3.Connection):
    """Commit/rollback like sqlite3, and release the connection on context exit."""
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect(path: str | Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path), timeout=15, factory=ClosingConnection)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    con.execute('PRAGMA journal_mode=WAL')
    return con


def init_db(path: str | Path) -> None:
    if str(path) != ':memory:':
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as con:
        con.executescript(SCHEMA)


def _audit(con: sqlite3.Connection, kind: str, object_id: str, detail: dict) -> None:
    con.execute('INSERT INTO audit(kind,object_id,detail,created_at) VALUES(?,?,?,?)',
                (kind, object_id, json.dumps(detail, ensure_ascii=False), utcnow()))


def _apply(con: sqlite3.Connection, b: dict) -> dict:
    source = b['source']; sid = source['id']
    existing = con.execute('SELECT payload FROM sources WHERE id=?', (sid,)).fetchone()
    if existing and json.loads(existing['payload'])['is_demo'] != source['is_demo']:
        raise ValidationError('Een bron kan niet van demo naar echt worden omgezet; maak een aparte bron.')
    con.execute('INSERT INTO sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', (sid, json.dumps(source)))
    for c in b['competitions']:
        cid = sid + ':' + c['id']
        # UPDATE/INSERT avoids deleting a referenced parent in SQLite.
        con.execute('INSERT INTO competitions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                    (cid, sid, json.dumps(c)))
    changed = 0
    for p in b['players']:
        pid = sid + ':' + p['id']; cid = sid + ':' + p['competition_id']
        old = con.execute('SELECT payload FROM players WHERE id=?', (pid,)).fetchone()
        payload = json.dumps(p, sort_keys=True, ensure_ascii=False)
        if old and old['payload'] == payload:
            continue
        con.execute('INSERT INTO revisions(player_id,recorded_at,payload) VALUES(?,?,?)', (pid, utcnow(), payload))
        con.execute('INSERT INTO players VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET competition_id=excluded.competition_id,payload=excluded.payload', (pid,sid,cid,payload))
        changed += 1
    _audit(con, 'import', sid, {'changed': changed, 'received': len(b['players']), 'is_demo': source['is_demo']})
    return {'changed': changed, 'received': len(b['players'])}


def import_bundle(path: str | Path, raw: dict, now: str | None = None) -> dict:
    b = validate_bundle(raw, now)
    with connect(path) as con:
        return _apply(con, b)


def enqueue(path: str | Path, raw: dict) -> dict:
    b = validate_bundle(raw)
    encoded = json.dumps(b, sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with connect(path) as con:
        con.execute('INSERT OR IGNORE INTO jobs(digest,payload,created_at) VALUES(?,?,?)', (digest, encoded, utcnow()))
        row = con.execute('SELECT id,status,attempts FROM jobs WHERE digest=?', (digest,)).fetchone()
        return dict(row)


def run_worker_once(path: str | Path) -> dict:
    """Bounded synchronous worker; one transaction, so a crash rolls back claims/writes."""
    con = connect(path)
    try:
        con.execute('BEGIN IMMEDIATE')
        row = con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
        if not row:
            con.commit(); return {'status': 'idle'}
        con.execute("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=?", (row['id'],))
        con.execute('SAVEPOINT apply_import')
        try:
            b = validate_bundle(json.loads(row['payload']))
            result = _apply(con, b)
        except (ValidationError, sqlite3.Error) as exc:
            con.execute('ROLLBACK TO apply_import')
            con.execute('RELEASE apply_import')
            con.execute("UPDATE jobs SET status='failed', error=?,finished_at=? WHERE id=?", (str(exc)[:500],utcnow(),row['id']))
            _audit(con,'job_failed',str(row['id']),{'error':str(exc)[:500]})
            con.commit(); return {'id':row['id'], 'status':'failed', 'error':str(exc)[:500]}
        con.execute('RELEASE apply_import')
        con.execute("UPDATE jobs SET status='completed',error=NULL,finished_at=? WHERE id=?", (utcnow(),row['id']))
        con.commit()
        return {'id': row['id'], 'status':'completed', **result}
    finally:
        con.close()


def retry_job(path: str | Path, job_id: int) -> dict:
    with connect(path) as con:
        result = con.execute("UPDATE jobs SET status='queued',error=NULL WHERE id=? AND status='failed' AND attempts<3", (job_id,))
        if not result.rowcount:
            raise ValidationError('Deze taak kan niet opnieuw worden uitgevoerd (maximaal drie pogingen).')
        _audit(con,'job_retry',str(job_id),{})
    return {'status':'queued'}


def signal_for(p: dict, source: dict, competition: dict, now: str) -> dict:
    metric, label, _ = METRICS[p['role']]
    minutes = p.get('minutes'); value = p['metrics'].get(metric)
    rate = per90(value, minutes)
    age_days = (parse_time(now) - parse_time(p['available_at'])).days
    is_stale = age_days > 30
    measurable = competition['coverage']['minutes'] in ('available','partial') and competition['coverage']['player_stats'] in ('available','partial')
    sufficient = (minutes is not None and minutes >= 450 and p.get('appearances') is not None
                  and p['appearances'] >= 5 and value is not None and measurable and not is_stale
                  and p['identity_status'] != 'needs_review')
    warnings = []
    if minutes is None: warnings.append('Speelminuten onbekend; geen berekening per 90.')
    elif minutes < 450: warnings.append('Kleine steekproef: minder dan 450 minuten.')
    if p.get('appearances') is None: warnings.append('Aantal wedstrijden onbekend.')
    if value is None: warnings.append(f'{label} niet beschikbaar; dit is geen nul.')
    if not measurable: warnings.append('Competitiedekking ondersteunt nog geen voldoende statistische vergelijking.')
    if p['identity_status']=='needs_review': warnings.append('Speleridentiteit vraagt handmatige verificatie.')
    if is_stale: warnings.append(f'Gegevens zijn {age_days} dagen oud; actualiteit controleren.')
    if competition['coverage']['full_video'] != 'available': warnings.append('Volledige wedstrijdbeelden ontbreken of zijn niet compleet.')
    if p.get('counterevidence'): warnings.append(p['counterevidence'])
    signals=[]
    old, new = p.get('previous_window'), p.get('recent_window')
    if old and new:
        comparable = (old['revision']==new['revision'] and old['coverage']==new['coverage']=='available'
                      and old.get('matches') == new.get('matches') and (old.get('matches') or 0) >= 3
                      and old.get('minutes') is not None and new.get('minutes') is not None)
        if comparable:
            delta = round(new['minutes']/new['matches'] - old['minutes']/old['matches'],1)
            if delta >= 15:
                signals.append({'type':'minutes_change','text':f'{delta:g} minuten méér per wedstrijd in twee vergelijkbare vensters. Dit meet speeltijd, niet talentgroei.'})
        else:
            warnings.append('Trendvensters niet vergelijkbaar; geen ontwikkelingsclaim.')
    if not sufficient:
        question = 'Verifieer identiteit, minuten en rolgegevens; verzamel een bruikbare volledige wedstrijd vóór verdere beoordeling.'
    else:
        question = {
            'GK':'Beoordeel volledige wedstrijden: komen de reddingen door kwaliteit of door veel schoten tegen? Controleer positionering en opbouw.',
            'CB':'Beoordeel intercepties in context: startpositie, risico en verdedigen van ruimte. Noteer ook mislukte ingrepen.',
            'CM':'Beoordeel progressieve passing onder druk in volledige wedstrijden, inclusief balverlies en veilige alternatieven.',
            'WG':'Beoordeel gecreëerde kansen in context, inclusief spelhervattingen en mislukte acties.',
            'ST':'Beoordeel afronding en loopacties in volledige wedstrijden; controleer kanskwaliteit en tegenstand.',
        }[p['role']]
    return {'track':'documented' if sufficient else 'explore', 'metric_key':metric,'metric_label':label,
            'per90':rate,'metric_total':value,'warnings':warnings,'signals':signals,'next_question':question,
            'is_stale':is_stale,'data_age_days':age_days,'percentile':None,'cohort_n':0,
            'feasibility':'Niet geverifieerd; controleer beschikbaarheid, budget en registratie.'}


def snapshot(path: str | Path, now: str | None = None, purpose: str = 'display') -> dict:
    now = now or utcnow()
    with connect(path) as con:
        sources = {r['id']:json.loads(r['payload']) for r in con.execute('SELECT * FROM sources')}
        comps = {r['id']:{**json.loads(r['payload']), 'uid':r['id'], 'source_id':r['source_id']} for r in con.execute('SELECT * FROM competitions')}
        decisions = [dict(r) for r in con.execute('SELECT * FROM decisions ORDER BY id DESC')]
        latest={}
        for d in decisions: latest.setdefault(d['player_id'],d)
        all_rows=list(con.execute('SELECT * FROM players ORDER BY id'))
        players=[]
        for row in all_rows:
            s=sources[row['source_id']]
            if not permitted(s,purpose,now) or not permitted(s,'analyze',now): continue
            p=json.loads(row['payload']); c=comps[row['competition_id']]
            if parse_time(p['available_at']) > parse_time(now): continue
            p.update({'uid':row['id'],'source_id':row['source_id'],'source_name':s['name'],'is_demo':s['is_demo'],
                      'country':c['country'],'continent':c['continent'],'competition':c['name'],'level':c['level'],
                      'season':c['season'],'competition_uid':c['uid'],'coverage':c['coverage'],
                      'age':age_on(p['birth_date'],parse_time(now).date()),'decision':latest.get(row['id'])})
            p.update(signal_for(p,s,c,now)); players.append(p)
        # No automatic merging of ambiguous identities, including across providers.
        identities={}
        for p in players: identities.setdefault((p['name'].casefold(),p['birth_date']),[]).append(p)
        for group in identities.values():
            if len(group)>1:
                for p in group:
                    p['identity_status']='needs_review';p['track']='explore'
                    p['warnings'].append('Mogelijke dubbele identiteit; niet automatisch samengevoegd of als unieke ontdekking geteld.')
                    p['next_question']='Verifieer eerst of deze bronrecords bij dezelfde speler horen.'
        cohorts={}
        for p in players:
            if p['track']=='documented' and p['per90'] is not None:
                key=(p['competition_uid'],p['season'],p['role'],p['metric_definition'])
                cohorts.setdefault(key,[]).append(p)
        for group in cohorts.values():
            for p in group:
                p['cohort_n']=len(group)
                if len(group)>=5:
                    below=sum(q['per90']<p['per90'] for q in group)
                    tied=sum(q['per90']==p['per90'] for q in group)
                    p['percentile']=round(100*(below+.5*tied)/len(group))
                    if p['percentile']>=80:
                        p['signals'].append({'type':'within_cohort','text':f"P{p['percentile']} voor {p['metric_label'].lower()} per 90 binnen {len(group)} vergelijkbare bronrecords uit dezelfde competitie en rol. Geen algemene kwaliteitsscore."})
        allowed={p['uid'] for p in players}
        for c in comps.values():
            s=sources[c['source_id']]; c['is_demo']=s['is_demo'];c['source_name']=s['name']
            c['permitted']=permitted(s,purpose,now) and permitted(s,'analyze',now)
            c['record_count']=sum(p['competition_uid']==c['uid'] for p in players)
        tasks=[dict(r) for r in con.execute('SELECT * FROM tasks ORDER BY id DESC') if r['player_id'] in allowed]
        jobs=[dict(r) for r in con.execute('SELECT id,status,attempts,error,created_at,finished_at FROM jobs ORDER BY id DESC LIMIT 100')]
        audit=[dict(r) for r in con.execute('SELECT id,kind,object_id,detail,created_at FROM audit ORDER BY id DESC LIMIT 100')]
        setting=con.execute("SELECT value FROM settings WHERE key='brief'").fetchone()
    return {'version':VERSION,'generated_at':now,'deployment':'local-single-club','players':players,'competitions':list(comps.values()),
            'tasks':tasks,'jobs':jobs,'audit':audit,'decisions':[d for d in decisions if d['player_id'] in allowed],
            'brief':json.loads(setting['value']) if setting else {},
            'sources':[{'id':s['id'],'name':s['name'],'is_demo':s['is_demo'],'license_expires_at':s['license_expires_at'],
                        'rights_attested':s['rights_attested'],'display_permitted':permitted(s,'display',now)} for s in sources.values()],
            'live_provider_count':0,'blocked_records':len(all_rows)-len(players)}


def require_player(path: str | Path, pid: str, purpose: str = 'display') -> dict:
    for p in snapshot(path,purpose=purpose)['players']:
        if p['uid']==pid: return p
    raise ValidationError('Speler niet beschikbaar of verwerkingsrechten ontbreken.')


def add_decision(path: str | Path, payload: dict) -> dict:
    p=require_player(path,payload.get('player_id',''))
    action=payload.get('action'); reason=payload.get('reason') or None
    if action not in DECISIONS: raise ValidationError('Ongeldige onderzoeksbeslissing.')
    if action=='not_prioritized' and reason not in REASONS: raise ValidationError('Leg de afwijsreden afzonderlijk vast.')
    if reason is not None and reason not in REASONS: raise ValidationError('Ongeldige reden.')
    note=text(payload.get('note',''),'note',2000,True)
    with connect(path) as con:
        cur=con.execute('INSERT INTO decisions(player_id,action,reason,note,created_at) VALUES(?,?,?,?,?)',(p['uid'],action,reason,note,utcnow()))
        _audit(con,'decision',p['uid'],{'action':action,'reason':reason})
        return {'id':cur.lastrowid}


def add_task(path: str | Path, payload: dict) -> dict:
    p=require_player(path,payload.get('player_id',''))
    question=text(payload.get('question',p['next_question']),'question',2000)
    with connect(path) as con:
        con.execute('INSERT OR IGNORE INTO tasks(player_id,question,created_at) VALUES(?,?,?)',(p['uid'],question,utcnow()))
        row=con.execute("SELECT id,status FROM tasks WHERE player_id=? AND question=? AND status='open'",(p['uid'],question)).fetchone()
        _audit(con,'task_prepared',p['uid'],{'task_id':row['id'],'sent':False})
        return dict(row)


def finish_task(path: str | Path, tid: int) -> dict:
    with connect(path) as con:
        row=con.execute('SELECT * FROM tasks WHERE id=?',(tid,)).fetchone()
    if not row: raise ValidationError('Opdracht niet gevonden.')
    require_player(path,row['player_id'])
    with connect(path) as con:
        con.execute("UPDATE tasks SET status='done' WHERE id=?",(tid,));_audit(con,'task_done',str(tid),{})
    return {'status':'done'}


def save_brief(path: str | Path, payload: dict) -> dict:
    role=payload.get('role','')
    if role and role not in METRICS: raise ValidationError('Onbekende rol.')
    brief={'role':role,'tasks':text(payload.get('tasks',''),'tasks',2000,True),'club':text(payload.get('club','Mijn club'),'club')}
    with connect(path) as con:
        con.execute("INSERT OR REPLACE INTO settings VALUES('brief',?)",(json.dumps(brief),));_audit(con,'brief','current',brief)
    return brief
