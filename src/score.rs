//! パート（打楽器・管楽器の楽譜）記法の解析。
//! `part "名前" for 対象 { ... }` の波括弧の中身（本文）を、開始位置からの相対カウントの音符列にする。
use crate::syntax::fmt_num;
use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum PartStart {
    Count(f64),
    /// start set 名前
    Set(String),
}

/// 相対時刻（パート開始 = 0）の音符
#[derive(Debug, Clone, Copy)]
pub struct RNote {
    pub t: f64,
    pub dur: f64,
    pub hand: char,
    pub accent: u8,
    pub kind: &'static str,
    pub pad: u8,
    /// 強弱（0..1。既定 mf = 0.7）。アクセントとは別
    pub vel: f32,
}

#[derive(Debug, Clone)]
pub struct BarIssue {
    /// 1始まりの小節番号
    pub bar: usize,
    pub got: f64,
    pub want: f64,
    /// 小節の頭の相対カウント
    pub at: f64,
}

#[derive(Debug, Clone)]
pub struct PartBody {
    pub meter: Option<(u32, u32)>,
    pub start: Option<PartStart>,
    pub start_pos: (usize, usize),
    pub notes: Vec<RNote>,
    /// 小節の頭の相対カウント
    pub bars: Vec<f64>,
    /// 記譜全体の長さ（末尾の休符を含む）
    pub len: f64,
    pub issues: Vec<BarIssue>,
    /// meter / start を除いた記譜テキスト（インデントをそろえたもの）
    pub src: String,
}

#[derive(Debug, Clone)]
enum It {
    /// ev = 同時に鳴らす (手, ドラム番号) の並び。和音 R[135] は複数
    Note { dur: f64, accent: u8, kind: &'static str, ev: Vec<(char, u8)> },
    /// 強弱記号 pp p mp mf f ff
    Dyn(f64),
    /// cresc（+1）/ dim（-1）。次の強弱記号までなめらかに変える
    Ramp(f64),
    Rest(f64),
    Tie(f64, usize, usize),
    Bar,
}

const EPS: f64 = 1e-6;
/// 強弱記号 → 音量（0..1）
pub const DEFAULT_VEL: f64 = 0.7;
fn dyn_vel(w: &str) -> Option<f64> {
    Some(match w {
        "pp" => 0.25,
        "p" => 0.4,
        "mp" => 0.55,
        "mf" => 0.7,
        "f" => 0.85,
        "ff" => 1.0,
        _ => return None,
    })
}
/// cresc / dim で次の強弱記号がないときの変化量
const RAMP_OPEN: f64 = 0.25;
fn r3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}
const MAX_ITEMS: usize = 200_000;

struct Sc {
    cs: Vec<char>,
    i: usize,
    line: usize,
    col: usize,
    div: u32,
    dotted: bool,
    den: u32,
    meter: Option<(u32, u32)>,
    start: Option<PartStart>,
    start_pos: (usize, usize),
    any: bool,
    cuts: Vec<(usize, usize)>,
    /// 連符の中: (1スロットの長さ, 個数, 必要な個数)
    tup: Option<(f64, usize, usize)>,
}

fn is_pow2(n: u32) -> bool {
    n != 0 && n & (n - 1) == 0
}

