use serde::{Deserialize, Serialize};

pub const DEFAULT_TERMINAL_FONT_FAMILY: &str = r#""AppTerminalMono", "Sarasa Mono SC", "Noto Sans Mono CJK SC", "Source Han Mono SC", "WenQuanYi Micro Hei Mono", "WenQuanYi Zen Hei Mono", "Microsoft YaHei UI", "Microsoft YaHei", NSimSun, "PingFang SC", "Hiragino Sans GB", monospace"#;

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
    #[serde(default)]
    pub output_highlight: bool,
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
            output_highlight: false,
            scrollback: 10_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TerminalSettingsDto;

    #[test]
    fn output_highlight_defaults_off_and_round_trips() {
        let mut value = serde_json::to_value(TerminalSettingsDto::default()).unwrap();
        assert_eq!(value["outputHighlight"], false);
        value.as_object_mut().unwrap().remove("outputHighlight");
        let legacy: TerminalSettingsDto = serde_json::from_value(value.clone()).unwrap();
        assert!(!legacy.output_highlight);
        value["outputHighlight"] = true.into();
        let enabled: TerminalSettingsDto = serde_json::from_value(value).unwrap();
        assert!(enabled.output_highlight);
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
