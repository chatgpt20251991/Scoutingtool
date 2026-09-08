"""Generate a standalone demo HTML. Only synthetic fixtures; no real database export."""
from pathlib import Path
import tempfile
import json
import scout
from seed import make_demo

ROOT=Path(__file__).parent

def create_preview(destination=None):
    with tempfile.TemporaryDirectory() as td:
        db=Path(td)/'preview.sqlite';scout.init_db(db);scout.import_bundle(db,make_demo());s=scout.snapshot(db)
    s.pop('csrf_token',None)
    html=(ROOT/'web/index.html').read_text()
    html=html.replace('<link rel="stylesheet" href="/style.css">','<style>'+ (ROOT/'web/style.css').read_text()+'</style>')
    # Do not inline user imports. Script-closing sequences are escaped as defense in depth.
    payload=json.dumps(s,ensure_ascii=False).replace('<','\\u003c')
    scripts='<script>window.OMNI_PREVIEW='+payload+';</script><script>'+ (ROOT/'web/app.js').read_text().replace('</script','<\\/script')+'</script>'
    html=html.replace('<script defer src="/app.js"></script>','').replace('</body>',scripts+'</body>')
    target=Path(destination) if destination else ROOT/'preview.html'
    target.write_text(html,encoding='utf-8')
    return target

if __name__=='__main__':print(create_preview())
