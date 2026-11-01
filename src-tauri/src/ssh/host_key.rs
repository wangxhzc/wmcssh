use crate::contracts::{AppErrorCode, AppErrorDto, HostKeyChallenge, TrustedHostKey};
use crate::utils::ids::new_id;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use ssh2::{CheckResult, HostKeyType, KnownHostFileKind, Session};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct HostKeyStore {
    path: PathBuf,
    file_lock: Mutex<()>,
}

impl HostKeyStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            file_lock: Mutex::new(()),
        }
    }

    pub fn verify(&self, session: &Session, hostname: &str, port: u16) -> Result<(), AppErrorDto> {
        let _guard = self.file_lock.lock().map_err(|_| host_key_store_error())?;
        let (key, key_type) = session.host_key().ok_or_else(|| {
            AppErrorDto::new(
                AppErrorCode::HostKeyVerificationFailed,
                "服务器未提供可验证的 SSH 主机密钥",
                false,
            )
        })?;
        let known_hosts = self.load(session)?;
        match known_hosts.check_port(hostname, port, key) {
            CheckResult::Match => Ok(()),
            CheckResult::NotFound => Err(challenge_error(hostname, port, key_type, key, false)),
            CheckResult::Mismatch => Err(challenge_error(hostname, port, key_type, key, true)),
            CheckResult::Failure => Err(host_key_store_error()),
        }
    }

    pub fn trust(
        &self,
        session: &Session,
        hostname: &str,
        port: u16,
        expected_fingerprint: &str,
    ) -> Result<(), AppErrorDto> {
        let _guard = self.file_lock.lock().map_err(|_| host_key_store_error())?;
        let (key, key_type) = session.host_key().ok_or_else(|| {
            AppErrorDto::new(
                AppErrorCode::HostKeyVerificationFailed,
                "服务器未提供可保存的 SSH 主机密钥",
                false,
            )
        })?;
        let actual_fingerprint = fingerprint_for_key(key);
        if actual_fingerprint != expected_fingerprint {
            return Err(AppErrorDto::with_details(
                AppErrorCode::HostKeyMismatch,
                "确认期间服务器主机密钥发生变化，已拒绝保存",
                actual_fingerprint,
                false,
            ));
        }

        let mut known_hosts = self.load(session)?;
        let entry_name = known_host_name(hostname, port);
        for host in known_hosts.hosts().map_err(host_key_error)? {
            if host.name() == Some(entry_name.as_str()) {
                known_hosts.remove(&host).map_err(host_key_error)?;
            }
        }
        known_hosts
            .add(&entry_name, key, "wmcssh", key_type.into())
            .map_err(host_key_error)?;
        self.write(&known_hosts)
    }

    pub fn list_trusted(&self) -> Result<Vec<TrustedHostKey>, AppErrorDto> {
        let _guard = self.file_lock.lock().map_err(|_| host_key_store_error())?;
        let contents = self.read_raw()?;
        let mut occurrences = HashMap::new();

        Ok(contents
            .split_inclusive(|byte| *byte == b'\n')
            .filter_map(|line| parse_trusted_host_key(line, &mut occurrences))
            .collect())
    }

    pub fn delete_trusted(&self, id: &str) -> Result<bool, AppErrorDto> {
        let _guard = self.file_lock.lock().map_err(|_| host_key_store_error())?;
        let contents = self.read_raw()?;
        let mut occurrences = HashMap::new();
        let mut deleted = false;
        let mut updated = Vec::with_capacity(contents.len());

        for line in contents.split_inclusive(|byte| *byte == b'\n') {
            let entry = parse_trusted_host_key(line, &mut occurrences);
            if !deleted && entry.as_ref().is_some_and(|entry| entry.id == id) {
                deleted = true;
            } else {
                updated.extend_from_slice(line);
            }
        }

        if deleted {
            self.write_raw(&updated)?;
        }
        Ok(deleted)
    }

    fn read_raw(&self) -> Result<Vec<u8>, AppErrorDto> {
        match std::fs::read(&self.path) {
            Ok(contents) => Ok(contents),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(AppErrorDto::io(error)),
        }
    }

    fn load(&self, session: &Session) -> Result<ssh2::KnownHosts, AppErrorDto> {
        let mut known_hosts = session.known_hosts().map_err(host_key_error)?;
        if self.path.exists() {
            known_hosts
                .read_file(&self.path, KnownHostFileKind::OpenSSH)
                .map_err(host_key_error)?;
        }
        Ok(known_hosts)
    }

    fn write(&self, known_hosts: &ssh2::KnownHosts) -> Result<(), AppErrorDto> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(AppErrorDto::io)?;
        }
        let temporary_path = self.path.with_extension(format!("{}.tmp", new_id()));
        let result = (|| {
            drop(create_private_file(&temporary_path)?);
            known_hosts
                .write_file(&temporary_path, KnownHostFileKind::OpenSSH)
                .map_err(host_key_error)?;
            set_private_permissions(&temporary_path)?;
            sync_file(&temporary_path)?;
            replace_file(&temporary_path, &self.path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary_path);
        }
        result
    }

    fn write_raw(&self, contents: &[u8]) -> Result<(), AppErrorDto> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(AppErrorDto::io)?;
        }
        let temporary_path = self.path.with_extension(format!("{}.tmp", new_id()));
        let result = (|| {
            let mut temporary_file = create_private_file(&temporary_path)?;
            temporary_file
                .write_all(contents)
                .map_err(AppErrorDto::io)?;
            set_private_permissions(&temporary_path)?;
            temporary_file.sync_all().map_err(AppErrorDto::io)?;
            drop(temporary_file);
            replace_file(&temporary_path, &self.path)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary_path);
        }
        result
    }
}

