//! 縦長リール動画（レイアウト `reel`）: 上から「斜め俯瞰の3D」「パート名と1線の楽譜」「客席側の3D」「真上のグリッド」の4段。
//! 3D は render.rs のレンダラを2台のカメラ（Diag と Low）で回し、楽譜とグリッドはここで自前のベクタ描画（外部ライブラリなし）。
//! 楽譜の配置は src/staff.js（jkStaff）と同じ式。音符・休符・記号は Bravura の形に近いベクタで描く。
use crate::build::{Part, Show};
use crate::field::{FieldKind, BSL};
use crate::render::{counts_at, face_deg, member_color, state_at, CamMode, RenderOpts};

pub type Col = [u8; 3];

// ================= キャンバス（RGB・アンチエイリアス付きの図形） =================

pub struct Canvas {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Canvas {
    pub fn new(w: usize, h: usize, c: Col) -> Canvas {
        let mut px = vec![0u8; w * h * 3];
        for p in px.chunks_exact_mut(3) {
            p.copy_from_slice(&c);
        }
        Canvas { w, h, px }
    }

    #[inline]
    fn blend(&mut self, x: i32, y: i32, c: Col, a: f32) {
        if a <= 0.0 || x < 0 || y < 0 || x >= self.w as i32 || y >= self.h as i32 {
            return;
        }
        let i = (y as usize * self.w + x as usize) * 3;
        let a = a.min(1.0);
        for k in 0..3 {
            self.px[i + k] = (self.px[i + k] as f32 * (1.0 - a) + c[k] as f32 * a + 0.5) as u8;
        }
    }

    /// 画素を (x0..x1, y0..y1) に配置（はみ出しは切る）
    pub fn blit(&mut self, x0: usize, y0: usize, src: &[u8], sw: usize, sh: usize) {
        for y in 0..sh {
            if y0 + y >= self.h {
                break;
            }
            let n = sw.min(self.w.saturating_sub(x0));
            let d = ((y0 + y) * self.w + x0) * 3;
            self.px[d..d + n * 3].copy_from_slice(&src[y * sw * 3..y * sw * 3 + n * 3]);
        }
    }

    /// 矩形（端は小数座標でなめらかに）
    pub fn rect(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, c: Col, alpha: f32) {
        let (xa, xb, ya, yb) = (x0.min(x1), x0.max(x1), y0.min(y1), y0.max(y1));
        for y in ya.floor() as i32..=yb.ceil() as i32 {
            let cy = ((y as f32 + 1.0).min(yb) - (y as f32).max(ya)).clamp(0.0, 1.0);
            if cy <= 0.0 {
                continue;
            }
            for x in xa.floor() as i32..=xb.ceil() as i32 {
                let cx = ((x as f32 + 1.0).min(xb) - (x as f32).max(xa)).clamp(0.0, 1.0);
                self.blend(x, y, c, cx * cy * alpha);
            }
        }
    }

