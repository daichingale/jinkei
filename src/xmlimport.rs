//! MusicXML（score-partwise）の1パートを、陣形の part 記法に変換する。
//! 変換の考え方は Kanade の musicxml-import.js を参考にした（音価 → 分割指定・休符・タイ・連符、
//! アクセント → R / ^R、x 音符 → x、無音程の display-step → 打面番号）。XML は std だけの小さな読み取りで処理する。
use crate::{Error, Result};

#[derive(Debug, Default, Clone)]
struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    kids: Vec<Node>,
    text: String,
}

impl Node {
    fn attr(&self, k: &str) -> &str {
        self.attrs.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str()).unwrap_or("")
    }
    fn kid(&self, n: &str) -> Option<&Node> {
        self.kids.iter().find(|k| k.name == n)
    }
    fn kids_named<'a>(&'a self, n: &'a str) -> impl Iterator<Item = &'a Node> {
        self.kids.iter().filter(move |k| k.name == n)
    }
    fn val(&self, n: &str) -> String {
        self.kid(n).map(|k| k.text.trim().to_string()).unwrap_or_default()
    }
    fn num(&self, n: &str) -> Option<f64> {
        self.kid(n).and_then(|k| k.text.trim().parse().ok())
    }
    /// 子孫から最初に見つかった name
    fn find(&self, n: &str) -> Option<&Node> {
        for k in &self.kids {
            if k.name == n {
                return Some(k);
            }
            if let Some(f) = k.find(n) {
                return Some(f);
            }
        }
        None
    }
}

fn decode(s: &str) -> String {
    let mut o = String::new();
    let cs: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < cs.len() {
        if cs[i] == '&' {
            if let Some(e) = cs[i..].iter().take(12).position(|c| *c == ';') {
                let ent: String = cs[i + 1..i + e].iter().collect();
                let r = match ent.as_str() {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    x if x.starts_with("#x") => u32::from_str_radix(&x[2..], 16).ok().and_then(char::from_u32),
                    x if x.starts_with('#') => x[1..].parse::<u32>().ok().and_then(char::from_u32),
                    _ => None,
                };
                if let Some(c) = r {
                    o.push(c);
                    i += e + 1;
                    continue;
                }
            }
        }
        o.push(cs[i]);
        i += 1;
    }
    o
}

fn bad(m: impl Into<String>) -> Error {
    Error::at(0, 0, m)
}

