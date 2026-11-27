use jinkei::geom::{self, P};
use jinkei::*;

fn rng(seed: &mut u64) -> f64 {
    *seed ^= *seed << 13;
    *seed ^= *seed >> 7;
    *seed ^= *seed << 17;
    (*seed % 1_000_000) as f64 / 1_000_000.0
}

fn total(from: &[P], to: &[P], a: &[usize]) -> f64 {
    from.iter().enumerate().map(|(i, p)| geom::dist(*p, to[a[i]])).sum()
}

fn permutations(n: usize) -> Vec<Vec<usize>> {
    if n == 0 {
        return vec![vec![]];
    }
    let mut out = vec![];
    for p in permutations(n - 1) {
        for k in 0..=p.len() {
            let mut q = p.clone();
            q.insert(k, n - 1);
            out.push(q);
        }
    }
    out
}

#[test]
fn hungarian_is_optimal() {
    let mut s = 88172645463325252u64;
    for _ in 0..200 {
        let n = 2 + (rng(&mut s) * 6.0) as usize;
        let from: Vec<P> = (0..n).map(|_| (rng(&mut s) * 50.0, rng(&mut s) * 50.0)).collect();
        let to: Vec<P> = (0..n).map(|_| (rng(&mut s) * 50.0, rng(&mut s) * 50.0)).collect();
        let a = geom::assign(&from, &to);
        let best = permutations(n).iter().map(|p| total(&from, &to, p)).fold(f64::MAX, f64::min);
        assert!((total(&from, &to, &a) - best).abs() < 1e-6);
    }
}

fn segments_cross(a: P, b: P, c: P, d: P) -> bool {
    let o = |p: P, q: P, r: P| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    let (d1, d2, d3, d4) = (o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d));
    d1 * d2 < -1e-9 && d3 * d4 < -1e-9
}

#[test]
fn auto_assignment_paths_do_not_cross() {
    let mut s = 1234567u64;
    for _ in 0..100 {
        let n = 30;
        let from: Vec<P> = (0..n).map(|_| (rng(&mut s) * 100.0, rng(&mut s) * 60.0)).collect();
        let to: Vec<P> = (0..n).map(|_| (rng(&mut s) * 100.0, rng(&mut s) * 60.0)).collect();
        let a = geom::assign(&from, &to);
        for i in 0..n {
            for j in i + 1..n {
                assert!(!segments_cross(from[i], to[a[i]], from[j], to[a[j]]));
            }
        }
    }
}

#[test]
fn exact_collision_between_samples() {
    // 2人が正面からすれ違う。高速なので半カウント刻みのサンプリングでは見逃す配置
    let show = compile(
        r#"show t { field football
          section a 1
          section b 1
          set 1 { a: at (-40, 40)  b: at (40, 40.3) }
          set 2 counts 1 { a: at (40, 40)  b: at (-40, 40.3) }
        }"#,
    )
    .unwrap();
    let r = analyze(&show);
    let c: Vec<_> = r.warnings.iter().filter(|w| w.kind == "衝突").collect();
    assert_eq!(c.len(), 1, "{:?}", r.warnings);
    assert!(c[0].msg.contains("0.30"));
}

#[test]
fn avoiding_assignment_routes_around_obstacle() {
    // 最短の割り当てだと a1 が静止している o にぶつかる → 遠回りでもぶつからない割り当てを選ぶ
    let src = r#"show t { field floor 40 x 40 clearance 0.6
      section a 2
      section o 1
      set 1 { a: line (0, 0) -> (10, 0)   o: at (0, 5) }
      set 2 counts 8 { a: poly (0, 12) -> (14, 10) }
    }"#;
    let show = compile(src).unwrap();
    let r = analyze(&show);
    assert!(!r.warnings.iter().any(|w| w.kind == "衝突"), "{:?}", r.warnings);
    assert_eq!(show.sets[1].pos[0], (14.0, 10.0));
}

