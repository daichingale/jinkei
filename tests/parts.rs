//! 楽譜（part）の解析・時間計算・警告・音声のテスト
use jinkei::*;

fn wrap(body: &str) -> String {
    format!(
        "show \"t\" {{\n  field gym\n  tempo 120\n  section sn \"スネア\" 3 instrument snare\n  section tp \"トランペット\" 2\n  set 1 hold 8 {{ sn : line (-2, 0) -> (2, 0)\n tp : line (-2, 3) -> (2, 3) }}\n  set 2 counts 8 {{ sn : line (-2, 1) -> (2, 1) }}\n  {}\n}}\n",
        body
    )
}

fn part(body: &str) -> build::Part {
    let show = compile(&wrap(&format!("part \"p\" for sn {{ {} }}", body))).unwrap_or_else(|e| panic!("{}", e));
    show.parts[0].clone()
}

fn ts(p: &build::Part) -> Vec<f64> {
    p.notes.iter().map(|n| (n.t * 1000.0).round() / 1000.0).collect()
}

#[test]
fn known_bar_times() {
    // 8分8個 = 4拍。1小節
    let p = part("8: R l r l R l r l |");
    assert_eq!(ts(&p), vec![0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
    assert_eq!(p.notes[0].accent, 1);
    assert_eq!(p.notes[1].accent, 0);
    assert_eq!(p.notes[0].hand, 'R');
    assert_eq!(p.notes[1].hand, 'L');
    assert_eq!(p.bars, vec![0.0]);
    assert_eq!(p.end, 4.0);
}

#[test]
fn default_division_is_sixteenth_and_start_offset() {
    let p = part("start 8 r l r l | 4: R - R - |");
    assert_eq!(p.start, 8.0);
    assert_eq!(p.notes[0].t, 8.0);
    assert_eq!(p.notes[1].t, 8.25);
    // 2小節目は 4拍後ではなく 1 拍（16分4つ）後から始まる（小節の長さは検査だけで、時間は音符の長さの合計）
    assert_eq!(p.bars, vec![8.0, 9.0]);
}

#[test]
fn triplets_and_dotted() {
    let p = part("8: 3[ R l r ] 3[ L r l ] 4: R R |");
    let t = ts(&p);
    assert_eq!(t[..6], [0.0, 0.333, 0.667, 1.0, 1.333, 1.667]);
    assert!((p.notes[0].dur - 1.0 / 3.0).abs() < 1e-9);
    assert_eq!(t[6], 2.0);
    // 付点8分 + 16分
    let p = part("8.: R 16: r 4: R 8: r r |");
    assert_eq!(ts(&p), vec![0.0, 0.75, 1.0, 2.0, 2.5]);
    assert_eq!(p.notes[0].dur, 0.75);
    // 5連符は 4 の時間に 5 つ
    let p = part("16: 5[ r l r l r ] |");
    assert!((p.notes[1].t - 0.2).abs() < 1e-9);
}

#[test]
fn rests_ties_and_kinds() {
    let p = part("4: R - r ~ | 8: fR xl dr zl ^R >r b B |");
    // タイは直前の音符を延ばし、休符は音符を作らない
    assert_eq!(p.notes.len(), 10);
    assert_eq!(p.notes[0].dur, 1.0);
    assert_eq!(p.notes[1].t, 2.0);
    assert_eq!(p.notes[1].dur, 2.0);
    let kinds: Vec<&str> = p.notes[2..].iter().map(|n| n.kind).collect();
    assert_eq!(kinds, ["flam", "click", "diddle", "buzz", "tap", "tap", "tap", "tap"]);
    assert_eq!(p.notes[6].accent, 2);
    assert_eq!(p.notes[7].accent, 1);
    assert_eq!(p.notes[8].hand, 'B');
    assert_eq!(p.notes[9].accent, 1);
}

#[test]
fn pads_and_repeat() {
    let p = part("8: R2 l5 B1 r | repeat 2 { 4: R L | }");
    assert_eq!(p.notes.iter().map(|n| n.pad).collect::<Vec<_>>(), vec![2, 5, 1, 0, 0, 0, 0, 0]);
    // 4/4 で 2拍の小節が2つ + 最初の小節
    assert_eq!(p.notes.len(), 8);
    assert_eq!(p.notes[4].t, 2.0);
    assert_eq!(p.notes[7].t, 5.0);
}

#[test]
fn meter_and_bar_warnings() {
    let show = compile(&wrap("part \"A\" for sn { meter 6/8 8: r l r l r l | r l r | 8: r l r l r l r }")).unwrap();
    // 6/8: 1小節 = 6カウント（8分 = 1）
    assert_eq!(show.parts[0].meter, (6, 8));
    assert_eq!(show.parts[0].notes[1].t, 1.0);
    let msgs: Vec<&str> = show.part_warnings.iter().map(|w| w.msg.as_str()).collect();
    assert_eq!(msgs, vec!["パート「A」の2小節目が拍子と合いません（3/6拍）", "パート「A」の3小節目が拍子と合いません（7/6拍）"]);
    let rep = analyze(&show);
    assert!(rep.warnings.iter().any(|w| w.kind == "拍子" && w.msg.contains("2小節目")));
    // 合っていれば警告なし
    let ok = compile(&wrap("part \"B\" for sn { 4: R R R R | }")).unwrap();
    assert!(ok.part_warnings.is_empty());
}

#[test]
fn start_set_and_show_extension() {
    let show = compile(&wrap("part \"p\" for sn { start set 2 4: R R R R | }")).unwrap();
    assert_eq!(show.parts[0].start, 8.0);
    // set 2 は 8 カウントなので 16 まで。パートは 8+4 = 12 で収まる
    let rep = analyze(&show);
    assert_eq!(rep.total_counts, 16.0);
    // 長いパートは最後のセットのホールドを延ばす
    let show = compile(&wrap("part \"p\" for sn { start 14 4: R R R R | }")).unwrap();
    let rep = analyze(&show);
    assert_eq!(rep.total_counts, 18.0);
    assert_eq!(show.sets.last().unwrap().hold, 2.0);
    // 名前つきセットも使える。ない名前はエラー
    let e = compile(&wrap("part \"p\" for sn { start set 9 4: R | }")).err().unwrap();
    assert!(e.msg.contains("start set「9」"), "{}", e);
}

#[test]
fn errors_have_positions() {
    let e = compile(&wrap("part \"p\" for sn {\n  8: R q l |\n}")).err().unwrap();
    assert_eq!(e.line, 10);
    assert!(e.msg.contains("使えない文字です: 'q'"), "{}", e);
    let e = compile(&wrap("part \"p\" for zz { r }")).err().unwrap();
    assert!(e.msg.contains("「zz」というセクション"), "{}", e);
    let e = compile(&wrap("part \"p\" for sn { ~ r }")).err().unwrap();
    assert!(e.msg.contains("タイ"), "{}", e);
    assert!(compile(&wrap("part \"p\" for sn { 3[ r l ] }")).is_err());
    assert!(compile(&wrap("part \"p\" for sn { 7: r }")).is_err());
    assert!(compile(&wrap("part \"p\" for sn { r meter 3/4 }")).is_err());
    assert!(compile(&wrap("part \"p\" for sn { repeat 2 { r l }")).is_err());
}

#[test]
fn groups_and_aliases() {
    let show = compile(&wrap("パート \"ぱ\" for sn1 + tp { 拍子 3/4 開始 2 くり返し 2 { r l r l r l | } }")).unwrap();
    let p = &show.parts[0];
    assert_eq!(p.members, vec![0, 3, 4]);
    assert_eq!(p.meter, (3, 4));
    assert_eq!(p.start, 2.0);
    assert_eq!(p.notes.len(), 12);
}

#[test]
fn json_and_model_contract() {
    let show = compile(&wrap("part \"p\" for sn { 8: R2 l | }")).unwrap();
    let rep = analyze(&show);
    let j = output::json(&show, &rep);
    assert!(j.contains("\"parts\":[{\"name\":\"p\",\"members\":[0,1,2],\"meter\":[4,4],\"start\":0,\"end\":1,\"bars\":[0],\"notes\":[[0,0.5,\"R\",1,\"tap\",2],[0.5,0.5,\"L\",0,\"tap\",0]]}]"), "{}", j);
    let ast = syntax::parse(&wrap("part \"p\" for sn {\n    meter 3/4\n    start set 2\n    # メモ\n    8: R l |\n}")).unwrap();
    let m = model::model_json(&ast);
    assert!(m.contains("\"meter\":\"3/4\",\"start\":\"set 2\",\"src\":\"# メモ\\n8: R l |\""), "{}", m);
}

#[test]
fn audio_has_expected_length_and_levels() {
    let show = compile(&wrap("part \"p\" for sn { 4: R l ^R l | 16: fR xr dr zl 8: r - 4: R | }")).unwrap();
    let w = audio::render_wav(&show, 22050);
    assert_eq!(&w[..4], b"RIFF");
    let n = (w.len() - 44) / 2;
    let dur = n as f64 / 22050.0;
    // 16カウント = 8秒 + 1秒の余韻
    assert!((dur - 9.0).abs() < 0.05, "{}", dur);
    let s: Vec<i16> = w[44..].chunks(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    let peak = s.iter().map(|v| v.unsigned_abs()).max().unwrap() as f64 / 32768.0;
    assert!(peak < 0.99 && peak > 0.5, "{}", peak);
    // 1打目のあたりには音があり、パートの後ろ（10秒近く）は無音
    let at = |sec: f64, len: f64| s[(sec * 22050.0) as usize..((sec + len) * 22050.0) as usize].iter().map(|v| v.unsigned_abs() as u32).max().unwrap();
    assert!(at(0.0, 0.05) > 2000);
    assert!(at(8.2, 0.5) < 200);
}

#[test]
fn musicxml_import_roundtrip() {
    let xml = std::fs::read_to_string("tests/fixtures/sample.musicxml").unwrap();
    let r = xmlimport::import(&xml, None).unwrap();
    assert_eq!(r.parts, vec!["Snare Drum", "Tenor Drums"]);
    assert_eq!(r.meter, "4/4");
    assert_eq!(r.notation, "8: R L 4: r2 8: 3[ l r l ] - xr | 2: ^L ~ |");
    // 取り込んだ結果をそのまま読める。小節の長さも合う
    let show = compile(&wrap(&format!("part \"i\" for sn {{ meter {} {} }}", r.meter, r.notation))).unwrap();
    assert!(show.part_warnings.is_empty());
    let p = &show.parts[0];
    assert_eq!(p.notes.len(), 8);
    assert_eq!(p.notes[2].pad, 2);
    assert_eq!(p.notes[6].kind, "click");
    assert_eq!(p.notes[7].dur, 4.0);
    assert_eq!(p.notes[7].accent, 2);
    let t = xmlimport::import(&xml, Some("tenor")).unwrap();
    assert_eq!(t.meter, "3/4");
    assert_eq!(t.notation, "2.: r6 |");
    assert!(xmlimport::import(&xml, Some("zzz")).is_err());
}
