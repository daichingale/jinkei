//! 楽譜の音符 → 打楽器を叩く腕の動き。ブラウザの src/strike.js と同じ式。
//! ストローク列を作る（strokes）→ 時刻 t の手ごとの状態を引く（state）→ 上半身ボーンへ書く（human.rs の apply_strike）。
//! スネア・テナー・バスドラムは、アセット（human.json の strike）に書いた打面の位置へスティックの先が正確に着くように、
//! 肩から手首までを 2 関節 IK で解く（human.rs の strike_ik）。それ以外（シンバル・シロフォン・グロッケン）は前腕・手首の回転だけ足す。
//! 座標は構え（hold）のときのモデル座標。
use crate::build::Note;
use crate::human::{StrikeDrum, StrikeTbl};

const AH: [f32; 3] = [0.30, 0.60, 1.0];

pub(crate) fn sst(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// 強弱 vel（0..1）→ 振り上げの高さの倍率（pp はごく低く、ff は高く）
pub fn vs(v: f32) -> f32 {
    0.2 + 1.15 * v.clamp(0.0, 1.0).powf(1.3)
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Fam {
    Snare,
    Tenors,
    Bass,
    Cymbals,
    Xylo,
    Glock,
}

pub fn fam_of(kind: &str) -> Option<Fam> {
    match kind {
        "snare" => Some(Fam::Snare),
        "tenors" => Some(Fam::Tenors),
        "bass1" | "bass2" | "bass3" | "bass4" | "bass5" => Some(Fam::Bass),
        "cymbals_mid" | "cymbals_high" => Some(Fam::Cymbals),
        "xylophone" => Some(Fam::Xylo),
        "glockenspiel" => Some(Fam::Glock),
        _ => None,
    }
}

/// スティック先端の待機位置 x（モデル座標、右手は負、左手は正）。IK を使わない楽器用
pub fn stick_base(fam: Fam, right: bool) -> f32 {
    let a = match fam {
        Fam::Xylo => 0.16,
        Fam::Glock => 0.045,
        _ => 0.05,
    };
    if right {
        -a
    } else {
        a
    }
}

// ---- 小さなベクトル ----
pub(crate) type V = [f32; 3];
pub(crate) fn va(a: V, b: V) -> V {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub(crate) fn vsub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub(crate) fn vm(a: V, s: f32) -> V {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub(crate) fn vd(a: V, b: V) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub(crate) fn vma(a: V, b: V, s: f32) -> V {
    [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
}
pub(crate) fn vl(a: V) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
pub(crate) fn vn(a: V) -> V {
    let l = vl(a);
    let l = if l == 0.0 { 1.0 } else { l };
    [a[0] / l, a[1] / l, a[2] / l]
}
pub(crate) fn vc(a: V, b: V) -> V {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub(crate) fn vlerp(a: V, b: V, s: f32) -> V {
    [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s]
}

/// 打面へ当てる接点まわりの記述
struct Contact {
    p: V,
    p1: Option<V>,
    n: V,
    f: Option<V>,
    b0: f32,
    buzz: u8,
    hm: f32,
}

/// 手が打面 d を叩く接点。p = 接点、p1 = こすりの終点、n = 離れる向き、f = 棒の前向き（None なら手首の待機位置から決める）、
/// b0 = 打つときの棒の傾き（打面に対して、先が下を向くほど正。rad）
fn contact(fam: Fam, d: &StrikeDrum, right: bool, kd: &str, pad: u8) -> Contact {
    let sx = if right { -1.0f32 } else { 1.0 };
    let r = d.r;
    let sp = d.spread;
    let off = |a: f32, b: f32| va(d.c, va(vm(d.ex, a * r), vm(d.ez, b * r)));
    let b0 = match fam {
        Fam::Bass => 0.38,
        Fam::Tenors => 0.35,
        _ => 0.30,
    };
    let mut o = Contact { p: off(sx * 0.28 * sp, -0.10 * sp), p1: None, n: d.n, f: None, b0, buzz: 0, hm: 1.0 };
    if kd == "rimshot" {
        if fam == Fam::Bass {
            o.hm = 1.15;
            return o;
        }
        o.p = off(sx * 0.15 * sp, -0.55);
        o.b0 = 0.05;
        o.hm = 1.1;
    } else if kd == "click" || (fam == Fam::Snare && pad == 2) {
        if fam == Fam::Snare {
            o.p = vma(off(sx * 0.93, 0.0), d.n, 0.006);
            o.b0 = 0.10;
        } else if fam == Fam::Bass {
            o.p = off(0.92, 0.0);
        } else {
            o.p = vma(off(sx * 0.15 * sp, -0.93), d.n, 0.006);
            o.b0 = 0.10;
        }
        o.hm = 0.6;
    } else if kd == "gock" {
        if fam == Fam::Snare {
            o.p = vma(vma(d.c, d.ex, sx * (r + 0.014)), d.n, -0.06);
            o.n = vn(va(vm(d.ex, sx * 0.5), vm(d.n, 0.85)));
        } else if fam == Fam::Tenors {
            o.p = vma(vma(d.c, d.ez, -(r + 0.014)), d.n, -0.06);
            o.n = vn(va(vm(d.ez, -0.5), vm(d.n, 0.85)));
        } else {
            o.p = va(d.c, va(vm(d.ex, 0.55 * r), vm(d.ez, 0.65 * r)));
        }
        o.b0 = 0.12;
        o.hm = 0.8;
    } else if kd == "scrape" {
        o.p = off(-sx * 0.55 * sp, -0.15 * sp);
        o.p1 = Some(off(sx * 0.55 * sp, -0.15 * sp));
        if fam == Fam::Bass {
            o.p = off(-0.5, 0.0);
            o.p1 = Some(off(0.5, 0.0));
        }
        o.buzz = 3;
        o.hm = 0.3;
    } else if kd == "mute" {
        o.buzz = 2;
        o.hm = 0.8;
    } else if fam == Fam::Snare && pad == 3 {
        o.p = off(sx * 0.3, 0.72);
        o.hm = 0.8;
    }
    o
}

/// 手首の待機位置 anc から、棒の前向き（打面の面内で anc → p の向き）
fn f_of(p: V, n: V, anc: V) -> V {
    let mut v = vsub(p, anc);
    v = vsub(v, vm(n, vd(v, n)));
    if vl(v) < 1e-4 {
        v = [0.0, 0.0, 1.0];
        v = vsub(v, vm(n, vd(v, n)));
    }
    vn(v)
}

/// 打面の番号 → 表の項目。番号なしは R が 1、L が 2
fn drum_of<'a>(fam: Fam, tbl: &'a StrikeTbl, right: bool, pad: u8) -> &'a StrikeDrum {
    let ds = &tbl.drums;
    match fam {
        Fam::Bass => ds.iter().find(|d| d.hand == Some(if right { 'R' } else { 'L' })).unwrap_or(&ds[0]),
        Fam::Snare => &ds[0],
        _ => ds.iter().find(|d| d.pad == pad).or_else(|| ds.iter().find(|d| d.pad == if right { 1 } else { 2 })).unwrap_or(&ds[0]),
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Stroke {
    pub t: f32,
    pub te: f32,
    pub h: f32,
    /// 旧方式（IK を使わない楽器）: 先端の目標 x と縁へ寄せる量
    pub x: f32,
    pub rim: f32,
    /// 0 = 打つ、1 = バズ（押しつけて震える）、2 = チョーク・ミュート（押さえたまま）、3 = こすり
    pub buzz: u8,
    /// IK の楽器: 接点・こすりの終点・離れる向き・棒の前向き・打つときの傾き
    pub p: V,
    pub p1: V,
    pub n: V,
    pub f: Option<V>,
    pub b0: f32,
    pub click: bool,
}

impl Stroke {
    fn legacy(t: f32, te: f32, h: f32, x: f32, buzz: u8) -> Stroke {
        Stroke { t, te, h, x, rim: 0.0, buzz, p: [0.0; 3], p1: [0.0; 3], n: [0.0, 1.0, 0.0], f: None, b0: 0.3, click: false }
    }
    fn ik(t: f32, te: f32, h: f32, c: &Contact) -> Stroke {
        Stroke { t, te, h, x: 0.0, rim: 0.0, buzz: c.buzz, p: c.p, p1: c.p1.unwrap_or(c.p), n: c.n, f: c.f, b0: c.b0, click: false }
    }
    fn pe(&self) -> V {
        if self.buzz == 3 {
            self.p1
        } else {
            self.p
        }
    }
}

pub struct Strokes {
    pub fam: Fam,
    /// 打面の表で IK を解く楽器か
    pub ik: bool,
    pub r: Vec<Stroke>,
    pub l: Vec<Stroke>,
}

/// 1人ぶんの音符 → 手ごとのストローク列。叩かない楽器なら None
pub fn strokes(notes: &[&Note], kind: &str, spc: f32) -> Option<Strokes> {
    let fam = fam_of(kind)?;
    let tbl: Option<&StrikeTbl> = crate::human::human().and_then(|h| h.strike.get(kind));
    let ik = tbl.is_some() && matches!(fam, Fam::Snare | Fam::Tenors | Fam::Bass);
    let mut out = Strokes { fam, ik, r: vec![], l: vec![] };
    if notes.is_empty() {
        return Some(out);
    }
    let bs: u8 = if fam == Fam::Bass { kind.as_bytes()[4] - b'0' } else { 0 };
    let grace = 0.065 / spc;
    let mut ni = 0usize;
    for n in notes {
        let (t, dur) = (n.t as f32, n.dur as f32);
        let vsc = vs(n.vel);
        if fam == Fam::Bass && n.pad > 0 && n.pad != bs {
            continue;
        }
        let ah = AH.get(n.accent as usize).copied().unwrap_or(0.3);
        if ik {
            let tbl = tbl.unwrap();
            let both: &[bool] = &[true, false];
            let hands: &[bool] = if n.kind == "stickclick" || n.hand == 'B' {
                both
            } else if n.hand == 'R' {
                &[true]
            } else {
                &[false]
            };
            if n.kind == "stickclick" {
                for &right in hands {
                    let sx = if right { -1.0f32 } else { 1.0 };
                    let list = if right { &mut out.r } else { &mut out.l };
                    if let Some(last) = list.last() {
                        if (last.t - t).abs() < 1e-6 && last.click {
                            continue;
                        }
                    }
                    let mut s = Stroke::legacy(t, t, 0.35 * vsc, 0.0, 0);
                    s.p = va(tbl.click, [sx * 0.012, 0.0, 0.0]);
                    s.p1 = s.p;
                    s.n = vn([sx * 0.9, 0.35, 0.0]);
                    s.f = Some(vn([-sx * 0.55, 0.0, 1.0]));
                    s.b0 = -0.15;
                    s.click = true;
                    list.push(s);
                }
                ni += 1;
                continue;
            }
            // バスドラムの buzz / ロール: 両手の小さな交互打ち
            if fam == Fam::Bass && n.kind == "buzz" {
                let step = 0.125f32;
                let cnt = ((dur / step).round() as usize).max(2);
                for i in 0..cnt {
                    let right = (n.hand == 'L') == (i % 2 == 1);
                    let d = drum_of(fam, tbl, right, n.pad);
                    let c = contact(fam, d, right, "tap", n.pad);
                    let ti = t + i as f32 * step;
                    let s = Stroke::ik(ti, ti, 0.14 * vsc, &c);
                    if right {
                        out.r.push(s);
                    } else {
                        out.l.push(s);
                    }
                }
                ni += 1;
                continue;
            }
            for &right in hands {
                let d = drum_of(fam, tbl, right, n.pad);
                let mut c = contact(fam, d, right, n.kind, n.pad);
                let mut h = ah * vsc * c.hm;
                let mut te = t;
                if c.buzz == 3 || c.buzz == 2 {
                    te = t + dur.max(0.25);
                }
                if n.kind == "buzz" {
                    h = 0.08;
                    c.buzz = 1;
                    te = t + dur;
                }
                let s = Stroke::ik(t, te, h, &c);
                let (list, other) = if right { (&mut out.r, &mut out.l) } else { (&mut out.l, &mut out.r) };
                list.push(s);
                if n.kind == "diddle" {
                    let mut s2 = Stroke::ik(t + dur / 2.0, t + dur / 2.0, h * 0.65, &c);
                    s2.buzz = 0;
                    list.push(s2);
                }
                if n.kind == "flam" && n.hand != 'B' {
                    let d2 = drum_of(fam, tbl, !right, n.pad);
                    let c2 = contact(fam, d2, !right, "tap", n.pad);
                    other.push(Stroke::ik(t - grace, t - grace, 0.2 * vsc, &c2));
                }
            }
            ni += 1;
            continue;
        }
        // ---- 旧方式（シンバル・シロフォン・グロッケン）----
        let hs: &[bool] = match (fam, n.hand) {
            (Fam::Cymbals, _) | (_, 'B') => &[true, false],
            (Fam::Glock, _) => &[true],
            (_, 'R') => &[true],
            _ => &[false],
        };
        for &right in hs {
            let mut h = ah * if fam == Fam::Cymbals { vsc } else { 1.0 };
            let mut x = stick_base(fam, right);
            let (mut buzz, mut te) = (0u8, t);
            match fam {
                Fam::Xylo => x = stick_base(fam, right) + 0.2 * (ni as f32 * 2.3 + if right { 0.0 } else { 1.7 }).sin(),
                Fam::Glock => x = stick_base(fam, right) + 0.04 * (ni as f32 * 2.3).sin(),
                Fam::Cymbals => match n.pad {
                    2 => h *= 0.35,
                    3 => h = h * 0.5 + 0.2,
                    4 => {
                        buzz = 2;
                        te = t + dur.max(0.5);
                    }
                    _ => {}
                },
                _ => {}
            }
            if n.kind == "buzz" && fam != Fam::Cymbals {
                h = 0.08;
                buzz = 1;
                te = t + dur;
            }
            let list = if right { &mut out.r } else { &mut out.l };
            list.push(Stroke::legacy(t, te, h, x, buzz));
            if n.kind == "diddle" && fam != Fam::Cymbals {
                list.push(Stroke::legacy(t + dur / 2.0, t + dur / 2.0, h * 0.65, x, 0));
            }
            if n.kind == "flam" && n.hand != 'B' && fam != Fam::Cymbals && fam != Fam::Glock {
                let other = if right { &mut out.l } else { &mut out.r };
                other.push(Stroke::legacy(t - grace, t - grace, 0.2, stick_base(fam, !right), 0));
            }
        }
        ni += 1;
    }
    out.r.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    out.l.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    Some(out)
}

#[derive(Clone, Copy, Debug)]
pub struct HandSt {
    pub lift: f32,
    pub x: f32,
    pub rim: f32,
    pub dp: f32,
    pub dn: f32,
    /// この手のストロークがあるか（無ければ IK せず構えのまま）
    pub has: bool,
    pub p: V,
    pub n: V,
    pub f: V,
    pub b0: f32,
    pub arc: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct StrikeSt {
    pub r: HandSt,
    pub l: HandSt,
    /// 演奏中の度合い 0..1（音が 1 カウント以上途切れると手がなめらかに構えへ戻る）
    pub w: f32,
}

fn hand_state(list: &[Stroke], t: f32, spc: f32, base: f32, anc: Option<V>) -> HandSt {
    let lo = list.partition_point(|s| s.t <= t + 1e-9);
    let next = list.get(lo);
    let prev = if lo > 0 { list.get(lo - 1) } else { None };
    let mut o = HandSt { lift: 0.0, x: base, rim: 0.0, dp: 1e9, dn: 1e9, has: !list.is_empty(), p: [0.0; 3], n: [0.0, 1.0, 0.0], f: [0.0, 0.0, 1.0], b0: 0.3, arc: 0.0 };
    if let Some(p) = prev {
        o.dp = (t - p.t.max(p.te)).max(0.0);
    }
    if let Some(n) = next {
        o.dn = n.t - t;
    }
    let pi = std::f32::consts::PI;
    if let Some(p) = prev {
        if p.buzz > 0 && t <= p.te {
            o.lift = if p.buzz == 1 {
                0.05 + 0.035 * (2.0 * pi * 14.0 * t * spc).sin()
            } else if p.buzz == 3 {
                0.02
            } else {
                0.0
            };
            o.x = p.x;
            o.rim = p.rim;
            o.dp = 0.0;
            if let Some(a) = anc {
                o.p = if p.buzz == 3 { vlerp(p.p, p.p1, sst((t - p.t) / (p.te - p.t).max(1e-6))) } else { p.p };
                o.n = p.n;
                o.f = p.f.unwrap_or_else(|| f_of(o.p, o.n, a));
                o.b0 = p.b0;
            }
            return o;
        }
    }
    let sg = prev.map(|p| (t - p.t.max(p.te)) * spc).unwrap_or(1e9);
    let tau = next.map(|n| (n.t - t) * spc).unwrap_or(1e9);
    let lift = match next {
        None => {
            let x = sg / 0.32;
            match prev {
                Some(p) if x < 1.0 => p.h * 0.45 * (pi * x).sin(),
                _ => 0.0,
            }
        }
        Some(nx) => {
            let p = nx.h;
            let g = sg + tau;
            let f = (0.10 + 0.14 * p).min(0.55 * g);
            if tau <= f {
                p * (1.0 - (1.0 - tau / f).powf(1.7))
            } else if prev.is_none() {
                if tau < f + 0.18 {
                    p * (pi / 2.0 * (1.0 - (tau - f) / 0.18)).sin()
                } else {
                    0.0
                }
            } else if g > f + 0.32 {
                let m = p.min(0.1 + 0.2 * p);
                if tau < f + 0.10 {
                    m + (p - m) * sst(1.0 - (tau - f) / 0.10)
                } else if sg < 0.12 {
                    m * (pi / 2.0 * sg / 0.12).sin()
                } else {
                    m
                }
            } else {
                p * (pi / 2.0 * (sg / (g - f)).min(1.0)).sin()
            }
        }
    };
    o.lift = lift;
    let Some(anc) = anc else {
        match (prev, next) {
            (Some(p), Some(n)) => {
                let s = sst(sg / ((sg + tau) * 0.75));
                o.x = p.x + (n.x - p.x) * s;
                o.rim = p.rim + (n.rim - p.rim) * s;
            }
            (None, Some(n)) => {
                o.x = n.x;
                o.rim = n.rim;
            }
            (Some(p), None) => {
                o.x = p.x;
                o.rim = p.rim;
            }
            _ => {}
        }
        return o;
    };
    match (prev, next) {
        (Some(p), Some(n)) => {
            // 前の打面から次の打面へ。次の音の手前（間の 75%）で着き、そのまま構えて振り下ろす。離れた打面の間は弧を描いて持ち上げる
            let s = sst(sg / ((sg + tau) * 0.75));
            let pp = p.pe();
            o.p = vlerp(pp, n.p, s);
            o.n = vn(vlerp(p.n, n.n, s));
            o.b0 = p.b0 + (n.b0 - p.b0) * s;
            o.arc = 0.22 * vl(vsub(n.p, pp)) * (pi * s).sin();
            o.f = if p.f.is_some() || n.f.is_some() {
                vn(vlerp(p.f.unwrap_or_else(|| f_of(pp, p.n, anc)), n.f.unwrap_or_else(|| f_of(n.p, n.n, anc)), s))
            } else {
                f_of(o.p, o.n, anc)
            };
        }
        (_, _) => {
            if let Some(s0) = next.or(prev) {
                o.p = if next.is_some() { s0.p } else { s0.pe() };
                o.n = s0.n;
                o.b0 = s0.b0;
                o.f = s0.f.unwrap_or_else(|| f_of(o.p, o.n, anc));
            }
        }
    }
    o
}

/// 時刻 t（カウント）の状態。spc = 秒 / カウント。tbl = アセットの打面の表（IK の楽器のみ）
pub fn state(s: &Strokes, t: f32, spc: f32, tbl: Option<&StrikeTbl>) -> StrikeSt {
    let (ar, al) = match (s.ik, tbl) {
        (true, Some(tb)) => (Some(tb.anchor[0]), Some(tb.anchor[1])),
        _ => (None, None),
    };
    let r = hand_state(&s.r, t, spc, stick_base(s.fam, true), ar);
    let l = hand_state(&s.l, t, spc, stick_base(s.fam, false), al);
    let d = r.dp.min(r.dn).min(l.dp).min(l.dn);
    StrikeSt { r, l, w: 1.0 - sst((d - 0.4) / 0.9) }
}