    /// 丸い端の太い線
    pub fn line(&mut self, x0: f32, y0: f32, x1: f32, y1: f32, wd: f32, c: Col, alpha: f32) {
        let r = wd / 2.0;
        let (dx, dy) = (x1 - x0, y1 - y0);
        let l2 = dx * dx + dy * dy;
        for y in (y0.min(y1) - r - 1.0).floor() as i32..=(y0.max(y1) + r + 1.0).ceil() as i32 {
            for x in (x0.min(x1) - r - 1.0).floor() as i32..=(x0.max(x1) + r + 1.0).ceil() as i32 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let t = if l2 > 1e-9 { (((px - x0) * dx + (py - y0) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                let d = ((px - x0 - dx * t).powi(2) + (py - y0 - dy * t).powi(2)).sqrt();
                self.blend(x, y, c, (r + 0.5 - d).clamp(0.0, 1.0) * alpha);
            }
        }
    }

    pub fn poly(&mut self, pts: &[(f32, f32)], wd: f32, c: Col) {
        for w in pts.windows(2) {
            self.line(w[0].0, w[0].1, w[1].0, w[1].1, wd, c, 1.0);
        }
    }

    pub fn circle(&mut self, cx: f32, cy: f32, r: f32, c: Col) {
        self.ellipse(cx, cy, r, r, 0.0, c);
    }

    pub fn ring(&mut self, cx: f32, cy: f32, r: f32, wd: f32, c: Col) {
        for y in (cy - r - wd).floor() as i32..=(cy + r + wd).ceil() as i32 {
            for x in (cx - r - wd).floor() as i32..=(cx + r + wd).ceil() as i32 {
                let d = (((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt() - r).abs();
                self.blend(x, y, c, (wd / 2.0 + 0.5 - d).clamp(0.0, 1.0));
            }
        }
    }

    /// 塗りつぶし楕円。rot はラジアン（正 = 画面で時計回り）
    pub fn ellipse(&mut self, cx: f32, cy: f32, rx: f32, ry: f32, rot: f32, c: Col) {
        let r = rx.max(ry) + 1.0;
        let (sn, cs) = rot.sin_cos();
        for y in (cy - r).floor() as i32..=(cy + r).ceil() as i32 {
            for x in (cx - r).floor() as i32..=(cx + r).ceil() as i32 {
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                let (u, v) = (cs * dx + sn * dy, -sn * dx + cs * dy);
                let n2 = (u / rx).powi(2) + (v / ry).powi(2);
                let g = ((u / (rx * rx)).powi(2) + (v / (ry * ry)).powi(2)).sqrt().max(1e-6);
                // 1次近似の符号つき距離（画素）
                let d = (n2 - 1.0) / (2.0 * g);
                self.blend(x, y, c, (0.5 - d).clamp(0.0, 1.0));
            }
        }
    }

    /// 塗りつぶし三角形
    pub fn tri(&mut self, p: [(f32, f32); 3], c: Col) {
        let area = (p[1].0 - p[0].0) * (p[2].1 - p[0].1) - (p[1].1 - p[0].1) * (p[2].0 - p[0].0);
        let sg = if area >= 0.0 { 1.0 } else { -1.0 };
        let xs = p.iter().map(|q| q.0);
        let ys = p.iter().map(|q| q.1);
        let (x0, x1) = (xs.clone().fold(f32::MAX, f32::min), xs.fold(f32::MIN, f32::max));
        let (y0, y1) = (ys.clone().fold(f32::MAX, f32::min), ys.fold(f32::MIN, f32::max));
        for y in y0.floor() as i32 - 1..=y1.ceil() as i32 + 1 {
            for x in x0.floor() as i32 - 1..=x1.ceil() as i32 + 1 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let mut m = f32::MAX;
                for k in 0..3 {
                    let (a, b) = (p[k], p[(k + 1) % 3]);
                    let (ex, ey) = (b.0 - a.0, b.1 - a.1);
                    let l = (ex * ex + ey * ey).sqrt().max(1e-6);
                    m = m.min(sg * (ex * (py - a.1) - ey * (px - a.0)) / l);
                }
                self.blend(x, y, c, (m + 0.5).clamp(0.0, 1.0));
            }
        }
    }

    /// ストローク文字（数字と R L B r l b）。cy は文字の縦の中心、h は高さ、wd は線の太さ。anchor: 0 = 中央
    pub fn text(&mut self, s: &str, cx: f32, cy: f32, h: f32, wd: f32, c: Col) {
        let adv = h * 0.78;
        let total = adv * s.chars().count() as f32 - (adv - h * 0.6);
        let mut x = cx - total / 2.0;
        for ch in s.chars() {
            for st in glyph(ch) {
                let pts: Vec<(f32, f32)> = st.iter().map(|&(u, v)| (x + u * h, cy - h / 2.0 + v * h)).collect();
                if pts.len() == 1 {
                    self.circle(pts[0].0, pts[0].1, wd / 2.0, c);
                } else {
                    self.poly(&pts, wd, c);
                }
            }
            x += adv;
        }
    }
}

/// 楕円弧の点列（角度は度。画面座標: 0° = 右、90° = 下、270° = 上）
fn arc(cx: f32, cy: f32, rx: f32, ry: f32, a0: f32, a1: f32) -> Vec<(f32, f32)> {
    let n = ((a1 - a0).abs() / 12.0).ceil().max(2.0) as usize;
    (0..=n)
        .map(|i| {
            let a = (a0 + (a1 - a0) * i as f32 / n as f32).to_radians();
            (cx + rx * a.cos(), cy + ry * a.sin())
        })
        .collect()
}

/// 文字の骨格（幅 0.6 × 高さ 1 の箱、y は下向き）
fn glyph(c: char) -> Vec<Vec<(f32, f32)>> {
    let cat = |mut a: Vec<(f32, f32)>, b: Vec<(f32, f32)>| {
        a.extend(b);
        a
    };
    match c {
        '0' => vec![arc(0.3, 0.5, 0.27, 0.5, 0.0, 360.0)],
        '1' => vec![vec![(0.08, 0.2), (0.33, 0.0), (0.33, 1.0)]],
        '2' => vec![cat(arc(0.3, 0.27, 0.27, 0.27, 180.0, 395.0), vec![(0.03, 1.0), (0.57, 1.0)])],
        '3' => vec![cat(arc(0.3, 0.25, 0.26, 0.25, 205.0, 450.0), arc(0.3, 0.75, 0.29, 0.25, 270.0, 515.0))],
        '4' => vec![vec![(0.45, 1.0), (0.45, 0.0), (0.0, 0.68), (0.6, 0.68)]],
        '5' => vec![cat(vec![(0.55, 0.0), (0.1, 0.0), (0.06, 0.45)], arc(0.3, 0.7, 0.28, 0.3, 235.0, 515.0))],
        '6' => vec![vec![(0.5, 0.0), (0.2, 0.18), (0.04, 0.5), (0.03, 0.7)], arc(0.3, 0.7, 0.27, 0.3, 0.0, 360.0)],
        '7' => vec![vec![(0.02, 0.0), (0.58, 0.0), (0.2, 1.0)]],
        '8' => vec![arc(0.3, 0.26, 0.24, 0.26, 0.0, 360.0), arc(0.3, 0.74, 0.28, 0.27, 0.0, 360.0)],
        '9' => vec![vec![(0.1, 1.0), (0.4, 0.82), (0.56, 0.5), (0.57, 0.3)], arc(0.3, 0.3, 0.27, 0.3, 0.0, 360.0)],
        'R' => vec![cat(vec![(0.05, 1.0), (0.05, 0.0), (0.3, 0.0)], cat(arc(0.3, 0.26, 0.26, 0.26, 270.0, 450.0), vec![(0.05, 0.52)])), vec![(0.27, 0.52), (0.58, 1.0)]],
        'L' => vec![vec![(0.05, 0.0), (0.05, 1.0), (0.55, 1.0)]],
        'B' => vec![
            cat(vec![(0.05, 1.0), (0.05, 0.0), (0.28, 0.0)], cat(arc(0.28, 0.25, 0.27, 0.25, 270.0, 450.0), vec![(0.05, 0.5)])),
            cat(vec![(0.05, 0.5), (0.3, 0.5)], cat(arc(0.3, 0.75, 0.3, 0.25, 270.0, 450.0), vec![(0.05, 1.0)])),
        ],
        'r' => vec![vec![(0.1, 0.3), (0.1, 1.0)], cat(vec![(0.1, 0.6)], arc(0.32, 0.55, 0.22, 0.25, 180.0, 275.0))],
        'l' => vec![vec![(0.3, 0.0), (0.3, 1.0)]],
        'b' => vec![vec![(0.08, 0.0), (0.08, 1.0)], arc(0.32, 0.68, 0.24, 0.31, 0.0, 360.0)],
        _ => vec![],
    }
}

// ================= 楽譜 =================

#[derive(Clone, Copy)]
pub struct Pal {
    pub fg: Col,
    pub mu: Col,
    pub hi: Col,
    pub bg: Col,
}

const EPS: f64 = 3e-3;

fn is_pow2(x: f64) -> bool {
    x > 0.0 && (x / 2f64.powf(x.log2().round()) - 1.0).abs() < 0.006
}
fn is_trip(d: f64) -> bool {
    d > 0.01 && !is_pow2(d) && is_pow2(d * 3.0)
}
fn flags_of(d: f64) -> u8 {
    if d >= 1.0 - EPS {
        0
    } else if d > 0.25 + EPS {
        1
    } else if d > 0.125 + EPS {
        2
    } else {
        3
    }
}
fn dotted(d: f64) -> bool {
    [0.75, 1.5, 3.0, 0.375, 6.0].iter().any(|x| (d - x).abs() < 1e-6)
}

#[derive(Clone, Copy, PartialEq)]
enum Rest {
    Whole,
    Half,
    Quarter,
    Eighth,
    Sixteenth,
    ThirtySecond,
}

const RESTS: [(f64, Rest); 9] = [
    (4.0, Rest::Whole),
    (2.0, Rest::Half),
    (1.0, Rest::Quarter),
    (2.0 / 3.0, Rest::Quarter),
    (0.5, Rest::Eighth),
    (1.0 / 3.0, Rest::Eighth),
    (0.25, Rest::Sixteenth),
    (1.0 / 6.0, Rest::Sixteenth),
    (0.125, Rest::ThirtySecond),
];

struct Item {
    t: f64,
    d: f64,
    hand: char,
    acc: u8,
    kind: &'static str,
    pad: u8,
    x: f32,
    f: u8,
    stem: bool,
    gid: i64,
}

/// 譜面に出すページ（2 小節ぶん）: (from, to)。再生位置の小節を含むページ
pub fn staff_page(part: &Part, t: f64) -> (f64, f64) {
    let bl = part.meter.0.max(1) as f64;
    if part.bars.is_empty() {
        let a = (part.start + ((t - part.start).max(0.0) / (2.0 * bl)).floor() * 2.0 * bl).max(part.start);
        return (a, a + 2.0 * bl);
    }
    let mut bi = 0;
    for (i, b) in part.bars.iter().enumerate() {
        if *b <= t + 1e-6 {
            bi = i;
        }
    }
    let pi = bi / 2 * 2;
    let from = part.bars[pi];
    let to = if pi + 2 < part.bars.len() { part.bars[pi + 2] } else { from + 2.0 * bl };
    (from, to)
}

/// 1線の打楽器譜を (ox, oy) から w×h に描く。staff.js の jkStaff と同じ配置
#[allow(clippy::too_many_arguments)]
pub fn draw_staff(c: &mut Canvas, ox: f32, oy: f32, w: f32, h: f32, part: &Part, from: f64, to: f64, ph: Option<f64>, pal: &Pal) {
    let sp = h / 11.0;
    let line_y = 7.0 * sp;
    let (fg, mu, hi) = (pal.fg, pal.mu, pal.hi);
    let meter = part.meter;
    let mlen = meter.0.to_string().len().max(meter.1.to_string().len()) as f32;
    let x0 = sp * (2.6 + 1.9 * mlen + 2.2);
    let x1 = w - sp * 1.2;
    let xf = |t: f64| x0 + ((t - from) / (to - from)) as f32 * (x1 - x0);
    let lw = sp * 0.13;
    // 座標は (ox, oy) からの相対
    let vline = |c: &mut Canvas, x: f32, ya: f32, yb: f32, wd: f32, col: Col| c.rect(ox + x - wd / 2.0, oy + ya, ox + x + wd / 2.0, oy + yb, col, 1.0);
    let seg = |c: &mut Canvas, xa: f32, ya: f32, xb: f32, yb: f32, wd: f32, col: Col| c.line(ox + xa, oy + ya, ox + xb, oy + yb, wd, col, 1.0);
    let head = |c: &mut Canvas, x: f32, y: f32, k: f32, col: Col| c.ellipse(ox + x, oy + y, 0.64 * sp * k, 0.46 * sp * k, -20f32.to_radians(), col);

    c.rect(ox, oy + line_y - lw / 2.0, ox + w, oy + line_y + lw / 2.0, fg, 1.0);
    // 打楽器記号（太い2本の縦線）と拍子
    c.rect(ox + sp * 0.6, oy + line_y - sp, ox + sp, oy + line_y + sp, fg, 1.0);
    c.rect(ox + sp * 1.3, oy + line_y - sp, ox + sp * 1.7, oy + line_y + sp, fg, 1.0);
    let cx = sp * (2.6 + 0.95 * mlen);
    c.text(&meter.0.to_string(), ox + cx, oy + line_y - sp, sp * 1.9, sp * 0.34, fg);
    c.text(&meter.1.to_string(), ox + cx, oy + line_y + sp, sp * 1.9, sp * 0.34, fg);

    let mut notes: Vec<&crate::build::Note> = part.notes.iter().collect();
    notes.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    let bar_of = |t: f64| {
        let mut b = part.start;
        for x in &part.bars {
            if *x <= t + EPS {
                b = *x;
            }
        }
        b
    };
    // 小節線・終止線
    for b in &part.bars {
        if *b > from + 1e-6 && *b < to {
            vline(c, xf(*b), line_y - sp * 2.0, line_y + sp * 2.0, lw, fg);
        }
    }
    if part.end > from && part.end <= to + 1e-6 {
        vline(c, xf(part.end) - sp * 0.5, line_y - sp * 2.0, line_y + sp * 2.0, lw, fg);
        vline(c, xf(part.end), line_y - sp * 2.0, line_y + sp * 2.0, sp * 0.45, fg);
    }
    // 休符（音符どうしのすき間）
    let win = if meter.1 == 8 && meter.0 % 3 == 0 { 3.0 } else { 1.0 };
    let rest_at = |c: &mut Canvas, t: f64, len: f64| {
        let (mut left, mut tt) = (len, t);
        while left > 0.1 {
            let Some(r) = RESTS.iter().find(|x| x.0 <= left + 1e-6) else { break };
            if tt + r.0 > from && tt < to {
                draw_rest(c, ox + xf(tt + r.0.min(1.0) / 2.0), oy + line_y, sp, r.1, mu);
            }
            tt += r.0;
            left -= r.0;
        }
    };
    let mut cursor = part.start;
    for n in &notes {
        if n.t - cursor > 0.1 {
            rest_at(c, cursor, n.t - cursor);
        }
        cursor = cursor.max(n.t + n.dur);
    }
    if part.end - cursor > 0.1 && !notes.is_empty() {
        rest_at(c, cursor, part.end - cursor);
    }
    // 音符
    let mut items: Vec<Item> = vec![];
    for n in &notes {
        if n.t < from - 1e-6 || n.t > to {
            continue;
        }
        let d = n.dur;
        items.push(Item { t: n.t, d, hand: n.hand, acc: n.accent, kind: n.kind, pad: n.pad, x: xf(n.t), f: if d >= 2.0 - 1e-6 { 0 } else { flags_of(d) }, stem: d < 4.0 - 1e-6, gid: 0 });
    }
    let stem_top = line_y - sp * 3.6;
    let hw = sp * 0.59;
    // 連桁
    let mut groups: Vec<Vec<usize>> = vec![];
    let mut run: Vec<usize> = vec![];
    for i in 0..items.len() {
        let gid = ((items[i].t - bar_of(items[i].t)) / win + EPS).floor() as i64;
        items[i].gid = gid;
        let ok = items[i].f > 0 && i > 0 && !run.is_empty() && items[i - 1].f > 0 && (items[i - 1].t + items[i - 1].d - items[i].t).abs() < EPS && items[i - 1].gid == gid;
        if !ok && !run.is_empty() {
            groups.push(std::mem::take(&mut run));
        }
        if items[i].f > 0 {
            run.push(i);
        } else if !run.is_empty() {
            groups.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        groups.push(run);
    }
    let mut beamed = vec![false; items.len()];
    let bw = sp * 0.5;
    for g in &groups {
        if g.len() < 2 {
            continue;
        }
        for &i in g {
            beamed[i] = true;
        }
        for lv in 1..=3u8 {
            let y = stem_top + (lv - 1) as f32 * sp * 0.75 + bw / 2.0;
            let mut i = 0;
            while i < g.len() {
                if items[g[i]].f < lv {
                    i += 1;
                    continue;
                }
                let mut j = i;
                while j + 1 < g.len() && items[g[j + 1]].f >= lv {
                    j += 1;
                }
                let (xa, xb) = (items[g[i]].x + hw, items[g[j]].x + hw);
                if j > i {
                    c.rect(ox + xa - sp * 0.065 - sp * 0.06, oy + y - bw / 2.0, ox + xb + sp * 0.065 + sp * 0.06, oy + y + bw / 2.0, fg, 1.0);
                } else if lv > 1 {
                    if i < g.len() - 1 {
                        c.rect(ox + xa - sp * 0.065, oy + y - bw / 2.0, ox + xa + sp * 1.3, oy + y + bw / 2.0, fg, 1.0);
                    } else {
                        c.rect(ox + xa - sp * 1.3, oy + y - bw / 2.0, ox + xa + sp * 0.065, oy + y + bw / 2.0, fg, 1.0);
                    }
                }
                i = j + 1;
            }
        }
    }
    // 3連符の数字
    let mut trip: Vec<(i64, f32, f32)> = vec![];
    for it in &items {
        if !is_trip(it.d) {
            continue;
        }
        let key = (((it.t - bar_of(it.t)) / (it.d * 3.0) + EPS).floor() as i64) * 100000 + (it.d * 1000.0).round() as i64 * 7 + (bar_of(it.t) * 10.0) as i64 * 1000003;
        if let Some(e) = trip.iter_mut().find(|e| e.0 == key) {
            e.1 = e.1.min(it.x);
            e.2 = e.2.max(it.x);
        } else {
            trip.push((key, it.x, it.x));
        }
    }
    for e in &trip {
        c.text("3", ox + (e.1 + e.2) / 2.0 + hw, oy + stem_top - sp * 1.25, sp * 1.1, sp * 0.2, fg);
    }
    for (idx, it) in items.iter().enumerate() {
        let x = it.x;
        let loud = it.acc > 0;
        if it.kind == "click" {
            let k = sp * 0.5;
            seg(c, x - k, line_y - k, x + k, line_y + k, sp * 0.24, fg);
            seg(c, x - k, line_y + k, x + k, line_y - k, sp * 0.24, fg);
        } else if it.d >= 4.0 - 1e-6 {
            c.ellipse(ox + x, oy + line_y, sp * 0.86, sp * 0.5, -10f32.to_radians(), fg);
            c.ellipse(ox + x, oy + line_y, sp * 0.4, sp * 0.26, -50f32.to_radians(), pal.bg);
        } else if it.d >= 2.0 - 1e-6 {
            head(c, x, line_y, 1.0, fg);
            c.ellipse(ox + x, oy + line_y, sp * 0.46, sp * 0.19, -30f32.to_radians(), pal.bg);
        } else {
            head(c, x, line_y, 1.0, fg);
        }
        if it.stem {
            vline(c, x + hw, stem_top, line_y - sp * 0.1, lw, fg);
            if it.f > 0 && !beamed[idx] {
                for k in 0..it.f.min(2) {
                    draw_flag(c, ox + x + hw, oy + stem_top + k as f32 * sp * 0.75, sp, if it.f == 3 { 0.8 } else { 1.0 }, fg);
                }
                if it.f == 3 {
                    draw_flag(c, ox + x + hw, oy + stem_top + 1.5 * sp * 0.75, sp, 0.7, fg);
                }
            }
        }
        if dotted(it.d) {
            c.circle(ox + x + sp * 1.2, oy + line_y - sp * 0.5, sp * 0.2, fg);
        }
        // 装飾: フラム（小さな前打音）・ダブル・バズ（幹の斜線）
        if it.kind == "flam" {
            let gx = x - sp * 1.9;
            head(c, gx, line_y, 0.65, fg);
            vline(c, gx + hw * 0.65, line_y - sp * 2.4, line_y - sp * 0.1, sp * 0.1, fg);
            seg(c, gx - sp * 0.1, line_y - sp * 1.9, gx + sp * 0.9, line_y - sp * 2.5, sp * 0.1, fg);
        }
        if (it.kind == "diddle" || it.kind == "buzz") && it.stem {
            let n = if it.kind == "buzz" { 3 } else { 2 };
            for k in 0..n {
                let y = line_y - sp * (1.3 + k as f32 * 0.55);
                seg(c, x + hw - sp * 0.6, y + sp * 0.35, x + hw + sp * 0.6, y - sp * 0.35, sp * 0.16, fg);
            }
        }
        if loud {
            // アクセント（>）とマルカート（^）
            let (ax, ay) = (ox + x + hw * 0.4, oy + line_y - sp * if it.acc >= 2 { 5.7 } else { 5.5 } - sp * 0.45);
            if it.acc >= 2 {
                c.poly(&[(ax - sp * 0.55, ay + sp * 0.5), (ax, ay - sp * 0.55), (ax + sp * 0.55, ay + sp * 0.5)], sp * 0.22, hi);
            } else {
                c.poly(&[(ax - sp * 0.62, ay - sp * 0.5), (ax + sp * 0.62, ay), (ax - sp * 0.62, ay + sp * 0.5)], sp * 0.22, hi);
            }
        }
        // 手順（強いときは大文字、普通は小文字）
        let ch = if loud { it.hand } else { it.hand.to_ascii_lowercase() };
        c.text(&ch.to_string(), ox + x, oy + line_y + sp * 2.55, sp * 1.45, sp * 0.3, if loud { hi } else { fg });
        if it.pad > 0 {
            c.text(&it.pad.to_string(), ox + x + sp * 1.0, oy + line_y + sp * 3.45, sp * 0.8, sp * 0.14, mu);
        }
    }
    if let Some(p) = ph {
        if p >= from && p <= to {
            vline(c, xf(p), sp * 0.3, h - sp * 0.3, sp * 0.22, hi);
        }
    }
}

/// 旗（符幹の先から右下へ流れる）
fn draw_flag(c: &mut Canvas, x: f32, y: f32, sp: f32, k: f32, col: Col) {
    let n = 14;
    for i in 0..=n {
        let t = i as f32 / n as f32;
        // 2次ベジェ: 幹の先 → 右にふくらむ → 下で戻る
        let (p0, p1, p2) = ((0.0, 0.0), (1.5 * sp, 0.9 * sp * k), (0.7 * sp, 2.5 * sp * k));
        let bx = (1.0 - t).powi(2) * p0.0 + 2.0 * (1.0 - t) * t * p1.0 + t * t * p2.0;
        let by = (1.0 - t).powi(2) * p0.1 + 2.0 * (1.0 - t) * t * p1.1 + t * t * p2.1;
        c.circle(x + bx, y + by + sp * 0.18, sp * (0.22 - 0.14 * t), col);
    }
}

fn draw_rest(c: &mut Canvas, x: f32, y: f32, sp: f32, r: Rest, col: Col) {
    match r {
        Rest::Whole => c.rect(x - sp * 0.56, y, x + sp * 0.56, y + sp * 0.5, col, 1.0),
        Rest::Half => c.rect(x - sp * 0.56, y - sp * 0.5, x + sp * 0.56, y, col, 1.0),
        Rest::Quarter => {
            let w = sp * 0.3;
            c.poly(&[(x - sp * 0.3, y - sp * 1.4), (x + sp * 0.35, y - sp * 0.55), (x - sp * 0.3, y + sp * 0.3)], w, col);
            c.poly(&[(x - sp * 0.3, y + sp * 0.3), (x + sp * 0.3, y + sp * 0.75)], w * 1.3, col);
            c.poly(&arc(x - sp * 0.05, y + sp * 1.15, sp * 0.4, sp * 0.4, 300.0, 100.0), w * 0.9, col);
        }
        _ => {
            let n = match r {
                Rest::Eighth => 1,
                Rest::Sixteenth => 2,
                _ => 3,
            };
            let top = y - sp * 0.9;
            let bot = top + sp * (1.9 + 0.55 * (n - 1) as f32);
            let sx = |yy: f32| x + sp * 0.35 - (yy - top) / (bot - top) * sp * 0.75;
            c.line(sx(top), top, sx(bot), bot, sp * 0.14, col, 1.0);
            for k in 0..n {
                let dy = top + sp * (0.35 + 0.55 * k as f32);
                let ex = sx(dy + sp * 0.1);
                c.circle(ex - sp * 0.55, dy, sp * 0.26, col);
                // 点から幹へ向かう払い
                let pts: Vec<(f32, f32)> = (0..=8)
                    .map(|i| {
                        let t = i as f32 / 8.0;
                        let (p0, p1, p2) = ((ex - sp * 0.5, dy + sp * 0.12), (ex - sp * 0.05, dy + sp * 0.2), (ex + sp * 0.12, dy - sp * 0.2));
                        ((1.0 - t).powi(2) * p0.0 + 2.0 * (1.0 - t) * t * p1.0 + t * t * p2.0, (1.0 - t).powi(2) * p0.1 + 2.0 * (1.0 - t) * t * p1.1 + t * t * p2.1)
                    })
                    .collect();
                c.poly(&pts, sp * 0.16, col);
            }
        }
    }
}

// ================= グリッド（真上から） =================

struct Spec {
    /// 表示範囲（フィールド単位）
    view: (f64, f64, f64, f64),
    /// 会場の外枠
    outline: (f64, f64, f64, f64),
    /// 中心線（軸）
    center: (f64, f64),
    minor: f64,
    major: f64,
    /// 外枠の外側にうっすら出す領域（ステージの袖）
    wings: Option<(f64, f64, f64, f64)>,
    /// football のハッシュ（y の位置）
    hashes: Vec<f64>,
}

fn spec(show: &Show, pw: f32, ph: f32) -> Spec {
    match &show.field.kind {
        FieldKind::Gym { w, d } => Spec { view: (-w / 2.0 - 1.5, w / 2.0 + 1.5, -d / 2.0 - 1.5, d / 2.0 + 1.5), outline: (-w / 2.0, w / 2.0, -d / 2.0, d / 2.0), center: (0.0, 0.0), minor: 1.0, major: 5.0, wings: None, hashes: vec![] },
        FieldKind::Floor { w, d } => Spec { view: (-w / 2.0 - 1.5, w / 2.0 + 1.5, -1.5, d + 1.5), outline: (-w / 2.0, w / 2.0, 0.0, *d), center: (0.0, d / 2.0), minor: 1.0, major: 5.0, wings: None, hashes: vec![] },
        FieldKind::Stage { w, d, wing } => {
            let ww = w / 2.0 + wing;
            Spec { view: (-ww - 1.0, ww + 1.0, -1.5, d + 1.5), outline: (-w / 2.0, w / 2.0, 0.0, *d), center: (0.0, d / 2.0), minor: 1.0, major: 5.0, wings: Some((-ww, ww, 0.0, *d)), hashes: vec![] }
        }
        FieldKind::Football { hash, .. } => {
            // 8 to 5: ヤードライン（5 ヤード = 8 歩）を太く、間に 2 歩ごとの細い線。画面が小さいときは細線を 4 歩ごとに
            let scale = (pw as f64 / 166.0).min(ph as f64 / (BSL + 6.0));
            Spec { view: (-83.0, 83.0, -3.0, BSL + 3.0), outline: (-80.0, 80.0, 0.0, BSL), center: (0.0, BSL / 2.0), minor: if scale < 6.0 { 4.0 } else { 2.0 }, major: 8.0, wings: None, hashes: vec![*hash, BSL - *hash] }
        }
    }
}

/// グリッドパネルの変換（フィールド座標 ↔ 画素）
pub struct GridMap {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub scale: f32,
    vcx: f64,
    vcy: f64,
}

impl GridMap {
    fn px(&self, x: f64, y: f64) -> (f32, f32) {
        (self.x + self.w / 2.0 + ((x - self.vcx) as f32) * self.scale, self.y + self.h / 2.0 - ((y - self.vcy) as f32) * self.scale)
    }
}

const GRID_BG: Col = [17, 19, 24];
const GRID_MINOR: Col = [46, 50, 60];
const GRID_MAJOR: Col = [84, 90, 104];
const GRID_AXIS: Col = [150, 157, 172];

/// 静止している部分（グリッド線・外枠・軸）を描いたパネル
pub fn grid_base(show: &Show, w: usize, h: usize) -> (Canvas, GridMap) {
    let mut sp = spec(show, w as f32, h as f32);
    // 表示範囲は、全セットの全員の位置の和 + 2m（ショー全体で固定）。最小でも 10m 四方
    {
        let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for s in &show.sets {
            for p in &s.pos {
                x0 = x0.min(p.0);
                x1 = x1.max(p.0);
                y0 = y0.min(p.1);
                y1 = y1.max(p.1);
            }
        }
        if x0 <= x1 {
            let mg = 2.0 / show.field.unit_m;
            let minw = 10.0 / show.field.unit_m;
            let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
            let (hw, hh) = (((x1 - x0) / 2.0 + mg).max(minw / 2.0), ((y1 - y0) / 2.0 + mg).max(minw / 2.0));
            sp.view = (cx - hw, cx + hw, cy - hh, cy + hh);
        }
    }
    let mut c = Canvas::new(w, h, GRID_BG);
    let (vx0, vx1, vy0, vy1) = sp.view;
    let scale = ((w as f64 / (vx1 - vx0)).min(h as f64 / (vy1 - vy0))) as f32;
    let m = GridMap { x: 0.0, y: 0.0, w: w as f32, h: h as f32, scale, vcx: (vx0 + vx1) / 2.0, vcy: (vy0 + vy1) / 2.0 };
    // パネル全体に線を引く（会場の外は暗く）
    let (lx0, lx1) = (m.vcx - w as f64 / 2.0 / scale as f64, m.vcx + w as f64 / 2.0 / scale as f64);
    let (ly0, ly1) = (m.vcy - h as f64 / 2.0 / scale as f64, m.vcy + h as f64 / 2.0 / scale as f64);
    let (ox0, ox1, oy0, oy1) = sp.outline;
    let on_major = |v: f64| ((v - 0.0) / sp.major - ((v - 0.0) / sp.major).round()).abs() < 1e-6;
    let mut x = (lx0 / sp.minor).floor() * sp.minor;
    while x <= lx1 {
        let (px, _) = m.px(x, 0.0);
        let major = on_major(x);
        c.rect(px - 0.5, 0.0, px + 0.5, h as f32, if major { GRID_MAJOR } else { GRID_MINOR }, if major { 1.0 } else { 0.9 });
        x += sp.minor;
    }
    let mut y = ((ly0 - sp.center.1) / sp.minor).floor() * sp.minor + sp.center.1;
    // football は y=0（フロントサイドライン）から数える
    if matches!(show.field.kind, FieldKind::Football { .. }) {
        y = (ly0 / sp.minor).floor() * sp.minor;
    }
    while y <= ly1 {
        let (_, py) = m.px(0.0, y);
        let base = if matches!(show.field.kind, FieldKind::Football { .. }) { 0.0 } else { sp.center.1 };
        let q = (y - base) / sp.major;
        let major = (q - q.round()).abs() < 1e-6;
        c.rect(0.0, py - 0.5, w as f32, py + 0.5, if major { GRID_MAJOR } else { GRID_MINOR }, if major { 1.0 } else { 0.9 });
        y += sp.minor;
    }
    // 会場の外を暗くする
    let (a, b) = (m.px(ox0, oy1), m.px(ox1, oy0));
    let (wa, wb) = match sp.wings {
        Some((x0, x1, y0, y1)) => (m.px(x0, y1), m.px(x1, y0)),
        None => (a, b),
    };
    let (ix0, iy0, ix1, iy1) = (wa.0, wa.1, wb.0, wb.1);
    c.rect(0.0, 0.0, w as f32, iy0, GRID_BG, 0.55);
    c.rect(0.0, iy1, w as f32, h as f32, GRID_BG, 0.55);
    c.rect(0.0, iy0, ix0, iy1, GRID_BG, 0.55);
    c.rect(ix1, iy0, w as f32, iy1, GRID_BG, 0.55);
    if sp.wings.is_some() {
        // 袖は舞台より少し暗く
        c.rect(ix0, iy0, a.0, iy1, GRID_BG, 0.35);
        c.rect(b.0, iy0, ix1, iy1, GRID_BG, 0.35);
    }
    // ハッシュ（football）
    for hy in &sp.hashes {
        let (_, py) = m.px(0.0, *hy);
        let mut xx = a.0;
        while xx < b.0 {
            c.rect(xx, py - 0.75, (xx + 5.0).min(b.0), py + 0.75, GRID_AXIS, 0.55);
            xx += 9.0;
        }
    }
    // 外枠
    let ow = 1.6;
    c.rect(a.0 - ow / 2.0, a.1 - ow / 2.0, b.0 + ow / 2.0, a.1 + ow / 2.0, GRID_AXIS, 0.8);
    c.rect(a.0 - ow / 2.0, b.1 - ow / 2.0, b.0 + ow / 2.0, b.1 + ow / 2.0, GRID_AXIS, 0.8);
    c.rect(a.0 - ow / 2.0, a.1 - ow / 2.0, a.0 + ow / 2.0, b.1 + ow / 2.0, GRID_AXIS, 0.8);
    c.rect(b.0 - ow / 2.0, a.1 - ow / 2.0, b.0 + ow / 2.0, b.1 + ow / 2.0, GRID_AXIS, 0.8);
    // 中心を通る軸
    let (cx, cy) = m.px(sp.center.0, sp.center.1);
    c.rect(cx - 1.0, 0.0, cx + 1.0, h as f32, GRID_AXIS, 0.95);
    c.rect(0.0, cy - 1.0, w as f32, cy + 1.0, GRID_AXIS, 0.95);
    // 軸の目盛り（メートルの会場: 5m ごとの数字）
    if !matches!(show.field.kind, FieldKind::Football { .. }) {
        let mut v = sp.major;
        while v <= (lx1 - sp.center.0).abs().max((sp.center.0 - lx0).abs()) {
            for s in [-1.0, 1.0] {
                let (px, _) = m.px(sp.center.0 + s * v, 0.0);
                if px > 8.0 && px < w as f32 - 8.0 && (sp.center.0 + s * v > ox0 + 1e-6 && sp.center.0 + s * v < ox1 - 1e-6) {
                    c.text(&format!("{}", v as i64), px, cy + 9.0, 8.0, 1.1, GRID_AXIS);
                }
            }
            v += sp.major;
        }
    }
    (c, m)
}

fn lum(c: u32) -> f32 {
    let (r, g, b) = ((c >> 16 & 255) as f32, (c >> 8 & 255) as f32, (c & 255) as f32);
    (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
}

/// 隊員の番号（id の末尾の数字。なければ通し番号）
pub fn member_number(show: &Show, i: usize) -> String {
    let id = &show.performers[i].id;
    let digits: String = id.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
    if digits.is_empty() {
        format!("{}", i + 1)
    } else {
        digits
    }
}

/// 時刻 t の全員を、色つきの番号ピンと向きの矢印で描く
pub fn draw_pins(c: &mut Canvas, show: &Show, m: &GridMap, t: f64) {
    let r = (m.scale * 0.5).clamp(13.0, 19.0);
    // 手前（客席側 = y が小さい）を後から描く
    let mut order: Vec<(usize, f64, f64, f64)> = (0..show.performers.len())
        .map(|i| {
            let st = state_at(show, i, t);
            (i, st.x, st.y, face_deg(&st))
        })
        .collect();
    order.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap());
    for (i, x, y, fd) in order {
        let (px, py) = m.px(x, y);
        let col = member_color(show, i);
        let rgb = [(col >> 16) as u8, (col >> 8) as u8, col as u8];
        let a = fd.to_radians();
        let (dx, dy) = (a.cos() as f32, -(a.sin() as f32));
        // 矢印: 軸と三角の頭
        let (s0, s1) = (r + 1.5, r + 13.0);
        let tip = (px + dx * (s1 + 5.0), py + dy * (s1 + 5.0));
        c.line(px + dx * s0, py + dy * s0, px + dx * s1, py + dy * s1, 2.8, [236, 238, 244], 1.0);
        let (nx, ny) = (-dy, dx);
        c.tri([tip, (px + dx * s1 + nx * 5.2, py + dy * s1 + ny * 5.2), (px + dx * s1 - nx * 5.2, py + dy * s1 - ny * 5.2)], [236, 238, 244]);
        c.circle(px, py, r + 1.6, [8, 9, 12]);
        c.circle(px, py, r, rgb);
        let ink = if lum(col) > 0.58 { [16, 18, 22] } else { [255, 255, 255] };
        let num = member_number(show, i);
        let hh = if num.len() > 1 { r * 0.9 } else { r * 1.05 };
        c.text(&num, px, py, hh, (r * 0.2).max(1.5), ink);
    }
}

// ================= 4段の合成 =================

pub struct Layout {
    pub w: usize,
    pub h: usize,
    /// 各段の上端と高さ: [上の3D, 楽譜, 客席側の3D, グリッド]
    pub y: [usize; 4],
    pub hh: [usize; 4],
}

impl Layout {
    pub fn new(w: usize, h: usize) -> Layout {
        let ev = |v: f64| (v.round() as usize) & !1;
        let (a, b) = (ev(h as f64 * 0.32), ev(h as f64 * 0.135));
        let c = ev(h as f64 * 0.30);
        let hh = [a, b, c, h - a - b - c];
        let y = [0, hh[0], hh[0] + hh[1], hh[0] + hh[1] + hh[2]];
        Layout { w, h, y, hh }
    }
}

pub const PAL: Pal = Pal { fg: [20, 22, 28], mu: [128, 134, 146], hi: [226, 82, 20], bg: [255, 255, 255] };

/// 表示するパート: --part の名前、なければメンバー数が最多（同数なら先頭）
pub fn pick_part<'a>(show: &'a Show, name: Option<&str>) -> Result<Option<&'a Part>, String> {
    if let Some(n) = name {
        return show.parts.iter().find(|p| p.name == n).map(Some).ok_or_else(|| format!("part「{}」がありません（{}）", n, show.parts.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(" / ")));
    }
    let mut best: Option<&Part> = None;
    for p in &show.parts {
        if best.map(|b| p.members.len() > b.members.len()).unwrap_or(true) {
            best = Some(p);
        }
    }
    Ok(best)
}

/// 楽譜の段と、段の境目を描く
pub fn draw_band(c: &mut Canvas, lay: &Layout, part: Option<&Part>, t: f64) {
    let (y0, bh) = (lay.y[1] as f32, lay.hh[1] as f32);
    c.rect(0.0, y0, lay.w as f32, y0 + bh, PAL.bg, 1.0);
    if let Some(p) = part {
        let (from, to) = staff_page(p, t);
        let ph = if t >= from - 1e-9 { Some(t) } else { None };
        // 上の 36% は題名の場所（ASS で重ねる）
        let top = bh * 0.3;
        draw_staff(c, 0.0, y0 + top, lay.w as f32, bh - top - bh * 0.02, p, from, to, ph, &PAL);
    }
    // 段の境目の細い線
    for k in [1usize, 2, 3] {
        c.rect(0.0, lay.y[k] as f32 - 1.0, lay.w as f32, lay.y[k] as f32 + 1.0, [10, 11, 14], 1.0);
    }
}

/// 1フレーム: 2枚の3D画像（幅 w × 各段の高さ）を重ね、楽譜とグリッドを描く
pub fn compose(show: &Show, lay: &Layout, top: &[u8], front: &[u8], grid: &(Canvas, GridMap), part: Option<&Part>, t: f64) -> Vec<u8> {
    let mut c = Canvas::new(lay.w, lay.h, [0, 0, 0]);
    c.blit(0, lay.y[0], top, lay.w, lay.hh[0]);
    c.blit(0, lay.y[2], front, lay.w, lay.hh[2]);
    draw_band(&mut c, lay, part, t);
    let mut g = Canvas { w: grid.0.w, h: grid.0.h, px: grid.0.px.clone() };
    draw_pins(&mut g, show, &grid.1, t);
    c.blit(0, lay.y[3], &g.px, g.w, g.h);
    c.rect(0.0, lay.y[3] as f32 - 1.0, lay.w as f32, lay.y[3] as f32 + 1.0, [10, 11, 14], 1.0);
    c.px
}

/// 上段（Diag）と客席側（Low）の描画設定
pub fn panel_opts(lay: &Layout) -> (RenderOpts, RenderOpts) {
    (
        RenderOpts { width: lay.w, height: lay.hh[0], ss: 2, mode: CamMode::Diag, hud: false },
        RenderOpts { width: lay.w, height: lay.hh[2], ss: 2, mode: CamMode::Front, hud: false },
    )
}

/// 縦動画を書き出す
#[allow(clippy::too_many_arguments)]
pub fn render_reel(
    show: &Show,
    path: &str,
    w: usize,
    h: usize,
    fps: f64,
    speed: f64,
    part_name: Option<&str>,
    audio: bool,
    hud: bool,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<(), String> {
    use crate::render::{base_frame_t, mux_input, mux_output, render_with, venue, Ctx, Scratch};
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let part = pick_part(show, part_name)?;
    let lay = Layout::new(w, h);
    let (o_top, o_front) = panel_opts(&lay);
    let total_counts = show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0);
    let secs = crate::render::seconds_at(show, total_counts) / speed;
    let nframes = ((secs * fps).ceil() as usize).max(1) + (fps as usize);
    // 題名（パート名）と、任意で下部のカウント表示を ASS で焼き込む
    let title = part.map(|p| p.name.clone()).unwrap_or_else(|| show.name.clone());
    let ass = if crate::hud::available() {
        crate::hud::AssFile::write(&crate::hud::reel_ass(show, w, h, speed, &title, lay.y[1], lay.hh[1], nframes as f64 / fps, hud)).ok()
    } else {
        None
    };
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", &format!("{}x{}", w, h), "-r", &format!("{}", fps), "-i", "-"]);
    let track = if audio { crate::audio::mux_track(show, speed) } else { None };
    mux_input(&mut cmd, track.as_ref());
    if let Some(a) = &ass {
        cmd.args(["-vf", &a.filter()]);
    }
    let mut child = mux_output(&mut cmd, track.as_ref())
        .args(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path])
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg を起動できません（インストールしてください: macOS なら `brew install ffmpeg`）: {}", e))?;
    let v_top = venue(show, CamMode::Diag);
    let v_front = venue(show, CamMode::Front);
    let ctx = Ctx::new(show);
    let grid = grid_base(show, lay.w, lay.hh[3]);
    let fallback_title = if ass.is_none() { Some(title.clone()) } else { None };
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let mut stdin = child.stdin.take().unwrap();
    let next = AtomicUsize::new(0);
    let written = AtomicUsize::new(0);
    let window = threads * 3;
    let (tx, rx) = std::sync::mpsc::channel::<(usize, Vec<u8>)>();
    let mut result: Result<(), String> = Ok(());
    std::thread::scope(|scope| {
        for _ in 0..threads {
            let (tx, next, written, ctx, v_top, v_front, grid, lay, o_top, o_front, fb) = (tx.clone(), &next, &written, &ctx, &v_top, &v_front, &grid, &lay, &o_top, &o_front, &fallback_title);
            scope.spawn(move || {
                let (mut s_top, mut s_front) = (Scratch::new(), Scratch::new());
                loop {
                    let fi = next.fetch_add(1, Ordering::SeqCst);
                    if fi >= nframes {
                        break;
                    }
                    while fi >= written.load(Ordering::SeqCst) + window {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                    let t = counts_at(show, fi as f64 / fps * speed).min(total_counts);
                    let frac = fi as f32 / nframes as f32;
                    let b = base_frame_t(show, v_top, o_top, frac, t);
                    let top = render_with(show, ctx, &mut s_top, &b, false, t, o_top, frac);
                    let bf = base_frame_t(show, v_front, o_front, frac, t);
                    let front = render_with(show, ctx, &mut s_front, &bf, false, t, o_front, frac);
                    let mut img = compose(show, lay, &top, &front, grid, part, t);
                    if let Some(tt) = fb {
                        // 字幕フィルタがないときは、ASCII だけビットマップ文字で題名を出す
                        if tt.is_ascii() {
                            let sc = 5;
                            let tw = tt.len() * 6 * sc;
                            crate::render::draw_text(&mut img, lay.w, lay.h, (lay.w.saturating_sub(tw)) / 2, lay.y[1] + 14, sc, tt, [20, 22, 28]);
                        }
                    }
                    if tx.send((fi, img)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);
        let mut pending: std::collections::BTreeMap<usize, Vec<u8>> = std::collections::BTreeMap::new();
        let mut done = 0;
        for (fi, img) in rx {
            pending.insert(fi, img);
            while let Some(img) = pending.remove(&done) {
                if result.is_ok() {
                    if let Err(e) = stdin.write_all(&img) {
                        result = Err(format!("ffmpeg への書き込みに失敗: {}", e));
                        next.store(nframes, Ordering::SeqCst);
                    }
                }
                done += 1;
                written.store(done, Ordering::SeqCst);
                if done % (threads * 2) == 0 || done == nframes {
                    progress(done, nframes);
                }
            }
        }
    });
    result?;
    drop(stdin);
    let st = child.wait().map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("ffmpeg がエラーで終了しました".into());
    }
    Ok(())
}

/// 静止画（1フレーム）
pub fn render_reel_still(show: &Show, path: &str, w: usize, h: usize, t: f64, part_name: Option<&str>, hud: bool) -> Result<(), String> {
    use crate::render::{base_frame_t, render_with, venue, Ctx, Scratch};
    use std::io::Write;
    let part = pick_part(show, part_name)?;
    let lay = Layout::new(w, h);
    let (o_top, o_front) = panel_opts(&lay);
    let ctx = Ctx::new(show);
    let b = base_frame_t(show, &venue(show, CamMode::Diag), &o_top, 0.3, t);
    let top = render_with(show, &ctx, &mut Scratch::new(), &b, false, t, &o_top, 0.3);
    let bf = base_frame_t(show, &venue(show, CamMode::Front), &o_front, 0.3, t);
    let front = render_with(show, &ctx, &mut Scratch::new(), &bf, false, t, &o_front, 0.3);
    let img = compose(show, &lay, &top, &front, &grid_base(show, lay.w, lay.hh[3]), part, t);
    let title = part.map(|p| p.name.clone()).unwrap_or_else(|| show.name.clone());
    let ass = if crate::hud::available() { crate::hud::AssFile::write(&crate::hud::reel_still_ass(show, w, h, &title, lay.y[1], lay.hh[1], t, hud)).ok() } else { None };
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", &format!("{}x{}", w, h), "-i", "-"]);
    if let Some(a) = &ass {
        cmd.args(["-vf", &a.filter()]);
    }
    let mut child = cmd.args(["-frames:v", "1", path]).stdin(std::process::Stdio::piped()).spawn().map_err(|e| format!("ffmpeg を起動できません: {}", e))?;
    child.stdin.take().unwrap().write_all(&img).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_sums_and_part_pages() {
        let l = Layout::new(1080, 1920);
        assert_eq!(l.hh.iter().sum::<usize>(), 1920);
        assert_eq!(l.y[3] + l.hh[3], 1920);
        let show = crate::compile("show \"t\" {\n section sn \"スネア\" 3 instrument snare\n set 1 hold 16 { sn : line (-2, 0) -> (2, 0) }\n part \"P\" for sn {\n meter 4/4\n 8: R l r l R l r l | R l r l R l r l | R l r l R l r l |\n }\n}").unwrap();
        let p = pick_part(&show, None).unwrap().unwrap();
        assert_eq!(p.name, "P");
        assert!(pick_part(&show, Some("nope")).is_err());
        // 小節 0..4 / 4..8 / 8..12: 再生位置 5 は 2 小節目 → 最初のページ（0〜8）、9 は 2 ページ目（8〜16）
        assert_eq!(staff_page(p, 5.0), (0.0, 8.0));
        assert_eq!(staff_page(p, 9.0).0, 8.0);
        // ピンの色は袖の色と同じ関数（color なし + イラスト = 隊員ごとのパレット）
        assert_eq!(member_number(&show, 2), "3");
    }
}
