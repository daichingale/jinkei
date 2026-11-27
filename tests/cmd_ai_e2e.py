#!/usr/bin/env python3
"""日本語で指示する判断AIの、画面での通し検証（Playwright / Chromium）。
使い方: python3 tests/cmd_ai_e2e.py [URL] [スクリーンショットの出力先 /tmp/cmdai]
URL を省くと、node tools/build_browser_app.js で単体 HTML を作って file:// で開く。終了コード 0 = 合格。
確かめること（デスクトップ ＋ iPhone 13）:
  入力 → 一行の説明 → Enter で実行 → ショーの位置が変わる → 「元に戻す」1回で元どおり（複合の指示も1回）
  削除は 2 回目の確認まで実行されない / 足りない値は質問 / わからない文は実行されない
  Ctrl+K のパレットで、メニューに無い言い方が「AIに頼む」になる / 声の入力（Web Speech を差し替えて）/ 確実なときの自動実行
  1回の判断 20ms 未満 / ページのエラーなし / スマホでタップ対象が 40px 以上
"""
import sys, os, json, subprocess, tempfile
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = sys.argv[1] if len(sys.argv) > 1 else None
OUT = sys.argv[2] if len(sys.argv) > 2 else '/tmp/cmdai'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox']
if URL is None:
    path = os.path.join(tempfile.mkdtemp(), 'app.html')
    subprocess.check_call(['node', os.path.join(ROOT, 'tools/build_browser_app.js'), path], stdout=subprocess.DEVNULL)
    URL = 'file://' + path
fails = []
def check(c, msg):
    if not c:
        fails.append(msg); print('  NG', msg)
    else:
        print('  ok', msg)

POS = "JSON.stringify(R.data.sets[curSet].pos.map(p=>[Math.round(p[0]*1000)/1000,Math.round(p[1]*1000)/1000]))"

def start(p, dev):
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}) if dev == 'desktop' else b.new_context(**p.devices['iPhone 13'])
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.get_by_text('このまま編集する').click(); pg.wait_for_timeout(900)
    return b, pg, errs

def settle(pg, ms=400):
    pg.wait_for_timeout(ms)
    pg.wait_for_function("typeof lastErr !== 'undefined' && !lastErr", timeout=5000)

def toast_undo(pg):
    pg.wait_for_selector('#toasts .sct-undo', timeout=4000)
    pg.click('#toasts .sct-undo'); settle(pg, 700)

