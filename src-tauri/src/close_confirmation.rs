pub fn exit_confirmation_message(
    terminals: Option<usize>,
    file_sessions: Option<usize>,
    transfers: Option<usize>,
) -> Option<String> {
    if terminals == Some(0) && file_sessions == Some(0) && transfers == Some(0) {
        return None;
    }
    let mut details = Vec::new();
    match terminals {
        Some(0) => {}
        Some(count) => details.push(format!("还有 {count} 个终端会话已连接或正在连接。")),
        None => details.push("无法确认终端连接状态。".into()),
    }
    match file_sessions {
        Some(0) => {}
        Some(count) => details.push(format!("还有 {count} 个文件会话已连接。")),
        None => details.push("无法确认文件连接状态。".into()),
    }
    match transfers {
        Some(0) => {}
        Some(count) => details.push(format!("还有 {count} 个文件传输任务未完成。")),
        None => details.push("无法确认文件传输状态。".into()),
    }
    details
        .push("退出会断开所有连接；未完成的传输会被中断，重新启动后不会恢复。确定退出吗？".into());
    Some(details.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::exit_confirmation_message;

    #[test]
    fn no_sessions_or_transfers_closes_without_confirmation() {
        assert!(exit_confirmation_message(Some(0), Some(0), Some(0)).is_none());
    }

    #[test]
    fn terminal_and_file_connections_each_require_confirmation() {
        let terminal = exit_confirmation_message(Some(2), Some(0), Some(0)).unwrap();
        assert!(terminal.contains("2 个终端会话"));
        let files = exit_confirmation_message(Some(0), Some(1), Some(0)).unwrap();
        assert!(files.contains("1 个文件会话"));
    }

    #[test]
    fn background_transfers_still_require_confirmation_without_tabs() {
        let message = exit_confirmation_message(Some(0), Some(0), Some(3)).unwrap();
        assert!(message.contains("3 个文件传输任务未完成"));
        assert!(message.contains("重新启动后不会恢复"));
    }

    #[test]
    fn combined_activity_uses_one_message() {
        let message = exit_confirmation_message(Some(1), Some(2), Some(3)).unwrap();
        for detail in ["1 个终端会话", "2 个文件会话", "3 个文件传输任务"] {
            assert!(message.contains(detail));
        }
    }

    #[test]
    fn unknown_state_requires_confirmation() {
        for counts in [
            (None, Some(0), Some(0)),
            (Some(0), None, Some(0)),
            (Some(0), Some(0), None),
        ] {
            let message = exit_confirmation_message(counts.0, counts.1, counts.2).unwrap();
            assert!(message.contains("无法确认"));
        }
    }
}