fn parse_trusted_host_key(
    raw_line: &[u8],
    occurrences: &mut HashMap<String, usize>,
) -> Option<TrustedHostKey> {
    let line_bytes = trim_line_ending(raw_line);
    let line = std::str::from_utf8(line_bytes).ok()?.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    let mut fields = line.split_whitespace();
    let first = fields.next()?;
    let (marker, host_patterns) = if first.starts_with('@') {
        (Some(first.to_string()), fields.next()?)
    } else {
        (None, first)
    };
    let key_type = fields.next()?;
    let encoded_key = fields.next()?;
    let key = decode_key(encoded_key)?;
    let line_hash = sha256_hex(line_bytes);
    let occurrence = occurrences.entry(line_hash.clone()).or_insert(0);
    let id = format!("kh1:{line_hash}:{}", *occurrence);
    *occurrence += 1;
    let hashed = host_patterns
        .split(',')
        .any(|pattern| pattern.starts_with("|1|"));
    let (hostname, port) = parse_host_display(host_patterns, hashed);

    Some(TrustedHostKey {
        id,
        host_patterns: host_patterns.to_string(),
        hostname,
        port,
        key_type: key_type.to_string(),
        fingerprint: fingerprint_for_key(&key),
        hashed,
        marker,
    })
}

fn trim_line_ending(line: &[u8]) -> &[u8] {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    line.strip_suffix(b"\r").unwrap_or(line)
}

fn decode_key(encoded_key: &str) -> Option<Vec<u8>> {
    STANDARD.decode(encoded_key).ok().or_else(|| {
        let missing_padding = (4 - encoded_key.len() % 4) % 4;
        let padded = format!("{encoded_key}{}", "=".repeat(missing_padding));
        STANDARD.decode(padded).ok()
    })
}

fn parse_host_display(host_patterns: &str, hashed: bool) -> (Option<String>, Option<u16>) {
    if hashed {
        return (None, None);
    }

    let patterns: Vec<_> = host_patterns.split(',').collect();
    let parsed: Vec<_> = patterns.iter().map(|pattern| parse_host(pattern)).collect();
    let port = parsed
        .first()
        .and_then(|(_, port)| *port)
        .filter(|first_port| {
            parsed
                .iter()
                .all(|(_, candidate)| candidate == &Some(*first_port))
        });
    let hostname = if parsed.len() == 1 {
        parsed.into_iter().next().and_then(|(hostname, _)| hostname)
    } else {
        None
    };
    (hostname, port)
}