def run_dev(p, dev):
    print(f'== {dev}')
    b, pg, errs = start(p, dev)
    mobile = dev != 'desktop'
    inp = pg.locator('#aiin')
    check(pg.locator('#aibar').is_visible(), 'かんたんモードに、いつも見える入力欄がある')
    if mobile:
        for sel in ['#aimic', '#aigo']:
            bb = pg.locator(sel).bounding_box()
            if bb: check(min(bb['width'], bb['height']) >= 40, f'{sel} のタップ対象が 40px 以上（{bb["width"]:.0f}x{bb["height"]:.0f}）')
        bb = inp.bounding_box(); check(bb['height'] >= 40, '入力欄の高さが 40px 以上')
    # --- 1. 1つの指示: 入力 → プレビュー → Enter → 位置が変わる → 元に戻す
    n0 = pg.evaluate("undoStack.length"); before = pg.evaluate(POS)
    ids = pg.evaluate("R.data.performers.map(p=>p.id)")
    stride = pg.evaluate("strideM()")
    inp.click(); inp.fill('トランペットを前に3歩動かして'); pg.wait_for_timeout(250)
    check(pg.locator('.ai-card.ai-run .ai-one').count() == 1, 'プレビュー（一行の説明）が出る')
    txt = pg.locator('.ai-card .ai-one').inner_text()
    check('トランペット' in txt and '3歩' in txt and '客席' in txt, f'説明が正しい: {txt}')
    check(pg.evaluate(POS) == before, 'Enter を押すまでは、ショーは変わらない')
    check(pg.locator('.ai-cf').count() == 1, '確信度が見える')
    if os.path.isdir(OUT) or os.makedirs(OUT, exist_ok=True) is None: pg.screenshot(path=f'{OUT}/{dev}_preview.png')
    inp.press('Enter'); settle(pg, 900)
    after = json.loads(pg.evaluate(POS)); b0 = json.loads(before)
    tp = [i for i, x in enumerate(ids) if x.startswith('tp')]
    other = [i for i, x in enumerate(ids) if not x.startswith('tp')]
    moved = all(abs((after[i][1] - b0[i][1]) + 3 * stride) < 0.02 and abs(after[i][0] - b0[i][0]) < 1e-6 for i in tp)
    check(moved, f'トランペット全員が客席側へ 3歩（{3*stride:.3f}m）動いた')
    check(all(after[i] == b0[i] for i in other), 'ほかの人は動いていない')
    check(pg.evaluate("undoStack.length") - n0 == 1, '元に戻す履歴は1つ')
    check(pg.locator('#toasts .sct-undo').count() == 1, 'トースト（元に戻す付き）が出る')
    toast_undo(pg)
    check(pg.evaluate(POS) == before, '「元に戻す」1回で、位置が完全に元どおり')
    # --- 2. 複合の指示は、元に戻すのも1回
    n0 = pg.evaluate("undoStack.length"); before = pg.evaluate(POS)
    inp.click(); inp.fill('トロンボーンを選んで後ろに2m、それから円にして'); pg.wait_for_timeout(250)
    check(pg.locator('.ai-steps li').count() == 3, '3段階に分かれて見える')
    inp.press('Enter'); settle(pg, 1100)
    after = pg.evaluate(POS)
    check(after != before, '複合の指示で位置が変わった')
    r = pg.evaluate("(() => { const ix = R.data.performers.map((p,i)=>p.id.startsWith('tb')?i:-1).filter(i=>i>=0), P = R.data.sets[curSet].pos; const c = [0,1].map(k=>ix.reduce((s,i)=>s+P[i][k],0)/ix.length); const d = ix.map(i=>Math.hypot(P[i][0]-c[0],P[i][1]-c[1])); return {n: ix.length, spread: Math.max(...d)-Math.min(...d), r: d[0]}; })()")
    check(r['spread'] < 0.6 and r['r'] > 1, f'トロンボーンが円になっている（半径のばらつき {r["spread"]:.2f}）')
    check(pg.evaluate("undoStack.length") - n0 == 1, '複合でも元に戻す履歴は1つ')
    toast_undo(pg)
    check(pg.evaluate(POS) == before, '複合も、元に戻す1回で完全に元どおり')
    # --- 3. 削除は2回目の確認まで実行されない
    n_perf = pg.evaluate("R.data.performers.length"); n0 = pg.evaluate("undoStack.length")
    inp.click(); inp.fill('tp3を削除して'); pg.wait_for_timeout(250)
    check(pg.locator('.ai-card.ai-danger').count() == 1, '削除は赤い確認の表示になる')
    inp.press('Enter'); pg.wait_for_timeout(500)
    check(pg.evaluate("R.data.performers.length") == n_perf, '1回目の Enter では削除されない')
    check('もう一度' in pg.locator('.ai-warnl').inner_text(), '「もう一度」の案内が出る')
    inp.press('Enter'); settle(pg, 1200)
    check(pg.evaluate("R.data.performers.length") == n_perf - 1, '2回目の Enter で削除された')
    check(pg.evaluate("undoStack.length") - n0 == 1, '削除も元に戻す履歴は1つ')
    toast_undo(pg)
    check(pg.evaluate("R.data.performers.length") == n_perf, '削除も元に戻せる')
    # --- 4. 足りない値は質問（選ぶだけで進む）
    before = pg.evaluate(POS)
    inp.click(); inp.fill('前に動かして'); pg.wait_for_timeout(250)
    check(pg.locator('.ai-card.ai-ask').count() == 1, '足りない値を質問する')
    pg.locator('.ai-ch .ai-pick').first.click(); pg.wait_for_timeout(250)
    check(pg.locator('.ai-card.ai-ask').count() == 1, '次の質問（量）が続く')
    pg.locator('.ai-ch .ai-pick', has_text='2歩').click(); settle(pg, 900)
    check(pg.evaluate(POS) != before, '質問に答えて実行された')
    toast_undo(pg)
    check(pg.evaluate(POS) == before, '質問経由でも1回で戻せる')
    # --- 5. わからない文は実行されない
    inp.click(); inp.fill('あしたの天気はどうなりますか'); pg.wait_for_timeout(250)
    check(pg.locator('.ai-card.ai-unk').count() == 1 and 'わかりませんでした' in pg.locator('.ai-card.ai-unk').inner_text(), '「わかりませんでした」と例が出る')
    inp.press('Enter'); pg.wait_for_timeout(300)
    check(pg.evaluate(POS) == before, 'わからない文は何も変えない')
    pg.screenshot(path=f'{OUT}/{dev}_unknown.png')
    inp.fill(''); pg.keyboard.press('Escape')
    # --- 6. 速さ（画面の中で。ctx を作る時間を含む）
    ms = pg.evaluate("""(() => { const T = ['トランペットを前に3歩動かして','全員を円にして','tp3を削除して','セットを8拍で追加','時計回りに90度回して','トロンボーンを選んで後ろに2m、それから円にして','ぶつかりを自動で直して','前に動かして']; const a = []; for (let r = 0; r < 30; r++) for (const t of T) { const t0 = performance.now(); JKCMDUI.decide(t); a.push(performance.now() - t0); } a.sort((x,y)=>x-y); return {p50: a[Math.floor(a.length*.5)], p99: a[Math.floor(a.length*.99)]}; })()""")
    check(ms['p99'] < 20, f'1回の判断（状況の取り込み込み）が 20ms 未満: p50 {ms["p50"]:.2f}ms / p99 {ms["p99"]:.2f}ms')
    check(pg.locator('#aimic').count() == 1, 'マイクのボタンがある')
    # --- 8. パレット（Ctrl+K / スマホはメニューから）
    pg.evaluate("scOpenPalette()"); pg.wait_for_timeout(300)
    pg.fill('#scpin', 'トランペットを前に2歩'); pg.wait_for_timeout(300)
    check(pg.locator('#scplist .ai-card').count() == 1, 'メニューに無い言い方は、そのまま「AIに頼む」の表示になる')
    pg.screenshot(path=f'{OUT}/{dev}_palette.png')
    before = pg.evaluate(POS)
    pg.press('#scpin', 'Enter'); settle(pg, 900)
    check(pg.evaluate(POS) != before, 'パレットから実行できた')
    check(not pg.locator('#scpal').is_visible(), '実行するとパレットが閉じる')
    toast_undo(pg)
    check(pg.evaluate(POS) == before, 'パレットからでも1回で戻せる')
    pg.evaluate("scOpenPalette()"); pg.wait_for_timeout(300)
    pg.fill('#scpin', 'sakujo'); pg.wait_for_timeout(250)
    check(pg.locator('#scplist .scp-ai').count() == 1 and pg.locator('#scplist .scp-i:not(.scp-ai)').count() >= 1, 'メニューに合う語では、メニューが先で「AIに頼む」の行が下に出る')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    if mobile:
        # スマホ: ⋮ メニューの「検索（コマンド）」から
        pg.screenshot(path=f'{OUT}/{dev}_after.png')
    check(not errs, 'ページのエラーなし ' + ' | '.join(errs[:3]))
    b.close()

