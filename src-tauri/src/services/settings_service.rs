use crate::contracts::{default_terminal_font_family, AppErrorDto, TerminalSettingsDto};
use crate::repositories::settings_repository::SettingsRepository;
use std::collections::HashMap;
use std::sync::Arc;

const TERMINAL_FONT_FAMILY_KEY: &str = "terminal.fontFamily";
const TERMINAL_FONT_SIZE_KEY: &str = "terminal.fontSize";
const TERMINAL_FONT_WEIGHT_KEY: &str = "terminal.fontWeight";
const TERMINAL_FONT_WEIGHT_BOLD_KEY: &str = "terminal.fontWeightBold";
const TERMINAL_LINE_HEIGHT_KEY: &str = "terminal.lineHeight";
const TERMINAL_LETTER_SPACING_KEY: &str = "terminal.letterSpacing";
const TERMINAL_CURSOR_BLINK_KEY: &str = "terminal.cursorBlink";
const TERMINAL_SCROLLBACK_KEY: &str = "terminal.scrollback";

pub struct SettingsService {
    settings_repo: Arc<SettingsRepository>,
}

impl SettingsService {
    pub fn new(settings_repo: Arc<SettingsRepository>) -> Self {
        Self { settings_repo }
    }

    pub async fn get_terminal_settings(&self) -> Result<TerminalSettingsDto, AppErrorDto> {
        let defaults = TerminalSettingsDto::default();
        let values = self.settings_repo.list_values().await?;

        let stored_font_family = Self::read_string(&values, TERMINAL_FONT_FAMILY_KEY);
        let font_family = default_terminal_font_family().to_string();
        if stored_font_family.as_deref() != Some(font_family.as_str()) {
            self.settings_repo
                .set_value(TERMINAL_FONT_FAMILY_KEY, &font_family)
                .await?;
        }

        let raw_letter_spacing = Self::read_f32(
            &values,
            TERMINAL_LETTER_SPACING_KEY,
            defaults.letter_spacing,
        );
        let letter_spacing = Self::clamp_letter_spacing(raw_letter_spacing);

        if (letter_spacing - raw_letter_spacing).abs() > f32::EPSILON {
            self.settings_repo
                .set_value(TERMINAL_LETTER_SPACING_KEY, &letter_spacing.to_string())
                .await?;
        }

        Ok(TerminalSettingsDto {
            font_family,
            font_size: Self::read_u16(&values, TERMINAL_FONT_SIZE_KEY, defaults.font_size),
            font_weight: Self::read_u16(&values, TERMINAL_FONT_WEIGHT_KEY, defaults.font_weight),
            font_weight_bold: Self::read_u16(
                &values,
                TERMINAL_FONT_WEIGHT_BOLD_KEY,
                defaults.font_weight_bold,
            ),
            line_height: Self::read_f32(&values, TERMINAL_LINE_HEIGHT_KEY, defaults.line_height),
            letter_spacing,
            cursor_blink: Self::read_bool(
                &values,
                TERMINAL_CURSOR_BLINK_KEY,
                defaults.cursor_blink,
            ),
            scrollback: Self::read_u32(&values, TERMINAL_SCROLLBACK_KEY, defaults.scrollback),
        })
    }

    pub async fn update_terminal_settings(
        &self,
        input: TerminalSettingsDto,
    ) -> Result<TerminalSettingsDto, AppErrorDto> {
        let font_family = default_terminal_font_family();
        let letter_spacing = Self::clamp_letter_spacing(input.letter_spacing);

        self.settings_repo
            .set_value(TERMINAL_FONT_FAMILY_KEY, font_family)
            .await?;
        self.settings_repo
            .set_value(TERMINAL_FONT_SIZE_KEY, &input.font_size.to_string())
            .await?;
        self.settings_repo
            .set_value(TERMINAL_FONT_WEIGHT_KEY, &input.font_weight.to_string())
            .await?;
        self.settings_repo
            .set_value(
                TERMINAL_FONT_WEIGHT_BOLD_KEY,
                &input.font_weight_bold.to_string(),
            )
            .await?;
        self.settings_repo
            .set_value(TERMINAL_LINE_HEIGHT_KEY, &input.line_height.to_string())
            .await?;
        self.settings_repo
            .set_value(TERMINAL_LETTER_SPACING_KEY, &letter_spacing.to_string())
            .await?;
        self.settings_repo
            .set_value(
                TERMINAL_CURSOR_BLINK_KEY,
                if input.cursor_blink { "true" } else { "false" },
            )
            .await?;
        self.settings_repo
            .set_value(TERMINAL_SCROLLBACK_KEY, &input.scrollback.to_string())
            .await?;

        self.get_terminal_settings().await
    }

    pub async fn reset_terminal_settings(&self) -> Result<TerminalSettingsDto, AppErrorDto> {
        let defaults = TerminalSettingsDto::default();
        self.update_terminal_settings(defaults.clone()).await?;
        Ok(defaults)
    }

    fn read_string(values: &HashMap<String, String>, key: &str) -> Option<String> {
        values
            .get(key)
            .map(|value| {
                let decoded =
                    serde_json::from_str::<String>(value).unwrap_or_else(|_| value.clone());
                decoded.trim().to_string()
            })
            .and_then(|value| if value.is_empty() { None } else { Some(value) })
    }

    fn read_u16(values: &HashMap<String, String>, key: &str, default: u16) -> u16 {
        values
            .get(key)
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(default)
    }

    fn read_u32(values: &HashMap<String, String>, key: &str, default: u32) -> u32 {
        values
            .get(key)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(default)
    }

    fn read_f32(values: &HashMap<String, String>, key: &str, default: f32) -> f32 {
        values
            .get(key)
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(default)
    }

    fn read_bool(values: &HashMap<String, String>, key: &str, default: bool) -> bool {
        values
            .get(key)
            .and_then(|value| value.parse::<bool>().ok())
            .unwrap_or(default)
    }

    fn clamp_letter_spacing(value: f32) -> f32 {
        value.clamp(-1.0, 1.0)
    }
}