#[test]
fn dot_sheet_language() {
    let f = field::Field::football("hs");
    assert_eq!(f.describe_x(0.0), "50ydライン上");
    assert_eq!(f.describe_x(-24.0), "サイド1: 35ydライン上");
    assert_eq!(f.describe_x(-26.0), "サイド1: 35ydラインから外へ 2.00歩");
    assert_eq!(f.describe_x(22.0), "サイド2: 35ydラインから内へ 2.00歩");
    assert_eq!(f.describe_x(80.0), "サイド2: ゴールライン上");
    let fh = 53.0 * 12.0 + 4.0;
    assert_eq!(f.describe_y(fh / 22.5 + 4.0), "フロントハッシュから後ろへ 4.00歩");
    assert_eq!(f.describe_y(fh / 22.5 - 3.0), "フロントハッシュから前へ 3.00歩");
    assert_eq!(f.describe_y(0.0), "フロントサイドライン上");
    assert_eq!(f.describe_step(1.0), "8.0 to 5");
    assert_eq!(f.describe_step(0.0), "静止");
}

#[test]
fn shapes_have_exact_counts_and_spacing() {
    let l = geom::line((0.0, 0.0), (10.0, 0.0), 6);
    assert_eq!(l.len(), 6);
    assert!((l[1].0 - 2.0).abs() < 1e-9);
    let c = geom::curve(&[(0.0, 0.0), (10.0, 10.0), (20.0, 0.0)], 11);
    let d: Vec<f64> = c.windows(2).map(|w| geom::dist(w[0], w[1])).collect();
    let mx = d.iter().cloned().fold(0.0, f64::max);
    let mn = d.iter().cloned().fold(f64::MAX, f64::min);
    assert!(mx / mn < 1.03, "曲線上の間隔が不均一 {:?}", d);
    let b = geom::block((0.0, 0.0), 4, 2.0, 2.0, 7);
    assert_eq!(b.len(), 7);
    assert!((b[4].0 - -2.0).abs() < 1e-9); // 2列目は3人で中央寄せ
}

#[test]
fn step_size_and_min_counts() {
    let show = compile(
        r#"show t { field football section a 1
          set 1 { a: at (0, 30) }
          set 2 counts 8 { a: at (16, 30) } }"#,
    )
    .unwrap();
    let r = analyze(&show);
    // 16歩を8カウント → 4 to 5 → 大股
    assert!(r.warnings.iter().any(|w| w.kind == "大股"));
    assert_eq!(output::min_counts(&show, &r, 1), Some(12.0)); // 6 to 5 以内には12カウント
}

#[test]
fn wait_and_in_timing() {
    let show = compile(
        r#"show t { field floor 20 x 20 section a 1 section b 1
          set 1 { a: at (-5, 5) b: at (0, 10) }
          set 2 counts 16 { a: at (5, 5) in 8   b: at (0, 0) wait 8 } }"#,
    )
    .unwrap();
    let r = analyze(&show);
    // a は 0〜8 で横切り、b は 8 以降に縦に動く → ぶつからない
    assert!(!r.warnings.iter().any(|w| w.kind == "衝突"), "{:?}", r.warnings);
    assert!(r.dots[1][1].step.contains("9〜16"));
}

#[test]
fn helpful_errors() {
    let e = compile("show t {\n field football\n section tp 4\n set 1 {\n  tp: line (s1(35), XX) -> (0, 0)\n }\n}").unwrap_err();
    assert_eq!(e.line, 5);
    assert!(e.msg.contains("XX"));
    let e = compile("show t { field football section tp 4 section tb 2 set 1 { tp: line (0,0) -> (10,0) } }").unwrap_err();
    assert!(e.msg.contains("tb1"));
    let e = compile("show t { field football section tp 2 set 1 { tp: at (0,0) } }").unwrap_err();
    assert!(e.msg.contains("1人"));
    let e = compile("show t { field floor 20 x 20 section tp 2 set 1 { tp: line (s1(30),0) -> (0,0) } }").unwrap_err();
    assert!(e.msg.contains("s1"));
}

