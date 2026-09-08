import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import scout
from seed import make_demo
from server import make_server

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.db=Path(cls.tmp.name)/'http.sqlite';scout.init_db(cls.db);scout.import_bundle(cls.db,make_demo())
        cls.server=make_server(cls.db,0);cls.url=f'http://127.0.0.1:{cls.server.server_address[1]}'
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        with urlopen(cls.url+'/api/state') as r:cls.token=json.load(r)['csrf_token']
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.tmp.cleanup()
    def req(self,path,data=None,headers=None):
        return urlopen(Request(self.url+path,data=json.dumps(data).encode() if data is not None else None,headers=headers or {}))
    def test_health(self):
        with self.req('/api/health') as r:self.assertEqual(json.load(r)['live_providers'],0)
    def test_index_and_csp(self):
        with self.req('/') as r:
            self.assertIn(b'OMNI',r.read());self.assertIn("frame-ancestors 'none'",r.headers['Content-Security-Policy']);self.assertEqual(r.headers['Cache-Control'],'no-store')
    def test_state_is_json(self):
        with self.req('/api/state') as r:self.assertEqual(len(json.load(r)['players']),400)
    def test_host_rebinding_blocked(self):
        with self.assertRaises(HTTPError) as cm:self.req('/api/state',headers={'Host':'evil.example'})
        self.assertEqual(cm.exception.code,403)
    def test_cross_origin_write_blocked(self):
        with self.assertRaises(HTTPError) as cm:self.req('/api/brief',{'club':'Attack'},{'Content-Type':'application/json','Origin':'http://evil.example','X-Omni-CSRF':self.token})
        self.assertEqual(cm.exception.code,403)
    def test_missing_csrf_blocked(self):
        with self.assertRaises(HTTPError) as cm:self.req('/api/brief',{'club':'Attack'},{'Content-Type':'application/json','Origin':self.url})
        self.assertEqual(cm.exception.code,403)
    def test_valid_same_origin_write(self):
        with self.req('/api/brief',{'club':'HTTP Test','role':'CB','tasks':'Test'},{'Content-Type':'application/json','Origin':self.url,'X-Omni-CSRF':self.token}) as r:self.assertEqual(json.load(r)['club'],'HTTP Test')
    def test_path_traversal_not_served(self):
        with self.assertRaises(HTTPError) as cm:self.req('/../scout.py')
        self.assertEqual(cm.exception.code,404)
    def test_export(self):
        with self.req('/api/export?id=demo-fixtures%3Aplayer-0001') as r:
            self.assertIn('attachment',r.headers['Content-Disposition']);self.assertTrue(json.load(r)['player']['is_demo'])
    def test_unsupported_type_rejected(self):
        with self.assertRaises(HTTPError) as cm:self.req('/api/brief',{'club':'No'},{'Content-Type':'text/plain','Origin':self.url,'X-Omni-CSRF':self.token})
        self.assertEqual(cm.exception.code,415)

if __name__=='__main__':unittest.main()
