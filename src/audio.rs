//! パート（楽譜）の音を、外部ファイルなしで合成して WAV にする。
//! 打楽器（スネア・テナー・バス・シンバル）の合成は Kanade の打楽器合成を移植したもの
//! （ブラウザ側の src/audio.js と同じ式。ノイズは決まった乱数列なので毎回同じ音になる）。
use crate::build::{Part, Show};

const TAU: f64 = std::f64::consts::TAU;

/// Kanade と同じ4種の打楽器 + 鍵盤 + 管
#[derive(Clone, Copy, PartialEq, Debug)]
enum Fam {
    Snare,
    Tenor,
    Bass(u8),
    Cymbal,
    Xylo,
    Glock,
    Wind(f64),
    Silent,
}

/// 楽器ID → 音の系統。bass_drum はセクション内の番号 mi（0始まり）で大きさが決まる
fn family(instr: &str, mi: usize) -> Fam {
    match instr {
        "snare" => Fam::Snare,
        "tenors" => Fam::Tenor,
        "bass1" => Fam::Bass(1),
        "bass2" => Fam::Bass(2),
        "bass3" => Fam::Bass(3),
        "bass4" => Fam::Bass(4),
        "bass5" => Fam::Bass(5),
        "bass_drum" => Fam::Bass((mi.min(4) + 1) as u8),
        "cymbals_mid" | "cymbals_high" => Fam::Cymbal,
        "xylophone" => Fam::Xylo,
        "glockenspiel" => Fam::Glock,
        "none" | "flag" => Fam::Silent,
        "piccolo" => Fam::Wind(1568.0),
        "flute" => Fam::Wind(880.0),
        "oboe" | "eb_clarinet" | "soprano_sax" => Fam::Wind(698.5),
        "trumpet" | "clarinet" | "alto_sax" => Fam::Wind(466.2),
        "mellophone" | "marching_horn" | "horn" | "tenor_sax" | "alto_clarinet" => Fam::Wind(293.7),
        "trombone" | "euphonium" | "marching_euphonium" | "bassoon" | "bass_clarinet" | "baritone_sax" => Fam::Wind(196.0),
        _ => Fam::Wind(110.0),
    }
}

struct Synth {
    sr: f64,
    noise: Vec<f32>,
    hits: usize,
}

fn add(dst: &mut Vec<f32>, src: &[f32], at: usize) {
    if dst.len() < at + src.len() {
        dst.resize(at + src.len(), 0.0);
    }
    for (i, v) in src.iter().enumerate() {
        dst[at + i] += *v;
    }
}

