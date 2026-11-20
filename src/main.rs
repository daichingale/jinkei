use jinkei::output::{check_text, dots_text, html, json};
use jinkei::{analyze, compile};
use std::process::exit;

const USAGE: &str = "陣形 (jinkei) — マーチングドリル設計エンジン

使い方:
  jinkei edit  <show.jk> [--port 7878] [--no-open]
                                          GUIエディタをブラウザで開く（ファイルがなければひな形を作る）
  jinkei web   [-o jinkei.html]           サーバ不要の単一HTML「ブラウザ版エディタ」を書き出す（ダブルクリックで開ける）
  jinkei build <show.jk> [-o show.html]   アニメーション＋ドットシート付きHTMLを作る
  jinkei check <show.jk>                  歩幅・衝突・場外をチェック（問題があれば終了コード2）
  jinkei dots  <show.jk> [-p tp1|tp]      ドットシートをテキストで出す（メンバーかセクションで絞り込み）
  jinkei json  <show.jk>                  全データをJSONで出す
  jinkei fix   <show.jk>                  衝突を減らす直し方（時間差・早着き・カーブ）を探して提案
  jinkei audio <show.jk> [-o show.wav] [--rate 44100]
                                          楽譜（part）の音を合成してWAVに書き出す
  jinkei import-xml <score.musicxml> [--part 名前]
                                          MusicXML の1パートを、陣形の part ブロックにして出力する
  jinkei video <show.jk> [-o show.mp4] [--camera audience|top|orbit|low|diag] [--size 1280x720] [--fps 30] [--speed 1]
                     [--layout single|reel] [--part 名前] [--hud] [--no-audio]
                                          3D動画（MP4）を書き出す（ffmpeg が必要）。partの音も混ぜる（--no-audio で無音）。
                                          --layout reel（別名 split）は 1080x1920 の縦動画: 斜め俯瞰3D / 楽譜 / 客席側3D / 真上グリッド
  jinkei still <show.jk> --at カウント [-o still.png] [--camera ...] [--size ...] [--layout reel]
                                          3Dの静止画";

