//! `jinkei web` — サーバ不要の「ブラウザ版」エディタ（単一HTML）を書き出す。
//! エディタ画面 + JS版エンジン（web/engine.js）+ ローカル用の差し替えスクリプト + プレビューのひな形。
use crate::output::{js, preview_template};
use crate::server::{editor_page, TEMPLATE_SHOW};

const ENGINE_JS: &str = include_str!("../web/engine.js");
const PROJECT_JS: &str = include_str!("../web/project.js");
const SHIM_JS: &str = include_str!("../web/shim.js");
const MAIN_SCRIPT: &str = "<script>\n'use strict';";
/// `</script` や `<!--` を <script type="text/plain"> に安全に入れるための目印（読み出し時に `<` へ戻す）
const ESC: &str = "<@@JK@@";

/// ブラウザ版のHTML全体を作る
pub fn page() -> String {
    let editor = editor_page();
    let tpl = preview_template().replace("</script", &format!("{}/script", ESC)).replace("<!--", &format!("{}!--", ESC));
    let shim = SHIM_JS.replace("__JK_TEMPLATE_SHOW__", &js(TEMPLATE_SHOW));
    let inject = format!(
        "<script type=\"text/plain\" id=\"jk-preview-tpl\">{}</script>\n<script>window.JK_ESC = {};</script>\n<script id=\"jk-engine\">{}</script>\n<script>{}</script>\n<script>{}</script>\n{}",
        tpl,
        js(ESC),
        ENGINE_JS,
        PROJECT_JS,
        shim,
        MAIN_SCRIPT
    );
    editor.replacen(MAIN_SCRIPT, &inject, 1)
}