fn parse_xml(src: &str) -> Result<Node> {
    if src.contains("<!ENTITY") {
        return Err(bad("外部・独自のXML実体を含むファイルには対応していません"));
    }
    let cs: Vec<char> = src.chars().collect();
    let mut i = 0;
    let starts = |i: usize, p: &str| p.chars().enumerate().all(|(k, c)| cs.get(i + k) == Some(&c));
    let mut stack: Vec<Node> = vec![Node { name: "#root".into(), ..Default::default() }];
    while i < cs.len() {
        if cs[i] != '<' {
            let st = i;
            while i < cs.len() && cs[i] != '<' {
                i += 1;
            }
            let t: String = cs[st..i].iter().collect();
            stack.last_mut().unwrap().text.push_str(&decode(&t));
            continue;
        }
        if starts(i, "<!--") {
            match (i..cs.len()).find(|&j| starts(j, "-->")) {
                Some(j) => i = j + 3,
                None => return Err(bad("XMLの形式が正しくありません（コメントが閉じていません）")),
            }
        } else if starts(i, "<![CDATA[") {
            let j = (i..cs.len()).find(|&j| starts(j, "]]>")).ok_or_else(|| bad("XMLの形式が正しくありません（CDATA）"))?;
            let t: String = cs[i + 9..j].iter().collect();
            stack.last_mut().unwrap().text.push_str(&t);
            i = j + 3;
        } else if starts(i, "<?") {
            match (i..cs.len()).find(|&j| starts(j, "?>")) {
                Some(j) => i = j + 2,
                None => return Err(bad("XMLの形式が正しくありません")),
            }
        } else if starts(i, "<!") {
            // DOCTYPE（内部サブセットの [ ] を含む場合も読み飛ばす）
            let mut depth = 0;
            while i < cs.len() {
                match cs[i] {
                    '[' => depth += 1,
                    ']' => depth -= 1,
                    '>' if depth <= 0 => break,
                    _ => {}
                }
                i += 1;
            }
            i += 1;
        } else if starts(i, "</") {
            let j = (i..cs.len()).find(|&j| cs[j] == '>').ok_or_else(|| bad("XMLの形式が正しくありません"))?;
            let name: String = cs[i + 2..j].iter().collect::<String>().trim().to_string();
            let n = stack.pop().unwrap();
            if stack.is_empty() || n.name != name {
                return Err(bad(format!("XMLの形式が正しくありません（</{}> が対応していません）", name)));
            }
            stack.last_mut().unwrap().kids.push(n);
            i = j + 1;
        } else {
            let mut j = i + 1;
            let mut quote: Option<char> = None;
            while j < cs.len() {
                match (quote, cs[j]) {
                    (None, '>') => break,
                    (None, c @ ('"' | '\'')) => quote = Some(c),
                    (Some(q), c) if c == q => quote = None,
                    _ => {}
                }
                j += 1;
            }
            if j >= cs.len() {
                return Err(bad("XMLの形式が正しくありません（タグが閉じていません）"));
            }
            let mut body: String = cs[i + 1..j].iter().collect();
            let selfclose = body.ends_with('/');
            if selfclose {
                body.pop();
            }
            let body = body.trim();
            let (name, rest) = body.split_once(char::is_whitespace).unwrap_or((body, ""));
            let mut node = Node { name: name.to_string(), ..Default::default() };
            let rc: Vec<char> = rest.chars().collect();
            let mut k = 0;
            while k < rc.len() {
                while k < rc.len() && rc[k].is_whitespace() {
                    k += 1;
                }
                let ks = k;
                while k < rc.len() && rc[k] != '=' && !rc[k].is_whitespace() {
                    k += 1;
                }
                let key: String = rc[ks..k].iter().collect();
                while k < rc.len() && (rc[k] == '=' || rc[k].is_whitespace()) {
                    k += 1;
                }
                if k < rc.len() && (rc[k] == '"' || rc[k] == '\'') {
                    let q = rc[k];
                    k += 1;
                    let vs = k;
                    while k < rc.len() && rc[k] != q {
                        k += 1;
                    }
                    let v: String = rc[vs..k.min(rc.len())].iter().collect();
                    k += 1;
                    if !key.is_empty() {
                        node.attrs.push((key, decode(&v)));
                    }
                }
            }
            if selfclose {
                stack.last_mut().unwrap().kids.push(node);
            } else {
                stack.push(node);
            }
            i = j + 1;
        }
    }
    if stack.len() != 1 {
        return Err(bad("XMLの形式が正しくありません（閉じていないタグがあります）"));
    }
    stack.pop().unwrap().kids.into_iter().next().ok_or_else(|| bad("XMLの形式が正しくありません"))
}

