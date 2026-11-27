#!/usr/bin/env python3
# ブラウザでの計測（Playwright + Chrome）。ページの重さ・起動の速さ・3D 最初の描画・エディタ操作の体感時間。
#   python3 tools/bench_browser.py --docs docs --standalone /path/standalone.html --out /tmp/bench_browser.json [--label before]
# docs は tools/serve_static.js で配信（Pages と同じく文字ものだけ gzip）。standalone は file:// で開く。
import argparse, asyncio, json, subprocess, sys, time, os
from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--docs', default='docs'); ap.add_argument('--standalone', default=None)
ap.add_argument('--out', default='/tmp/bench_browser.json'); ap.add_argument('--port', type=int, default=8765)
ap.add_argument('--example', default='examples/battery.jk'); ap.add_argument('--chrome', default='/usr/bin/google-chrome')
a = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIRST_DRAW = """(() => { for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; const o = C.prototype.drawElements; C.prototype.drawElements = function () { if (!window.__firstDraw) window.__firstDraw = performance.now(); return o.apply(this, arguments); }; } })();"""

async def measure(browser, url, label, usable_js, extra=None, wait_ms=1500, cold=True):
    ctx = await browser.new_context(viewport={'width': 1400, 'height': 800}, service_workers='allow')
    page = await ctx.new_page()
    await page.add_init_script(FIRST_DRAW)
    cdp = await ctx.new_cdp_session(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    sizes = {}; total = {'enc': 0, 'n': 0}
    def on_done(e):
        total['enc'] += e['encodedDataLength']; total['n'] += 1
    cdp.on('Network.loadingFinished', on_done)
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    t0 = time.time()
    await page.goto(url, wait_until='load')
    load_wall = (time.time() - t0) * 1000
    usable = None
    if usable_js:
        try:
            await page.wait_for_function(usable_js, timeout=20000)
            usable = await page.evaluate('performance.now()')
        except Exception as e:
            errs.append('usable-timeout ' + str(e)[:80])
    await page.wait_for_timeout(wait_ms)
    nav = await page.evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; return {dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, transfer: n.transferSize}; })()")
    heap = await page.evaluate("performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null")
    first_draw = await page.evaluate("window.__firstDraw || null")
    res = {'label': label, 'transferred_kb': round(total['enc'] / 1024, 1), 'requests': total['n'], 'dcl_ms': round(nav['dcl']), 'load_ms': round(nav['load']),
           'usable_ms': round(usable) if usable else None, 'heap_mb': round(heap, 1) if heap else None, 'first_draw_ms': round(first_draw) if first_draw else None, 'errors': errs[:3]}
    if extra:
        res.update(await extra(page))
    await ctx.close()
    return res

async def editor_ops(page):
    # エディタ操作の体感時間（ページ内で計測）。メンバー追加・自動修正・ドラッグ後の再計算・セット追加
    return await page.evaluate("""async () => {
      const out = {};
      const T = async (name, fn) => { const t = performance.now(); try { await fn(); } catch (e) { out[name + '_err'] = String(e).slice(0, 60); } out[name] = Math.round((performance.now() - t) * 10) / 10; };
      if (typeof compile !== 'function') return {note: 'no compile'};
      const src = currentSource();
      await T('recompile_same_ms', () => compile(src, false));
      const tweaked = src.replace(/(\\d+(?:\\.\\d+)?)/, m => String(+m + 0.25));
      await T('recompile_drag_ms', () => compile(tweaked, false));
      await compile(src, true);
      if (typeof addMembers === 'function') {
        sel = new Set([Math.floor(R.data.performers.length / 2)]);
        await T('add_member_ms', () => addMembers(false));
      }
      if (typeof autoFix === 'function') await T('autofix_ms', () => autoFix());
      return out;
    }""")

async def main():
    out = {}
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'tools/serve_static.js'), a.docs, str(a.port)], stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=a.chrome, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
            usable = "typeof R !== 'undefined' && R && R.data && document.querySelector('#field svg, svg')"
            out['pages_editor'] = await measure(b, f'http://127.0.0.1:{a.port}/index.html', 'docs/index.html (Pages)', usable, editor_ops)
            if os.path.exists(os.path.join(a.docs, 'snare-preview.html')):
                out['pages_3d'] = await measure(b, f'http://127.0.0.1:{a.port}/snare-preview.html#view=3d', 'docs/snare-preview.html#view=3d', None, wait_ms=6000)
            if a.standalone:
                out['standalone_editor'] = await measure(b, 'file://' + os.path.abspath(a.standalone), 'standalone editor', usable, editor_ops)
            await b.close()
    finally:
        srv.terminate()
    # ファイルサイズ
    sizes = {}
    for dp, _, fs in os.walk(a.docs):
        for f in fs:
            sizes[os.path.relpath(os.path.join(dp, f), a.docs)] = os.path.getsize(os.path.join(dp, f))
    out['docs_total_kb'] = round(sum(sizes.values()) / 1024)
    out['docs_files_kb'] = {k: round(v / 1024, 1) for k, v in sorted(sizes.items(), key=lambda x: -x[1])[:8]}
    if a.standalone: out['standalone_kb'] = round(os.path.getsize(a.standalone) / 1024)
    json.dump(out, open(a.out, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps(out, indent=1, ensure_ascii=False))
asyncio.run(main())
