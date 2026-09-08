"""Run locally: python server.py [--demo] [--port 8765]. Python 3.10+, no packages.

Loopback-only alpha, not an Internet production server. Browser requests are
Host-checked; mutations require same Origin and an application CSRF token.
"""
from __future__ import annotations
import argparse
import json
import mimetypes
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import scout

ROOT=Path(__file__).resolve().parent
STATIC=ROOT/'web'
MAX_BODY=4*1024*1024


class Handler(BaseHTTPRequestHandler):
    server_version='OmniScoutLocal/0.1'

    def log_message(self, fmt, *args):
        # Avoid logging query strings or personal content.
        pass

    def _safe_host(self):
        port=self.server.server_address[1]
        return self.headers.get('Host') in {f'127.0.0.1:{port}',f'localhost:{port}'}

    def _send(self, code, payload, kind='application/json; charset=utf-8', download=False):
        if kind.startswith('application/json'):
            payload=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
        elif isinstance(payload,str): payload=payload.encode()
        self.send_response(code)
        self.send_header('Content-Type',kind)
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('X-Frame-Options','DENY')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if download:self.send_header('Content-Disposition','attachment; filename="omni-scout-dossier.json"')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if not self._safe_host(): return self._send(403,{'error':'Alleen lokale hostnamen toegestaan.'})
        uri=urlsplit(self.path)
        try:
            if uri.path=='/api/health': return self._send(200,{'ok':True,'version':scout.VERSION,'mode':'local-only','live_providers':0})
            if uri.path=='/api/state':
                result=scout.snapshot(self.server.db)
                result['csrf_token']=self.server.csrf
                return self._send(200,result)
            if uri.path=='/api/export':
                pid=parse_qs(uri.query).get('id',[''])[0]
                p=scout.require_player(self.server.db,pid,'export')
                return self._send(200,{'exported_at':scout.utcnow(),'disclaimer':'Onderzoekshypothesen, geen talentvoorspelling. DEMO betekent fictief.','player':p},download=True)
            files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'}
            name=files.get(uri.path)
            if name:
                suffix='text/javascript' if name.endswith('.js') else (mimetypes.guess_type(name)[0] or 'application/octet-stream')
                return self._send(200,(STATIC/name).read_bytes(),suffix+'; charset=utf-8')
            return self._send(404,{'error':'Niet gevonden.'})
        except scout.ValidationError as exc:
            return self._send(400,{'error':str(exc)})
        except Exception:
            return self._send(500,{'error':'Interne fout. Controleer lokaal de database; geen gegevens gewijzigd door dit leesverzoek.'})

    def do_POST(self):
        port=self.server.server_address[1]
        origins={f'http://127.0.0.1:{port}',f'http://localhost:{port}'}
        token=self.headers.get('X-Omni-CSRF','')
        if (not self._safe_host() or self.headers.get('Origin') not in origins
            or not secrets.compare_digest(token,self.server.csrf)):
            return self._send(403,{'error':'Ongeldige lokale oorsprong of CSRF-token.'})
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self._send(415,{'error':'Alleen application/json toegestaan.'})
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=MAX_BODY:return self._send(413,{'error':'Import maximaal 4 MB.'})
            raw=self.rfile.read(length)
            body=json.loads(raw)
            if not isinstance(body,dict):raise scout.ValidationError('JSON-object vereist.')
            routes={
                '/api/decisions':lambda:scout.add_decision(self.server.db,body),
                '/api/tasks':lambda:scout.add_task(self.server.db,body),
                '/api/tasks/finish':lambda:scout.finish_task(self.server.db,int(body.get('id',0))),
                '/api/brief':lambda:scout.save_brief(self.server.db,body),
                '/api/imports':lambda:scout.enqueue(self.server.db,body),
                '/api/worker/run':lambda:scout.run_worker_once(self.server.db),
                '/api/jobs/retry':lambda:scout.retry_job(self.server.db,int(body.get('id',0))),
            }
            action=routes.get(urlsplit(self.path).path)
            if not action:return self._send(404,{'error':'Niet gevonden.'})
            return self._send(200,action())
        except (ValueError,TypeError,UnicodeDecodeError) as exc:
            return self._send(400,{'error':str(exc)[:500]})
        except Exception:
            return self._send(500,{'error':'Interne fout; controleer import en lokale database.'})


def make_server(db, port=8765):
    httpd=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    httpd.db=Path(db);httpd.csrf=secrets.token_urlsafe(32)
    return httpd


def main():
    parser=argparse.ArgumentParser(description='Omni-Scout lokale single-club alpha')
    parser.add_argument('--db',default=str(ROOT/'data'/'scout.sqlite'))
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--demo',action='store_true',help='Laad expliciet fictieve softwaretestdata als deze bron nog niet bestaat.')
    args=parser.parse_args()
    scout.init_db(args.db)
    if args.demo:
        with scout.connect(args.db) as con:exists=con.execute("SELECT 1 FROM sources WHERE id='demo-fixtures'").fetchone()
        if not exists:
            from seed import make_demo
            scout.import_bundle(args.db,make_demo())
    httpd=make_server(args.db,args.port)
    print(f'Omni-Scout {scout.VERSION}: http://127.0.0.1:{httpd.server_address[1]}',flush=True)
    print('Lokale single-club alpha. Geen login, productiehosting, live providers of gestarte Codex-taak.',flush=True)
    try:httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:httpd.server_close()

if __name__=='__main__':main()
