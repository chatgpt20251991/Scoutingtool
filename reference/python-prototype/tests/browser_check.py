"""Optional browser/HTTP integration check.

Chromium in the build sandbox blocks file/localhost navigation by policy.
The harness injects the DOM and bridges fetch to a REAL local HTTP server via
urllib; headers/security are independently tested in test_http.py. This is NOT
proof of public hosting, TLS, production auth, or an unmodified network E2E run.
Run: python tests/browser_check.py
Optional: OMNI_CHROMIUM=/path/to/chromium python tests/browser_check.py
"""
import json
import os
import shutil
import tempfile
import threading
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from playwright.sync_api import sync_playwright
import scout
from seed import make_demo
from server import make_server

ROOT=Path(__file__).resolve().parents[1]

def main():
    results=[]
    def check(name,condition=True):
        if not condition:raise AssertionError(name)
        results.append({'name':name,'status':'passed'})
    with tempfile.TemporaryDirectory() as td:
        db=Path(td)/'browser.sqlite';scout.init_db(db);bundle=make_demo();scout.import_bundle(db,bundle)
        server=make_server(db,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_address[1]}'
        def transport(path,options=None):
            if not path.startswith('/api/'):raise ValueError('Only local /api/ endpoints are allowed.')
            opts=options or {};headers=opts.get('headers',{}).copy();headers['Origin']=base
            req=Request(base+path,data=opts.get('body','').encode() if opts.get('method')=='POST' else None,headers=headers)
            try:
                with urlopen(req,timeout=10) as response:return {'ok':True,'data':json.load(response),'status':response.status}
            except HTTPError as e:return {'ok':False,'data':json.load(e),'status':e.code}
        html=(ROOT/'web/index.html').read_text().replace('<link rel="stylesheet" href="/style.css">','<style>'+(ROOT/'web/style.css').read_text()+'</style>')
        html=html.replace('<script defer src="/app.js"></script>','')
        bridge='<script>window.fetch=async(p,o)=>{const r=await window.__omniTransport(p,o||{});return {ok:r.ok,status:r.status,json:async()=>r.data};};</script>'
        html=html.replace('</body>',bridge+'<script>'+(ROOT/'web/app.js').read_text()+'</script></body>')
        try:
            with sync_playwright() as pw:
                exe=os.environ.get('OMNI_CHROMIUM') or shutil.which('chromium')
                options={'headless':True}
                if exe:options['executable_path']=exe
                browser=pw.chromium.launch(**options)
                page=browser.new_page(viewport={'width':1440,'height':1080})
                errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
                page.expose_function('__omniTransport',transport);page.set_content(html);page.wait_for_selector('.player-card')
                check('desktop_initial_render',page.locator('.player-card').count()==9)
                check('demo_warning_visible','400 demorecords' in page.locator('#mode-banner').inner_text())
                check('desktop_no_horizontal_page_overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                page.screenshot(path=str(ROOT/'evidence/desktop.png'),full_page=True)
                page.locator('#role').select_option('CB');page.wait_for_timeout(50)
                check('role_filter',all('Centrale verdediger' in c for c in page.locator('.player-card').all_inner_texts()))
                page.locator('[data-track="explore"]').click();page.wait_for_timeout(50)
                check('exploration_separate',all('EERST VERKENNEN' in c for c in page.locator('.player-card').all_inner_texts()))
                page.locator('.open-player').first.click();page.wait_for_selector('dialog[open]')
                check('dossier_has_counterevidence','Tegenbewijs' in page.locator('#dossier-content').inner_text())
                check('dossier_has_source','Bewijslocatie' in page.locator('#dossier-content').inner_text())
                page.locator('#prepare-task').click();page.wait_for_function("document.querySelector('#task-count').textContent==='1'")
                check('research_task_persisted_to_real_sqlite',len(scout.snapshot(db)['tasks'])==1)
                page.locator('#prepare-task').click();page.wait_for_timeout(200)
                check('task_repeated_click_idempotent',len(scout.snapshot(db)['tasks'])==1)
                page.locator('#decision-form [name=action]').select_option('not_prioritized')
                page.locator('#decision-form [name=reason]').select_option('budget')
                note='<img src=x onerror="window.injected=1"> Niet betaalbaar, geen talentoordeel.'
                page.locator('#decision-form [name=note]').fill(note)
                page.locator('#decision-form button[type=submit]').click();page.wait_for_selector('dialog[open]',state='hidden')
                check('budget_decision_persisted',scout.snapshot(db)['decisions'][0]['reason']=='budget')
                page.locator('.nav-item[data-view=log]').click();page.wait_for_selector('.log-card')
                check('notes_render_as_text_not_html',note in page.locator('.log-card').inner_text() and page.locator('.log-card img').count()==0)
                page.locator('.nav-item[data-view=tasks]').click();page.locator('[data-finish]').click();page.wait_for_timeout(200)
                check('task_completion_persisted',scout.snapshot(db)['tasks'][0]['status']=='done')
                page.locator('.nav-item[data-view=coverage]').click();page.wait_for_selector('.coverage-table')
                check('coverage_result_only_visible','resultaat-only' in page.locator('.coverage-table').inner_text())
                page.locator('.nav-item[data-view=brief]').click();page.locator('#brief-form [name=club]').fill('Ontwerpclub')
                page.locator('#brief-form [name=role]').select_option('CM');page.locator('#brief-form [name=tasks]').fill('Passing onder druk onderzoeken.')
                page.locator('#brief-form [type=submit]').click();page.wait_for_function("document.querySelector('#club-name').textContent==='Ontwerpclub'")
                check('club_brief_persisted',scout.snapshot(db)['brief']['role']=='CM')
                page.locator('.nav-item[data-view=imports]').click()
                sample=make_demo();sample['source']['id']='browser-import-demo';sample['players']=sample['players'][:2];sample['competitions']=sample['competitions'][:1]
                raw=json.dumps(sample).encode();page.locator('#import-file').set_input_files({'name':'sample.json','mimeType':'application/json','buffer':raw});page.locator('#rights-check').check()
                page.locator('#import-form [type=submit]').click();page.wait_for_function("document.querySelector('#job-list').textContent.includes('queued')")
                check('import_queued',scout.snapshot(db)['jobs'][0]['status']=='queued')
                page.locator('#run-worker').click();page.wait_for_function("document.querySelector('#job-list').textContent.includes('completed')")
                check('worker_processed_import',scout.snapshot(db)['jobs'][0]['status']=='completed')
                page.locator('.nav-item[data-view=radar]').click();page.locator('#reset-filters').click();page.locator('[data-track=all]').click();page.locator('#mode').select_option('real');page.wait_for_selector('.empty')
                check('real_data_never_faked_by_demo',page.locator('.player-card').count()==0)
                page.locator('#mode').select_option('demo');page.wait_for_selector('.player-card')
                page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
                check('mobile_390_no_horizontal_page_overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                page.screenshot(path=str(ROOT/'evidence/mobile.png'),full_page=True)
                page.screenshot(path=str(ROOT/'evidence/mobile-top.png'))
                page.locator('.open-player').first.click();page.wait_for_selector('dialog[open]')
                check('mobile_dossier_fits',page.locator('#dossier').bounding_box()['width']<=390)
                page.screenshot(path=str(ROOT/'evidence/mobile-dossier.png'))
                page.locator('#close-dossier').click();page.set_viewport_size({'width':360,'height':800});page.wait_for_timeout(100)
                check('mobile_360_no_horizontal_page_overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                check('no_uncaught_javascript_errors',not errors)
                browser.close()
        finally:
            server.shutdown();server.server_close();thread.join()
    output={'status':'passed','checks':len(results),'harness':'DOM injection + real HTTP/SQLite via Python fetch bridge; NOT native-navigation E2E','results':results}
    (ROOT/'evidence/browser-tests.json').write_text(json.dumps(output,indent=2))
    print(json.dumps(output,indent=2))

if __name__=='__main__':main()
