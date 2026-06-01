use crate::contracts::{AppErrorCode, AppErrorDto};
use crate::ssh::types::{AuthConfig, ConnectConfig};
use ssh2::Session;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;

pub fn connect_ssh_session(config: &ConnectConfig) -> Result<Session, AppErrorDto> {
    let tcp = connect_tcp_stream(&config.hostname, config.port, config.connect_timeout_ms)?;

    let mut session = Session::new().map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::IoError,
            "Failed to create SSH session",
            err.to_string(),
            true,
        )
    })?;

    session.set_tcp_stream(tcp);
    session.handshake().map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::NetworkUnreachable,
            "SSH handshake failed",
            err.to_string(),
            true,
        )
    })?;

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
    let addr = (hostname, port)
        .to_socket_addrs()
        .map_err(|err| {
            AppErrorDto::with_details(
                AppErrorCode::NetworkUnreachable,
                "Failed to resolve host",
                err.to_string(),
                true,
            )
        })?
        .next()
        .ok_or_else(|| {
            AppErrorDto::new(
                AppErrorCode::NetworkUnreachable,
                "No socket address resolved for host",
                true,
            )
        })?;

    TcpStream::connect_timeout(&addr, timeout).map_err(|err| {
        AppErrorDto::with_details(
            AppErrorCode::NetworkUnreachable,
            format!("Failed to connect to {addr}"),
            err.to_string(),
            true,
        )
    })
}