impl Synth {
    fn new(sr: u32) -> Self {
        let n = sr as usize * 2;
        let mut x: u32 = 0x9E37_79B9;
        let noise = (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x as f64 / 4294967296.0 * 2.0 - 1.0) as f32
            })
            .collect();
        Synth { sr: sr as f64, noise, hits: 0 }
    }

    /// バンドパスをかけたノイズ。包絡線は 0.0001 → vol（2ms）→ 0.0001（dur）の指数減衰
    fn noise_hit(&mut self, dur: f64, freq: f64, q: f64, vol: f64) -> Vec<f32> {
        self.hits += 1;
        let n = (dur * self.sr) as usize;
        let off = (self.hits * 7919) % (self.noise.len() / 2);
        let w0 = TAU * freq / self.sr;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        let (b0, b2) = (alpha / a0, -alpha / a0);
        let (a1, a2) = (-2.0 * w0.cos() / a0, (1.0 - alpha) / a0);
        let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        let vol = vol.max(0.0002);
        let mut o = Vec::with_capacity(n);
        // 指数減衰は1サンプルごとに一定の倍率をかけて求める（累乗を毎回計算しない）
        let step = (0.0001 / vol).powf(1.0 / ((dur - 0.002) * self.sr));
        let mut ge = -1.0f64;
        for i in 0..n {
            let tau = i as f64 / self.sr;
            let g = if tau < 0.002 {
                vol * tau / 0.002
            } else {
                ge = if ge < 0.0 { vol * (0.0001 / vol).powf((tau - 0.002) / (dur - 0.002)) } else { ge * step };
                ge
            };
            let x = self.noise[(off + i) % self.noise.len()] as f64;
            let y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            o.push((y * g) as f32);
        }
        o
    }

    /// 音程が bend 倍まで下がる正弦波/三角波。包絡線は 1ms で立ち上がり dur で 0.0001 まで指数減衰
    fn body(&self, f: f64, dur: f64, vol: f64, tri: bool, bend: f64) -> Vec<f32> {
        let n = (dur * self.sr) as usize;
        let t_bend = dur.min(0.06);
        let vol = vol.max(0.0002);
        let mut ph = 0.0f64;
        let mut o = Vec::with_capacity(n);
        let step = (0.0001 / vol).powf(1.0 / ((dur - 0.001) * self.sr));
        let mut ge = -1.0f64;
        for i in 0..n {
            let tau = i as f64 / self.sr;
            let fr = f * bend.powf((tau / t_bend).min(1.0));
            let g = if tau < 0.001 {
                vol * tau / 0.001
            } else {
                ge = if ge < 0.0 { vol * (0.0001 / vol).powf((tau - 0.001) / (dur - 0.001)) } else { ge * step };
                ge
            };
            let s = (TAU * ph).sin();
            let w = if tri { 2.0 / std::f64::consts::PI * s.asin() } else { s };
            o.push((w * g) as f32);
            ph += fr / self.sr;
            ph -= ph.floor();
        }
        o
    }

    /// 時間とともに中心周波数が f0 → f1 に動くノイズ（スティックを面にこする音）
    fn sweep_noise(&mut self, dur: f64, f0: f64, f1: f64, q: f64, vol: f64) -> Vec<f32> {
        self.hits += 1;
        let n = (dur * self.sr) as usize;
        let off = (self.hits * 7919) % (self.noise.len() / 2);
        let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
        let mut o = Vec::with_capacity(n);
        for i in 0..n {
            let tau = i as f64 / self.sr;
            let k = tau / dur;
            let freq = f0 + (f1 - f0) * k;
            let w0 = TAU * freq / self.sr;
            let alpha = w0.sin() / (2.0 * q);
            let a0 = 1.0 + alpha;
            let (b0, b2) = (alpha / a0, -alpha / a0);
            let (a1, a2) = (-2.0 * w0.cos() / a0, (1.0 - alpha) / a0);
            // 立ち上がり 15ms、終わりに向けて弱まり、スティックの凹凸でゆらぐ
            let g = vol * (tau / 0.015).min(1.0) * (1.0 - 0.7 * k * k) * (0.72 + 0.28 * (TAU * 19.0 * tau).sin());
            let x = self.noise[(off + i) % self.noise.len()] as f64;
            let y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
            o.push((y * g) as f32);
        }
        o
    }

    /// 打楽器1打。idx は Kanade の打面番号（snare: 0センター 1リム 2スティック / tenor 0..5 = ドラム1..4・スポック1・2 / bass 0..4 / cymbal 0閉 1開 2クラッシュ 3チョーク）。
    /// br = 明るさ（強弱・アクセントで変わる。既定 1）、kind = 奏法（rimshot / mute / gock / scrape / stickclick。それ以外は通常）、dsec = 音符の長さ（秒。scrape の長さ）
    fn drum(&mut self, fam: Fam, idx: usize, level: f64, br: f64, kind: &str, dsec: f64) -> Vec<f32> {
        let mut o: Vec<f32> = vec![];
        let drum = matches!(fam, Fam::Snare | Fam::Tenor | Fam::Bass(_));
        if kind == "stickclick" {
            // 空中でスティック（マレット）を打ち合わせる音
            add(&mut o, &self.body(2400.0, 0.02, level * 0.5, true, 0.97), 0);
            add(&mut o, &self.body(3300.0, 0.012, level * 0.3, true, 0.98), 0);
            add(&mut o, &self.noise_hit(0.016, 4000.0 * br, 1.5, level * 0.6), 0);
            return o;
        }
        if kind == "gock" && drum {
            // シェル（胴）を叩く木質のコツッ。ドラムの大きさで高さが変わる
            let f = match fam {
                Fam::Snare => 760.0,
                Fam::Tenor => [900.0, 780.0, 680.0, 600.0, 1300.0, 1450.0][idx.min(5)],
                _ => [520.0, 600.0, 690.0, 800.0, 920.0][idx.min(4)],
            };
            add(&mut o, &self.body(f, 0.05, level * 0.9, true, 0.9), 0);
            add(&mut o, &self.body(f * 2.3, 0.025, level * 0.3, true, 0.95), 0);
            add(&mut o, &self.noise_hit(0.03, f * 3.0 * br, 2.5, level * 0.5), 0);
            return o;
        }
        if kind == "scrape" && drum {
            let d = dsec.clamp(0.08, 0.95);
            let (f0, f1) = match fam {
                Fam::Snare => (4200.0, 2200.0),
                Fam::Tenor => (3200.0, 1800.0),
                _ => (900.0, 400.0),
            };
            add(&mut o, &self.sweep_noise(d, f0 * br, f1 * br, 1.0, level * 1.6), 0);
            return o;
        }
        // 通常・リムショット・ミュート（ds は鳴りの長さの倍率）
        let ds: f64 = if kind == "mute" { 0.3 } else { 1.0 };
        let crack = |s: &mut Synth, o: &mut Vec<f32>, f: f64, vol: f64, d: f64| {
            add(o, &s.body(f, d, level * vol, false, 0.9), 0);
            add(o, &s.noise_hit(d * 0.8, 4800.0 * br, 0.8, level * vol * 1.3), 0);
        };
        match fam {
            Fam::Snare => {
                if idx == 2 {
                    let b = self.body(1800.0, 0.045, level * 0.65, true, 0.92);
                    add(&mut o, &b, 0);
                    let n = self.noise_hit(0.035, 3500.0 * br, 1.0, level * 0.3);
                    add(&mut o, &n, 0);
                } else {
                    let b = self.body(if idx == 1 { 650.0 } else { 390.0 }, (0.13 * ds).max(0.03), level * 0.8, true, 0.72);
                    add(&mut o, &b, 0);
                    let n = self.noise_hit(((if idx == 1 { 0.15 } else { 0.22 }) * ds).max(0.035), 2600.0 * br, 0.65, level * 1.8);
                    add(&mut o, &n, 0);
                    if idx == 1 {
                        let b = self.body(1850.0, 0.065 * ds.max(0.5), level * 0.5, false, 0.9);
                        add(&mut o, &b, 0);
                    }
                }
                if kind == "rimshot" {
                    crack(self, &mut o, 2100.0, 0.55, 0.07);
                } else if kind == "mute" {
                    // リムショットをすぐ止めた「スカンク」: 短いリムの鳴り
                    add(&mut o, &self.body(1850.0, 0.02, level * 0.35, false, 0.9), 0);
                }
            }
            Fam::Tenor => {
                let f = [300.0, 225.0, 168.0, 126.0, 560.0, 700.0][idx.min(5)];
                let spock = idx >= 4;
                let (d1, d2, dn): (f64, f64, f64) = if spock { (0.1, 0.05, 0.03) } else { (0.28, 0.13, 0.035) };
                let b = self.body(f * 1.35, (d1 * ds).max(0.03), level * if spock { 0.85 } else { 1.0 }, false, if spock { 0.9 } else { 0.72 });
                add(&mut o, &b, 0);
                let b = self.body(f * 2.12, (d2 * ds).max(0.02), level * 0.25 * br * br, true, 0.86);
                add(&mut o, &b, 0);
                let n = self.noise_hit(dn.max(0.03), (if spock { 3800.0 } else { 2400.0 }) * br, 1.0, level * if spock { 0.9 } else { 0.4 });
                add(&mut o, &n, 0);
                if kind == "rimshot" {
                    crack(self, &mut o, f * 3.4, 0.5, 0.06);
                } else if kind == "mute" {
                    add(&mut o, &self.body(f * 3.4, 0.02, level * 0.3, false, 0.9), 0);
                }
            }
            Fam::Bass(_) => {
                let f = [55.0, 68.0, 82.0, 100.0, 125.0][idx.min(4)];
                let b = self.body(f * 1.6, (0.48 * ds).max(0.09), level * 1.6, false, 0.65);
                add(&mut o, &b, 0);
                let b = self.body(f * 2.1, (0.2 * ds).max(0.05), level * 0.18, false, 0.8);
                add(&mut o, &b, 0);
                let n = self.noise_hit(0.045, 1200.0 * br, 0.8, level * 0.5);
                add(&mut o, &n, 0);
                if kind == "rimshot" {
                    crack(self, &mut o, 1100.0, 0.45, 0.05);
                }
            }
            _ => {
                let i = idx.min(3);
                let dur = [0.07, 0.55, 1.2, 0.055][i];
                let n = self.noise_hit(dur, if i < 2 { 8500.0 } else { 6500.0 }, if i < 2 { 0.7 } else { 0.45 }, level * if i == 3 { 0.65 } else { 1.3 });
                add(&mut o, &n, 0);
                for f in [2190.0, 3070.0, 4310.0, 5870.0] {
                    let b = self.body(f, dur * 0.8, level * if i < 2 { 0.045 } else { 0.09 }, true, 0.998);
                    add(&mut o, &b, 0);
                }
            }
        }
        o
    }

    /// 部分音の和（鍵盤・管）。attack 秒で立ち上がり、dur で指数減衰
    fn tone(&self, parts: &[(f64, f64, f64)], dur: f64, attack: f64, vol: f64) -> Vec<f32> {
        let n = (dur * self.sr) as usize;
        let vol = vol.max(0.0002);
        (0..n)
            .map(|i| {
                let tau = i as f64 / self.sr;
                let mut s = 0.0;
                for (f, a, d) in parts {
                    // 各部分音の減衰（d 秒でほぼ消える）
                    s += a * (TAU * f * tau).sin() * (-6.9 * tau / d).exp();
                }
                let g = if tau < attack { vol * tau / attack } else { vol };
                (s * g) as f32
            })
            .collect()
    }
}

