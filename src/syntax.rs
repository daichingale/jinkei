//! 字句解析と構文解析
use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    Ident(String),
    Num(f64),
    Str(String),
    Sym(&'static str),
    /// part ブロックの本文（波括弧の中身そのまま）
    Raw(String),
    Eof,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub tok: Tok,
    pub line: usize,
    pub col: usize,
}

const SYM2: [&str; 2] = ["..", "->"];
const SYM1: [&str; 11] = ["{", "}", "(", ")", ",", ":", "+", "-", "*", "/", ";"];

/// 直前のトークン列が `part 名前 for 対象` の形か（その直後の `{` は本文の始まり）
fn part_header(out: &[Token]) -> bool {
    let mut j = out.len().saturating_sub(1);
    // 直近の `{` `}` `;` の手前までさかのぼって part を探す
    while j > 0 {
        j -= 1;
        match &out[j].tok {
            Tok::Sym("{") | Tok::Sym("}") | Tok::Sym(";") | Tok::Raw(_) => return false,
            Tok::Ident(w) if w == "part" || w == "パート" => {
                let kw = out.get(j + 2).map(|t| &t.tok);
                let after_item = j > 0 && matches!(&out[j - 1].tok, Tok::Ident(x) if x == "set" || x == "section");
                return !after_item && matches!(kw, Some(Tok::Ident(k)) if k == "for" || k == "対象");
            }
            _ => {}
        }
    }
    false
}

pub fn lex(src: &str) -> Result<Vec<Token>> {
    Ok(lex_full(src)?.0)
}

