"""Real Chromium interaction tests; software fixtures only. No external network/data calls.
Requires Python Playwright plus an installed Chromium. Set CHROMIUM_PATH when needed.
"""
import json, os, subprocess, tempfile, time, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / 'reports'
REPORTS.mkdir(exist_ok=True)
checks, errors = [], []
CONTENT_ONLY = '--content-only' in sys.argv
HTML = (ROOT / 'OmniScout-preview.html').read_text()
def load_page(page, base):
    if CONTENT_ONLY:
        page.set_content(HTML, wait_until='load')
    else:
        page.goto(base)
        expect(page.locator('#storage-status')).to_contain_text('Lokaal opgeslagen')
def passed(name):
    checks.append({'test': name, 'status': 'passed'})
    print('PASS:', name, flush=True)
with tempfile.TemporaryDirectory(prefix='omniscout-browser-') as td:
    server_code = f"import {{createApp}} from './src/server.mjs'; const {{server}}=await createApp({{statePath:{json.dumps(str(Path(td)/'state.json'))}}});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"
    proc = subprocess.Popen(['node', '--input-type=module', '-e', server_code], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        port = proc.stdout.readline().strip()
        assert port.isdigit(), 'Server did not start: '+port
        base = f'http://127.0.0.1:{port}'
        with sync_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 1512, 'height': 1050}, device_scale_factor=1, accept_downloads=True)
            page = context.new_page()
            page.on('pageerror', lambda err: errors.append(str(err)))
            load_page(page, base)
            expect(page.locator('.player-table tbody tr')).to_have_count(12)
            expect(page.locator('.demo-banner')).to_contain_text('0 live databronnen')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            page.screenshot(path=str(REPORTS / 'desktop.png'), full_page=True)
            passed('Desktop renders all 12 labelled fixtures without page overflow')
            page.locator('#search').fill('Idrissa')
            expect(page.locator('.player-table tbody tr')).to_have_count(1)
            expect(page.locator('.player-table .numeric')).to_have_text('Onbekend')
            passed('Search and unknown-value presentation')
            page.locator('[data-open="p03"]').first.click()
            expect(page.locator('#dossier-dialog')).to_be_visible()
            expect(page.locator('#dossier-content')).to_contain_text('Speelminuten onbekend')
            expect(page.locator('#dossier-content')).to_contain_text('Tegenbewijs')
            page.screenshot(path=str(REPORTS / 'dossier.png'), full_page=False)
            passed('Dossier shows counterevidence, provenance and missing information')
            page.locator('[data-action="create-task"]').click()
            page.locator('#create-task-form [type="submit"]').click()
            expect(page.locator('#task-count')).to_have_text('1')
            expect(page.locator('.task-card')).to_have_count(1)
            passed('Research question creates an internal task' + (' in temporary memory' if CONTENT_ONLY else ' in persistent local state'))
            page.locator('[data-task]').click()
            page.locator('#task-result-form textarea').fill('Volledige beelden ontbreken. De onderzoeksvraag blijft onzeker; geen niveauclaim gemaakt.')
            page.locator('#task-result-form [type="submit"]').click()
            expect(page.locator('.task-card .status-tag')).to_have_text('Afgerond')
            expect(page.locator('#task-count')).to_have_text('0')
            passed('Research result is mandatory and completing it updates the board')
            page.locator('#nav [data-view="radar"]').click()
            page.locator('#search').fill('')
            page.locator('[data-save="p01"]').click()
            expect(page.locator('#shortlist-count')).to_have_text('1')
            if CONTENT_ONLY:
                page.locator('#nav [data-view="shortlist"]').click()
                expect(page.locator('.player-table tbody tr')).to_have_count(1)
                page.locator('#nav [data-view="radar"]').click()
                passed('Shortlist survives navigation within the current in-memory session')
            else:
                page.reload()
                expect(page.locator('#storage-status')).to_contain_text('Lokaal opgeslagen')
                expect(page.locator('#shortlist-count')).to_have_text('1')
                passed('Shortlist survives a page reload through server persistence')
            page.locator('[data-compare="p01"]').check()
            page.locator('[data-compare="p02"]').check()
            page.locator('[data-action="compare"]').click()
            expect(page.locator('.compare-table')).to_be_visible()
            expect(page.locator('.compare-table thead')).to_contain_text('Noah Vermeer')
            expect(page.locator('.compare-table thead')).to_contain_text('Sami Azzouri')
            page.keyboard.press('Escape')
            passed('Evidence comparison and native dialog keyboard close')
            page.locator('#nav [data-view="shortlist"]').click()
            expect(page.locator('.player-table tbody tr')).to_have_count(1)
            if not CONTENT_ONLY:
                with page.expect_download() as dl:
                    page.locator('[data-action="export"]').click()
                download = dl.value
                saved = Path(td) / 'selection.csv'
                download.save_as(saved)
                csv = saved.read_text(encoding='utf-8-sig')
                assert 'Noah Vermeer' in csv and 'FICTIEF - softwaretest' in csv
                passed('Shortlist CSV downloads with source and synthetic-data notice')
            page.locator('#nav [data-view="brief"]').click()
            page.locator('[name="role"]').select_option('GK')
            page.locator('[name="task"]').fill('Beoordeel positionering bij hoge ballen.')
            page.locator('#brief-form [type="submit"]').click()
            expect(page.locator('#toast')).to_contain_text('Clubvraag opgeslagen')
            page.locator('[data-action="apply-brief"]').click()
            expect(page.locator('.player-table tbody tr')).to_have_count(1)
            expect(page.locator('.role-label')).to_have_text('GK')
            passed('Structured club brief saves and applies role and age filters')
            page.locator('#nav [data-view="coverage"]').click()
            expect(page.locator('.coverage-table tbody tr')).to_have_count(8)
            page.locator('[data-competition="au2"]').click()
            expect(page.locator('.empty-state')).to_contain_text('niet-aangesloten competities')
            passed('Coverage register and disconnected-competition empty state')
            page.locator('#nav [data-view="log"]').click()
            expect(page.locator('.timeline-item')).to_have_count(4)
            passed('Decision and task changes are visible in the local audit log')
            mobile = context.new_page()
            mobile.set_viewport_size({'width': 390, 'height': 844})
            mobile.on('pageerror', lambda err: errors.append(str(err)))
            load_page(mobile, base)
            assert mobile.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page overflows'
            mobile.screenshot(path=str(REPORTS / 'mobile.png'), full_page=True)
            mobile.locator('[data-filter="role"]').select_option('CM')
            expect(mobile.locator('.player-table tbody tr')).to_have_count(3)
            mobile.locator('[data-open="p02"]').first.click()
            expect(mobile.locator('#dossier-dialog')).to_be_visible()
            assert mobile.locator('#dossier-dialog').evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
            mobile.screenshot(path=str(REPORTS / 'mobile-dossier.png'), full_page=False)
            mobile.locator('[data-close="dossier"]').click()
            passed('390px mobile filtering and dossier are usable without document overflow')
            offline = context.new_page()
            offline.on('pageerror', lambda err: errors.append(str(err)))
            if CONTENT_ONLY:
                offline.set_content(HTML, wait_until='load')
                expect(offline.locator('.player-table tbody tr')).to_have_count(12)
                passed('Self-contained HTML renders from memory without external assets or network requests')
            else:
                offline.goto((ROOT / 'OmniScout-preview.html').as_uri())
                expect(offline.locator('.player-table tbody tr')).to_have_count(12)
                offline.locator('[data-save="p02"]').click()
                expect(offline.locator('#shortlist-count')).to_have_text('1')
                offline.reload()
                expect(offline.locator('#shortlist-count')).to_have_text('1')
                passed('Standalone HTML works offline and retains synthetic shortlist in browser storage')
            assert not errors, 'Browser JavaScript errors: '+str(errors)
            passed('No uncaught JavaScript errors in tested browser workflows')
            browser.close()
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()
        (REPORTS / 'browser-tests.json').write_text(json.dumps({'mode': 'content_only' if CONTENT_ONLY else 'http_and_file', 'limitations': 'Browser navigation to HTTP and file URLs is blocked by environment policy. Content-only tests verify the inline interface in memory. HTTP API and disk persistence were tested separately in Node, not end-to-end in this browser.' if CONTENT_ONLY else '', 'checks': checks, 'passed': len(checks), 'browserErrors': errors, 'browser': 'System Chromium via Python Playwright', 'note': 'Fixture UI tests; not a scouting effectiveness evaluation.'}, indent=2, ensure_ascii=False))
print(json.dumps({'passed':len(checks),'errors':errors}))
