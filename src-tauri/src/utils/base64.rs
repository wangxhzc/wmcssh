use crate::contracts::{AppErrorCode, AppErrorDto};
use base64::{engine::general_purpose, Engine as _};

pub fn encode_base64(input: &[u8]) -> String {
    general_purpose::STANDARD.encode(input)
}

pub fn decode_base64(input: &str) -> Result<Vec<u8>, AppErrorDto> {
    general_purpose::STANDARD.decode(input).map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Invalid base64 input",
            err.to_string(),
            false,
        )
    })
}
