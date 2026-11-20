//! 歩幅・衝突・場外のチェックと、ドットシートの作成
use crate::build::Show;

#[derive(Debug, Clone)]
pub struct Warning {
    pub set: usize,
    pub kind: &'static str,
    pub msg: String,
    pub who: Vec<usize>,
    /// 問題が起きる通算カウント
    pub at: f64,
}

#[derive(Debug, Clone)]
pub struct Dot {
    pub x: f64,
    pub y: f64,
    pub h: String,
    pub v: String,
    pub step: String,
    /// 体の向き
    pub face: String,
    /// このセットへの移動距離（フィールド単位）
    pub moved: f64,
}

#[derive(Debug, Clone)]
pub struct Report {
    /// dots[performer][set]
    pub dots: Vec<Vec<Dot>>,
    pub warnings: Vec<Warning>,
    /// セットごとの最大歩幅（1カウントの移動量、フィールド単位）
    pub max_per_count: Vec<f64>,
    pub total_counts: f64,
}

pub fn analyze(s: &Show) -> Report {
    let f = &s.field;
    let n = s.performers.len();
    let u = f.unit_name();
    let mut warnings = vec![];
    let mut dots = vec![Vec::with_capacity(s.sets.len()); n];
    let mut max_per_count = vec![];

    for (k, set) in s.sets.iter().enumerate() {
        let mut mx = 0.0f64;
        for i in 0..n {
            let p = set.pos[i];
            let moved = if k == 0 {
                0.0
            } else {
                match &set.route[i] {
                    Some(r) => crate::geom::poly_len(r),
                    None => crate::geom::path_len(s.sets[k - 1].pos[i], p, set.bend[i]),
                }
            };
            let dur = set.end[i] - set.wait[i];
            let per = if dur > 0.0 { moved / dur } else { 0.0 };
            mx = mx.max(per);
            dots[i].push(Dot {
                x: p.0,
                y: p.1,
                h: f.describe_x(p.0),
                v: f.describe_y(p.1),
                face: f.describe_face(set.face[i]),
                step: if k == 0 {
                    "—".into()
                } else if (set.wait[i] > 0.0 || set.end[i] < set.counts) && moved > 1e-9 {
                    format!(
                        "{}（{}〜{}カウント目で移動）",
                        f.describe_step(per),
                        crate::syntax::fmt_num(set.wait[i] + 1.0),
                        crate::syntax::fmt_num(set.end[i])
                    )
                } else {
                    f.describe_step(per)
                } + &if set.route[i].is_some() && moved > 1e-9 {
                    "・フォロー".to_string()
                } else if set.bend[i].abs() > 1e-6 && moved > 1e-9 {
                    format!("・カーブ{}°", crate::syntax::fmt_num(set.bend[i]))
                } else {
                    String::new()
                } + match set.step[i].as_deref() {
                    Some("back") => "・バックマーチ",
                    Some("slide") => "・スライド",
                    Some("jazz") => "・ジャズラン",
                    Some("high") => "・ハイステップ",
                    Some("glide") => "・グライド",
                    _ => "",
                } + match set.pose[i].as_deref() {
                    Some("attention") => "・姿勢: 気をつけ",
                    Some("rest") => "・姿勢: 休め",
                    Some("wide") => "・姿勢: 足開き",
                    Some("cross") => "・姿勢: 足クロス",
                    Some("kneel") => "・姿勢: 片膝つき",
                    Some("kneel2") => "・姿勢: 両膝つき",
                    Some("lunge") => "・姿勢: ランジ",
                    Some("crouch") => "・姿勢: しゃがみ",
                    Some("toe") => "・姿勢: つま先立ち",
                    _ => "",
                } + match set.carry[i].as_deref() {
                    Some("play") => "・構え: 演奏",
                    Some("right") => "・構え: 右手に持つ",
                    Some("left") => "・構え: 左手に持つ",
                    Some("front") => "・構え: 正面",
                    Some("diag") => "・構え: 斜め",
                    _ => "",
                } + match set.action[i].as_deref() {
                    Some("spin") => "・動作: スピン",
                    Some("toss") => "・動作: トス",
                    Some("swing") => "・動作: スイング",
                    Some("rest") => "・動作: レスト",
                    _ => "",
                },
                moved,
            });
            // 大股
            if k > 0 && per > 1e-9 {
                let too_big = if f.is_football() { 8.0 / per < s.maxstep } else { per > s.maxstep };
                if too_big {
                    warnings.push(Warning {
                        set: k,
                        kind: "大股",
                        msg: format!(
                            "セット{}: {} の歩幅が大きすぎます（{}、{:.1}{}を{}カウント）",
                            set.name,
                            s.performers[i].id,
                            f.describe_step(per),
                            moved,
                            u,
                            crate::syntax::fmt_num(dur)
                        ),
                        who: vec![i],
                        at: set.start,
                    });
                }
            }
            if !f.in_bounds(p.0, p.1) {
                warnings.push(Warning {
                    set: k,
                    kind: "場外",
                    msg: format!("セット{}: {} がフィールドの外です（{} / {}）", set.name, s.performers[i].id, f.describe_x(p.0), f.describe_y(p.1)),
                    who: vec![i],
                    at: set.start + set.counts,
                });
            }
        }
        max_per_count.push(mx);

        // 衝突: 各人は [wait, counts] の間だけ直線・等速で動く。
        // 時刻の区切り（0, 各人のwait, counts）ごとに両者とも一次式なので、最接近を厳密に求める
        let prev = if k == 0 { &set.pos } else { &s.sets[k - 1].pos };
        let cl = s.clearance;
        let c = set.counts;
        for a in 0..n {
            for b in a + 1..n {
                let (best, best_t) = crate::geom::closest(
                    &crate::geom::Mv { a: prev[a], b: set.pos[a], w: set.wait[a], e: set.end[a], bend: set.bend[a], route: set.route[a].as_deref() },
                    &crate::geom::Mv { a: prev[b], b: set.pos[b], w: set.wait[b], e: set.end[b], bend: set.bend[b], route: set.route[b].as_deref() },
                    c,
                );
                if best < cl {
                    let moving = k > 0 && best_t < c - 1e-9;
                    warnings.push(Warning {
                        set: k,
                        kind: "衝突",
                        msg: if moving {
                            format!(
                                "セット{}への移動中（{:.1}カウント目）: {} と {} が {:.2}{} まで接近",
                                set.name, best_t, s.performers[a].id, s.performers[b].id, best, u
                            )
                        } else {
                            format!(
                                "セット{}: {} と {} の間隔が {:.2}{} しかありません（最低 {}{}）",
                                set.name, s.performers[a].id, s.performers[b].id, best, u, cl, u
                            )
                        },
                        who: vec![a, b],
                        at: set.start + if moving { best_t } else { c },
                    });
                }
            }
        }
    }
    // 楽譜パート: 拍子の合わない小節
    for w in &s.part_warnings {
        let k = s.sets.iter().rposition(|x| x.start <= w.at + 1e-9).unwrap_or(0);
        warnings.push(Warning { set: k, kind: "拍子", msg: w.msg.clone(), who: s.parts[w.part].members.clone(), at: w.at });
    }
    let total_counts = s.sets.last().map(|x| x.start + x.counts + x.hold).unwrap_or(0.0);
    Report { dots, warnings, max_per_count, total_counts }
}