pub struct Imported {
    /// `part "名前" for all { ... }` のテキスト
    pub text: String,
    /// 拍子（"4/4"）
    pub meter: String,
    /// 記譜だけ（meter 行なし。エディタの本文欄に入れる用）
    pub notation: String,
    pub name: String,
    pub warnings: Vec<String>,
    /// 見つかったパート名
    pub parts: Vec<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Kit {
    Snare,
    Tenor,
    Bass,
    Cymbal,
}

/// Kanade の percussion.js の打面表（C〜G）→ 陣形の打面番号
fn pad_of(kit: Kit, step: &str) -> u8 {
    let i = match step {
        "C" => 0,
        "D" => 1,
        "E" => 2,
        "F" => 3,
        "G" => 4,
        // A = スポック2（テナーだけ）
        "A" if kit == Kit::Tenor => return 6,
        _ => return 0,
    };
    match kit {
        Kit::Snare => [1, 2, 3, 1, 1][i],
        // テナー: C = ロー … F = ハイ → ドラム 4 … 1（1 が最高音）、G = スポック1
        Kit::Tenor => [4, 3, 2, 1, 5][i],
        Kit::Bass => [5, 4, 3, 2, 1][i],
        Kit::Cymbal => [2, 3, 1, 4, 1][i],
    }
}

#[derive(Clone, Debug)]
struct Ev {
    /// 元の単位（divisions）のままの位置・長さ
    start: f64,
    dur: f64,
    rest: bool,
    tie_stop: bool,
    accent: u8,
    click: bool,
    buzz: bool,
    flam: bool,
    /// 符頭から決まる奏法の頭文字: o リムショット（slash）/ m ミュート（slash + スタッカート）/ g ゴック（triangle）/ k スティッククリック（circle-x）
    pre: Option<char>,
    hand: Option<char>,
    pad: u8,
    /// 同じ時刻の他の音（MusicXML の chord）: (打面, 手)
    chord: Vec<(u8, Option<char>)>,
    /// この音の前に置く強弱記号・cresc / dim
    marks: Vec<&'static str>,
    /// (実際の数, 通常の数, 1スロットの音価の分母)
    tup: Option<(u32, u32, u32)>,
}

/// 1/64音符 = 1 の単位での音価 → (分割, 付点)
const VALUES: [(i64, u32, bool); 12] =
    [(64, 1, false), (48, 2, true), (32, 2, false), (24, 4, true), (16, 4, false), (12, 8, true), (8, 8, false), (6, 16, true), (4, 16, false), (3, 32, true), (2, 32, false), (1, 64, false)];

fn pieces(mut u: i64) -> Vec<(u32, bool)> {
    let mut v = vec![];
    while u > 0 {
        let (n, d, dot) = VALUES.iter().find(|x| x.0 <= u).copied().unwrap_or((1, 64, false));
        v.push((d, dot));
        u -= n;
    }
    v
}

struct Out {
    toks: Vec<String>,
    div: u32,
    dotted: bool,
}
impl Out {
    fn set_div(&mut self, d: u32, dot: bool) {
        if self.div != d || self.dotted != dot {
            self.toks.push(format!("{}{}:", d, if dot { "." } else { "" }));
            self.div = d;
            self.dotted = dot;
        }
    }
}

fn kit_of(name: &str) -> Kit {
    let l = name.to_lowercase();
    let has = |w: &[&str]| w.iter().any(|x| l.contains(x));
    if has(&["tenor", "quad", "quint", "テナー", "クワッド", "クイント"]) {
        Kit::Tenor
    } else if has(&["bass", "バス"]) {
        Kit::Bass
    } else if has(&["cymbal", "hat", "シンバル"]) {
        Kit::Cymbal
    } else {
        Kit::Snare
    }
}

fn beats_of(time: &Node) -> (u32, u32) {
    let n: u32 = time.kids_named("beats").flat_map(|b| b.text.split('+').map(|x| x.trim().parse::<u32>().unwrap_or(0)).collect::<Vec<_>>()).sum();
    let d: u32 = time.val("beat-type").parse().unwrap_or(4);
    (n.max(1), d.max(1))
}

pub fn import(src: &str, want: Option<&str>) -> Result<Imported> {
    let root = parse_xml(src)?;
    if root.name != "score-partwise" {
        return Err(bad("パート単位の MusicXML（score-partwise）を選んでください"));
    }
    let list: Vec<(String, String)> = root
        .kid("part-list")
        .map(|pl| pl.kids_named("score-part").map(|sp| (sp.attr("id").to_string(), sp.val("part-name"))).collect())
        .unwrap_or_default();
    let parts: Vec<&Node> = root.kids_named("part").collect();
    if parts.is_empty() {
        return Err(bad("パートが見つかりません"));
    }
    let names: Vec<String> = parts
        .iter()
        .enumerate()
        .map(|(i, p)| list.iter().find(|(id, _)| id == p.attr("id")).map(|(_, n)| n.clone()).filter(|n| !n.is_empty()).unwrap_or_else(|| format!("パート {}", i + 1)))
        .collect();
    let pi = match want {
        None => 0,
        Some(w) => names
            .iter()
            .position(|n| n == w)
            .or_else(|| names.iter().position(|n| n.to_lowercase().contains(&w.to_lowercase())))
            .ok_or_else(|| bad(format!("パート「{}」が見つかりません（ある名前: {}）", w, names.join(" / "))))?,
    };
    let part = parts[pi];
    let name = names[pi].clone();
    let kit = kit_of(&name);
    let mut warnings: Vec<String> = vec![];
    let mut warn = |m: &str| {
        if !warnings.iter().any(|w| w == m) {
            warnings.push(m.to_string());
        }
    };

    let mut divisions = 1.0f64;
    let mut time = (4u32, 4u32);
    let mut got_time = false;
    // 使う声部: 最初の音符の voice
    let voice = part.find("note").map(|n| n.val("voice")).filter(|v| !v.is_empty()).unwrap_or_else(|| "1".into());
    let mut bars: Vec<Vec<Ev>> = vec![];
    let mut bar_len: Vec<f64> = vec![];
    let mut flam_next = false;
    let mut marks: Vec<&'static str> = vec![];
    for m in part.kids_named("measure") {
        let mut cursor = 0.0f64;
        let mut evs: Vec<Ev> = vec![];
        let mut last_end = 0.0f64;
        for it in &m.kids {
            match it.name.as_str() {
                "attributes" => {
                    if let Some(d) = it.num("divisions") {
                        if d > 0.0 {
                            divisions = d;
                        }
                    }
                    if let Some(t) = it.kid("time") {
                        let nt = beats_of(t);
                        if !got_time {
                            time = nt;
                            got_time = true;
                        } else if nt != time {
                            warn("途中の拍子変更は最初の拍子にそろえました");
                        }
                    }
                }
                "direction" => {
                    for dt in it.kids_named("direction-type") {
                        if let Some(d) = dt.kid("dynamics") {
                            for k in &d.kids {
                                let t = match k.name.as_str() {
                                    "pp" | "ppp" => "pp",
                                    "p" => "p",
                                    "mp" => "mp",
                                    "mf" => "mf",
                                    "f" => "f",
                                    "ff" | "fff" => "ff",
                                    _ => continue,
                                };
                                marks.push(t);
                            }
                        }
                        if let Some(w) = dt.kid("wedge") {
                            match w.attr("type") {
                                "crescendo" => marks.push("cresc"),
                                "diminuendo" => marks.push("dim"),
                                _ => {}
                            }
                        }
                    }
                }
                "backup" | "forward" => {
                    let d = it.num("duration").unwrap_or(0.0);
                    cursor += if it.name == "backup" { -d } else { d };
                    cursor = cursor.max(0.0);
                }
                "note" => {
                    if it.kid("grace").is_some() {
                        flam_next = true;
                        continue;
                    }
                    let chord = it.kid("chord").is_some();
                    let dur = it.num("duration").unwrap_or(0.0);
                    let v = {
                        let v = it.val("voice");
                        if v.is_empty() {
                            "1".to_string()
                        } else {
                            v
                        }
                    };
                    if chord {
                        // テナー・バスは和音にする。スネア・シンバルは先頭の音だけ
                        let pad = it.kid("unpitched").map(|u| pad_of(kit, &u.val("display-step"))).unwrap_or(0);
                        let lyric = it.kid("lyric").map(|l| l.val("text")).unwrap_or_default();
                        let hand = match lyric.chars().next() {
                            Some(c @ ('R' | 'L' | 'B' | 'r' | 'l' | 'b')) if lyric.chars().count() == 1 => Some(c),
                            _ => None,
                        };
                        match evs.last_mut() {
                            Some(last) if v == voice && matches!(kit, Kit::Tenor | Kit::Bass) && pad > 0 && last.pad > 0 => last.chord.push((pad, hand)),
                            _ => warn("和音は先頭の音だけ読み込みました（和音にできるのはテナー・バスのドラム番号が分かる音だけです）"),
                        }
                        continue;
                    }
                    let start = cursor;
                    cursor += dur;
                    if v != voice {
                        continue;
                    }
                    if start < last_end - 1e-9 {
                        continue;
                    }
                    last_end = start + dur;
                    let rest = it.kid("rest").is_some();
                    let notations = it.kid("notations");
                    let has_n = |n: &str| notations.is_some_and(|x| x.find(n).is_some());
                    let tie_stop = it.kids_named("tie").any(|t| t.attr("type") == "stop") || notations.is_some_and(|x| x.kids_named("tied").any(|t| t.attr("type") == "stop"));
                    let tup = it.kid("time-modification").map(|tm| {
                        let a = tm.num("actual-notes").unwrap_or(3.0) as u32;
                        let n = tm.num("normal-notes").unwrap_or(2.0) as u32;
                        let tn = tm.val("normal-type");
                        let den_of = |t: &str| match t {
                            "whole" => 1,
                            "half" => 2,
                            "quarter" => 4,
                            "eighth" => 8,
                            "16th" => 16,
                            "32nd" => 32,
                            "64th" => 64,
                            _ => 0,
                        };
                        let d = if den_of(&tn) > 0 { den_of(&tn) } else { den_of(&it.val("type")) };
                        (a, n, d)
                    });
                    let mut pad = 0;
                    if let Some(u) = it.kid("unpitched") {
                        pad = pad_of(kit, &u.val("display-step"));
                    }
                    let lyric = it.kid("lyric").map(|l| l.val("text")).unwrap_or_default();
                    let hand = match lyric.chars().next() {
                        Some(c @ ('R' | 'L' | 'B' | 'r' | 'l' | 'b')) if lyric.chars().count() == 1 => Some(c),
                        _ => None,
                    };
                    let nh = it.val("notehead");
                    let staccato = has_n("staccato");
                    let pre = match nh.as_str() {
                        "triangle" | "inverted triangle" => Some('g'),
                        "slash" => Some(if staccato { 'm' } else { 'o' }),
                        "circle-x" => Some('k'),
                        _ => None,
                    };
                    let accent = if has_n("strong-accent") {
                        2
                    } else if has_n("accent") {
                        1
                    } else {
                        0
                    };
                    evs.push(Ev {
                        start,
                        dur,
                        rest,
                        tie_stop,
                        accent,
                        click: nh == "x",
                        buzz: has_n("tremolo"),
                        flam: std::mem::take(&mut flam_next),
                        pre,
                        hand,
                        pad,
                        chord: vec![],
                        marks: if rest { vec![] } else { std::mem::take(&mut marks) },
                        tup,
                    });
                }
                _ => {}
            }
        }
        bar_len.push((time.0 as f64) * 4.0 / time.1 as f64 * divisions);
        bars.push(evs);
    }
    if bars.is_empty() {
        return Err(bad("小節がありません"));
    }
    // ---- 音符列にする ----
    let mut o = Out { toks: vec![], div: 16, dotted: false };
    let mut right = true;
    let mut prev_note = false;
    for (bi, evs) in bars.iter().enumerate() {
        let mut pos = 0.0f64;
        let u = |x: f64| (x / divisions * 16.0).round() as i64;
        let mut k = 0;
        // 休符・音符・タイを出す共通処理
        let emit = |o: &mut Out, ev: Option<&Ev>, units: i64, right: &mut bool, prev_note: &mut bool| {
            for (pi, (d, dot)) in pieces(units).iter().enumerate() {
                o.set_div(*d, *dot);
                match ev {
                    Some(e) if !e.rest => {
                        if pi == 0 && !(e.tie_stop && *prev_note) {
                            push_note(o, e, kit, right);
                            *prev_note = true;
                        } else {
                            o.toks.push("~".into());
                        }
                    }
                    _ => {
                        o.toks.push("-".into());
                        *prev_note = false;
                    }
                }
            }
        };
        while k < evs.len() {
            let e = &evs[k];
            if u(e.start - pos) > 0 {
                emit(&mut o, None, u(e.start - pos), &mut right, &mut prev_note);
            }
            if let Some((a, n, d)) = e.tup {
                // 連符: a 個ぶんのスロットが埋まるまでを1グループにする
                let p = if a.is_power_of_two() { a / 2 } else { a.next_power_of_two() / 2 };
                if n != p || d == 0 {
                    warn("対応しない比率の連符は、近い長さの音符に置き換えました");
                }
                let slot = divisions * 4.0 / d as f64 * n as f64 / a as f64;
                let mut group: Vec<(usize, i64)> = vec![];
                let mut filled = 0i64;
                let mut j = k;
                while j < evs.len() && evs[j].tup == e.tup && filled < a as i64 {
                    let s = ((evs[j].dur as f64 / slot).round() as i64).max(1);
                    group.push((j, s));
                    filled += s;
                    j += 1;
                }
                if filled == a as i64 && n == p && d > 0 {
                    o.set_div(d, false);
                    o.toks.push(format!("{}[", a));
                    for (gi, s) in &group {
                        let ev = &evs[*gi];
                        for si in 0..*s {
                            if ev.rest {
                                o.toks.push("-".into());
                                prev_note = false;
                            } else if si == 0 && !(ev.tie_stop && prev_note) {
                                push_note(&mut o, ev, kit, &mut right);
                                prev_note = true;
                            } else {
                                o.toks.push("~".into());
                            }
                        }
                    }
                    o.toks.push("]".into());
                    pos = evs[j - 1].start + evs[j - 1].dur;
                    k = j;
                    continue;
                }
            }
            emit(&mut o, Some(e), u(e.dur).max(1), &mut right, &mut prev_note);
            pos = e.start + e.dur;
            k += 1;
        }
        if u(bar_len[bi] - pos) > 0 {
            emit(&mut o, None, u(bar_len[bi] - pos), &mut right, &mut prev_note);
        }
        o.toks.push("|".into());
    }
    // 4小節ごとに改行
    let mut lines: Vec<String> = vec![];
    let mut cur: Vec<String> = vec![];
    let mut nbar = 0;
    for t in &o.toks {
        cur.push(t.clone());
        if t == "|" {
            nbar += 1;
            if nbar % 4 == 0 {
                lines.push(cur.join(" "));
                cur.clear();
            }
        }
    }
    if !cur.is_empty() {
        lines.push(cur.join(" "));
    }
    let meter = format!("{}/{}", time.0, time.1);
    let notation = lines.join("\n");
    let mut text = format!("part \"{}\" for all {{\n  meter {}\n", name.replace('"', "”"), meter);
    for l in &lines {
        text.push_str("  ");
        text.push_str(l);
        text.push('\n');
    }
    text.push_str("}\n");
    drop(warn);
    Ok(Imported { text, meter, notation, name, warnings, parts: names })
}

/// 強弱記号・cresc / dim を置いてから音符を出す
fn push_note(o: &mut Out, e: &Ev, kit: Kit, right: &mut bool) {
    for m in &e.marks {
        o.toks.push((*m).to_string());
    }
    o.toks.push(note_tok(e, kit, right));
}

fn note_tok(e: &Ev, kit: Kit, right: &mut bool) -> String {
    let mut h = match e.hand {
        Some(c) => {
            // 指定された手の次は逆の手
            *right = c.to_ascii_uppercase() != 'R';
            c.to_ascii_uppercase()
        }
        None => {
            let c = if *right { 'R' } else { 'L' };
            *right = !*right;
            c
        }
    };
    let loud = e.accent > 0 || e.hand.is_some_and(|c| c.is_uppercase());
    let mut s = String::new();
    if e.accent == 2 {
        s.push('^');
    }
    if e.pre == Some('k') {
        s.push('k');
    } else if e.click {
        s.push('x');
    } else if let Some(p) = e.pre {
        s.push(p);
    } else if e.flam {
        s.push('f');
    } else if e.buzz {
        s.push('z');
    }
    if !e.chord.is_empty() {
        // 和音: 右手と左手が1つずつなら B[右 左]、そうでなければ同じ手で R[135]
        let mut pads = vec![e.pad];
        pads.extend(e.chord.iter().map(|c| c.0));
        let two_hands = pads.len() == 2 && e.hand.is_some_and(|c| c.eq_ignore_ascii_case(&'R')) && e.chord[0].1.is_some_and(|c| c.eq_ignore_ascii_case(&'L'));
        if two_hands {
            h = 'B';
            *right = true;
        }
        s.push(if loud { h } else { h.to_ascii_lowercase() });
        s.push('[');
        for p in pads {
            s.push((b'0' + p.min(9)) as char);
        }
        s.push(']');
        return s;
    }
    s.push(if loud { h } else { h.to_ascii_lowercase() });
    if e.pad > 1 || (e.pad == 1 && matches!(kit, Kit::Tenor | Kit::Bass)) {
        s.push((b'0' + e.pad) as char);
    }
    s
}