#[test]
fn example_is_clean() {
    let src = std::fs::read_to_string("examples/opener.jk").unwrap();
    let show = compile(&src).unwrap();
    let r = analyze(&show);
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    assert_eq!(show.performers.len(), 37);
}

#[test]
fn same_timing_would_collide() {
    // 上と同じ配置で時間差なし → 衝突を検出
    let show = compile(
        r#"show t { field floor 20 x 20 section a 1 section b 1
          set 1 { a: at (-5, 5) b: at (0, 10) }
          set 2 counts 16 { a: at (5, 5)   b: at (0, 0) } }"#,
    )
    .unwrap();
    assert!(analyze(&show).warnings.iter().any(|w| w.kind == "衝突"));
}

#[test]
fn default_venue_is_gym_and_samples_are_clean() {
    let show = compile("show t { section a 2 set 1 { a: line (shimo(2), 0) -> (kami(2), 0) } }").unwrap();
    assert!(matches!(show.field.kind, field::FieldKind::Gym { w, d } if w == 30.0 && d == 30.0));
    for f in ["examples/gym.jk", "examples/stage.jk", "examples/opener.jk"] {
        let show = compile(&std::fs::read_to_string(f).unwrap()).unwrap();
        let r = analyze(&show);
        assert!(r.warnings.is_empty(), "{}: {:?}", f, r.warnings);
    }
}

#[test]
fn gym_and_stage_language() {
    let g = field::Field::gym(30.0, 30.0);
    assert_eq!(g.describe_x(-3.5), "センターから下手へ 5.6歩（3.50m）");
    assert_eq!(g.describe_x(11.875), "センターから上手へ 2ポイント+3歩（11.88m）");
    assert_eq!(g.describe_y(7.5), "センターから奥へ 1ポイント+4歩（7.50m）");
    assert_eq!(g.describe_x(5.0), "センターから上手へ 1ポイント（5.00m）");
    assert_eq!(g.describe_x(0.0), "センター");
    assert_eq!(g.describe_y(-5.0), "センターから客席側へ 1ポイント（5.00m）");
    assert_eq!(g.constant("KAMI20"), Some(10.0));
    let s = field::Field::stage(16.0, 10.0, 4.0);
    assert_eq!(s.describe_x(9.5), "上手袖（センターから上手へ 1ポイント+7.2歩（9.50m））");
    assert_eq!(s.describe_y(2.0), "舞台前端から奥へ 3.2歩（2.00m）");
    // 舞台前端より前は転落（場外）、袖は可
    assert!(!s.in_bounds(0.0, -0.5));
    assert!(s.in_bounds(11.0, 5.0));
}

#[test]
fn renderer_draws_people() {
    use jinkei::render::*;
    let show = compile(&std::fs::read_to_string("examples/gym.jk").unwrap()).unwrap();
    let opts = RenderOpts { width: 320, height: 180, ss: 1, mode: CamMode::Audience, hud: false };
    let v = venue(&show, CamMode::Audience);
    let empty = {
        let mut s2 = show.clone();
        s2.performers.clear();
        for set in s2.sets.iter_mut() {
            set.pos.clear();
        }
        render_frame(&s2, &v, 0.0, &opts, 0.0)
    };
    let full = render_frame(&show, &v, 0.0, &opts, 0.0);
    let diff = empty.iter().zip(&full).filter(|(a, b)| a != b).count();
    assert!(diff > 1000, "人物が描かれていない（差分 {} 画素）", diff);
}

