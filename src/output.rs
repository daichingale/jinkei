//! 出力: JSON / テキスト（ドットシート・チェック結果）/ HTMLプレイヤー
use crate::analyze::Report;
use crate::build::Show;
use crate::field::{FieldKind, BSL};
use std::fmt::Write as _;

pub fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '<' => o.push_str("\\u003c"),
            c if (c as u32) < 0x20 => {
                let _ = write!(o, "\\u{:04x}", c as u32);
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

pub fn num(v: f64) -> String {
    let s = format!("{:.3}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

pub fn json(s: &Show, r: &Report) -> String {
    let mut o = String::new();
    let field = match &s.field.kind {
        FieldKind::Football { level, hash } => {
            format!("{{\"type\":\"football\",\"level\":{},\"hash\":{},\"bsl\":{}}}", js(level), num(*hash), num(BSL))
        }
        FieldKind::Floor { w, d } => format!("{{\"type\":\"floor\",\"w\":{},\"d\":{}}}", num(*w), num(*d)),
        FieldKind::Gym { w, d } => format!(
            "{{\"type\":\"gym\",\"w\":{},\"d\":{},\"margin\":{}}}",
            num(*w),
            num(*d),
            num(crate::field::GYM_MARGIN)
        ),
        FieldKind::Stage { w, d, wing } => {
            format!("{{\"type\":\"stage\",\"w\":{},\"d\":{},\"wing\":{}}}", num(*w), num(*d), num(*wing))
        }
    };
    let _ = write!(
        o,
        "{{\"name\":{},\"tempo\":{},\"look\":{},\"unit\":{},\"unit_m\":{},\"clearance\":{},\"field\":{},\"total\":{},\"sections\":[",
        js(&s.name),
        num(s.tempo),
        js(&s.look),
        js(s.field.unit_name()),
        num(s.field.unit_m),
        num(s.clearance),
        field,
        num(r.total_counts)
    );
    o.push_str(
        &s.sections
            .iter()
            .map(|x| format!("{{\"id\":{},\"label\":{},\"color\":{},\"color_given\":{},\"instrument\":{}}}", js(&x.id), js(&x.label), js(&x.color), x.color_given, js(&x.instrument)))
            .collect::<Vec<_>>()
            .join(","),
    );
    o.push_str("],\"performers\":[");
    o.push_str(
        &s.performers
            .iter()
            .map(|p| format!("{{\"id\":{},\"sec\":{}}}", js(&p.id), p.section))
            .collect::<Vec<_>>()
            .join(","),
    );
    o.push_str("],\"sets\":[");
    for (k, set) in s.sets.iter().enumerate() {
        if k > 0 {
            o.push(',');
        }
        let _ = write!(
            o,
            "{{\"name\":{},\"counts\":{},\"hold\":{},\"start\":{},\"min_counts\":{},\"max_step\":{},\"wait\":[{}],\"end\":[{}],\"bend\":[{}],\"face\":[{}],\"route\":[{}],\"step\":[{}],\"action\":[{}],\"pose\":[{}],\"carry\":[{}],\"tempo\":{},\"mark\":{},\"pos\":[{}]}}",
            js(&set.name),
            num(set.counts),
            num(set.hold),
            num(set.start),
            min_counts(s, r, k).map(num).unwrap_or_else(|| "null".into()),
            js(&if k == 0 { "—".to_string() } else { s.field.describe_step(r.max_per_count[k]) }),
            set.wait.iter().map(|w| num(*w)).collect::<Vec<_>>().join(","),
            set.end.iter().map(|w| num(*w)).collect::<Vec<_>>().join(","),
            set.bend.iter().map(|w| num(*w)).collect::<Vec<_>>().join(","),
            set.face.iter().map(|f| f.map(num).unwrap_or_else(|| "null".into())).collect::<Vec<_>>().join(","),
            set.route
                .iter()
                .map(|r| match r {
                    Some(r) => format!("[{}]", r.iter().map(|p| format!("[{},{}]", num(p.0), num(p.1))).collect::<Vec<_>>().join(",")),
                    None => "null".into(),
                })
                .collect::<Vec<_>>()
                .join(","),
            set.step.iter().map(|x| x.as_deref().map(js).unwrap_or_else(|| "null".into())).collect::<Vec<_>>().join(","),
            set.action.iter().map(|x| x.as_deref().map(js).unwrap_or_else(|| "null".into())).collect::<Vec<_>>().join(","),
            set.pose.iter().map(|x| x.as_deref().map(js).unwrap_or_else(|| "null".into())).collect::<Vec<_>>().join(","),
            set.carry.iter().map(|x| x.as_deref().map(js).unwrap_or_else(|| "null".into())).collect::<Vec<_>>().join(","),
            num(set.tempo),
            set.mark,
            set.pos.iter().map(|p| format!("[{},{}]", num(p.0), num(p.1))).collect::<Vec<_>>().join(",")
        );
    }
    o.push_str("],\"dots\":[");
    for (i, ds) in r.dots.iter().enumerate() {
        if i > 0 {
            o.push(',');
        }
        o.push('[');
        o.push_str(
            &ds.iter()
                .map(|d| format!("{{\"h\":{},\"v\":{},\"step\":{},\"face\":{},\"moved\":{}}}", js(&d.h), js(&d.v), js(&d.step), js(&d.face), num(d.moved)))
                .collect::<Vec<_>>()
                .join(","),
        );
        o.push(']');
    }
    o.push_str("],\"warnings\":[");
    o.push_str(
        &r.warnings
            .iter()
            .map(|w| {
                format!(
                    "{{\"set\":{},\"kind\":{},\"msg\":{},\"at\":{},\"who\":[{}]}}",
                    w.set,
                    js(w.kind),
                    js(&w.msg),
                    num(w.at),
                    w.who.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(","),
    );
    o.push_str("],\"parts\":[");
    o.push_str(
        &s.parts
            .iter()
            .map(|p| {
                format!(
                    "{{\"name\":{},\"members\":[{}],\"meter\":[{},{}],\"start\":{},\"end\":{},\"bars\":[{}],\"notes\":[{}]}}",
                    js(&p.name),
                    p.members.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","),
                    p.meter.0,
                    p.meter.1,
                    num(p.start),
                    num(p.end),
                    p.bars.iter().map(|x| num(*x)).collect::<Vec<_>>().join(","),
                    p.notes
                        .iter()
                        .map(|n| format!("[{},{},\"{}\",{},\"{}\",{}]", num(n.t), num(n.dur), n.hand, n.accent, n.kind, n.pad))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            })
            .collect::<Vec<_>>()
            .join(","),
    );
    o.push_str("]}");
    o
}

pub fn dots_text(s: &Show, r: &Report, who: Option<&str>) -> String {
    let mut o = String::new();
    for (i, p) in s.performers.iter().enumerate() {
        if let Some(w) = who {
            if p.id != w && s.sections[p.section].id != w {
                continue;
            }
        }
        let _ = writeln!(o, "■ {}（{}） — {}", p.id, s.sections[p.section].label, s.name);
        let _ = writeln!(o, "  {:<6} {:>6}  {:<32} {:<32} {:<18} {}", "セット", "カウント", "左右", "前後", "向き", "歩幅");
        for (k, d) in r.dots[i].iter().enumerate() {
            let set = &s.sets[k];
            let _ = writeln!(
                o,
                "  {:<6} {:>6}  {:<32} {:<32} {:<18} {}",
                set.name,
                if k == 0 { "—".to_string() } else { num(set.counts) },
                d.h,
                d.v,
                d.face,
                d.step
            );
        }
        o.push('\n');
    }
    o
}

/// 最大歩幅の制限内に収めるのに必要な最小カウント数
pub fn min_counts(s: &Show, r: &Report, k: usize) -> Option<f64> {
    if k == 0 {
        return None;
    }
    let per = if s.field.is_football() { 8.0 / s.maxstep } else { s.maxstep };
    // 待機時間ぶんも足して、全員が制限内に収まるカウント数
    let need = r
        .dots
        .iter()
        .enumerate()
        .map(|(i, d)| if d[k].moved > 1e-9 { s.sets[k].wait[i] + d[k].moved / per } else { 0.0 })
        .fold(0.0, f64::max);
    Some((need - 1e-9).ceil())
}

pub fn check_text(s: &Show, r: &Report) -> String {
    let mut o = format!(
        "■ {}  （{}人, {}セット, 全{}カウント, テンポ{}）\n",
        s.name,
        s.performers.len(),
        s.sets.len(),
        num(r.total_counts),
        num(s.tempo)
    );
    for (k, set) in s.sets.iter().enumerate() {
        let nw = r.warnings.iter().filter(|w| w.set == k).count();
        let need = min_counts(s, r, k);
        let _ = writeln!(
            o,
            "  セット{:<5} {:>4}カウント{}  最大歩幅 {:<12} {}{}",
            set.name,
            num(set.counts),
            format!(
                "{}{}{}",
                if set.hold > 0.0 { format!("+ホールド{}", num(set.hold)) } else { String::new() },
                if set.mark && set.hold > 0.0 { "(MT)" } else { "" },
                if k == 0 || (set.tempo - s.sets[k - 1].tempo).abs() > 1e-9 { format!(" ♩={}", num(set.tempo)) } else { String::new() }
            ),
            if k == 0 { "—".into() } else { s.field.describe_step(r.max_per_count[k]) },
            if nw == 0 { "✓".to_string() } else { format!("⚠ {}件", nw) },
            match need {
                Some(c) if c > set.counts => format!("  → 歩幅を収めるには最低 {} カウント", num(c)),
                _ => String::new(),
            }
        );
    }
    if !r.warnings.is_empty() {
        o.push_str("\n  警告:\n");
        for w in &r.warnings {
            let _ = writeln!(o, "  [{}] {}", w.kind, w.msg);
        }
    }
    o
}

const THREE_JS: &str = include_str!("../vendor/three.min.js");
const VIEW3D_JS: &str = include_str!("view3d.js");
/// 手続き生成の人体モデル（tools/gen_human.js が作る。形式は tools/README.md）
pub const HUMAN_BIN: &[u8] = include_bytes!("../assets/human.bin");
pub const FIELD2D_JS: &str = include_str!("field2d.js");
/// 動きの計算 + 楽譜（Bravura・staff.js）+ 音（audio.js）+ MusicXML 取り込み。プレビューとエディタに埋め込む
pub const MOTION_JS: &str = concat!(
    include_str!("motion.js"),
    "\n",
    include_str!("strike.js"),
    "\n",
    include_str!("bravura.js"),
    "\n",
    include_str!("staff.js"),
    "\n",
    include_str!("reel.js"),
    "\n",
    include_str!("audio.js"),
    "\n",
    include_str!("musicxml.js")
);

/// 標準の Base64（パディングあり）。外部クレートを使わないための小さな実装
pub fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        o.push(T[(n >> 18) as usize & 63] as char);
        o.push(T[(n >> 12) as usize & 63] as char);
        o.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        o.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    o
}

pub fn html(s: &Show, r: &Report) -> String {
    preview_template()
        .replace("__JK_TITLE__", &s.name.replace('<', "&lt;"))
        .replace("__JK_DATA__", &json(s, r).replace("</", "<\\/"))
}

/// プレビューHTMLのひな形（three.js・3D・動き・2Dは埋め込み済み）。
/// データは `__JK_DATA__`、題名は `__JK_TITLE__` のまま残す（ブラウザ版が実行時に埋める）。
pub fn preview_template() -> String {
    TEMPLATE
        .replace("__THREE__", THREE_JS)
        .replace("__VIEW3D__", VIEW3D_JS)
        .replace("__HUMAN__", &base64(HUMAN_BIN))
        .replace("__FIELD2D__", FIELD2D_JS)
        .replace("__MOTION__", MOTION_JS)
        .replace("__TITLE__", "__JK_TITLE__")
        .replace("__DATA__", "__JK_DATA__")
}

const TEMPLATE: &str = r##"<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__ — 陣形</title>
<style>
:root{--bg:#14161a;--panel:#1d2026;--line:#2c3038;--fg:#e8e9ec;--mut:#9aa0aa;--acc:#ffd23f;--bad:#ff6b6b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif}
header{display:flex;align-items:baseline;gap:16px;padding:12px 18px;border-bottom:1px solid var(--line)}
header h1{font-size:18px;margin:0}
header .meta{color:var(--mut);font-size:12px}
main{display:grid;grid-template-columns:1fr 440px;grid-template-rows:100%;height:calc(100vh - 50px)}
#stage{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
#svgwrap{flex:1;min-height:0;position:relative}
#svg{position:absolute;inset:8px;width:calc(100% - 16px);height:calc(100% - 16px)}
#glwrap{flex:1;min-height:0;position:relative;display:none}
#glwrap canvas{display:block;position:absolute;inset:0;cursor:grab}
#mode3d{background:#2b3a55;border-color:#4a6390}
.bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap}
button,select{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}
button:hover{border-color:var(--mut)}
#slider{flex:1;min-width:160px;accent-color:var(--acc)}
#now{font-variant-numeric:tabular-nums;min-width:250px}
#now b{color:var(--acc)}
label{color:var(--mut);font-size:12px;display:flex;align-items:center;gap:4px}
aside{border-left:1px solid var(--line);overflow:auto;background:var(--panel)}
aside section{padding:12px 14px;border-bottom:1px solid var(--line)}
aside h2{font-size:12px;color:var(--mut);margin:0 0 8px;font-weight:600;letter-spacing:.04em}
table{border-collapse:collapse;width:100%;font-size:12px}
td,th{padding:4px 5px;white-space:normal;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:500;white-space:nowrap}
tr.cur td{background:#2a2e36}
.sets td:first-child{font-weight:600}
.sets tr{cursor:pointer}
.warn{font-size:12px;padding:5px 7px;border-radius:5px;margin-bottom:4px;background:#2a1f22;cursor:pointer;border-left:3px solid var(--bad)}
.warn:hover{background:#3a2629}
.warn .k{color:var(--bad);font-weight:700;margin-right:4px}
.ok{color:#6fdc8c;font-size:12px}
.legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
#print{display:none}
@media (max-width:850px){
  header{padding:8px 12px;flex-wrap:wrap;gap:4px 12px}
  main{display:flex;flex-direction:column;height:auto;min-height:calc(100dvh - 46px)}
  #stage{height:calc(100dvh - 46px);min-height:560px;max-height:1000px}
  #svgwrap,#glwrap{min-height:0;flex:1}
  .bar{gap:5px;padding:7px 9px}
  .bar button,.bar select{padding:5px 7px;font-size:12px}
  #slider{min-width:80px}
  #now{min-width:0;font-size:11px}
  #reelcontrols{font-size:11px}
  aside{border-left:none;border-top:1px solid var(--line);overflow:visible}
}
@media print{
  body{background:#fff;color:#000}
  header,main{display:none}
  #print{display:block}
  .sheet{page-break-after:always;padding:8mm}
  .sheet table{font-size:10pt}
  .sheet td,.sheet th{border-bottom:1px solid #bbb;color:#000}
  .sheet h3{margin:0 0 4mm;font-size:14pt}
}
</style></head><body>
<header><h1 id="title"></h1><span class="meta" id="meta"></span></header>
<main>
  <div id="stage">
    <div id="svgwrap"><svg id="svg"></svg></div>
    <div id="glwrap"></div>
    <div class="bar">
      <button id="prev" title="前のセット">⏮</button>
      <button id="play">▶ 再生</button>
      <button id="next" title="次のセット">⏭</button>
      <input type="range" id="slider" min="0" step="0.01">
      <span id="now"></span>
      <select id="speed"><option value="0.5">×0.5</option><option value="1" selected>×1</option><option value="2">×2</option></select>
      <label id="sndl" style="display:none" title="パート（楽譜）の音"><input type="checkbox" id="snd" checked> 音</label>
      <label class="only2d"><input type="checkbox" id="labels"> 名前</label>
      <label class="only2d"><input type="checkbox" id="trails" checked> 移動線</label>
      <select id="cam3d" class="only3d" style="display:none" title="カメラ（ドラッグで回転・ホイールで拡大）"><option value="audience">客席から</option><option value="top">真上</option><option value="orbit">回り込み</option><option value="low">目線の高さ</option><option value="free">自由</option></select>
      <select id="look3d" class="only3d" style="display:none" title="見た目（ショーの look 指定の一時切り替え）"><option value="real">見た目: リアル</option><option value="illust">見た目: イラスト</option></select>
      <select id="layout3d" class="only3d" style="display:none" title="画面のレイアウト（縦分割 = 斜め俯瞰 / 楽譜 / 客席側 / 真上グリッドの縦長 9:16。「動画を保存」もこの形で録画）"><option value="single">レイアウト: 単一</option><option value="reel">レイアウト: 縦分割</option></select>
      <label id="reelcontrols" class="only3d" style="display:none;align-items:center;gap:6px;flex-wrap:wrap" title="縦分割の画角・俯瞰図を調整（ブラウザの録画にも反映）">
        3D拡大 <input id="reelzoom" type="range" min="0.75" max="1.5" value="1" step="0.05" style="width:92px;accent-color:var(--acc)"><output id="reelzoomvalue" for="reelzoom">100%</output>
        俯瞰 <select id="reelgridmode"><option value="all">全体固定</option><option value="follow">隊形に追従</option></select>
        ピン <select id="reelpin"><option value="1">標準</option><option value="1.25" selected>大きめ</option><option value="1.5">特大</option></select>
      </label>
      <button id="rec" class="only3d" style="display:none">● 動画を保存</button>
      <button id="mode3d">3D で見る</button>
    </div>
  </div>
  <aside>
    <section><h2>セクション</h2><div class="legend" id="legend"></div></section>
    <section id="scoresec" style="display:none"><h2>楽譜</h2><select id="partsel" style="width:100%;margin-bottom:6px"></select><div id="staff" style="overflow:hidden"></div></section>
    <section><h2>ドットシート</h2>
      <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center"><select id="who" style="flex:1;min-width:0"></select><button id="printall" style="flex:none;white-space:nowrap">全員分を印刷</button></div>
      <div id="sheet"></div></section>
    <section><h2>セット</h2><table class="sets" id="sets"></table></section>
    <section><h2>チェック</h2><div id="warns"></div></section>
  </aside>
</main>
<div id="print"></div>
<script id="data" type="application/json">__DATA__</script>
<script>__FIELD2D__</script>
<script>__MOTION__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const F = D.field, FB = F.type === 'football';
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('svg');
const $ = id => document.getElementById(id);
const FLD = jkField(svg, F);
const Y = FLD.Y, el = FLD.el, text = FLD.text;
// ---- 演者 ----
const R = FB ? 0.95 : 0.34, FS = FB ? 1.5 : 0.45;
const trailG = el('g', {});
const pathG = el('g', {});
const dotG = el('g', {});
const dots = D.performers.map((p, i) => {
  const g = el('g', {style: 'cursor:pointer'}, dotG);
  const c = el('circle', {r: R, fill: D.sections[p.sec].color, stroke: '#000', 'stroke-width': FB ? 0.18 : 0.05}, g);
  const f = el('line', {stroke: '#000', 'stroke-width': R * 0.32, 'stroke-linecap': 'round', opacity: 0.75}, g);
  const t = el('text', {'font-size': FS, 'text-anchor': 'middle', fill: '#fff', stroke: '#000', 'stroke-width': FB ? 0.25 : 0.07, 'paint-order': 'stroke', display: 'none'}, g);
  t.textContent = p.id;
  g.addEventListener('click', () => select(i));
  return {g, c, t, f};
});

let t = 0, playing = false, sel = -1, flagged = [];
const total = D.total;
$('slider').max = total;

function setAt(tt) { return jkSetAt(D, tt); }
function posAt(i, tt) { return jkState(D, i, tt).p; }

function draw() {
  const k = setAt(t), s = D.sets[k];
  for (let i = 0; i < dots.length; i++) {
    const st = jkState(D, i, t), [x, y] = st.p, fa = jkFacing(st) * Math.PI / 180;
    dots[i].c.setAttribute('cx', x); dots[i].c.setAttribute('cy', Y(y));
    dots[i].f.setAttribute('x1', x); dots[i].f.setAttribute('y1', Y(y)); dots[i].f.setAttribute('x2', x + Math.cos(fa) * R * 1.05); dots[i].f.setAttribute('y2', Y(y + Math.sin(fa) * R * 1.05));
    dots[i].t.setAttribute('x', x); dots[i].t.setAttribute('y', Y(y) - R - FS * 0.4);
    const hl = i === sel || flagged.includes(i);
    dots[i].c.setAttribute('stroke', hl ? (flagged.includes(i) ? '#ff6b6b' : '#ffd23f') : '#000');
    dots[i].c.setAttribute('stroke-width', hl ? (FB ? 0.5 : 0.12) : (FB ? 0.18 : 0.05));
  }
  // 移動線（現在の移動の始点→終点）
  trailG.innerHTML = '';
  if ($('trails').checked && k > 0 && s.counts > 0) {
    const a = D.sets[k-1].pos, b = s.pos;
    for (let i = 0; i < a.length; i++) {
      const rt = s.route && s.route[i];
      if (!rt && a[i][0] === b[i][0] && a[i][1] === b[i][1]) continue;
      const bd = s.bend ? s.bend[i] : 0, pts = [];
      if (rt) rt.forEach(q => pts.push(`${q[0]},${Y(q[1])}`));
      else for (let j = 0; j <= (bd ? 16 : 1); j++) { const q = jkArc(a[i], b[i], bd, j / (bd ? 16 : 1)); pts.push(`${q[0]},${Y(q[1])}`); }
      el('polyline', {points: pts.join(' '), fill: 'none', stroke: D.sections[D.performers[i].sec].color, 'stroke-width': FB ? 0.15 : 0.04, opacity: 0.45}, trailG);
    }
  }
  const into = t - s.start;
  let phase;
  if (k === 0) phase = s.hold > 0 ? `ホールド ${Math.min(s.hold, Math.floor(t) + 1)}/${s.hold}` : '開始位置';
  else if (into < s.counts - 1e-9) phase = `移動 ${Math.min(s.counts, Math.floor(into) + 1)}/${s.counts}`;
  else phase = s.hold > 0 ? `ホールド ${Math.min(s.hold, Math.floor(into - s.counts) + 1)}/${s.hold}` : '到着';
  $('now').innerHTML = `セット <b>${s.name}</b>　${phase}${s.mark && /ホールド/.test(phase) ? '（マークタイム）' : ''}　<span style="color:#9aa0aa">通算 ${Math.floor(t)} / ${total}・♩=${s.tempo}</span>`;
  $('slider').value = t;
  document.querySelectorAll('#sets tr').forEach((tr, j) => tr.classList.toggle('cur', j - 1 === k));
  document.querySelectorAll('#sheet tr').forEach((tr, j) => tr.classList.toggle('cur', j - 1 === k));
  if (window.updateStaff) window.updateStaff();
  if (window.onDraw) window.onDraw();
}

let last = null;
function loop(ts) {
  if (!playing) { last = null; return; }
  if (last !== null) t = Math.min(total, t + (ts - last) / 1000 * jkTempoAt(D, t) / 60 * +$('speed').value);
  last = ts;
  draw();
  if (t >= total) { playing = false; $('play').textContent = '▶ 再生'; window.dispatchEvent(new Event('jinkei-end')); return; }
  requestAnimationFrame(loop);
}
$('play').onclick = () => { if (t >= total) t = 0; playing = !playing; $('play').textContent = playing ? '⏸ 停止' : '▶ 再生'; if (playing) requestAnimationFrame(loop); audioSync(); };
$('slider').oninput = e => { t = +e.target.value; draw(); audioSync(); };
const arrive = k => D.sets[k].start + D.sets[k].counts;
$('next').onclick = () => { for (let k = 0; k < D.sets.length; k++) if (arrive(k) > t + 1e-6) { t = arrive(k); break; } draw(); audioSync(); };
$('prev').onclick = () => { for (let k = D.sets.length - 1; k >= 0; k--) if (arrive(k) < t - 1e-6) { t = arrive(k); draw(); audioSync(); return; } t = 0; draw(); audioSync(); };
$('labels').onchange = e => dots.forEach(d => d.t.setAttribute('display', e.target.checked ? 'inline' : 'none'));
$('trails').onchange = draw;
document.addEventListener('keydown', e => { if (e.target.tagName === 'SELECT') return; if (e.code === 'Space') { e.preventDefault(); $('play').click(); } if (e.code === 'ArrowRight') $('next').click(); if (e.code === 'ArrowLeft') $('prev').click(); });

// ---- 楽譜と音（パートがあるときだけ） ----
// 描画側（3D など）から使う入口: window.jkAudioSync() = 今の再生状態に合わせて音を鳴らし直す/止める
const hasParts = !!(D.parts && D.parts.some(p => p.notes.length));
function audioSync() {
  if (!hasParts) return;
  if (playing && $('snd').checked) jkAudio.play(D, t, +$('speed').value); else jkAudio.stop();
}
window.jkAudioSync = audioSync;
if (hasParts) {
  $('sndl').style.display = ''; $('scoresec').style.display = '';
  $('snd').onchange = audioSync;
  $('speed').addEventListener('change', audioSync);
  $('partsel').innerHTML = D.parts.map((p, i) => `<option value="${i}">${p.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}（${p.members.length}人）</option>`).join('');
  $('partsel').value = D.parts.reduce((b, p, i) => p.members.length > D.parts[b].members.length ? i : b, 0);   // 人数が最も多いパートを初期表示（縦分割レイアウトの楽譜にも使う）
  $('partsel').onchange = () => draw();
  window.updateStaff = () => {
    const p = D.parts[+$('partsel').value || 0], w = $('staff').clientWidth || 400;
    $('staff').innerHTML = jkStaff(p, t - 1.5, t + 4.5, w, 96, t);
  };
}
window.addEventListener('jinkei-end', () => jkAudio.stop());

// ---- サイドパネル ----
$('title').textContent = D.name;
$('meta').textContent = `${D.performers.length}人 ・ ${D.sets.length}セット ・ ${total}カウント ・ ♩=${D.tempo} ・ ${({football: 'フットボールフィールド（' + F.level + '）', gym: '体育館 演技フロア ' + F.w + '×' + F.d + 'm', stage: 'ステージ 間口' + F.w + 'm×奥行' + F.d + 'm・袖' + F.wing + 'm', floor: 'フロア ' + F.w + '×' + F.d + 'm'})[F.type]}`;
$('legend').innerHTML = D.sections.map(s => `<span><i style="background:${s.color}"></i>${s.label}（${D.performers.filter(p => D.sections[p.sec].id === s.id).length}）</span>`).join('');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
$('sets').innerHTML = '<tr><th>セット</th><th>カウント</th><th>最大歩幅</th><th></th></tr>' + D.sets.map((s, k) => {
  const n = D.warnings.filter(w => w.set === k).length;
  return `<tr data-k="${k}"><td>${esc(s.name)}</td><td>${k ? s.counts : '—'}${s.hold ? ' +' + s.hold : ''}</td><td>${esc(s.max_step)}${s.min_counts && s.min_counts > s.counts ? '<br><span style="color:#ff6b6b;font-size:11px">最低' + s.min_counts + 'カウント必要</span>' : ''}</td><td>${n ? '<span style="color:#ff6b6b">⚠' + n + '</span>' : ''}</td></tr>`;
}).join('');
document.querySelectorAll('#sets tr[data-k]').forEach(tr => tr.onclick = () => { t = arrive(+tr.dataset.k); flagged = []; draw(); audioSync(); });
$('warns').innerHTML = D.warnings.length ? D.warnings.map((w, j) => `<div class="warn" data-j="${j}"><span class="k">${w.kind}</span>${esc(w.msg)}</div>`).join('') : '<div class="ok">✓ 大股・衝突・場外はありません</div>';
document.querySelectorAll('.warn').forEach(d => d.onclick = () => { const w = D.warnings[+d.dataset.j]; t = w.at; flagged = w.who; playing = false; $('play').textContent = '▶ 再生'; draw(); audioSync(); });

$('who').innerHTML = '<option value="-1">メンバーを選択（ドットをクリックでも可）</option>' + D.performers.map((p, i) => `<option value="${i}">${p.id}（${D.sections[p.sec].label}）</option>`).join('');
$('who').onchange = e => select(+e.target.value);
function sheetTable(i) {
  return '<table><tr><th>セット</th><th>カウント</th><th>左右</th><th>前後</th><th>向き</th><th>歩幅</th></tr>' + D.dots[i].map((d, k) => `<tr><td>${esc(D.sets[k].name)}</td><td>${k ? D.sets[k].counts : '—'}</td><td>${esc(d.h)}</td><td>${esc(d.v)}</td><td>${esc(d.face)}</td><td>${esc(d.step)}</td></tr>`).join('') + '</table>';
}
function select(i) {
  sel = i; $('who').value = i; flagged = [];
  pathG.innerHTML = '';
  if (i >= 0) {
    $('sheet').innerHTML = sheetTable(i);
    const pts = D.sets.map(s => s.pos[i]);
    el('polyline', {points: pts.map(p => `${p[0]},${Y(p[1])}`).join(' '), fill: 'none', stroke: '#ffd23f', 'stroke-width': FB ? 0.3 : 0.08, 'stroke-dasharray': FB ? '1 0.6' : '0.25 0.15'}, pathG);
    pts.forEach((p, k) => text(p[0], p[1] + R * 1.7, D.sets[k].name, FS * 0.85, {fill: '#ffd23f', stroke: '#000', 'stroke-width': FB ? 0.2 : 0.05, 'paint-order': 'stroke'}, pathG));
  } else $('sheet').innerHTML = '';
  draw();
}
$('printall').onclick = () => {
  $('print').innerHTML = D.performers.map((p, i) => `<div class="sheet"><h3>${esc(p.id)}（${esc(D.sections[p.sec].label)}） — ${esc(D.name)}</h3>${sheetTable(i)}</div>`).join('');
  window.print();
};
// URL の #t=40&p=tp1 で時刻・メンバーを指定して開ける
(() => {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('t')) t = Math.min(total, +h.get('t') || 0);
  if (h.has('labels')) { $('labels').checked = true; $('labels').onchange({target: $('labels')}); }
  const pi = D.performers.findIndex(p => p.id === h.get('p'));
  if (pi >= 0) select(pi);
})();
draw();
</script>
<script>__THREE__</script>
<script>window.JK_HUMAN="__HUMAN__";</script>
<script>__VIEW3D__</script>
</body></html>
"##;