struct Stroke {
    at: usize,
    buf: Vec<f32>,
    cym: Option<usize>,
}

fn jitter(a: usize, b: usize, c: usize) -> f64 {
    let mut x: u32 = (a as u32).wrapping_mul(0x9E37_79B1) ^ (b as u32).wrapping_mul(0x85EB_CA6B) ^ (c as u32).wrapping_mul(0xC2B2_AE35) ^ 0x27D4_EB2F;
    for _ in 0..3 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
    }
    (x % 1000) as f64 / 1000.0 * 0.003
}

fn secs(show: &Show, t: f64) -> f64 {
    crate::render::seconds_at(show, t)
}

/// 1人ぶんの演奏を strokes に積む
fn play_member(show: &Show, syn: &mut Synth, part: &Part, pi: usize, member: usize, mi: usize, out: &mut Vec<f32>) {
    let sr = syn.sr;
    let perf = &show.performers[member];
    let instr = &show.sections[perf.section].instrument;
    let fam = family(instr, mi);
    if fam == Fam::Silent {
        return;
    }
    let mut strokes: Vec<Stroke> = vec![];
    for (ni, n) in part.notes.iter().enumerate() {
        let t0 = secs(show, n.t) + jitter(pi, member, ni);
        let dsec = (secs(show, n.t + n.dur) - secs(show, n.t)).max(0.02);
        // 強弱（mf = 0.7 を 1 とする）とアクセントで音量と明るさが変わる
        let vel = n.vel as f64;
        let base = [0.5, 0.8, 1.0][n.accent.min(2) as usize] * if n.hand == 'B' { 1.15 } else { 1.0 } * (vel / 0.7).powf(1.2);
        let br = (1.0 + 0.6 * (vel - 0.7) + 0.12 * n.accent.min(2) as f64).clamp(0.6, 1.4);
        // 打面・ドラムの決定
        let (idx, cym): (usize, Option<usize>) = match fam {
            Fam::Snare => (
                if n.kind == "click" {
                    2
                } else if n.kind == "rimshot" {
                    1
                } else {
                    match n.pad {
                        2 => 1,
                        3 => 2,
                        _ => 0,
                    }
                },
                None,
            ),
            // テナー: 1〜4 = 主ドラム（1 が最高音）、5・6 = スポック。0 は主ドラムを順に回す
            Fam::Tenor => (if n.pad == 0 { ni % 4 } else { (n.pad as usize - 1).min(5) }, None),
            Fam::Bass(k) => {
                if n.kind != "stickclick" && n.pad != 0 && n.pad != k {
                    continue;
                }
                (5 - k as usize, None)
            }
            Fam::Cymbal => {
                let i = match n.pad {
                    2 => 0,
                    3 => 1,
                    4 => 3,
                    _ => 2,
                };
                (i, Some(i))
            }
            _ => (0, None),
        };
        // 1音 → 打点の並び (時刻オフセット秒, 強さ)
        let mut hits: Vec<(f64, f64)> = vec![];
        let drum = matches!(fam, Fam::Snare | Fam::Tenor | Fam::Bass(_) | Fam::Cymbal);
        match n.kind {
            "flam" => {
                hits.push((-0.03, base * 0.45));
                hits.push((0.0, base));
            }
            "diddle" => {
                hits.push((0.0, base * 0.85));
                hits.push((dsec / 2.0, base * 0.85));
            }
            "buzz" if drum && fam != Fam::Cymbal => {
                let k = ((dsec / 0.014) as usize).max(2);
                for j in 0..k {
                    let f = j as f64 / k as f64;
                    hits.push((j as f64 * 0.014, base * (0.9 - 0.55 * f) * if j == 0 { 1.0 } else { 0.6 }));
                }
            }
            _ => hits.push((0.0, base)),
        }
        for (off, lv) in hits {
            let at = ((t0 + off).max(0.0) * sr) as usize;
            let buf = match fam {
                Fam::Snare | Fam::Tenor | Fam::Bass(_) | Fam::Cymbal => syn.drum(fam, idx, lv * 0.3, br, if fam == Fam::Cymbal && n.kind != "stickclick" { "tap" } else { n.kind }, dsec),
                Fam::Xylo => {
                    let f = [523.25, 587.33, 659.25, 783.99, 880.0][ni % 5];
                    syn.tone(&[(f, 1.0, 0.35), (f * 3.9, 0.35, 0.12)], 0.5, 0.001, lv * 0.35)
                }
                Fam::Glock => {
                    let f = [1046.5, 1174.7, 1318.5, 1568.0, 1760.0][ni % 5];
                    syn.tone(&[(f, 1.0, 1.2), (f * 2.76, 0.3, 0.6), (f * 5.4, 0.15, 0.3)], 1.4, 0.001, lv * 0.25)
                }
                Fam::Wind(f) => {
                    let d = dsec.clamp(0.08, 1.5);
                    let nn = (d * sr) as usize;
                    let rel = 0.06f64.min(d / 3.0);
                    (0..nn)
                        .map(|i| {
                            let tau = i as f64 / sr;
                            let env = (tau / 0.02).min(1.0) * ((d - tau) / rel).clamp(0.0, 1.0);
                            let w = (TAU * f * tau).sin() + 0.3 * (TAU * 2.0 * f * tau).sin() + 0.15 * (TAU * 3.0 * f * tau).sin();
                            (w * env * lv * 0.12) as f32
                        })
                        .collect()
                }
                Fam::Silent => vec![],
            };
            if let Some(ci) = cym {
                // 閉じたハイハットは開いたハイハットを、チョークは先に鳴っているシンバルを止める
                if ci == 0 || ci == 3 {
                    for s in strokes.iter_mut() {
                        if let Some(oc) = s.cym {
                            if s.at < at && (ci == 3 || oc == 1) {
                                let from = at - s.at;
                                let len = (from + (0.04 * sr) as usize).min(s.buf.len());
                                for (k, v) in s.buf.iter_mut().enumerate().take(len).skip(from.min(len)) {
                                    *v *= (-((k - from) as f64) / (0.006 * sr)).exp() as f32;
                                }
                                s.buf.truncate(len);
                            }
                        }
                    }
                }
            }
            strokes.push(Stroke { at, buf, cym });
        }
    }
    let gain = 1.0 / (part.members.len().max(1) as f64).sqrt();
    for s in strokes {
        let g = gain as f32;
        if out.len() < s.at + s.buf.len() {
            out.resize(s.at + s.buf.len(), 0.0);
        }
        for (i, v) in s.buf.iter().enumerate() {
            out[s.at + i] += v * g;
        }
    }
}