#[test]
fn later_statement_overrides_one_person() {
    // 円の後に tp3 だけ別の場所へ。ほかの人の位置は変わらない（tp3 がいた場所が空くだけ）
    let base = "show t { section tp 8
      set 1 { tp: line (-7, 0) -> (7, 0) }
      set 2 counts 16 { tp: circle (0, 0) radius 6 OVERRIDE } }";
    let a = compile(&base.replace("OVERRIDE", "")).unwrap();
    let b = compile(&base.replace("OVERRIDE", "tp3: at (10, 10)")).unwrap();
    let i3 = b.performers.iter().position(|p| p.id == "tp3").unwrap();
    assert_eq!(b.sets[1].pos[i3], (10.0, 10.0));
    for i in 0..8 {
        if i != i3 {
            assert_eq!(a.sets[1].pos[i], b.sets[1].pos[i], "{} が動いてしまった", b.performers[i].id);
        }
    }
    assert_eq!(b.owner[1][i3], 1);
    assert_eq!(b.owner[1][0], 0);
}

#[test]
fn curved_path_geometry_and_collision() {
    // 半円（bend 180 未満）の経路は端点を通り、長さは直線より長い
    let (a, b) = ((0.0, 0.0), (10.0, 0.0));
    let m = geom::arc_point(a, b, 90.0, 0.5);
    assert!(m.1 > 1.0, "左側（+y）にふくらむはず: {:?}", m);
    let e = geom::arc_point(a, b, 90.0, 1.0);
    assert!((e.0 - 10.0).abs() < 1e-9 && e.1.abs() < 1e-9);
    assert!((geom::path_len(a, b, 90.0) - 10.0 * std::f64::consts::FRAC_PI_2 / (2.0f64.sqrt())).abs() < 1e-6);
    // 直線ならぶつかる2人も、片方をカーブさせれば避けられる
    let src = |bend: &str| format!(
        "show t {{ section a 1 section b 1
          set 1 {{ a: at (-5, 0) b: at (0, -5) }}
          set 2 counts 16 {{ a: at (5, 0) b: at (0, 5) {} }} }}", bend);
    let straight = analyze(&compile(&src("")).unwrap());
    assert!(straight.warnings.iter().any(|w| w.kind == "衝突"));
    let curved = analyze(&compile(&src("bend 90")).unwrap());
    assert!(!curved.warnings.iter().any(|w| w.kind == "衝突"), "{:?}", curved.warnings);
}

#[test]
fn facing_and_tempo() {
    let show = compile(
        "show t { tempo 120 section a 4
          set 1 { a: circle (0, 0) radius 4 face center }
          set 2 counts 8 tempo 90 { a: same face out }
          set 3 counts 8 { a: same rotate 10 } }",
    )
    .unwrap();
    // 中心向き: (r,0) にいる人は 180°（下手向き）
    let i = show.sets[0].pos.iter().position(|p| (p.0 - 4.0).abs() < 1e-6).unwrap_or(0);
    let f = show.sets[0].face[i].unwrap();
    let p = show.sets[0].pos[i];
    let expect = (-p.1).atan2(-p.0).to_degrees();
    assert!((f - expect).abs() < 1e-6);
    // 外向きは逆
    assert!(((show.sets[1].face[i].unwrap() - f).abs() - 180.0).abs() < 1e-6);
    // 触れなかったセットでは向きを引き継がない（same rotate は文があるので自動に戻る）
    assert_eq!(show.sets[2].face[i], None);
    assert_eq!(show.sets[1].tempo, 90.0);
    assert_eq!(show.sets[2].tempo, 90.0);
    // 秒数: セット2・3は 90 BPM で 16カウント = 10.67秒
    let secs = render::seconds_at(&show, show.sets[2].start + 8.0);
    assert!((secs - 16.0 * 60.0 / 90.0).abs() < 1e-9);
    assert!((render::counts_at(&show, secs) - 16.0).abs() < 1e-9);
}

