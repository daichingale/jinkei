//! `jinkei edit` 用のローカルサーバ（標準ライブラリのみ）。
//! ブラウザの画面から送られたソースをエンジンで計算して返し、保存・プレビュー・動画書き出しを行う。
use crate::analyze::analyze;
use crate::build::build;
use crate::model::model_json;
use crate::output::{html, js, json, FIELD2D_JS};
use crate::syntax::parse;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

pub const EDITOR: &str = include_str!("editor.html");
pub const PRINTER_JS: &str = include_str!("printer.js");

pub const TEMPLATE_SHOW: &str = r##"# 陣形ファイル（GUIエディタで作成）
show "新しいショー" {
  field gym
  tempo 120

  section tp "トランペット" 8 color "#ffd23f"
  section tb "トロンボーン" 6 color "#ee5253"
  section pc "打楽器" 4 color "#c8d6e5"

  set 1 hold 8 {
    tp + tb : line (SHIMO20, FRONT20 + 4) -> (KAMI20, FRONT20 + 4)
    pc      : line (shimo(3), 2) -> (kami(3), 2)
  }

  set 2 counts 16 {
    tp + tb : arc (0, 0) radius 8 from 200 to 340
  }
}
"##;

#[derive(Default)]
struct Video {
    running: bool,
    done: usize,
    total: usize,
    path: String,
    error: String,
    finished: bool,
}

struct State {
    path: String,
    last_ok_src: String,
    video: Video,
}

