//! 楽譜の音符 → 打楽器を叩く腕の動き。ブラウザの src/strike.js と同じ式。
//! ストローク列を作る（strokes）→ 時刻 t の手ごとの状態を引く（state）→ 上半身ボーンへ書く（human.rs の apply_strike）。
//! 状態は手ごとに lift（スティックの高さ 0..1。0 = 打面）・x（先端の目標 x。モデル座標 m）・rim（縁へ寄せる量 -1..1）。
use crate::build::Note;

const AH: [f32; 3] = [0.30, 0.60, 1.0];

fn sst(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
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

/// スティック先端の待機位置 x（モデル座標、右手は負、左手は正）
pub fn stick_base(fam: Fam, right: bool) -> f32 {
    let a = match fam {
        Fam::Tenors => 0.11,
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

/// テナーのドラム位置（低→高 = 大→小、スポックは上手側）。手の届く範囲に収める
fn tenor_x(idx: usize, right: bool) -> f32 {
    let x = if idx >= 5 { 0.30 } else { 0.343 - idx.min(4) as f32 / 4.0 * 0.686 };
    if right {
        x.min(0.10)
    } else {
        x.max(-0.10)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Stroke {
    pub t: f32,
    pub te: f32,
    pub h: f32,
    pub x: f32,
    pub rim: f32,
    /// 0 = 打つ、1 = バズ（押しつけて震える）、2 = チョーク（押さえたまま）
    pub buzz: u8,
}

pub struct Strokes {
    pub fam: Fam,
    pub r: Vec<Stroke>,
    pub l: Vec<Stroke>,
}

/// 1人ぶんの音符 → 手ごとのストローク列。叩かない楽器なら None
pub fn strokes(notes: &[&Note], kind: &str, spc: f32) -> Option<Strokes> {
    let fam = fam_of(kind)?;
    let mut out = Strokes { fam, r: vec![], l: vec![] };
    if notes.is_empty() {
        return Some(out);
    }
    let bs: u8 = if fam == Fam::Bass { kind.as_bytes()[4] - b'0' } else { 0 };
    let grace = 0.065 / spc;
    let mut ni = 0usize;
    for n in notes {
        let (t, dur) = (n.t as f32, n.dur as f32);
        if fam == Fam::Bass && n.pad > 0 && n.pad != bs {
            continue;
        }
        let hs: &[bool] = match (fam, n.hand) {
            (Fam::Cymbals, _) | (_, 'B') => &[true, false],
            (Fam::Glock, _) => &[true],
            (_, 'R') => &[true],
            _ => &[false],
        };
        for &right in hs {
            let mut h = AH.get(n.accent as usize).copied().unwrap_or(0.3);
            let mut x = stick_base(fam, right);
            let (mut rim, mut buzz, mut te) = (0.0f32, 0u8, t);
            match fam {
                Fam::Snare => {
                    if n.pad == 2 || n.kind == "click" {
                        rim = 1.0;
                        if n.kind == "click" {
                            h *= 0.6;
                        }
                    } else if n.pad == 3 {
                        rim = -0.6;
                        h *= 0.8;
                    }
                }
                Fam::Tenors => x = tenor_x(if n.pad > 0 { n.pad as usize - 1 } else { ni % 5 }, right),
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
            list.push(Stroke { t, te, h, x, rim, buzz });
            if n.kind == "diddle" && fam != Fam::Cymbals {
                list.push(Stroke { t: t + dur / 2.0, te: t + dur / 2.0, h: h * 0.65, x, rim, buzz: 0 });
            }
            if n.kind == "flam" && n.hand != 'B' && fam != Fam::Cymbals && fam != Fam::Glock {
                let gx = if fam == Fam::Tenors { x } else { stick_base(fam, !right) };
                let other = if right { &mut out.l } else { &mut out.r };
                other.push(Stroke { t: t - grace, te: t - grace, h: 0.2, x: gx, rim: 0.0, buzz: 0 });
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
}

#[derive(Clone, Copy, Debug)]
pub struct StrikeSt {
    pub r: HandSt,
    pub l: HandSt,
    /// 演奏中の度合い 0..1（音が 1 カウント以上途切れると手がなめらかに構えへ戻る）
    pub w: f32,
}

fn hand_state(list: &[Stroke], t: f32, spc: f32, base: f32) -> HandSt {
    let lo = list.partition_point(|s| s.t <= t + 1e-9);
    let next = list.get(lo);
    let prev = if lo > 0 { list.get(lo - 1) } else { None };
    let mut o = HandSt { lift: 0.0, x: base, rim: 0.0, dp: 1e9, dn: 1e9 };
    if let Some(p) = prev {
        o.dp = (t - p.t.max(p.te)).max(0.0);
    }
    if let Some(n) = next {
        o.dn = n.t - t;
    }
    if let Some(p) = prev {
        if p.buzz > 0 && t <= p.te {
            o.lift = if p.buzz == 1 { 0.05 + 0.035 * (2.0 * std::f32::consts::PI * 14.0 * t * spc).sin() } else { 0.0 };
            o.x = p.x;
            o.rim = p.rim;
            o.dp = 0.0;
            return o;
        }
    }
    let sg = prev.map(|p| (t - p.t.max(p.te)) * spc).unwrap_or(1e9);
    let tau = next.map(|n| (n.t - t) * spc).unwrap_or(1e9);
    let pi = std::f32::consts::PI;
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
    o
}

/// 時刻 t（カウント）の状態。spc = 秒 / カウント
pub fn state(s: &Strokes, t: f32, spc: f32) -> StrikeSt {
    let r = hand_state(&s.r, t, spc, stick_base(s.fam, true));
    let l = hand_state(&s.l, t, spc, stick_base(s.fam, false));
    let d = r.dp.min(r.dn).min(l.dp).min(l.dn);
    StrikeSt { r, l, w: 1.0 - sst((d - 0.4) / 0.9) }
}