impl Sc {
    fn peek(&self) -> Option<char> {
        self.cs.get(self.i).copied()
    }
    fn peek2(&self) -> Option<char> {
        self.cs.get(self.i + 1).copied()
    }
    fn adv(&mut self) -> char {
        let c = self.cs[self.i];
        self.i += 1;
        if c == '\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
        }
        c
    }
    fn err(&self, m: impl Into<String>) -> Error {
        Error::at(self.line, self.col, m)
    }
    fn skip(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_whitespace() {
                self.adv();
            } else if c == '#' || (c == '/' && self.peek2() == Some('/')) {
                while let Some(c) = self.peek() {
                    if c == '\n' {
                        break;
                    }
                    self.adv();
                }
            } else {
                break;
            }
        }
    }
    /// 行内の空白だけ飛ばす
    fn skip_inline(&mut self) {
        while let Some(c) = self.peek() {
            if c == ' ' || c == '\t' {
                self.adv();
            } else {
                break;
            }
        }
    }
    fn digits(&mut self) -> String {
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_digit() {
                s.push(self.adv());
            } else {
                break;
            }
        }
        s
    }
    fn div_dur(&self) -> f64 {
        self.den as f64 / self.div as f64 * if self.dotted { 1.5 } else { 1.0 }
    }
    fn slot(&self) -> f64 {
        match self.tup {
            Some((s, _, _)) => s,
            None => self.div_dur(),
        }
    }
    fn tick_tup(&mut self) {
        if let Some(t) = self.tup.as_mut() {
            t.1 += 1;
        }
    }
    fn word(&self) -> String {
        let mut j = self.i;
        let mut s = String::new();
        while j < self.cs.len() && self.cs[j].is_alphabetic() {
            s.push(self.cs[j]);
            j += 1;
        }
        s
    }

    fn items(&mut self, depth: usize) -> Result<Vec<It>> {
        let mut out: Vec<It> = vec![];
        loop {
            self.skip();
            let Some(c) = self.peek() else {
                if self.tup.is_some() {
                    return Err(self.err("'[' が ']' で閉じられていません"));
                }
                if depth > 0 {
                    return Err(self.err("くり返しの '{' が '}' で閉じられていません"));
                }
                break;
            };
            if out.len() > MAX_ITEMS {
                return Err(self.err("音符が多すぎます"));
            }
            match c {
                '|' => {
                    if self.tup.is_some() {
                        return Err(self.err("連符の中には音符・休符・タイだけを書けます"));
                    }
                    self.adv();
                    self.any = true;
                    out.push(It::Bar);
                }
                '}' => {
                    if depth > 0 && self.tup.is_none() {
                        self.adv();
                        break;
                    }
                    return Err(self.err("対応する '{' のない '}' です"));
                }
                '{' => return Err(self.err("'{' は repeat N { ... } の形でだけ使えます")),
                ']' => {
                    let Some((_, n, need)) = self.tup else {
                        return Err(self.err("対応する '[' のない ']' です"));
                    };
                    if n != need {
                        return Err(self.err(format!("{}[ ] の中は{}個分の音符・休符が必要です（今は{}個）", need, need, n)));
                    }
                    self.adv();
                    self.tup = None;
                }
                '-' => {
                    self.adv();
                    self.any = true;
                    self.tick_tup();
                    out.push(It::Rest(self.slot()));
                }
                '~' => {
                    let (l, cl) = (self.line, self.col);
                    self.adv();
                    self.any = true;
                    self.tick_tup();
                    out.push(It::Tie(self.slot(), l, cl));
                }
                c if c.is_ascii_digit() => {
                    if self.tup.is_some() {
                        return Err(self.err("連符の中には音符・休符・タイだけを書けます"));
                    }
                    let (l, cl) = (self.line, self.col);
                    let ds = self.digits();
                    let n: u32 = ds.parse().unwrap_or(u32::MAX);
                    if self.peek() == Some('.') && self.peek2() == Some(':') {
                        self.check_div(n, l, cl)?;
                        self.adv();
                        self.adv();
                        self.div = n;
                        self.dotted = true;
                    } else if self.peek() == Some(':') {
                        self.check_div(n, l, cl)?;
                        self.adv();
                        self.div = n;
                        self.dotted = false;
                    } else if self.peek() == Some('[') {
                        if !(2..=32).contains(&n) {
                            return Err(Error::at(l, cl, "連符の数は2〜32にしてください"));
                        }
                        self.adv();
                        let p = if is_pow2(n) {
                            n / 2
                        } else {
                            let mut p = 1;
                            while p * 2 < n {
                                p *= 2;
                            }
                            p
                        };
                        let slot = p as f64 * self.div_dur() / n as f64;
                        self.tup = Some((slot, 0, n as usize));
                        self.any = true;
                    } else {
                        return Err(Error::at(l, cl, format!("数字「{}」の後には ':'（分割の指定。例 16:）か '['（連符。例 3[ r l r ]）が必要です", ds)));
                    }
                }
                _ if c.is_alphabetic() => {
                    let w = self.word();
                    match w.as_str() {
                        "meter" | "拍子" | "start" | "開始" | "repeat" | "くり返し" => {
                            if self.tup.is_some() {
                                return Err(self.err("連符の中には音符・休符・タイだけを書けます"));
                            }
                            self.keyword(&w, depth, &mut out)?;
                        }
                        "cresc" | "decresc" | "dim" => {
                            for _ in w.chars() {
                                self.adv();
                            }
                            out.push(It::Ramp(if w == "cresc" { 1.0 } else { -1.0 }));
                        }
                        _ if dyn_vel(&w).is_some() => {
                            for _ in w.chars() {
                                self.adv();
                            }
                            out.push(It::Dyn(dyn_vel(&w).unwrap()));
                        }
                        _ => {
                            let it = self.note()?;
                            self.any = true;
                            self.tick_tup();
                            out.push(it);
                        }
                    }
                }
                '>' | '^' => {
                    let it = self.note()?;
                    self.any = true;
                    self.tick_tup();
                    out.push(it);
                }
                c => return Err(self.err(format!("使えない文字です: '{}'", c))),
            }
        }
        Ok(out)
    }

    fn check_div(&self, n: u32, l: usize, c: usize) -> Result<()> {
        if !is_pow2(n) || n > 64 {
            return Err(Error::at(l, c, format!("分割「{}:」は 1 / 2 / 4 / 8 / 16 / 32 / 64 のどれかにしてください", n)));
        }
        Ok(())
    }

    fn keyword(&mut self, w: &str, depth: usize, out: &mut Vec<It>) -> Result<()> {
        let k0 = self.i;
        let (kl, kc) = (self.line, self.col);
        for _ in w.chars() {
            self.adv();
        }
        match w {
            "meter" | "拍子" => {
                if self.any || depth > 0 {
                    return Err(Error::at(kl, kc, "拍子（meter）は音符より前に、1回だけ書いてください"));
                }
                if self.meter.is_some() {
                    return Err(Error::at(kl, kc, "拍子（meter）は1回だけ書いてください"));
                }
                self.skip_inline();
                let (l, c) = (self.line, self.col);
                let a = self.digits();
                if a.is_empty() || self.peek() != Some('/') {
                    return Err(Error::at(l, c, "拍子は 4/4 や 6/8 の形で書いてください"));
                }
                self.adv();
                let b = self.digits();
                let (n, d): (u32, u32) = (a.parse().unwrap_or(0), b.parse().unwrap_or(0));
                if n == 0 || n > 64 || !is_pow2(d) || d > 32 {
                    return Err(Error::at(l, c, "拍子の分子は1〜64、分母は 1 / 2 / 4 / 8 / 16 / 32 にしてください"));
                }
                self.meter = Some((n, d));
                self.den = d;
                self.cuts.push((k0, self.i));
            }
            "start" | "開始" => {
                if self.any || depth > 0 {
                    return Err(Error::at(kl, kc, "開始（start）は音符より前に、1回だけ書いてください"));
                }
                if self.start.is_some() {
                    return Err(Error::at(kl, kc, "開始（start）は1回だけ書いてください"));
                }
                self.skip_inline();
                let (l, c) = (self.line, self.col);
                self.start_pos = (l, c);
                if self.word() == "set" {
                    for _ in 0..3 {
                        self.adv();
                    }
                    self.skip_inline();
                    let (nl, nc) = (self.line, self.col);
                    let name = if self.peek() == Some('"') {
                        self.adv();
                        let mut s = String::new();
                        loop {
                            match self.peek() {
                                None | Some('\n') => return Err(Error::at(nl, nc, "文字列が閉じられていません")),
                                Some('"') => {
                                    self.adv();
                                    break;
                                }
                                Some(_) => s.push(self.adv()),
                            }
                        }
                        s
                    } else {
                        let mut s = String::new();
                        while let Some(ch) = self.peek() {
                            if ch.is_alphanumeric() || ch == '_' || (ch == '.' && self.peek2().is_some_and(|d| d.is_ascii_digit()) && s.chars().all(|x| x.is_ascii_digit()) && !s.is_empty()) {
                                s.push(self.adv());
                            } else {
                                break;
                            }
                        }
                        if s.is_empty() {
                            return Err(Error::at(nl, nc, "start set の後にはセット名が必要です"));
                        }
                        if s.chars().next().is_some_and(|x| x.is_ascii_digit()) && s.chars().all(|x| x.is_ascii_digit() || x == '.') {
                            fmt_num(s.parse().unwrap_or(0.0))
                        } else {
                            s
                        }
                    };
                    self.start = Some(PartStart::Set(name));
                } else {
                    let mut s = self.digits();
                    if s.is_empty() {
                        return Err(Error::at(l, c, "start の後にはカウント数か `set セット名` が必要です"));
                    }
                    if self.peek() == Some('.') && self.peek2().is_some_and(|d| d.is_ascii_digit()) {
                        self.adv();
                        s.push('.');
                        s.push_str(&self.digits());
                    }
                    self.start = Some(PartStart::Count(s.parse().unwrap_or(0.0)));
                }
                self.cuts.push((k0, self.i));
            }
            _ => {
                // repeat N { ... }
                self.skip();
                let (l, c) = (self.line, self.col);
                let ds = self.digits();
                let n: usize = ds.parse().unwrap_or(0);
                if ds.is_empty() || !(1..=999).contains(&n) {
                    return Err(Error::at(l, c, "くり返しの回数は1〜999の整数にしてください（例: repeat 2 { ... }）"));
                }
                self.skip();
                if self.peek() != Some('{') {
                    return Err(self.err("repeat N の後に '{' が必要です"));
                }
                self.adv();
                self.any = true;
                let body = self.items(depth + 1)?;
                if body.len().saturating_mul(n) > MAX_ITEMS {
                    return Err(Error::at(l, c, "くり返しで音符が多くなりすぎます"));
                }
                for _ in 0..n {
                    out.extend(body.iter().cloned());
                }
            }
        }
        Ok(())
    }

    fn note(&mut self) -> Result<It> {
        let mut acc = 0u8;
        let mut kind: Option<&'static str> = None;
        let mut had = false;
        loop {
            let k = match self.peek() {
                Some('>') => {
                    acc = acc.max(1);
                    None
                }
                Some('^') => {
                    acc = 2;
                    None
                }
                Some('x') => Some("click"),
                Some('f') => Some("flam"),
                Some('d') => Some("diddle"),
                Some('z') => Some("buzz"),
                Some('o') => Some("rimshot"),
                Some('m') => Some("mute"),
                Some('g') => Some("gock"),
                Some('s') => Some("scrape"),
                Some('k') => Some("stickclick"),
                _ => break,
            };
            if let Some(k) = k {
                if kind.is_some() {
                    return Err(self.err("奏法の指定（x f d z o m g s k）は1音に1つだけです"));
                }
                kind = Some(k);
            }
            had = true;
            self.adv();
        }
        let hand = match self.peek() {
            Some(c @ ('r' | 'l' | 'b')) => c.to_ascii_uppercase(),
            Some(c @ ('R' | 'L' | 'B')) => {
                acc = acc.max(1);
                c
            }
            Some(c) => {
                return Err(self.err(if had { "音符の手（R / L / B）が必要です".to_string() } else { format!("使えない文字です: '{}'（音符は R L B r l b。休符 - ・タイ ~）", c) }));
            }
            None => return Err(self.err("音符の手（R / L / B）が必要です")),
        };
        self.adv();
        let mut ev: Vec<(char, u8)> = vec![(hand, 0)];
        if self.peek() == Some('[') {
            // 和音: R[135] = 同じ手で複数のドラム、B[12] = 右手が1、左手が2、B[3] = 両手で3
            let (l, c) = (self.line, self.col);
            self.adv();
            let mut pads: Vec<u8> = vec![];
            loop {
                match self.peek() {
                    Some(d) if d.is_ascii_digit() && d != '0' => {
                        pads.push(d as u8 - b'0');
                        self.adv();
                    }
                    Some(']') => {
                        self.adv();
                        break;
                    }
                    _ => return Err(Error::at(l, c, "和音 [ ] の中はドラム番号（1〜9）を並べて ']' で閉じてください（例: R[135]、B[12]）")),
                }
            }
            if pads.is_empty() {
                return Err(Error::at(l, c, "和音 [ ] の中にドラム番号がありません（例: R[135]）"));
            }
            ev = if hand == 'B' {
                match pads.len() {
                    1 => vec![('B', pads[0])],
                    2 => vec![('R', pads[0]), ('L', pads[1])],
                    _ => return Err(Error::at(l, c, "B[ ] は1つ（両手で同じドラム）か2つ（右手・左手）のドラム番号を書いてください")),
                }
            } else {
                pads.iter().map(|p| (hand, *p)).collect()
            };
        } else if let Some(d) = self.peek().filter(|d| d.is_ascii_digit()) {
            ev[0].1 = d as u8 - b'0';
            self.adv();
        }
        Ok(It::Note { dur: self.slot(), accent: acc, kind: kind.unwrap_or("tap"), ev })
    }
}