/// 全パートを合成した、-0.9〜0.9 に正規化したモノラル波形
pub fn render_samples(show: &Show, sample_rate: u32) -> Vec<f32> {
    let total = show.sets.last().map(|s| s.start + s.counts + s.hold).unwrap_or(0.0);
    let n = ((secs(show, total) + 1.0) * sample_rate as f64) as usize;
    let mut out = vec![0.0f32; n];
    let mut syn = Synth::new(sample_rate);
    for (pi, part) in show.parts.iter().enumerate() {
        for &m in &part.members {
            // セクション内の何番目か
            let mi = show.performers[..m].iter().filter(|p| p.section == show.performers[m].section).count();
            play_member(show, &mut syn, part, pi, m, mi, &mut out);
        }
    }
    let peak = out.iter().fold(0.0f32, |a, v| a.max(v.abs()));
    if peak > 0.0 {
        let k = 0.9 / peak;
        for v in out.iter_mut() {
            *v *= k;
        }
    }
    out
}

/// 16bit モノラル WAV（ショー全体。時間はセットごとのテンポでカウントから換算）
pub fn render_wav(show: &Show, sample_rate: u32) -> Vec<u8> {
    let s = render_samples(show, sample_rate);
    let data_len = (s.len() * 2) as u32;
    let mut o = Vec::with_capacity(44 + data_len as usize);
    o.extend_from_slice(b"RIFF");
    o.extend_from_slice(&(36 + data_len).to_le_bytes());
    o.extend_from_slice(b"WAVEfmt ");
    o.extend_from_slice(&16u32.to_le_bytes());
    o.extend_from_slice(&1u16.to_le_bytes());
    o.extend_from_slice(&1u16.to_le_bytes());
    o.extend_from_slice(&sample_rate.to_le_bytes());
    o.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    o.extend_from_slice(&2u16.to_le_bytes());
    o.extend_from_slice(&16u16.to_le_bytes());
    o.extend_from_slice(b"data");
    o.extend_from_slice(&data_len.to_le_bytes());
    for v in s {
        o.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
    }
    o
}

