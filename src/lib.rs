//! 陣形 (Jinkei) — マーチングドリル設計言語とエンジン
//!
//! 隊形を図形で宣言すると、各メンバーの位置・誰がどこへ行くか（自動割り当て）・
//! 歩幅や衝突のチェック・ドットシート・アニメーションを生成する。

pub mod analyze;
pub mod build;
pub mod field;
pub mod fix;
pub mod geom;
pub mod instruments;
pub mod hud;
pub mod human;
pub mod json_mini;
pub mod model;
pub mod output;
pub mod reel;
pub mod render;
pub mod score;
pub mod strike;
pub mod audio;
pub mod xmlimport;
pub mod server;
pub mod syntax;
pub mod web;

pub use analyze::{analyze, Report, Warning};
pub use build::{build, Show};

#[derive(Debug, Clone)]
pub struct Error {
    pub line: usize,
    pub col: usize,
    pub msg: String,
}

impl Error {
    pub fn at(line: usize, col: usize, msg: impl Into<String>) -> Self {
        Error { line, col, msg: msg.into() }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.line > 0 {
            write!(f, "{}行{}列: {}", self.line, self.col, self.msg)
        } else {
            write!(f, "{}", self.msg)
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

/// ソース → 隊形データ
pub fn compile(src: &str) -> Result<Show> {
    build(&syntax::parse(src)?)
}
