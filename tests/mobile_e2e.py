#!/usr/bin/env python3
"""スマホ表示の通し検証（Playwright / Chromium）。
使い方: python3 tests/mobile_e2e.py URL [出力プレフィックス]   例) python3 tests/mobile_e2e.py http://localhost:8000/ /tmp/mb
URL は `node tools/build_browser_app.js` の単体 HTML（file://）でも、docs/ を `python3 -m http.server` で配った URL でもよい。
合格条件: ページエラーなし・横スクロールなし・タップ対象が 40px 以上（画面ごとに点検）。 終了コード 0 = 合格。
"""
import sys, json
from playwright.sync_api import sync_playwright
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
URL = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/mb'
DEVICES = [('iPhone 13', ''), ('Pixel 7', ''), ('iPhone SE', ''), ('iPhone 13 landscape', '')]
SMALL_JS = """() => {
  const out = [], vw = innerWidth, vh = innerHeight;
  const sel = 'button,a[href],select,input:not([type=hidden]),summary,textarea,[role=button],[role=tab],[role=menuitem],.tlb,.ux-item,.fcard,.wcard';
  for (const e of document.querySelectorAll(sel)) {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0' || cs.pointerEvents === 'none') continue;
    if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
    if (e.closest('[hidden],[inert]') || e.disabled) continue;
    if (e.type === 'checkbox' || e.type === 'radio') { const l = e.closest('label'); if (l) { const lr = l.getBoundingClientRect(); if (lr.height >= 40 && lr.width >= 40) continue; } }
    if (e.type === 'range') { if (r.height >= 28 && r.width >= 120) continue; }   // つまみ付きスライダーは横長で指が当たる
    if (e.matches('select,input') && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 40) continue;
    const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
    if (!top || !(top === e || e.contains(top) || top.contains(e))) continue;   // 他の物に隠れている
    if (Math.min(r.width, r.height) < 40) out.push((e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/)[0] : '')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (e.textContent || e.title || e.getAttribute('aria-label') || '').trim().slice(0, 14) + '"');
  }
  return out;
}"""
fails = []
def check(pg, label, errs):
    ov = pg.evaluate("[document.scrollingElement.scrollWidth, innerWidth, document.body.scrollWidth]")
    small = pg.evaluate(SMALL_JS)
    if ov[0] > ov[1] + 0 or ov[2] > ov[1] + 0: fails.append(f'{label}: 横スクロール {ov}')
    for s in small[:8]: fails.append(f'{label}: 小さいタップ対象 {s}')
    return ov, small