fn die(m: impl std::fmt::Display) -> ! {
    eprintln!("エラー: {}", m);
    exit(1)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().cloned() else {
        println!("{}", USAGE);
        return;
    };
    if matches!(cmd.as_str(), "help" | "-h" | "--help") {
        println!("{}", USAGE);
        return;
    }
    let mut file = None;
    let mut out = None;
    let mut who = None;
    let mut cam = jinkei::render::CamMode::Audience;
    let (mut width, mut height) = (1280usize, 720usize);
    let mut fps = 30.0;
    let mut speed = 1.0;
    let mut at = 0.0;
    let mut rate = 44100u32;
    let mut part_name: Option<String> = None;
    let mut reel = false;
    let mut size_given = false;
    let mut no_audio = false;
    let mut hud_flag = false;
    let mut i = 1;
    let val = |i: usize| args.get(i).cloned().unwrap_or_else(|| die(format!("{} の値がありません", args[i - 1])));
    while i < args.len() {
        match args[i].as_str() {
            "--camera" => {
                i += 1;
                cam = match val(i).as_str() {
                    "audience" | "客席" => jinkei::render::CamMode::Audience,
                    "top" | "真上" => jinkei::render::CamMode::Top,
                    "orbit" | "回転" => jinkei::render::CamMode::Orbit,
                    "low" | "目線" => jinkei::render::CamMode::Low,
                    "diag" | "斜め" => jinkei::render::CamMode::Diag,
                    c => die(format!("不明なカメラ {}（audience / top / orbit / low / diag）", c)),
                };
            }
            "--size" => {
                i += 1;
                let v = val(i);
                let (a, b) = v.split_once('x').unwrap_or_else(|| die("--size は 1280x720 の形で"));
                width = a.parse().unwrap_or_else(|_| die("--size が不正です"));
                height = b.parse().unwrap_or_else(|_| die("--size が不正です"));
                width -= width % 2;
                height -= height % 2;
                size_given = true;
            }
            "--fps" => {
                i += 1;
                fps = val(i).parse().unwrap_or_else(|_| die("--fps が不正です"));
            }
            "--speed" => {
                i += 1;
                speed = val(i).parse().unwrap_or_else(|_| die("--speed が不正です"));
            }
            "--rate" => {
                i += 1;
                rate = val(i).parse().unwrap_or_else(|_| die("--rate が不正です"));
            }
            "--part" => {
                i += 1;
                part_name = Some(val(i));
            }
            "--layout" => {
                i += 1;
                reel = match val(i).as_str() {
                    "reel" | "split" | "縦分割" => true,
                    "single" | "default" | "単一" => false,
                    l => die(format!("不明なレイアウト {}（single / reel）", l)),
                };
            }
            "--no-audio" => no_audio = true,
            "--hud" => hud_flag = true,
            "--no-open" => {}
            "--port" => {
                i += 1;
            }
            "--at" => {
                i += 1;
                at = val(i).parse().unwrap_or_else(|_| die("--at が不正です"));
            }
            "-o" => {
                i += 1;
                out = args.get(i).cloned();
            }
            "-p" => {
                i += 1;
                who = args.get(i).cloned();
            }
            s => file = Some(s.to_string()),
        }
        i += 1;
    }
    if cmd == "web" {
        let path = out.unwrap_or_else(|| "jinkei.html".to_string());
        std::fs::write(&path, jinkei::web::page()).unwrap_or_else(|e| die(e));
        eprintln!("{} を書き出しました（サーバ不要。ブラウザで開くだけで編集できます）", path);
        return;
    }
    let file = file.unwrap_or_else(|| die("ファイルを指定してください"));
    if cmd == "import-xml" {
        let src = std::fs::read_to_string(&file).unwrap_or_else(|e| die(format!("{} を読めません: {}", file, e)));
        match jinkei::xmlimport::import(&src, part_name.as_deref()) {
            Ok(r) => {
                for w in &r.warnings {
                    eprintln!("注意: {}", w);
                }
                print!("{}", r.text);
            }
            Err(e) => die(e),
        }
        return;
    }
    if cmd == "fix" {
        let src = std::fs::read_to_string(&file).unwrap_or_else(|e| die(e));
        let ast = jinkei::syntax::parse(&src).unwrap_or_else(|e| die(format!("{}: {}", file, e)));
        let r = jinkei::fix::auto_fix(&ast).unwrap_or_else(|| die("ファイルにエラーがあるため直せません（check で確認してください）"));
        if r.notes.is_empty() {
            println!("自動で直せる衝突は見つかりませんでした（衝突 {}件）", r.before.0);
        } else {
            println!("衝突 {}件 → {}件 にできます。次のように書き足してください（エディタの「自動で直す」なら一度で反映されます）:", r.before.0, r.after.0);
            for n in &r.notes {
                println!("  ・{}", n);
            }
        }
        return;
    }
    if cmd == "model" {
        // エディタ用の編集モデル（JSON）を出す（往復テスト用）
        let src = std::fs::read_to_string(&file).unwrap_or_else(|e| die(e));
        let ast = jinkei::syntax::parse(&src).unwrap_or_else(|e| die(e));
        println!("{}", jinkei::model::model_json(&ast));
        return;
    }
    if cmd == "edit" {
        let port = args.iter().position(|a| a == "--port").and_then(|i| args.get(i + 1)).and_then(|p| p.parse().ok()).unwrap_or(7878);
        let open = !args.iter().any(|a| a == "--no-open");
        jinkei::server::serve(&file, port, open).unwrap_or_else(|e| die(e));
        return;
    }
    let src = std::fs::read_to_string(&file).unwrap_or_else(|e| die(format!("{} を読めません: {}", file, e)));
    let show = compile(&src).unwrap_or_else(|e| die(format!("{}: {}", file, e)));
    let rep = analyze(&show);
    match cmd.as_str() {
        "build" => {
            let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".html");
            std::fs::write(&path, html(&show, &rep)).unwrap_or_else(|e| die(e));
            eprintln!("{} を書き出しました（警告 {} 件）", path, rep.warnings.len());
        }
        "check" => {
            print!("{}", check_text(&show, &rep));
            if !rep.warnings.is_empty() {
                exit(2);
            }
        }
        "audio" => {
            if show.parts.is_empty() {
                eprintln!("注意: part（楽譜）がないので、無音のWAVになります");
            }
            let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".wav");
            std::fs::write(&path, jinkei::audio::render_wav(&show, rate)).unwrap_or_else(|e| die(e));
            eprintln!("{} を書き出しました", path);
        }
        "dots" => print!("{}", dots_text(&show, &rep, who.as_deref())),
        "json" => println!("{}", json(&show, &rep)),
        "video" | "still" => {
            let opts = jinkei::render::RenderOpts { width, height, ss: 2, mode: cam, hud: true };
            if reel {
                // 縦動画（既定 1080x1920）。日本語 HUD は --hud のときだけ
                let (rw, rh) = if size_given { (width, height) } else { (1080, 1920) };
                if cmd == "video" {
                    let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".mp4");
                    if !no_audio && !show.parts.iter().any(|p| !p.notes.is_empty()) {
                        eprintln!("注意: part（楽譜）がないので、音声は付けません");
                    }
                    let t0 = std::time::Instant::now();
                    let mut last = 0;
                    jinkei::reel::render_reel(&show, &path, rw, rh, fps, speed, part_name.as_deref(), !no_audio, hud_flag, &mut |d, n| {
                        let pct = d * 100 / n;
                        if pct >= last + 10 || d == n {
                            eprint!("\r描画中 {}% ({}/{} フレーム)", pct, d, n);
                            last = pct;
                        }
                    })
                    .unwrap_or_else(|e| die(e));
                    eprintln!("\n{} を書き出しました（{:.1}秒）", path, t0.elapsed().as_secs_f64());
                } else {
                    let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".png");
                    jinkei::reel::render_reel_still(&show, &path, rw, rh, at, part_name.as_deref(), hud_flag).unwrap_or_else(|e| die(e));
                    eprintln!("{} を書き出しました", path);
                }
                return;
            }
            if cmd == "video" {
                let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".mp4");
                let t0 = std::time::Instant::now();
                let mut last = 0;
                if !no_audio && !show.parts.iter().any(|p| !p.notes.is_empty()) {
                    eprintln!("注意: part（楽譜）がないので、音声は付けません");
                }
                jinkei::render::render_video_with(&show, &path, &opts, fps, speed, !no_audio, &mut |d, n| {
                    let pct = d * 100 / n;
                    if pct >= last + 10 || d == n {
                        eprint!("\r描画中 {}% ({}/{} フレーム)", pct, d, n);
                        last = pct;
                    }
                })
                .unwrap_or_else(|e| die(e));
                eprintln!("\n{} を書き出しました（{:.1}秒）", path, t0.elapsed().as_secs_f64());
            } else {
                let path = out.unwrap_or_else(|| file.trim_end_matches(".jk").to_string() + ".png");
                jinkei::render::render_still(&show, &path, at, &opts).unwrap_or_else(|e| die(e));
                eprintln!("{} を書き出しました", path);
            }
        }
        c => die(format!("不明なコマンド {}\n\n{}", c, USAGE)),
    }
}
