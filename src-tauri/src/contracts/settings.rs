use serde::{Deserialize, Serialize};

pub const DEFAULT_TERMINAL_FONT_FAMILY: &str =
    r#""AppTerminalMono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", Consolas, monospace"#;

pub fn default_terminal_font_family() -> &'static str {
    DEFAULT_TERMINAL_FONT_FAMILY
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum AppTheme {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettingsDto {
    pub font_family: String,
    pub font_size: u16,
    pub font_weight: u16,
    pub font_weight_bold: u16,
    pub line_height: f32,
    pub letter_spacing: f32,
    pub cursor_blink: bool,
    pub scrollback: u32,
}

impl Default for TerminalSettingsDto {
    fn default() -> Self {
        Self {
            font_family: default_terminal_font_family().to_string(),
            font_size: 14,
            font_weight: 400,
            font_weight_bold: 700,
            line_height: 1.2,
            letter_spacing: 0.0,
            cursor_blink: true,
            scrollback: 10_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct SshSettingsDto {
    pub default_connect_timeout_ms: u64,
    pub default_keepalive_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct AppSettingsDto {
    pub theme: AppTheme,
    pub terminal: TerminalSettingsDto,
    pub ssh: SshSettingsDto,
}