#[test]
fn auto_fix_removes_collisions() {
    let src = "show t { section a 6 section b 6
      set 1 { a : line (-8, -4) -> (-3, -4)  b : line (-2.5, 4) -> (2.5, 4) }
      set 2 counts 16 { a : line (3, -4) -> (8, -4)  b : line (-2.5, -8) -> (2.5, -8) } }";
    let ast = syntax::parse(src).unwrap();
    let r = fix::auto_fix(&ast).unwrap();
    assert!(r.before.0 > 0);
    assert_eq!(r.after.0, 0, "{:?}", r.notes);
    assert!(!r.notes.is_empty());
}

#[test]
fn skip_leaves_seats_empty_and_others_in_place() {
    let full = compile("show t { field floor 24 x 18 section a 5 set 1 { a: line (-8,0) -> (8,0) } set 2 counts 8 { a: arc (0,0) radius 6 from 0 to 180 } }").unwrap();
    // a3 が抜けた: 席を5つ作って3番目を空ける（日本語の「空き」でも同じ）
    for kw in ["skip 3", "空き 3"] {
        let src = format!("show t {{ field floor 24 x 18 section a 4 set 1 {{ a: line (-8,0) -> (8,0) {} }} set 2 counts 8 {{ a: arc (0,0) radius 6 from 0 to 180 skip 3 }} }}", kw);
        let s = compile(&src).unwrap();
        for (k, set) in s.sets.iter().enumerate() {
            let want: Vec<P> = [0usize, 1, 3, 4].iter().map(|&i| full.sets[k].pos[i]).collect();
            // 自動割り当てなので、位置の集合として同じ
            for w in &want {
                assert!(set.pos.iter().any(|p| geom::dist(*p, *w) < 1e-9), "{} セット{}: {:?} がない", kw, k, w);
            }
            assert_eq!(set.pos.len(), 4);
        }
        // 席番号（1始まり、空きを含む）
        assert!(s.sets[0].slots[0].iter().all(|&x| x != 3));
    }
    // 席数を超える・0・1人用・same では使えない
    assert!(compile("show t { field floor 24 x 18 section a 3 set 1 { a: line (-4,0) -> (4,0) skip 5 } }").unwrap_err().msg.contains("席"));
    assert!(compile("show t { field floor 24 x 18 section a 3 set 1 { a: line (-4,0) -> (4,0) skip 0 } }").is_err());
    assert!(compile("show t { field floor 24 x 18 section a 1 set 1 { a: at (0,0) skip 2 } }").is_err());
    assert!(compile("show t { field floor 24 x 18 section a 3 set 1 { a: line (-4,0) -> (4,0) } set 2 { a: same skip 1 } }").is_err());
}

#[test]
fn subsets_get_automatic_names() {
    let src = r#"show "s" {
  field gym
  section tp "T" 2
  set 1 hold 4 { tp : line (-2, 0) -> (2, 0) }
  set 2 counts 8 { tp : line (-2, 4) -> (2, 4) }
  set sub counts 4 { tp : line (-2, 5) -> (2, 5) }
  set サブ counts 4 { tp : line (-2, 6) -> (2, 6) }
  set 3 counts 8 { tp : line (-2, 8) -> (2, 8) }
  set 台 sub counts 4 { tp : line (-2, 9) -> (2, 9) }
  set sub counts 4 { tp : line (-2, 10) -> (2, 10) }
}"#;
    let show = compile(src).unwrap();
    let names: Vec<&str> = show.sets.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, vec!["1", "2", "2A", "2B", "3", "台", "3B"]);
    assert_eq!(show.sets.iter().map(|s| s.sub).collect::<Vec<_>>(), vec![false, false, true, true, false, true, true]);
    // 最初のセットは sub にできない・名前の省略は sub だけ
    assert!(compile("show \"s\" { field gym\n section tp \"T\" 1\n set sub { tp : line (-1, 0) -> (1, 0) } }").is_err());
    assert!(compile("show \"s\" { field gym\n section tp \"T\" 1\n set 1 { tp : line (-1, 0) -> (1, 0) }\n set counts 4 { tp : line (-1, 2) -> (1, 2) } }").is_err());
}
