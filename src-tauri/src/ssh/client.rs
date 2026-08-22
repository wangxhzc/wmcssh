use crate::contracts::{AppErrorCode, AppErrorDto};
use crate::ssh::host_key::HostKeyStore;
use crate::ssh::types::{AuthConfig, ConnectConfig};
use ssh2::Session;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

pub fn connect_ssh_transport(
    hostname: &str,
    port: u16,
    timeout_ms: u64,
) -> Result<Session, AppErrorDto> {
    let tcp = connect_tcp_stream(hostname, port, timeout_ms)?;
    let mut session = Session::new().map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Failed to create SSH session",
            err.to_string(),
            true,
        )
    })?;

    session.set_timeout(u32::try_from(timeout_ms).unwrap_or(u32::MAX).max(1));
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::NetworkUnreachable,
            "SSH handshake failed",
            err.to_string(),
            true,
        )
    })?;
    Ok(session)
}

pub fn connect_ssh_session(
    config: &ConnectConfig,
    host_key_store: &HostKeyStore,
) -> Result<Session, AppErrorDto> {
    let session = connect_ssh_transport(&config.hostname, config.port, config.connect_timeout_ms)?;
    host_key_store.verify(&session, &config.hostname, config.port)?;

    authenticate(&session, config)?;

    if !session.authenticated() {
        return Err(AppErrorDto::new(
            AppErrorCode::AuthFailed,
            "SSH authentication failed",
            false,
        ));
    }

    session.set_keepalive(true, config.keepalive_interval_secs as u32);
    Ok(session)
}

fn authenticate(session: &Session, config: &ConnectConfig) -> Result<(), AppErrorDto> {
    match &config.auth {
        AuthConfig::Password { password } => {
            session
                .userauth_password(&config.username, password)
                .map_err(|err| {
                    AppErrorDto::with_details(
                        AppErrorCode::AuthFailed,
                        "Password authentication failed",
                        err.to_string(),
                        false,
                    )
                })?;
        }
        AuthConfig::PrivateKey {
            private_key_path,
            passphrase,
        } => {
            session
                .userauth_pubkey_file(
                    &config.username,
                    None,
                    Path::new(private_key_path),
                    passphrase.as_deref(),
                )
                .map_err(|err| {
                    AppErrorDto::with_details(
                        AppErrorCode::AuthFailed,
                        "Private key authentication failed",
                        err.to_string(),
                        false,
                    )
                })?;
        }
    }

    Ok(())
}

fn connect_tcp_stream(
    hostname: &str,
    port: u16,
    timeout_ms: u64,
) -> Result<TcpStream, AppErrorDto> {
    let timeout = Duration::from_millis(timeout_ms.max(1));
    let addresses = (hostname, port)
        .to_socket_addrs()
        .map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::NetworkUnreachable,
                "Failed to resolve host",
                err.to_string(),
                true,
            )
        })?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(AppErrorDto::new(
            AppErrorCode::NetworkUnreachable,
            "No socket address resolved for host",
            true,
        ));
    }

    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, timeout) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some((address, error)),
        }
    }

    let Some((address, error)) = last_error else {
        return Err(AppErrorDto::new(
            AppErrorCode::NetworkUnreachable,
            "No socket address could be attempted",
            true,
        ));
    };
    Err(AppErrorDto::with_details(
        AppErrorCode::NetworkUnreachable,
        format!("Failed to connect to {address}"),
        error.to_string(),
        true,
    ))
}