fn compile_response(src: &str) -> (String, Option<String>) {
    let ast = match parse(src) {
        Ok(a) => a,
        Err(e) => {
            return (
                format!("{{\"ok\":false,\"stage\":\"parse\",\"error\":{{\"line\":{},\"col\":{},\"msg\":{}}}}}", e.line, e.col, js(&e.msg)),
                None,
            )
        }
    };
    let model = model_json(&ast);
    match build(&ast) {
        Err(e) => (
            format!(
                "{{\"ok\":false,\"stage\":\"build\",\"error\":{{\"line\":{},\"col\":{},\"msg\":{}}},\"model\":{}}}",
                e.line,
                e.col,
                js(&e.msg),
                model
            ),
            None,
        ),
        Ok(show) => {
            let rep = analyze(&show);
            let handles = show
                .handles
                .iter()
                .map(|set| {
                    format!(
                        "[{}]",
                        set.iter()
                            .map(|st| format!(
                                "[{}]",
                                st.iter().map(|(r, x, y)| format!("[{},{},{}]", js(r), x, y)).collect::<Vec<_>>().join(",")
                            ))
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let members = show
                .members
                .iter()
                .map(|set| {
                    format!(
                        "[{}]",
                        set.iter()
                            .map(|g| format!("[{}]", g.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",")))
                            .collect::<Vec<_>>()
                            .join(",")
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            let owner = show
                .owner
                .iter()
                .map(|o| format!("[{}]", o.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(",")))
                .collect::<Vec<_>>()
                .join(",");
            let mins = (0..show.sets.len())
                .map(|k| crate::output::min_counts(&show, &rep, k).map(|v| v.to_string()).unwrap_or_else(|| "null".into()))
                .collect::<Vec<_>>()
                .join(",");
            (
                format!(
                    "{{\"ok\":true,\"model\":{},\"data\":{},\"handles\":[{}],\"members\":[{}],\"owner\":[{}],\"min_counts\":[{}]}}",
                    model,
                    json(&show, &rep),
                    handles,
                    members,
                    owner,
                    mins
                ),
                Some(src.to_string()),
            )
        }
    }
}

fn respond(s: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        status,
        ctype,
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
}

fn handle(mut stream: TcpStream, st: Arc<Mutex<State>>) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut first = String::new();
    if reader.read_line(&mut first).is_err() {
        return;
    }
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();
    let mut len = 0usize;
    loop {
        let mut l = String::new();
        if reader.read_line(&mut l).is_err() || l == "\r\n" || l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                len = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; len];
    if len > 0 && reader.read_exact(&mut body).is_err() {
        return;
    }
    let body = String::from_utf8_lossy(&body).to_string();
    let path = target.split('?').next().unwrap_or("/");
    const J: &str = "application/json; charset=utf-8";
    match (method.as_str(), path) {
        ("GET", "/") => {
            let page = EDITOR.replace("__FIELD2D__", FIELD2D_JS).replace("__PRINTER__", PRINTER_JS).replace("__MOTION__", crate::output::MOTION_JS);
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes())
        }
        ("GET", "/api/source") => {
            let p = st.lock().unwrap().path.clone();
            let src = std::fs::read_to_string(&p).unwrap_or_else(|_| TEMPLATE_SHOW.to_string());
            let name = std::path::Path::new(&p).file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            respond(&mut stream, "200 OK", J, format!("{{\"path\":{},\"name\":{},\"source\":{}}}", js(&p), js(&name), js(&src)).as_bytes())
        }
        ("POST", "/api/compile") => {
            let (resp, ok) = compile_response(&body);
            if let Some(src) = ok {
                st.lock().unwrap().last_ok_src = src;
            }
            respond(&mut stream, "200 OK", J, resp.as_bytes())
        }
        ("POST", "/api/fix") => {
            let resp = match parse(&body).ok().and_then(|a| crate::fix::auto_fix(&a)) {
                None => format!("{{\"ok\":false,\"error\":{}}}", js("エラーを直してから実行してください")),
                Some(r) => format!(
                    "{{\"ok\":true,\"model\":{},\"notes\":[{}],\"before\":{},\"after\":{},\"others\":[{},{}]}}",
                    model_json(&r.ast),
                    r.notes.iter().map(|n| js(n)).collect::<Vec<_>>().join(","),
                    r.before.0,
                    r.after.0,
                    r.before.1,
                    r.after.1
                ),
            };
            respond(&mut stream, "200 OK", J, resp.as_bytes())
        }
        ("POST", "/api/save") => {
            let p = st.lock().unwrap().path.clone();
            // 初回保存時に元のファイルを .bak に残す
            let bak = format!("{}.bak", p);
            if std::path::Path::new(&p).exists() && !std::path::Path::new(&bak).exists() {
                let _ = std::fs::copy(&p, &bak);
            }
            match std::fs::write(&p, &body) {
                Ok(_) => respond(&mut stream, "200 OK", J, format!("{{\"ok\":true,\"path\":{}}}", js(&p)).as_bytes()),
                Err(e) => respond(&mut stream, "200 OK", J, format!("{{\"ok\":false,\"error\":{}}}", js(&e.to_string())).as_bytes()),
            }
        }
        ("GET", "/preview") => {
            let src = st.lock().unwrap().last_ok_src.clone();
            let page = match parse(&src).and_then(|a| build(&a)) {
                Ok(show) => html(&show, &analyze(&show)),
                Err(e) => format!("<meta charset=utf-8><p>エラー: {}</p>", e),
            };
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", page.as_bytes())
        }
        ("POST", "/api/video") => {
            let mut g = st.lock().unwrap();
            if g.video.running {
                drop(g);
                respond(&mut stream, "200 OK", J, format!("{{\"ok\":false,\"error\":{}}}", js("いま書き出し中です")).as_bytes());
                return;
            }
            let src = g.last_ok_src.clone();
            let out = format!("{}.mp4", g.path.trim_end_matches(".jk"));
            g.video = Video { running: true, path: out.clone(), ..Default::default() };
            drop(g);
            let mode = match body.trim() {
                "top" => crate::render::CamMode::Top,
                "orbit" => crate::render::CamMode::Orbit,
                "low" => crate::render::CamMode::Low,
                _ => crate::render::CamMode::Audience,
            };
            let st2 = st.clone();
            std::thread::spawn(move || {
                let r = parse(&src).and_then(|a| build(&a)).map_err(|e| e.to_string()).and_then(|show| {
                    let opts = crate::render::RenderOpts { width: 1280, height: 720, ss: 2, mode, hud: true };
                    let st3 = st2.clone();
                    crate::render::render_video(&show, &out, &opts, 30.0, 1.0, &mut |d, n| {
                        let mut g = st3.lock().unwrap();
                        g.video.done = d;
                        g.video.total = n;
                    })
                });
                let mut g = st2.lock().unwrap();
                g.video.running = false;
                g.video.finished = true;
                if let Err(e) = r {
                    g.video.error = e;
                }
            });
            respond(&mut stream, "200 OK", J, b"{\"ok\":true}")
        }
        ("GET", "/api/video") => {
            let g = st.lock().unwrap();
            let v = &g.video;
            let s = format!(
                "{{\"running\":{},\"finished\":{},\"done\":{},\"total\":{},\"path\":{},\"error\":{}}}",
                v.running,
                v.finished,
                v.done,
                v.total,
                js(&v.path),
                js(&v.error)
            );
            drop(g);
            respond(&mut stream, "200 OK", J, s.as_bytes())
        }
        ("GET", "/video.mp4") => {
            let p = st.lock().unwrap().video.path.clone();
            match std::fs::read(&p) {
                Ok(b) => respond(&mut stream, "200 OK", "video/mp4", &b),
                Err(_) => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
            }
        }
        ("GET", "/favicon.ico") => respond(&mut stream, "204 No Content", "image/x-icon", b""),
        _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
    }
}

fn open_browser(url: &str) {
    let r = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", url]).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
    let _ = r;
}

pub fn serve(path: &str, port: u16, open: bool) -> std::io::Result<()> {
    if !std::path::Path::new(path).exists() {
        std::fs::write(path, TEMPLATE_SHOW)?;
        eprintln!("{} がなかったので、ひな形を作りました", path);
    }
    let mut listener = None;
    for p in port..port + 20 {
        if let Ok(l) = TcpListener::bind(("127.0.0.1", p)) {
            listener = Some((l, p));
            break;
        }
    }
    let (listener, p) = listener.ok_or_else(|| std::io::Error::other("空いているポートが見つかりません"))?;
    let url = format!("http://127.0.0.1:{}/", p);
    eprintln!("陣形エディタ: {}  （{} を編集中。終了は Ctrl+C）", url, path);
    if open {
        open_browser(&url);
    }
    let src = std::fs::read_to_string(path).unwrap_or_default();
    let st = Arc::new(Mutex::new(State { path: path.to_string(), last_ok_src: src, video: Video::default() }));
    for s in listener.incoming().flatten() {
        let st = st.clone();
        std::thread::spawn(move || handle(s, st));
    }
    Ok(())
}
