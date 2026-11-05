use std::io::Read;

// Probe on a separate channel so unsupported shells never receive POSIX shell input.
pub fn supports_directory_reporting(session: &ssh2::Session) -> bool {
    let probe = || -> Result<bool, ssh2::Error> {
        let mut channel = session.channel_session()?;
        channel.exec(
            "command -v od tr sed stty >/dev/null 2>&1 && printf '\\nwmcssh-shell:%s\\n' \"$SHELL\"",
        )?;
        let mut output = String::new();
        let read = channel.by_ref().take(8192).read_to_string(&mut output);
        let _ = channel.close();
        Ok(read.is_ok() && supported_shell(&output))
    };
    probe().unwrap_or(false)
}

fn supported_shell(output: &str) -> bool {
    output.lines().any(|line| {
        line.strip_prefix("wmcssh-shell:")
            .and_then(|shell| shell.rsplit('/').next())
            .is_some_and(|shell| matches!(shell, "bash" | "zsh"))
    })
}

// Percent-encode every path byte, including newlines and URI delimiters. Keep the
// leading slash literal so the existing OSC 7 URI parser sees an absolute path.
// With echo disabled the initial prompt is still on the cursor line. Erase only
// that line before the shell redraws its prompt, preserving the login banner.
pub const DIRECTORY_REPORTING_SCRIPT: &str = concat!(
    " export COLORTERM=truecolor; if [ -n \"${BASH_VERSION-}${ZSH_VERSION-}\" ] && ! typeset -f __wmcssh_report_directory >/dev/null 2>&1; then ",
    "__wmcssh_report_directory() { local wmcssh_status=$?; local wmcssh_path; ",
    "wmcssh_path=$(printf '%s' \"${PWD#/}\" | od -An -v -tx1 | tr -d ' \\n' | sed 's/../%&/g'); ",
    "printf '\\033]7;file://localhost/%s\\007' \"$wmcssh_path\"; return \"$wmcssh_status\"; }; ",
    // Bash before 5.1 executes only element zero of PROMPT_COMMAND. Preserve
    // scalar hooks as scalar commands; flatten existing arrays on older Bash.
    "if [ -n \"${BASH_VERSION-}\" ]; then if ! [[ $(declare -p PROMPT_COMMAND 2>/dev/null) =~ ^declare\\ -[^[:space:]]*r ]]; then case \"$(declare -p PROMPT_COMMAND 2>/dev/null)\" in ",
    "'declare -a'*) if [ \"${BASH_VERSINFO[0]}\" -gt 5 ] || { [ \"${BASH_VERSINFO[0]}\" -eq 5 ] && [ \"${BASH_VERSINFO[1]}\" -ge 1 ]; }; then ",
    "PROMPT_COMMAND+=(__wmcssh_report_directory); else ",
    "printf -v __wmcssh_prompt_commands '%s\\n' \"${PROMPT_COMMAND[@]}\"; unset PROMPT_COMMAND; ",
    "PROMPT_COMMAND=\"${__wmcssh_prompt_commands}__wmcssh_report_directory\"; unset __wmcssh_prompt_commands; fi ;; ",
    "*) PROMPT_COMMAND=\"${PROMPT_COMMAND-}\"$'\\n''__wmcssh_report_directory' ;; esac; fi; ",
    "elif [ -n \"${ZSH_VERSION-}\" ]; then typeset -ga precmd_functions; precmd_functions+=(__wmcssh_report_directory); fi; fi; ",
    "if [ -t 1 ]; then printf '\\r\\033[2K\\033]777;wmcssh-ready\\007'; fi; stty echo 2>/dev/null; :\n"
);

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::process::Command;

    #[test]
    #[cfg(target_os = "linux")]
    fn interactive_bash_replaces_initial_prompt_and_restores_echo() {
        let output = Command::new("python3")
            .args([
                "-c",
                r#"
import os, pty, select, sys, termios, time
pid, fd = pty.fork()
if pid == 0:
    modes = termios.tcgetattr(0)
    modes[3] &= ~(termios.ECHO | termios.ECHONL)
    termios.tcsetattr(0, termios.TCSANOW, modes)
    os.environ['PS1'] = 'wmcssh-test> '
    os.environ['HISTFILE'] = '/dev/null'
    os.write(1, b'Last login: test banner\r\n')
    os.execvp('bash', ['bash', '--noprofile', '--norc', '-i'])
def read_until(marker):
    data = b''
    deadline = time.monotonic() + 5
    while marker not in data:
        assert time.monotonic() < deadline, repr(data)
        if select.select([fd], [], [], 0.1)[0]:
            data += os.read(fd, 65536)
    return data
try:
    initial = read_until(b'wmcssh-test> ')
    assert b'Last login: test banner' in initial, repr(initial)
    os.write(fd, sys.argv[1].encode())
    result = read_until(b'wmcssh-test> ')
    assert b'__wmcssh_report_directory' not in result, repr(result)
    # Only the cursor line is cleared; no screen/history erase or cursor-up.
    assert b'\r\x1b[2K' in result, repr(result)
    assert result.count(b'\x1b[2K') == 1, repr(result)
    assert result.index(b'\r\x1b[2K') < result.index(b'\x1b]7;'), repr(result)
    assert b'\x1b[2J' not in result and b'\x1b[3J' not in result
    assert b'\x1b[A' not in result
    assert result.count(b'wmcssh-test> ') == 1, repr(result)
    os.write(fd, b'cd /tmp\n')
    result = read_until(b'file://localhost/%74%6d%70\x07')
    assert b'cd /tmp' in result, repr(result)
    os.write(fd, b'printf "color-env=%s-end" "$COLORTERM"\n')
    read_until(b'color-env=truecolor-end')
finally:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    os.close(fd)
"#,
                DIRECTORY_REPORTING_SCRIPT,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn recognizes_only_supported_login_shells() {
        assert!(supported_shell("banner\nwmcssh-shell:/bin/bash\n"));
        assert!(supported_shell("wmcssh-shell:/usr/bin/zsh\n"));
        assert!(!supported_shell("wmcssh-shell:/bin/fish\n"));
        assert!(!supported_shell("wmcssh-shell:$SHELL\n"));
    }

    #[test]
    #[cfg(unix)]
    fn bash_hook_preserves_existing_commands_and_encodes_paths() {
        let script = format!(
            "PROMPT_COMMAND='echo existing';\n{0}{0}PWD='/tmp/a #?%'; __wmcssh_report_directory; printf '\\n'; printf '%s\\n' \"${{PROMPT_COMMAND[@]}}\"; [[ $(declare -p PROMPT_COMMAND) != 'declare -a'* ]]",
            DIRECTORY_REPORTING_SCRIPT
        );
        let output = Command::new("bash")
            .args(["--noprofile", "--norc", "-c", &script])
            .output()
            .expect("bash is required for shell integration tests");
        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.starts_with("\x1b]7;file://localhost/%74%6d%70%2f%61%20%23%3f%25\x07"));
        assert!(stdout.ends_with("\necho existing\n__wmcssh_report_directory\n"));
    }

    #[test]
    #[cfg(unix)]
    fn bash_hook_preserves_array_hooks_and_exit_status() {
        let script = format!(
            "PROMPT_COMMAND=('echo first' 'echo second');\n{}PWD='/'; (exit 42); __wmcssh_report_directory; result=$?; printf '\\n'; printf '%s\\n' \"$result\" \"${{PROMPT_COMMAND[@]}}\"",
            DIRECTORY_REPORTING_SCRIPT
        );
        let output = Command::new("bash")
            .args(["--noprofile", "--norc", "-c", &script])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "\x1b]7;file://localhost/\x07\n42\necho first\necho second\n__wmcssh_report_directory\n"
        );
    }

    #[test]
    #[cfg(unix)]
    fn bash_hook_skips_readonly_prompt_commands() {
        for original in [
            "readonly PROMPT_COMMAND=':'",
            "PROMPT_COMMAND=(':' ':'); readonly PROMPT_COMMAND",
            "export PROMPT_COMMAND=':'; readonly PROMPT_COMMAND",
        ] {
            let script = format!(
                "{original}; before=$(declare -p PROMPT_COMMAND);\n{0}{0}[[ $(declare -p PROMPT_COMMAND) == \"$before\" ]] && eval \"${{PROMPT_COMMAND[0]}}\"",
                DIRECTORY_REPORTING_SCRIPT
            );
            let output = Command::new("bash")
                .args(["--noprofile", "--norc", "-c", &script])
                .output()
                .unwrap();
            assert!(output.status.success(), "{original}");
            assert!(
                output.stderr.is_empty(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(output.stdout.is_empty(), "{original}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn legacy_bash_array_hooks_are_combined_before_directory_reporting() {
        // Exercise the legacy branch with the local Bash; its real 5.0 behavior
        // is also checked on a remote host during compatibility validation.
        let integration = DIRECTORY_REPORTING_SCRIPT
            .replace("${BASH_VERSINFO[0]}", "5")
            .replace("${BASH_VERSINFO[1]}", "0");
        let script = format!(
            "PROMPT_COMMAND=('echo first # comment' 'echo second');\n{integration}PWD='/tmp'; eval \"${{PROMPT_COMMAND[0]}}\"; [[ $(declare -p PROMPT_COMMAND) != 'declare -a'* ]]"
        );
        let output = Command::new("bash")
            .args(["--noprofile", "--norc", "-c", &script])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "first\nsecond\n\x1b]7;file://localhost/%74%6d%70\x07"
        );
    }

    #[test]
    #[cfg(unix)]
    fn scalar_prompt_command_reports_directory_when_only_element_zero_is_executed() {
        for original in [
            "unset PROMPT_COMMAND",
            "PROMPT_COMMAND=':'",
            "PROMPT_COMMAND=$': # existing comment'",
        ] {
            let script = format!(
                "{original};\n{}PWD='/tmp'; eval \"${{PROMPT_COMMAND[0]}}\"; PWD='/'; eval \"${{PROMPT_COMMAND[0]}}\"",
                DIRECTORY_REPORTING_SCRIPT
            );
            let output = Command::new("bash")
                .args(["--noprofile", "--norc", "-c", &script])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                "\x1b]7;file://localhost/%74%6d%70\x07\x1b]7;file://localhost/\x07",
                "{original}"
            );
        }
    }
}