fn parse_host(pattern: &str) -> (Option<String>, Option<u16>) {
    let pattern = pattern.strip_prefix('!').unwrap_or(pattern);
    if let Some(rest) = pattern.strip_prefix('[') {
        if let Some((hostname, port)) = rest.rsplit_once("]:") {
            return (
                (!hostname.is_empty()).then(|| hostname.to_string()),
                port.parse().ok(),
            );
        }
    }
    if pattern.is_empty() || pattern.contains('*') || pattern.contains('?') {
        (None, Some(22))
    } else {
        (Some(pattern.to_string()), Some(22))
    }
}

fn sha256_hex(value: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(value);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push(HEX[usize::from(byte >> 4)] as char);
        encoded.push(HEX[usize::from(byte & 0x0f)] as char);
    }
    encoded
}

fn challenge_error(
    hostname: &str,
    port: u16,
    key_type: HostKeyType,
    key: &[u8],
    changed: bool,
) -> AppErrorDto {
    let challenge = HostKeyChallenge {
        hostname: hostname.to_string(),
        port,
        key_type: key_type_name(key_type).to_string(),
        fingerprint: fingerprint_for_key(key),
        changed,
    };
    AppErrorDto::with_details(
        if changed {
            AppErrorCode::HostKeyMismatch
        } else {
            AppErrorCode::HostKeyUnknown
        },
        if changed {
            format!("警告：{hostname}:{port} 的 SSH 主机密钥与已信任记录不一致")
        } else {
            format!("首次连接 {hostname}:{port}，需要确认 SSH 主机密钥")
        },
        serde_json::to_string(&challenge).unwrap_or_default(),
        false,
    )
}

pub fn fingerprint_for_key(key: &[u8]) -> String {
    let digest = Sha256::digest(key);
    format!("SHA256:{}", STANDARD.encode(digest).trim_end_matches('='))
}

fn key_type_name(key_type: HostKeyType) -> &'static str {
    match key_type {
        HostKeyType::Rsa => "RSA",
        HostKeyType::Dss => "DSA",
        HostKeyType::Ecdsa256 => "ECDSA-256",
        HostKeyType::Ecdsa384 => "ECDSA-384",
        HostKeyType::Ecdsa521 => "ECDSA-521",
        HostKeyType::Ed25519 => "ED25519",
        HostKeyType::Unknown => "UNKNOWN",
    }
}

fn known_host_name(hostname: &str, port: u16) -> String {
    if port == 22 {
        hostname.to_string()
    } else {
        format!("[{hostname}]:{port}")
    }
}

fn sync_file(path: &Path) -> Result<(), AppErrorDto> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    // Windows FlushFileBuffers requires a handle opened for writing.
    #[cfg(windows)]
    options.write(true);
    options
        .open(path)
        .and_then(|file| file.sync_all())
        .map_err(AppErrorDto::io)
}

fn create_private_file(path: &Path) -> Result<std::fs::File, AppErrorDto> {
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(AppErrorDto::io)
}

fn replace_file(temporary_path: &Path, target_path: &Path) -> Result<(), AppErrorDto> {
    if !target_path.exists() {
        return std::fs::rename(temporary_path, target_path).map_err(AppErrorDto::io);
    }

    let backup_path = target_path.with_extension(format!("{}.backup", new_id()));
    std::fs::rename(target_path, &backup_path).map_err(AppErrorDto::io)?;
    match std::fs::rename(temporary_path, target_path) {
        Ok(()) => {
            let _ = std::fs::remove_file(backup_path);
            Ok(())
        }
        Err(replace_error) => match std::fs::rename(&backup_path, target_path) {
            Ok(()) => Err(AppErrorDto::io(replace_error)),
            Err(restore_error) => Err(AppErrorDto::with_details(
                AppErrorCode::IoError,
                "SSH 主机密钥文件替换失败，原文件保留在备份路径",
                format!("replace failed: {replace_error}; restore failed: {restore_error}"),
                true,
            )),
        },
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), AppErrorDto> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(AppErrorDto::io)
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), AppErrorDto> {
    Ok(())
}

fn host_key_error(error: impl ToString) -> AppErrorDto {
    AppErrorDto::with_details(
        AppErrorCode::HostKeyVerificationFailed,
        "SSH 主机密钥存储操作失败",
        error.to_string(),
        false,
    )
}