/// 動画に混ぜる一時 WAV。消えるときにファイルも消す
pub struct TempWav {
    pub path: String,
}

impl Drop for TempWav {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// 動画に混ぜる音声: (一時WAV, ffmpeg の -af に渡すフィルタ)。part に音符がなければ None。
/// speed != 1 のときは atempo で時間を縮める/伸ばす（音程は変わらない）
pub fn mux_track(show: &Show, speed: f64) -> Option<(TempWav, String)> {
    if !show.parts.iter().any(|p| !p.notes.is_empty()) {
        return None;
    }
    let p = std::env::temp_dir().join(format!("jinkei_audio_{}_{}.wav", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0)));
    std::fs::write(&p, render_wav(show, 48000)).ok()?;
    let mut f: Vec<String> = vec![];
    let mut s = speed;
    // atempo は 1 回で 0.5〜100。範囲外は重ねる
    while s < 0.5 - 1e-9 {
        f.push("atempo=0.5".into());
        s /= 0.5;
    }
    while s > 100.0 {
        f.push("atempo=100".into());
        s /= 100.0;
    }
    if (s - 1.0).abs() > 1e-9 {
        f.push(format!("atempo={}", s));
    }
    // 動画のほうが長いので、無音で埋めて動画の長さに合わせる
    f.push("apad".into());
    Some((TempWav { path: p.to_string_lossy().into_owned() }, f.join(",")))
}
