pub type HostId = String;
pub type SessionId = String;
pub type GroupId = String;
pub type TagId = String;
pub type EpochMillis = i64;

pub const CONTRACT_VERSION: u32 = 1;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoDto {
    pub contract_version: u32,
    pub app_version: String,
}