def run(p, dev):
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    name = dev.replace(' landscape', '')
    kw = dict(p.devices[name])
    if dev.endswith('landscape'):
        kw = dict(p.devices[name + ' landscape']) if name + ' landscape' in p.devices else kw
    c = b.new_context(**kw); pg = c.new_page(); cdp = c.new_cdp_session(pg)
    tag = dev.replace(' ', '').lower()
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and 'accounts.google' not in m.text and errs.append('console: ' + m.text[:120]))
    def touch(t, pts): cdp.send('Input.dispatchTouchEvent', {'type': t, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    def tap(x, y): touch('touchStart', [(x, y)]); pg.wait_for_timeout(40); touch('touchEnd', [])
    def drag(x0, y0, x1, y1, n=10):
        touch('touchStart', [(x0, y0)])
        for i in range(1, n + 1): touch('touchMove', [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n)]); pg.wait_for_timeout(16)
        touch('touchEnd', [])
    def hold(x, y, ms=800): touch('touchStart', [(x, y)]); pg.wait_for_timeout(ms); touch('touchEnd', [])
    def shot(n): pg.screenshot(path=f'{OUT}_{tag}_{n}.png')
    def center(js):
        if not pg.evaluate("!!(" + js + ")"): raise Exception("center: null " + js)
        return pg.evaluate("(()=>{const r=(" + js + ").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()")
    pg.goto(URL); pg.wait_for_function("typeof R!=='undefined' && R", timeout=30000); pg.wait_for_timeout(1500)
    print(f'--- {dev} {pg.viewport_size}')
    # 1 welcome
    assert pg.evaluate("!!document.querySelector('dialog#uxwelcome[open]')"), 'welcome が出ない'
    shot('01_welcome'); check(pg, dev + ' welcome', errs)
    # 2 wizard
    pg.tap('.wcard.main'); pg.wait_for_timeout(500); shot('02_wizard'); check(pg, dev + ' wizard1', errs)
    pg.tap('#wznext'); pg.wait_for_timeout(300); check(pg, dev + ' wizard2', errs)
    pg.tap('#wznext'); pg.wait_for_timeout(300)
    for cc in pg.query_selector_all('.fcard')[:3]: cc.scroll_into_view_if_needed(); cc.tap(); pg.wait_for_timeout(80)
    shot('03_wizard_forms'); check(pg, dev + ' wizard3', errs)
    for i in range(3): pg.tap('#wznext'); pg.wait_for_timeout(350)
    pg.wait_for_timeout(2500)
    assert not pg.evaluate("!!document.querySelector('dialog[open]')"), 'ウィザード後にダイアログが残る'
    n = pg.evaluate("R.data.performers.length"); assert n > 0
    if pg.evaluate("document.getElementById('tourov')?.classList.contains('on')"):   # 作成直後のツアー: 画面に収まり、指で進められる
        shot('03b_tour'); check(pg, dev + ' tour', errs)
        pg.tap('#tourbub [data-t=next]'); pg.wait_for_timeout(500); check(pg, dev + ' tour2', errs)
        pg.tap('#tourbub [data-t=skip]'); pg.wait_for_timeout(500)
        assert not pg.evaluate("document.getElementById('tourov').classList.contains('on')"), 'ツアーが閉じない'
    pg.evaluate("jkSheet.set('peek',false)"); pg.wait_for_timeout(400)
    if pg.evaluate("document.querySelectorAll('#toasts .toast').length") > 1: fails.append(dev + ': トーストが2つ以上同時に出ている')
    tb = pg.evaluate("(()=>{const t=document.querySelector('#toasts .toast');if(!t)return null;const r=t.getBoundingClientRect();return [r.top,r.bottom]})()")
    if tb and tb[1] > 160: fails.append(dev + f': トーストが上部に出ていない {tb}')
    shot('04_main'); check(pg, dev + ' main', errs)
    # 3 field touch
    def vis(i): return pg.evaluate("(()=>{const e=dotEls[%d];if(!e)return false;const r=e.getBoundingClientRect();const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t===e})()" % i)
    vd = [i for i in range(n) if vis(i)]; assert len(vd) >= 6, '触れる位置にある点が少ない'
    I1, I2 = vd[2], vd[5]
    d0 = center(f'dotEls[{I1}]'); tap(*d0); pg.wait_for_timeout(300)
    assert pg.evaluate("sel.size") == 1, 'タップで選べない'
    shot('05_selected'); check(pg, dev + ' selected', errs)
    before = pg.evaluate("JSON.stringify(R.data.sets[0].pos)")
    d0 = center(f'dotEls[{I1}]'); drag(d0[0], d0[1], d0[0] + 24, d0[1] - 24); pg.wait_for_timeout(500)
    assert pg.evaluate("JSON.stringify(R.data.sets[0].pos)") != before or pg.evaluate("undoStack.length") > 0, 'ドラッグで動かせない'
    # empty tap deselect
    cv = pg.evaluate("(()=>{const r=document.querySelector('#svg').getBoundingClientRect();return [r.left+10,r.top+30]})()")
    tap(*cv); pg.wait_for_timeout(300); assert pg.evaluate("sel.size") == 0, '空きタップで選択が外れない'
    # long-press context menu
    d0 = center(f'dotEls[{I2}]'); hold(*d0); pg.wait_for_timeout(300)
    ctx_open = pg.evaluate("getComputedStyle(document.getElementById('ctx')).display") == 'block'
    shot('06_longpress'); check(pg, dev + ' ctxmenu', errs)
    assert ctx_open, '長押しメニューが出ない'
    pg.keyboard.press('Escape'); pg.evaluate("hideCtx&&hideCtx()") if pg.evaluate("typeof hideCtx==='function'") else None
    pg.wait_for_timeout(200)
    # 4 bottom sheet tabs
    tabs = pg.query_selector_all('#mbtabs button, .tabs button, [role=tab]')
    pg.evaluate("jkSheet.set('half',false)"); pg.wait_for_timeout(400)
    visible = [t for t in pg.query_selector_all('#right .tabs button') if t.is_visible()]
    print('tabs', len(visible))
    for i, t in enumerate(visible[:6]):
        t.scroll_into_view_if_needed(); t.tap(); pg.wait_for_timeout(250)
        if i in (0, 2, 4): shot(f'07_tab{i}'); check(pg, dev + f' tab{i}', errs)
    pg.evaluate("jkSheet.set('peek',false)"); pg.wait_for_timeout(300)
    # 5 timeline: long-press a set block -> set menu
    if pg.evaluate("document.querySelectorAll('.tlb').length") > 0:
        b0 = center("document.querySelectorAll('.tlb')[0]"); hold(*b0, ms=800); pg.wait_for_timeout(400)
        shot('08_setmenu'); check(pg, dev + ' setmenu', errs)
        opened = pg.evaluate("getComputedStyle(document.getElementById('ctx')).display") == 'block'
        if not opened: fails.append(dev + ': セットの長押しメニューが出ない')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        pg.evaluate("JKUX.closeAll&&JKUX.closeAll()")
    # 6 menu / palette / help / parade
    pg.evaluate("jkMenu.open()"); pg.wait_for_timeout(500); shot('09_menu'); check(pg, dev + ' menu', errs)
    pg.evaluate("jkMenu.close&&jkMenu.close()"); pg.wait_for_timeout(300)
    for nm, js in [('palette', 'scOpenPalette()'), ('help', 'JKUX.help()'), ('sheet', 'scOpenSheet()')]:
        pg.evaluate(js); pg.wait_for_timeout(600); shot('10_' + nm); check(pg, dev + ' ' + nm, errs)
        pg.evaluate("JKUX.closeAll(); document.querySelectorAll('dialog[open]').forEach(d=>d.close())"); pg.wait_for_timeout(300)
    if pg.evaluate("!!document.getElementById('paradebtn')"):
        pg.evaluate("document.getElementById('paradebtn').click()"); pg.wait_for_timeout(900); shot('11_parade'); check(pg, dev + ' parade', errs)
        pg.evaluate("document.querySelectorAll('dialog[open]').forEach(d=>d.close())"); pg.wait_for_timeout(300)
    # 7 3D preview plays
    h = pg.evaluate("JK_LOCAL.previewHtml(R.data, R.data.name)")
    with c.expect_page() as ev:
        pg.evaluate("(h)=>window.open(URL.createObjectURL(new Blob([h],{type:'text/html'}))+'#view=3d')", h)
    q = ev.value; q.on('pageerror', lambda e: errs.append('preview pageerror: ' + str(e)))
    q.wait_for_function("window.jk3d && jk3d.renderer", timeout=90000); q.wait_for_timeout(1200)
    q.tap('#play'); q.wait_for_timeout(1500)
    assert q.evaluate("playing") and q.evaluate("t") > 0, '3D 再生が進まない'
    q.screenshot(path=f'{OUT}_{tag}_12_preview.png'); check(q, dev + ' preview', errs)
    q.close()
    # 8 save (download)
    with pg.expect_download(timeout=8000) as dl:
        pg.evaluate("jkMenu.open()"); pg.wait_for_timeout(300); pg.evaluate("document.getElementById('save').click()")
    assert dl.value.suggested_filename.endswith('.jk'), '保存のファイル名'
    # 9 draft recovery
    pg.wait_for_timeout(1500)
    keys = pg.evaluate("Object.keys(localStorage).filter(k=>/jk|jinkei|draft/i.test(k))")
    if not keys: fails.append(dev + ': 下書き（localStorage）が見つからない')
    fails.extend(f'{dev}: {e}' for e in errs)
    b.close()
with sync_playwright() as p:
    import os
    for dev, _ in DEVICES:
        if os.environ.get('ONLY') and os.environ['ONLY'] not in dev: continue
        try: run(p, dev)
        except Exception as e:
            import traceback; tb = traceback.extract_tb(e.__traceback__)[-1]
            fails.append(f'{dev}: {type(e).__name__} (line {tb.lineno}): {str(e).splitlines()[0][:140]}')
print('\n'.join(sorted(set(fails))) or 'OK')
sys.exit(1 if fails else 0)