def run_voice(p):
    print('== 声の入力・自動実行')
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=ARGS)
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    ctx.add_init_script("""window.SpeechRecognition = window.webkitSpeechRecognition = function () { window.__sr = this; this.start = () => { this.onstart && this.onstart(); }; this.stop = () => { this.onend && this.onend(); }; };""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.get_by_text('このまま編集する').click(); pg.wait_for_timeout(900)
    before = pg.evaluate(POS)
    check(pg.locator('#aimic').is_visible(), '声の入力に対応した環境では、マイクのボタンが見える')
    pg.click('#aimic'); pg.wait_for_timeout(100)
    # 音声認識は「トランペット を 前 に 3 歩 動かして」のように空白が入ることがある
    pg.evaluate("""(() => { const r = window.__sr; r.onresult({results: [Object.assign([{transcript: 'トランペット を 前 に 3 歩 動かして'}], {isFinal: true})]}); r.onend && r.onend(); })()""")
    pg.wait_for_timeout(300)
    check(pg.evaluate(POS) == before, '自動実行がオフなら、声の入力でも実行せずプレビューだけ')
    check('3歩' in pg.locator('.ai-card .ai-one').inner_text(), '声の入力（空白入り）でも正しく読める')
    pg.fill('#aiin', ''); pg.keyboard.press('Escape')
    pg.evaluate("JKCMDUI.setAuto(true)")
    pg.click('#aimic'); pg.wait_for_timeout(100)
    pg.evaluate("""(() => { const r = window.__sr; r.onresult({results: [Object.assign([{transcript: 'トランペット を 前 に 3 歩 動かして'}], {isFinal: true})]}); r.onend && r.onend(); })()""")
    settle(pg, 1000)
    check(pg.evaluate(POS) != before, '確実なときの自動実行がオンなら、声の入力だけで実行される')
    toast_undo(pg)
    check(pg.evaluate(POS) == before, '自動実行も元に戻せる')
    # 自動実行でも、削除は確認が要る
    pg.click('#aimic'); pg.wait_for_timeout(100)
    n_perf = pg.evaluate("R.data.performers.length")
    pg.evaluate("""(() => { const r = window.__sr; r.onresult({results: [Object.assign([{transcript: 'tp 3 を 削除 して'}], {isFinal: true})]}); r.onend && r.onend(); })()""")
    pg.wait_for_timeout(1500)
    check(pg.evaluate("R.data.performers.length") == n_perf, '自動実行がオンでも、削除は確認なしには実行されない')
    check(pg.locator('.ai-card.ai-danger').count() == 1, '削除の確認が出ている')
    check(not errs, 'ページのエラーなし ' + ' | '.join(errs[:3]))
    b.close()

with sync_playwright() as p:
    os.makedirs(OUT, exist_ok=True)
    run_dev(p, 'desktop')
    run_dev(p, 'iPhone 13')
    run_voice(p)
print()
if fails:
    print(f'NG {len(fails)} 件'); [print(' -', f) for f in fails]; sys.exit(1)
print('cmd_ai_e2e: すべて OK')