fn host_key_store_error() -> AppErrorDto {
    AppErrorDto::new(
        AppErrorCode::HostKeyVerificationFailed,
        "SSH 主机密钥存储暂时不可用",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known_host_line(hosts: &str, key_type: &str, key: &[u8]) -> String {
        format!("{hosts} {key_type} {}", STANDARD.encode(key))
    }

    fn temporary_test_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("wmcssh-known-hosts-{name}-{}", new_id()))
            .join("known_hosts")
    }

    #[test]
    fn formats_standard_and_nonstandard_known_host_names() {
        assert_eq!(known_host_name("example.com", 22), "example.com");
        assert_eq!(known_host_name("example.com", 2222), "[example.com]:2222");
        assert_eq!(known_host_name("::1", 2222), "[::1]:2222");
    }

    #[test]
    fn creates_openssh_sha256_fingerprint_without_padding() {
        let fingerprint = fingerprint_for_key(b"test host key");
        assert!(fingerprint.starts_with("SHA256:"));
        assert!(!fingerprint.ends_with('='));
        assert_eq!(fingerprint, fingerprint_for_key(b"test host key"));
        assert_ne!(fingerprint, fingerprint_for_key(b"another host key"));
    }

    #[test]
    fn openssh_file_round_trip_matches_standard_and_custom_ports() {
        let path = std::env::temp_dir().join(format!("wmcssh-known-hosts-test-{}", new_id()));
        let session = Session::new().expect("create SSH session");
        let mut known_hosts = session
            .known_hosts()
            .expect("create known-hosts collection");
        known_hosts
            .add(
                "example.com",
                b"standard-key",
                "test",
                ssh2::KnownHostKeyFormat::Ed25519,
            )
            .expect("add standard-port key");
        known_hosts
            .add(
                "[example.com]:2222",
                b"custom-key",
                "test",
                ssh2::KnownHostKeyFormat::Ed25519,
            )
            .expect("add custom-port key");
        HostKeyStore::new(path.clone())
            .write(&known_hosts)
            .expect("write known-hosts file atomically");

        let mut loaded = session.known_hosts().expect("create second collection");
        loaded
            .read_file(&path, KnownHostFileKind::OpenSSH)
            .expect("read known-hosts file");
        assert!(matches!(
            loaded.check_port("example.com", 22, b"standard-key"),
            CheckResult::Match
        ));
        assert!(matches!(
            loaded.check_port("example.com", 2222, b"custom-key"),
            CheckResult::Match
        ));
        std::fs::remove_file(path).expect("remove known-hosts test file");
    }

    #[test]
    fn lists_standard_custom_hashed_and_marked_entries_while_skipping_invalid_lines() {
        let path = temporary_test_path("list");
        std::fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        let key_one = b"first host key";
        let key_two = b"second host key";
        let contents = format!(
            "# managed by a user\n\n{} workstation\n{}\n{}\n{}\n@cert-authority *.corp.example {}\ninvalid entry !!!\n",
            known_host_line("example.com", "ssh-ed25519", key_one),
            known_host_line("[example.net]:2222", "ssh-rsa", key_two),
            known_host_line("|1|c2FsdA==|aGFzaA==", "ssh-ed25519", key_one),
            known_host_line("alias.example,192.0.2.1", "ssh-ed25519", key_one),
            known_host_line("ignored", "ecdsa-sha2-nistp256", key_two)
                .split_once(' ')
                .expect("host field")
                .1,
        );
        std::fs::write(&path, contents).expect("write test known-hosts file");

        let entries = HostKeyStore::new(path.clone())
            .list_trusted()
            .expect("list trusted host keys");
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0].hostname.as_deref(), Some("example.com"));
        assert_eq!(entries[0].port, Some(22));
        assert_eq!(entries[0].key_type, "ssh-ed25519");
        assert_eq!(entries[0].fingerprint, fingerprint_for_key(key_one));
        assert_eq!(entries[1].hostname.as_deref(), Some("example.net"));
        assert_eq!(entries[1].port, Some(2222));
        assert!(entries[2].hashed);
        assert_eq!(entries[2].hostname, None);
        assert_eq!(entries[2].port, None);
        assert_eq!(entries[3].host_patterns, "alias.example,192.0.2.1");
        assert_eq!(entries[3].hostname, None);
        assert_eq!(entries[3].port, Some(22));
        assert_eq!(entries[4].marker.as_deref(), Some("@cert-authority"));
        assert_eq!(entries[4].hostname, None);
        assert_eq!(entries[4].port, Some(22));

        std::fs::remove_dir_all(path.parent().expect("test parent"))
            .expect("remove test directory");
    }

    #[test]
    fn deletes_only_the_selected_entry_and_preserves_unparsed_content() {
        let path = temporary_test_path("delete");
        std::fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        let first = known_host_line("example.com", "ssh-ed25519", b"first key");
        let second = known_host_line("example.com", "ssh-ed25519", b"second key");
        let duplicate = known_host_line("duplicate.example", "ssh-rsa", b"duplicate key");
        let mut contents = format!(
            "# keep this comment\r\n{first}\r\nmalformed line\r\n{second}\r\n{duplicate}\r\n{duplicate}\r\n"
        )
        .into_bytes();
        contents.extend_from_slice(&[0xff, b'\n']);
        std::fs::write(&path, &contents).expect("write test known-hosts file");
        let store = HostKeyStore::new(path.clone());
        let entries = store.list_trusted().expect("list entries before deletion");
        assert_eq!(entries.len(), 4);
        assert_ne!(entries[2].id, entries[3].id);

        assert!(store
            .delete_trusted(&entries[0].id)
            .expect("delete selected entry"));
        assert!(!store
            .delete_trusted("kh1:missing:0")
            .expect("missing entry is explicit"));
        let updated = std::fs::read(&path).expect("read updated known-hosts file");
        assert!(!updated
            .windows(first.len())
            .any(|window| window == first.as_bytes()));
        assert!(updated
            .windows(second.len())
            .any(|window| window == second.as_bytes()));
        assert!(updated
            .windows(b"# keep this comment\r\n".len())
            .any(|window| window == b"# keep this comment\r\n"));
        assert!(updated.ends_with(&[0xff, b'\n']));

        let remaining = store.list_trusted().expect("list entries after deletion");
        assert_eq!(remaining.len(), 3);
        assert_eq!(
            remaining
                .iter()
                .filter(|entry| entry.host_patterns == "duplicate.example")
                .count(),
            2
        );
        assert!(store
            .delete_trusted(&remaining[2].id)
            .expect("delete one exact duplicate"));
        assert_eq!(
            store
                .list_trusted()
                .expect("list after duplicate deletion")
                .iter()
                .filter(|entry| entry.host_patterns == "duplicate.example")
                .count(),
            1
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path)
                    .expect("read known-hosts metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        assert_eq!(
            std::fs::read_dir(path.parent().expect("test parent"))
                .expect("list test directory")
                .count(),
            1,
            "atomic replacement must not leave temporary files"
        );
        std::fs::remove_dir_all(path.parent().expect("test parent"))
            .expect("remove test directory");
    }

    #[test]
    fn replaces_an_existing_file_without_leaving_a_backup() {
        let path = temporary_test_path("replace");
        std::fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        std::fs::write(&path, b"old contents\n").expect("write existing file");
        let store = HostKeyStore::new(path.clone());

        store
            .write_raw(b"new contents\n")
            .expect("replace existing known-hosts file");

        assert_eq!(
            std::fs::read(&path).expect("read replaced file"),
            b"new contents\n"
        );
        assert_eq!(
            std::fs::read_dir(path.parent().expect("test parent"))
                .expect("list test directory")
                .count(),
            1,
            "successful replacement must remove its backup"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path)
                    .expect("read replaced metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(path.parent().expect("test parent"))
            .expect("remove test directory");
    }

    #[test]
    fn restores_the_existing_file_when_replacement_fails() {
        let path = temporary_test_path("restore");
        std::fs::create_dir_all(path.parent().expect("test parent")).expect("create test parent");
        std::fs::write(&path, b"original contents\n").expect("write existing file");
        let missing_temporary_path = path.with_extension("missing.tmp");

        assert!(replace_file(&missing_temporary_path, &path).is_err());
        assert_eq!(
            std::fs::read(&path).expect("read restored file"),
            b"original contents\n"
        );
        assert_eq!(
            std::fs::read_dir(path.parent().expect("test parent"))
                .expect("list test directory")
                .count(),
            1,
            "failed replacement must restore the target and remove its backup name"
        );
        std::fs::remove_dir_all(path.parent().expect("test parent"))
            .expect("remove test directory");
    }
}