/// meter / start を除いたテキストを、先頭末尾の空行・各行の末尾空白・共通インデントを除いて返す
fn normalize_src(cs: &[char], cuts: &[(usize, usize)]) -> String {
    let mut s = String::new();
    for (i, c) in cs.iter().enumerate() {
        if cuts.iter().any(|&(a, b)| i >= a && i < b) {
            continue;
        }
        s.push(*c);
    }
    let mut lines: Vec<String> = s.split('\n').map(|l| l.trim_end().to_string()).collect();
    while lines.first().is_some_and(|l| l.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let ind = |l: &str| l.chars().take_while(|c| *c == ' ' || *c == '\t').count();
    let m = lines.iter().filter(|l| !l.is_empty()).map(|l| ind(l)).min().unwrap_or(0);
    lines.iter().map(|l| if l.is_empty() { String::new() } else { l.chars().skip(m).collect::<String>() }).collect::<Vec<_>>().join("\n")
}

/// 本文を解析する。(line, col) は本文の先頭文字の位置
pub fn parse_body(src: &str, line: usize, col: usize) -> Result<PartBody> {
    let mut sc = Sc {
        cs: src.chars().collect(),
        i: 0,
        line,
        col,
        div: 16,
        dotted: false,
        den: 4,
        meter: None,
        start: None,
        start_pos: (line, col),
        any: false,
        cuts: vec![],
        tup: None,
    };
    let items = sc.items(0)?;
    let meter = sc.meter.unwrap_or((4, 4));
    let want = meter.0 as f64;
    let mut notes: Vec<RNote> = vec![];
    let mut bars: Vec<f64> = vec![];
    let mut issues = vec![];
    let (mut t, mut bar_start, mut bar_no) = (0.0f64, 0.0f64, 1usize);
    let mut has = false;
    let mut pending: Option<f64> = Some(0.0);
    let mut last: Option<(usize, usize)> = None;
    let open = |pending: &mut Option<f64>, bars: &mut Vec<f64>| {
        if let Some(p) = pending.take() {
            bars.push(p);
        }
    };
    // 強弱: 現在の音量と、cresc / dim の途中（開始時刻・開始音量・向き・最初の音符の位置）
    let mut cur = DEFAULT_VEL;
    let mut ramp: Option<(f64, f64, f64, usize)> = None;
    fn settle(notes: &mut [RNote], r: (f64, f64, f64, usize), t1: f64, v1: f64) {
        for n in notes.iter_mut().skip(r.3) {
            let f = if t1 - r.0 > 1e-9 { ((n.t - r.0) / (t1 - r.0)).clamp(0.0, 1.0) } else { 1.0 };
            n.vel = r3(r.1 + (v1 - r.1) * f) as f32;
        }
    }
    for it in &items {
        match it {
            It::Note { dur, accent, kind, ev } => {
                open(&mut pending, &mut bars);
                let a = notes.len();
                for (hand, pad) in ev {
                    notes.push(RNote { t, dur: *dur, hand: *hand, accent: *accent, kind, pad: *pad, vel: r3(cur) as f32 });
                }
                last = Some((a, notes.len()));
                t += dur;
                has = true;
            }
            It::Dyn(v) => {
                if let Some(r) = ramp.take() {
                    settle(&mut notes, r, t, *v);
                }
                cur = *v;
            }
            It::Ramp(sign) => {
                if let Some(r) = ramp.take() {
                    // 続けて書いたときは、そこまでの変化を現在の音量で打ち切る
                    let v = (r.1 + r.2 * RAMP_OPEN).clamp(0.05, 1.0);
                    settle(&mut notes, r, t, v);
                    cur = v;
                }
                ramp = Some((t, cur, *sign, notes.len()));
            }
            It::Rest(d) => {
                open(&mut pending, &mut bars);
                last = None;
                t += d;
                has = true;
            }
            It::Tie(d, l, c) => {
                let Some((a, b)) = last else {
                    return Err(Error::at(*l, *c, "タイ ~ の前に音符がありません（休符や先頭の後には使えません）"));
                };
                open(&mut pending, &mut bars);
                for n in &mut notes[a..b] {
                    n.dur += d;
                }
                t += d;
                has = true;
            }
            It::Bar => {
                if has {
                    if (t - bar_start - want).abs() > EPS {
                        issues.push(BarIssue { bar: bar_no, got: t - bar_start, want, at: bar_start });
                    }
                    bar_no += 1;
                    bar_start = t;
                    has = false;
                    pending = Some(t);
                }
            }
        }
    }
    // 次の強弱記号がないまま終わった cresc / dim は、パートの終わりまでに少し変える
    if let Some(r) = ramp.take() {
        settle(&mut notes, r, t, (r.1 + r.2 * RAMP_OPEN).clamp(0.05, 1.0));
    }
    if has && (t - bar_start - want).abs() > EPS {
        issues.push(BarIssue { bar: bar_no, got: t - bar_start, want, at: bar_start });
    }
    let src_n = normalize_src(&sc.cs, &sc.cuts);
    Ok(PartBody { meter: sc.meter, start: sc.start, start_pos: sc.start_pos, notes, bars, len: t, issues, src: src_n })
}