/// コメント（行, 列, 本文）も返す字句解析
pub fn lex_full(src: &str) -> Result<(Vec<Token>, Vec<(usize, usize, String)>)> {
    let mut comments = Vec::new();
    let cs: Vec<char> = src.chars().collect();
    let (mut i, mut line, mut col) = (0usize, 1usize, 1usize);
    let mut out = Vec::new();
    while i < cs.len() {
        let c = cs[i];
        if c == '\n' {
            i += 1;
            line += 1;
            col = 1;
            continue;
        }
        if c.is_whitespace() {
            i += 1;
            col += 1;
            continue;
        }
        if c == '#' {
            let st = i;
            while i < cs.len() && cs[i] != '\n' {
                i += 1;
            }
            let txt: String = cs[st + 1..i].iter().collect();
            let txt = txt.strip_prefix(' ').unwrap_or(&txt).trim_end().to_string();
            comments.push((line, col, txt));
            col += i - st;
            continue;
        }
        let (sl, sc) = (line, col);
        let mut push = |t: Tok| out.push(Token { tok: t, line: sl, col: sc });
        if c.is_ascii_digit() {
            let st = i;
            while i < cs.len() && cs[i].is_ascii_digit() {
                i += 1;
            }
            if i + 1 < cs.len() && cs[i] == '.' && cs[i + 1].is_ascii_digit() {
                i += 1;
                while i < cs.len() && cs[i].is_ascii_digit() {
                    i += 1;
                }
            }
            let s: String = cs[st..i].iter().collect();
            col += i - st;
            push(Tok::Num(s.parse().unwrap()));
            continue;
        }
        if c == '"' {
            i += 1;
            col += 1;
            let mut s = String::new();
            loop {
                if i >= cs.len() || cs[i] == '\n' {
                    return Err(Error::at(sl, sc, "文字列が閉じられていません"));
                }
                if cs[i] == '"' {
                    i += 1;
                    col += 1;
                    break;
                }
                s.push(cs[i]);
                i += 1;
                col += 1;
            }
            push(Tok::Str(s));
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let st = i;
            while i < cs.len() && (cs[i].is_alphanumeric() || cs[i] == '_') {
                i += 1;
            }
            col += i - st;
            push(Tok::Ident(cs[st..i].iter().collect()));
            continue;
        }
        if i + 1 < cs.len() {
            let two: String = cs[i..i + 2].iter().collect();
            if let Some(s) = SYM2.iter().find(|s| **s == two) {
                push(Tok::Sym(s));
                i += 2;
                col += 2;
                continue;
            }
        }
        let one = c.to_string();
        if let Some(s) = SYM1.iter().find(|s| **s == one) {
            push(Tok::Sym(s));
            i += 1;
            col += 1;
            if *s == "{" && part_header(&out) {
                // part の本文は記法が違うので、対応する } までを文字列のまま取り出す
                let (bl, bc) = (line, col);
                let st = i;
                let mut depth = 1usize;
                while i < cs.len() {
                    let ch = cs[i];
                    if ch == '#' || (ch == '/' && cs.get(i + 1) == Some(&'/')) {
                        while i < cs.len() && cs[i] != '\n' {
                            i += 1;
                            col += 1;
                        }
                        continue;
                    }
                    if ch == '{' {
                        depth += 1;
                    } else if ch == '}' {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    if ch == '\n' {
                        line += 1;
                        col = 1;
                    } else {
                        col += 1;
                    }
                    i += 1;
                }
                if depth != 0 {
                    return Err(Error::at(bl, bc.saturating_sub(1).max(1), "part の '{' が '}' で閉じられていません"));
                }
                out.push(Token { tok: Tok::Raw(cs[st..i].iter().collect()), line: bl, col: bc });
            }
            continue;
        }
        return Err(Error::at(sl, sc, format!("使えない文字です: '{}'", c)));
    }
    out.push(Token { tok: Tok::Eof, line, col });
    Ok((out, comments))
}

// ================= AST =================

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Pos {
    pub line: usize,
    pub col: usize,
}

#[derive(Debug, Clone)]
pub enum Expr {
    Num(f64),
    Name(String, Pos),
    Call(String, Vec<Expr>, Pos),
    Neg(Box<Expr>),
    Bin(char, Box<Expr>, Box<Expr>),
}

#[derive(Debug, Clone)]
pub struct PointE(pub Expr, pub Expr);

#[derive(Debug, Clone)]
pub enum GroupTerm {
    Name(String, Pos),
    Range(String, String, Pos),
    All,
}

#[derive(Debug, Clone)]
pub enum Shape {
    Line(PointE, PointE),
    Arc { c: PointE, r: Expr, a1: Expr, a2: Expr },
    Circle { c: PointE, r: Expr, start: Option<Expr> },
    Block { c: PointE, cols: Expr, spacing: Option<Expr>, rowsp: Option<Expr> },
    Curve(Vec<PointE>),
    Poly(Vec<PointE>),
    At(PointE),
    Same,
    /// フォロー・ザ・リーダー: 先頭が経路をたどり、後ろの人はその通った道をたどる
    Follow { pts: Vec<PointE>, spacing: Option<Expr> },
    /// 位置は変えず、向き・姿勢・構え・ステップ・動作だけを指定する
    Attr,
}

#[derive(Debug, Clone)]
pub enum Xf {
    Rotate(Expr, Option<PointE>),
    Shift(PointE),
    Scale(Expr),
}

/// 体の向き
#[derive(Debug, Clone)]
pub enum FaceAst {
    /// front / back / kami / shimo / center / out / travel
    Named(String),
    Toward(PointE),
    /// 客席向きを0として、上手側へ何度
    Deg(Expr),
}

impl std::fmt::Display for FaceAst {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FaceAst::Named(n) => write!(f, "{}", n),
            FaceAst::Toward(p) => write!(f, "toward ({}, {})", p.0, p.1),
            FaceAst::Deg(e) => write!(f, "{}", e),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Assign {
    Auto,
    Keep,
}

#[derive(Debug, Clone)]
pub struct Stmt {
    pub group: Vec<GroupTerm>,
    pub shape: Shape,
    pub xf: Vec<Xf>,
    pub assign: Option<Assign>,
    pub wait: Option<Expr>,
    pub within: Option<Expr>,
    pub bend: Option<Expr>,
    pub face: Option<FaceAst>,
    /// ステップの種類: glide / back / slide / jazz / high
    pub step: Option<String>,
    /// 手具・動作: spin / toss / swing / rest
    pub action: Option<String>,
    /// 姿勢: attention / rest / wide / cross / kneel / kneel2 / lunge / crouch / toe
    pub pose: Option<String>,
    /// 楽器の構え: play / right / left / front / diag
    pub carry: Option<String>,
    pub pos: Pos,
    pub note: Vec<String>,
    pub tail: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SetAst {
    pub name: String,
    pub counts: f64,
    pub hold: f64,
    /// このセットからのテンポ（なければ前と同じ）
    pub tempo: Option<f64>,
    /// ホールド中にマークタイム（その場で足踏み）
    pub mark: bool,
    pub stmts: Vec<Stmt>,
    pub pos: Pos,
    pub note: Vec<String>,
    pub tail: Option<String>,
    pub foot: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum FieldAst {
    Football(String),
    Floor { w: f64, d: f64 },
    Gym { w: f64, d: f64 },
    Stage { w: f64, d: f64, wing: f64 },
}

#[derive(Debug, Clone)]
pub struct SectionAst {
    pub id: String,
    pub label: String,
    pub n: usize,
    pub color: Option<String>,
    /// 楽器の明示（なければ表示名から推定）
    pub instrument: Option<String>,
    pub pos: Pos,
    pub note: Vec<String>,
    pub tail: Option<String>,
}

/// 楽譜パート（打楽器・管楽器が演奏するリズム譜）
#[derive(Debug, Clone)]
pub struct PartAst {
    pub name: String,
    pub group: Vec<GroupTerm>,
    pub pos: Pos,
    pub body: crate::score::PartBody,
    pub note: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ShowAst {
    /// show より前のコメント
    pub header: Vec<String>,
    /// field / tempo など設定行まわりのコメント
    pub settings_notes: Vec<String>,
    /// 最後の } の前のコメント
    pub foot: Vec<String>,
    /// field を明示したか
    pub field_given: bool,
    pub name: String,
    pub field: FieldAst,
    pub tempo: f64,
    pub clearance: Option<f64>,
    pub maxstep: Option<f64>,
    /// 見た目（"real" / "illust"）。書かれていなければ None（= real）
    pub look: Option<String>,
    pub sections: Vec<SectionAst>,
    pub sets: Vec<SetAst>,
    pub parts: Vec<PartAst>,
}

// ================= Parser =================

pub struct Parser {
    toks: Vec<Token>,
    p: usize,
    comments: Vec<(usize, usize, String)>,
    ci: usize,
    last_line: usize,
}

fn describe(t: &Tok) -> String {
    match t {
        Tok::Ident(s) => format!("「{}」", s),
        Tok::Num(v) => format!("数値 {}", v),
        Tok::Str(s) => format!("文字列 \"{}\"", s),
        Tok::Sym(s) => format!("記号 '{}'", s),
        Tok::Raw(_) => "楽譜".into(),
        Tok::Eof => "終わり".into(),
    }
}

impl Parser {
    pub fn new(toks: Vec<Token>) -> Self {
        Parser { toks, p: 0, comments: vec![], ci: 0, last_line: 0 }
    }
    /// 今のトークンより前にある、まだ使っていないコメント
    fn lead(&mut self) -> Vec<String> {
        let (l, c) = (self.cur().line, self.cur().col);
        let mut v = vec![];
        while self.ci < self.comments.len() {
            let (cl, cc, ref t) = self.comments[self.ci];
            if cl < l || (cl == l && cc < c) {
                v.push(t.clone());
                self.ci += 1;
            } else {
                break;
            }
        }
        v
    }
    /// 直前のトークンと同じ行にあるコメント（行末コメント）
    fn tail(&mut self) -> Option<String> {
        if self.ci < self.comments.len() && self.comments[self.ci].0 == self.last_line {
            let t = self.comments[self.ci].2.clone();
            self.ci += 1;
            Some(t)
        } else {
            None
        }
    }
    fn cur(&self) -> &Token {
        &self.toks[self.p]
    }
    fn pos(&self) -> Pos {
        Pos { line: self.cur().line, col: self.cur().col }
    }
    fn bump(&mut self) -> Token {
        let t = self.toks[self.p].clone();
        self.last_line = t.line;
        if self.p + 1 < self.toks.len() {
            self.p += 1;
        }
        t
    }
    fn err(&self, m: impl Into<String>) -> Error {
        let p = self.pos();
        Error::at(p.line, p.col, format!("{}（ここにあるのは{}）", m.into(), describe(&self.cur().tok)))
    }
    fn is_sym(&self, s: &str) -> bool {
        matches!(&self.cur().tok, Tok::Sym(x) if *x == s)
    }
    fn eat_sym(&mut self, s: &str) -> bool {
        if self.is_sym(s) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn expect_sym(&mut self, s: &str) -> Result<()> {
        if self.eat_sym(s) {
            Ok(())
        } else {
            Err(self.err(format!("'{}' が必要です", s)))
        }
    }
    fn is_kw(&self, k: &str) -> bool {
        matches!(&self.cur().tok, Tok::Ident(x) if x == k)
    }
    fn eat_kw(&mut self, k: &str) -> bool {
        if self.is_kw(k) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn expect_kw(&mut self, k: &str) -> Result<()> {
        if self.eat_kw(k) {
            Ok(())
        } else {
            Err(self.err(format!("'{}' が必要です", k)))
        }
    }
    fn ident(&mut self) -> Result<(String, Pos)> {
        let p = self.pos();
        match &self.cur().tok {
            Tok::Ident(s) => {
                let s = s.clone();
                self.bump();
                Ok((s, p))
            }
            _ => Err(self.err("名前が必要です")),
        }
    }
    fn name(&mut self) -> Result<String> {
        match self.cur().tok.clone() {
            Tok::Str(s) | Tok::Ident(s) => {
                self.bump();
                Ok(s)
            }
            Tok::Num(v) => {
                self.bump();
                Ok(fmt_num(v))
            }
            _ => Err(self.err("名前が必要です")),
        }
    }
    fn string(&mut self) -> Result<String> {
        match self.cur().tok.clone() {
            Tok::Str(s) => {
                self.bump();
                Ok(s)
            }
            _ => Err(self.err("文字列が必要です")),
        }
    }
    fn num(&mut self) -> Result<f64> {
        let neg = self.eat_sym("-");
        match self.cur().tok {
            Tok::Num(v) => {
                self.bump();
                Ok(if neg { -v } else { v })
            }
            _ => Err(self.err("数値が必要です")),
        }
    }

    // ---- 式 ----
    fn expr(&mut self) -> Result<Expr> {
        let mut l = self.term()?;
        loop {
            let op = if self.eat_sym("+") {
                '+'
            } else if self.eat_sym("-") {
                '-'
            } else {
                break;
            };
            let r = self.term()?;
            l = Expr::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }
    fn term(&mut self) -> Result<Expr> {
        let mut l = self.unary()?;
        loop {
            let op = if self.eat_sym("*") {
                '*'
            } else if self.eat_sym("/") {
                '/'
            } else {
                break;
            };
            let r = self.unary()?;
            l = Expr::Bin(op, Box::new(l), Box::new(r));
        }
        Ok(l)
    }
    fn unary(&mut self) -> Result<Expr> {
        if self.eat_sym("-") {
            return Ok(Expr::Neg(Box::new(self.unary()?)));
        }
        let p = self.pos();
        match self.cur().tok.clone() {
            Tok::Num(v) => {
                self.bump();
                Ok(Expr::Num(v))
            }
            Tok::Ident(s) => {
                self.bump();
                if self.eat_sym("(") {
                    let mut args = vec![];
                    if !self.is_sym(")") {
                        loop {
                            args.push(self.expr()?);
                            if !self.eat_sym(",") {
                                break;
                            }
                        }
                    }
                    self.expect_sym(")")?;
                    Ok(Expr::Call(s, args, p))
                } else {
                    Ok(Expr::Name(s, p))
                }
            }
            Tok::Sym("(") => {
                self.bump();
                let e = self.expr()?;
                self.expect_sym(")")?;
                Ok(e)
            }
            _ => Err(self.err("式が必要です")),
        }
    }
    fn point(&mut self) -> Result<PointE> {
        self.expect_sym("(")?;
        let x = self.expr()?;
        self.expect_sym(",")?;
        let y = self.expr()?;
        self.expect_sym(")")?;
        Ok(PointE(x, y))
    }
    fn points(&mut self) -> Result<Vec<PointE>> {
        let mut v = vec![self.point()?];
        loop {
            self.eat_sym("->");
            self.eat_sym(",");
            if self.is_sym("(") {
                v.push(self.point()?);
            } else {
                break;
            }
        }
        Ok(v)
    }

    // ---- 文 ----
    fn group(&mut self) -> Result<Vec<GroupTerm>> {
        let mut v = vec![];
        loop {
            if self.eat_kw("all") {
                v.push(GroupTerm::All);
            } else {
                let (a, p) = self.ident()?;
                if self.eat_sym("..") {
                    let (b, _) = self.ident()?;
                    v.push(GroupTerm::Range(a, b, p));
                } else {
                    v.push(GroupTerm::Name(a, p));
                }
            }
            if !self.eat_sym("+") && !self.eat_sym(",") {
                break;
            }
        }
        Ok(v)
    }

    fn shape(&mut self) -> Result<Shape> {
        let (kw, kp) = self.ident()?;
        Ok(match kw.as_str() {
            "line" => {
                let a = self.point()?;
                if !self.eat_sym("->") {
                    self.expect_kw("to")?;
                }
                let b = self.point()?;
                Shape::Line(a, b)
            }
            "arc" => {
                self.eat_kw("center");
                let c = self.point()?;
                self.expect_kw("radius")?;
                let r = self.expr()?;
                self.expect_kw("from")?;
                let a1 = self.expr()?;
                self.expect_kw("to")?;
                let a2 = self.expr()?;
                Shape::Arc { c, r, a1, a2 }
            }
            "circle" => {
                self.eat_kw("center");
                let c = self.point()?;
                self.expect_kw("radius")?;
                let r = self.expr()?;
                let start = if self.eat_kw("start") { Some(self.expr()?) } else { None };
                Shape::Circle { c, r, start }
            }
            "block" => {
                self.eat_kw("center");
                let c = self.point()?;
                self.expect_kw("cols")?;
                let cols = self.expr()?;
                let mut spacing = None;
                let mut rowsp = None;
                loop {
                    if self.eat_kw("spacing") {
                        spacing = Some(self.expr()?);
                    } else if self.eat_kw("rows") {
                        rowsp = Some(self.expr()?);
                    } else {
                        break;
                    }
                }
                Shape::Block { c, cols, spacing, rowsp }
            }
            "curve" => Shape::Curve(self.points()?),
            "poly" => Shape::Poly(self.points()?),
            "at" => Shape::At(self.point()?),
            "same" | "hold" => Shape::Same,
            "follow" => {
                let pts = self.points()?;
                let spacing = if self.eat_kw("spacing") { Some(self.expr()?) } else { None };
                Shape::Follow { pts, spacing }
            }
            _ => {
                return Err(Error::at(
                    kp.line,
                    kp.col,
                    format!("不明な隊形「{}」（line / arc / circle / block / curve / poly / follow / at / same が使えます）", kw),
                ))
            }
        })
    }

    fn named(&mut self, table: &[(&str, &str)], msg: &str) -> Result<String> {
        if let Tok::Ident(n) = &self.cur().tok {
            if let Some((_, c)) = table.iter().find(|(k, _)| k == n) {
                self.bump();
                return Ok(c.to_string());
            }
        }
        Err(self.err(msg))
    }

    fn face(&mut self) -> Result<FaceAst> {
        const NAMES: [(&str, &str); 14] = [
            ("front", "front"), ("客席", "front"), ("back", "back"), ("奥", "back"), ("kami", "kami"), ("上手", "kami"),
            ("shimo", "shimo"), ("下手", "shimo"), ("center", "center"), ("中心", "center"), ("out", "out"), ("外", "out"),
            ("travel", "travel"), ("進行方向", "travel"),
        ];
        if let Tok::Ident(n) = &self.cur().tok {
            if let Some((_, c)) = NAMES.iter().find(|(k, _)| k == n) {
                self.bump();
                return Ok(FaceAst::Named(c.to_string()));
            }
            if n == "toward" || n == "方へ" {
                self.bump();
                return Ok(FaceAst::Toward(self.point()?));
            }
        }
        if matches!(self.cur().tok, Tok::Num(_) | Tok::Sym("-") | Tok::Sym("(")) {
            return Ok(FaceAst::Deg(self.expr()?));
        }
        Err(self.err("face の後には front / back / kami / shimo / center / out / travel / toward (x, y) / 角度 のどれか"))
    }

    fn stmt(&mut self) -> Result<Stmt> {
        let note = self.lead();
        let pos = self.pos();
        let group = self.group()?;
        self.expect_sym(":")?;
        // 「:」の直後が pose / carry / face / step / action なら、位置を変えない指定
        let shape = if ["pose", "carry", "構え", "face", "step", "action"].iter().any(|k| self.is_kw(k)) { Shape::Attr } else { self.shape()? };
        let mut xf = vec![];
        let mut assign = None;
        let mut wait = None;
        let mut within = None;
        let mut bend = None;
        let mut face = None;
        let mut step = None;
        let mut action = None;
        let mut pose = None;
        let mut carry = None;
        loop {
            if self.eat_kw("carry") || self.eat_kw("構え") {
                carry = Some(self.named(&[
                    ("play", "play"), ("演奏", "play"), ("right", "right"), ("右手", "right"), ("left", "left"), ("左手", "left"),
                    ("front", "front"), ("正面", "front"), ("diag", "diag"), ("斜め", "diag"),
                ], "carry（構え）の後には play / right / left / front / diag（演奏・右手・左手・正面・斜め）")?);
                continue;
            }
            if self.eat_kw("pose") {
                pose = Some(self.named(&[
                    ("attention", "attention"), ("気をつけ", "attention"), ("rest", "rest"), ("休め", "rest"), ("wide", "wide"), ("足開き", "wide"),
                    ("cross", "cross"), ("クロス", "cross"), ("kneel", "kneel"), ("片膝", "kneel"), ("kneel2", "kneel2"), ("膝つき", "kneel2"),
                    ("lunge", "lunge"), ("ランジ", "lunge"), ("crouch", "crouch"), ("しゃがみ", "crouch"), ("toe", "toe"), ("つま先", "toe"),
                ], "pose の後には attention / rest / wide / cross / kneel / kneel2 / lunge / crouch / toe（気をつけ・休め・足開き・クロス・片膝・膝つき・ランジ・しゃがみ・つま先）")?);
                continue;
            }
            if self.eat_kw("step") {
                step = Some(self.named(&[
                    ("glide", "glide"), ("グライド", "glide"), ("back", "back"), ("バック", "back"), ("slide", "slide"), ("スライド", "slide"),
                    ("jazz", "jazz"), ("ジャズ", "jazz"), ("high", "high"), ("ハイ", "high"),
                ], "step の後には glide / back / slide / jazz / high")?);
                continue;
            }
            if self.eat_kw("action") {
                action = Some(self.named(&[
                    ("spin", "spin"), ("スピン", "spin"), ("toss", "toss"), ("トス", "toss"), ("swing", "swing"), ("スイング", "swing"), ("rest", "rest"), ("レスト", "rest"),
                ], "action の後には spin / toss / swing / rest")?);
                continue;
            }
            if self.eat_kw("bend") {
                bend = Some(self.expr()?);
                continue;
            }
            if self.eat_kw("face") {
                face = Some(self.face()?);
                continue;
            }
            if self.eat_kw("wait") {
                wait = Some(self.expr()?);
                continue;
            }
            if self.eat_kw("in") {
                within = Some(self.expr()?);
                continue;
            }
            if self.eat_kw("rotate") {
                let a = self.expr()?;
                let about = if self.eat_kw("about") { Some(self.point()?) } else { None };
                xf.push(Xf::Rotate(a, about));
            } else if self.eat_kw("shift") {
                xf.push(Xf::Shift(self.point()?));
            } else if self.eat_kw("scale") {
                xf.push(Xf::Scale(self.expr()?));
            } else if self.eat_kw("assign") {
                if self.eat_kw("auto") {
                    assign = Some(Assign::Auto);
                } else if self.eat_kw("keep") {
                    assign = Some(Assign::Keep);
                } else {
                    return Err(self.err("assign の後には auto か keep"));
                }
            } else {
                break;
            }
        }
        let tail = self.tail();
        if matches!(shape, Shape::Attr) && (!xf.is_empty() || assign.is_some() || wait.is_some() || within.is_some() || bend.is_some()) {
            return Err(Error::at(pos.line, pos.col, "位置を変えない指定（隊形なし）では pose / carry / face / step / action だけが使えます"));
        }
        Ok(Stmt { group, shape, xf, assign, wait, within, bend, face, step, action, pose, carry, pos, note, tail })
    }

    fn set(&mut self, note: Vec<String>) -> Result<SetAst> {
        let pos = self.pos();
        let name = self.name()?;
        let mut counts = 0.0;
        let mut hold = 0.0;
        let mut tempo = None;
        let mut mark = false;
        loop {
            if self.eat_kw("counts") {
                counts = self.num()?;
            } else if self.eat_kw("tempo") {
                let t = self.num()?;
                if t <= 0.0 {
                    return Err(self.err("tempo は正の数にしてください"));
                }
                tempo = Some(t);
            } else if self.eat_kw("mark") {
                mark = true;
            } else if self.eat_kw("hold") {
                hold = self.num()?;
            } else {
                break;
            }
        }
        if counts < 0.0 || hold < 0.0 {
            return Err(Error::at(pos.line, pos.col, "counts / hold は0以上にしてください"));
        }
        self.expect_sym("{")?;
        let tail = self.tail();
        let mut stmts = vec![];
        let foot;
        loop {
            if self.is_sym("}") {
                foot = self.lead();
                self.bump();
                break;
            }
            if self.eat_sym(";") {
                continue;
            }
            if matches!(self.cur().tok, Tok::Eof) {
                return Err(self.err("'}' で閉じられていません"));
            }
            stmts.push(self.stmt()?);
        }
        Ok(SetAst { name, counts, hold, tempo, mark, stmts, pos, note, tail, foot })
    }

    pub fn show(&mut self) -> Result<ShowAst> {
        let header = self.lead();
        self.expect_kw("show")?;
        let name = self.name()?;
        self.expect_sym("{")?;
        let mut s = ShowAst {
            header,
            settings_notes: vec![],
            foot: vec![],
            field_given: false,
            name,
            field: FieldAst::Gym { w: 30.0, d: 30.0 },
            tempo: 120.0,
            clearance: None,
            maxstep: None,
            look: None,
            sections: vec![],
            sets: vec![],
            parts: vec![],
        };
        if let Some(t) = self.tail() {
            s.settings_notes.push(t);
        }
        loop {
            if self.is_sym("}") {
                s.foot = self.lead();
                self.bump();
                break;
            }
            if self.eat_sym(";") {
                continue;
            }
            let note = self.lead();
            let is_item = self.is_kw("set") || self.is_kw("section") || self.is_kw("part") || self.is_kw("パート");
            if !is_item {
                s.settings_notes.extend(note.iter().cloned());
            }
            let (kw, kp) = match &self.cur().tok {
                Tok::Eof => return Err(self.err("'}' で閉じられていません")),
                _ => self.ident()?,
            };
            match kw.as_str() {
                "field" => {
                    s.field_given = true;
                    if self.eat_kw("football") {
                        let k = if let Tok::Ident(x) = &self.cur().tok {
                            if ["hs", "college", "nfl"].contains(&x.as_str()) {
                                let x = x.clone();
                                self.bump();
                                x
                            } else {
                                "hs".into()
                            }
                        } else {
                            "hs".into()
                        };
                        s.field = FieldAst::Football(k);
                    } else if self.eat_kw("floor") {
                        let w = self.num()?;
                        self.expect_kw("x")?;
                        let d = self.num()?;
                        if w <= 0.0 || d <= 0.0 {
                            return Err(Error::at(kp.line, kp.col, "フロアの大きさは正の数にしてください"));
                        }
                        s.field = FieldAst::Floor { w, d };
                    } else if self.eat_kw("gym") {
                        let (mut w, mut d) = (30.0, 30.0);
                        if matches!(self.cur().tok, Tok::Num(_)) {
                            w = self.num()?;
                            self.expect_kw("x")?;
                            d = self.num()?;
                        }
                        if w <= 0.0 || d <= 0.0 {
                            return Err(Error::at(kp.line, kp.col, "大きさは正の数にしてください"));
                        }
                        s.field = FieldAst::Gym { w, d };
                    } else if self.eat_kw("stage") {
                        let (mut w, mut d, mut wing) = (16.0, 10.0, 4.0);
                        if matches!(self.cur().tok, Tok::Num(_)) {
                            w = self.num()?;
                            self.expect_kw("x")?;
                            d = self.num()?;
                        }
                        if self.eat_kw("wings") {
                            wing = self.num()?;
                        }
                        if w <= 0.0 || d <= 0.0 || wing < 0.0 {
                            return Err(Error::at(kp.line, kp.col, "大きさは正の数にしてください"));
                        }
                        s.field = FieldAst::Stage { w, d, wing };
                    } else {
                        return Err(self.err("field の後には gym / stage / football / floor"));
                    }
                }
                "tempo" => s.tempo = self.num()?,
                "clearance" => s.clearance = Some(self.num()?),
                "maxstep" => s.maxstep = Some(self.num()?),
                "look" | "見た目" => {
                    let lp = self.pos();
                    let name = match self.cur().tok.clone() {
                        Tok::Ident(x) | Tok::Str(x) => {
                            self.bump();
                            x
                        }
                        _ => return Err(self.err("look の後には real / illust")),
                    };
                    s.look = Some(match name.to_lowercase().as_str() {
                        "real" | "リアル" => "real".to_string(),
                        "illust" | "イラスト" => "illust".to_string(),
                        _ => return Err(Error::at(lp.line, lp.col, format!("見た目「{}」が分かりません（real / illust）", name))),
                    });
                }
                "section" => {
                    let (id, p) = self.ident()?;
                    let label = if let Tok::Str(_) = self.cur().tok { self.string()? } else { id.clone() };
                    let n = self.num()?;
                    if n < 1.0 || n.fract() != 0.0 {
                        return Err(Error::at(p.line, p.col, "人数は1以上の整数にしてください"));
                    }
                    let mut color = None;
                    let mut instrument = None;
                    loop {
                        if self.eat_kw("color") {
                            color = Some(self.string()?);
                        } else if self.eat_kw("instrument") {
                            let ip = self.pos();
                            let name = match self.cur().tok.clone() {
                                Tok::Ident(x) | Tok::Str(x) => {
                                    self.bump();
                                    x
                                }
                                _ => return Err(self.err("instrument の後には楽器名")),
                            };
                            let id = if crate::instruments::is_id(&name) { name.clone() } else { crate::instruments::detect(&name, "").to_string() };
                            if id == "none" && name != "none" {
                                let list: Vec<&str> = crate::instruments::INSTRUMENTS.iter().map(|x| x.0).collect();
                                return Err(Error::at(ip.line, ip.col, format!("楽器「{}」が分かりません（使えるもの: {}）", name, list.join(", "))));
                            }
                            instrument = Some(id);
                        } else {
                            break;
                        }
                    }
                    let tail = self.tail();
                    s.sections.push(SectionAst { id, label, n: n as usize, color, instrument, pos: p, note, tail });
                }
                "set" => {
                    let st = self.set(note)?;
                    s.sets.push(st)
                }
                "part" | "パート" => {
                    let name = self.name()?;
                    if !(self.eat_kw("for") || self.eat_kw("対象")) {
                        return Err(self.err("'for' が必要です（例: part \"名前\" for sn { ... }）"));
                    }
                    let group = self.group()?;
                    self.expect_sym("{")?;
                    let (src, bl, bc) = match self.cur().tok.clone() {
                        Tok::Raw(r) => (r, self.cur().line, self.cur().col),
                        _ => return Err(self.err("part の本文が必要です")),
                    };
                    self.bump();
                    self.expect_sym("}")?;
                    let body = crate::score::parse_body(&src, bl, bc)?;
                    s.parts.push(PartAst { name, group, pos: kp, body, note });
                }
                _ => {
                    return Err(Error::at(
                        kp.line,
                        kp.col,
                        format!("不明なキーワード「{}」（field / tempo / section / set / part / clearance / maxstep / look が使えます）", kw),
                    ))
                }
            }
            if !is_item {
                if let Some(t) = self.tail() {
                    s.settings_notes.push(t);
                }
            }
        }
        if !matches!(self.cur().tok, Tok::Eof) {
            return Err(self.err("show の後に余分なものがあります"));
        }
        Ok(s)
    }
}

/// 名前をソースに書くときの形（記号だけで書けるならそのまま、そうでなければ引用符つき）
pub fn name_tok(s: &str) -> String {
    let mut it = s.chars();
    let ident = it.next().is_some_and(|c| c.is_alphabetic() || c == '_') && s.chars().all(|c| c.is_alphanumeric() || c == '_');
    let num = {
        let (a, b) = s.split_once('.').map(|(a, b)| (a, Some(b))).unwrap_or((s, None));
        !a.is_empty() && a.chars().all(|c| c.is_ascii_digit()) && b.map_or(true, |b| !b.is_empty() && b.chars().all(|c| c.is_ascii_digit()))
    };
    if ident || num {
        s.to_string()
    } else {
        format!("\"{}\"", s.replace('"', "”"))
    }
}

pub fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}

pub fn parse(src: &str) -> Result<ShowAst> {
    let (toks, comments) = lex_full(src)?;
    let mut p = Parser::new(toks);
    p.comments = comments;
    p.show()
}

fn prec(e: &Expr) -> u8 {
    match e {
        Expr::Bin('+' | '-', ..) => 1,
        Expr::Bin(..) => 2,
        Expr::Neg(_) => 3,
        _ => 4,
    }
}

impl std::fmt::Display for Expr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Expr::Num(v) => write!(f, "{}", fmt_num(*v)),
            Expr::Name(n, _) => write!(f, "{}", n),
            Expr::Call(n, a, _) => {
                write!(f, "{}(", n)?;
                for (i, x) in a.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{}", x)?;
                }
                write!(f, ")")
            }
            Expr::Neg(a) => {
                if prec(a) < 3 {
                    write!(f, "-({})", a)
                } else {
                    write!(f, "-{}", a)
                }
            }
            Expr::Bin(op, a, b) => {
                let p = prec(self);
                if prec(a) < p {
                    write!(f, "({})", a)?;
                } else {
                    write!(f, "{}", a)?;
                }
                write!(f, " {} ", op)?;
                if prec(b) < p || (prec(b) == p && (*op == '-' || *op == '/')) {
                    write!(f, "({})", b)
                } else {
                    write!(f, "{}", b)
                }
            }
        }
    }
}

impl std::fmt::Display for GroupTerm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GroupTerm::Name(n, _) => write!(f, "{}", n),
            GroupTerm::Range(a, b, _) => write!(f, "{}..{}", a, b),
            GroupTerm::All => write!(f, "all"),
        }
    }
}
