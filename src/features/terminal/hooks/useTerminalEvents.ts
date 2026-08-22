import { useEffect } from "react";
import { listenSshClosed, listenSshError, listenSshStatus } from "../../../services/tauri/eventBus";
import { useTerminalStore } from "../../../stores/terminalStore";
import { resumeTerminalInput, retryAuthentication, stopTerminalInputBySessionId } from "../actions";

function errorMessage(code: string, fallback: string) {
  switch (code) {
    case "secret_not_found": return "保存的认证凭据不存在或已失效";
    case "host_invalid": return `主机配置不完整：${fallback}`;
    case "host_key_unknown": return fallback || "首次连接，需要确认服务器主机密钥";
    case "host_key_mismatch": return fallback || "服务器主机密钥与已信任记录不一致";
    case "host_key_verification_failed": return fallback || "无法验证服务器主机密钥";
    case "network_unreachable": return `无法连接到主机：${fallback}`;
    case "timeout": return "SSH 连接超时，请检查网络或连接超时设置";
    case "session_not_found": return "SSH 会话状态已失效，请重新连接";
    case "session_closed": return "SSH 会话已经关闭";
    case "input_buffer_full": return "输入发送过快，已暂时暂停输入";
    case "secret_store_error": return "系统凭据存储不可用，请检查应用数据权限";
    case "host_not_found": return "主机记录不存在或已被删除";
    case "unsupported": return `当前环境不支持此操作：${fallback}`;
    case "database_error": return "读取连接配置失败，请检查本地数据库";
    case "io_error": return `SSH 通道发生 I/O 错误：${fallback}`;
    default: return fallback || "发生未知 SSH 错误";
  }
}

export function useTerminalEvents() {
  const setTabStatus = useTerminalStore((state) => state.setTabStatus);

  useEffect(() => {
    const disposers: Array<() => void> = [];

    void listenSshStatus((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      if (payload.status === "disconnected" || payload.status === "error") {
        setTabStatus(tab.tabId, payload.status, payload.message);
      } else {
        // Connecting/Connected/Reconnecting/Closing are normal lifecycle states,
        // so their protocol messages must not become user-facing error banners.
        setTabStatus(tab.tabId, payload.status);
      }
    }).then((dispose) => disposers.push(dispose));

    void listenSshClosed((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      stopTerminalInputBySessionId(payload.sessionId, "ssh_closed_event");
      // A worker failure emits ssh:error followed by ssh:closed. Preserve the
      // structured error instead of replacing it with a generic closed state.
      if (payload.reason === "worker_error" && tab.status === "error" && tab.errorCode) return;
      const message = payload.message ?? (payload.reason === "remote_closed" ? "远程主机已关闭连接" : "SSH 连接已断开");
      setTabStatus(tab.tabId, "disconnected", message, payload.reason === "network_error" ? "network_unreachable" : "session_closed");
    }).then((dispose) => disposers.push(dispose));

    void listenSshError((payload) => {
      const tab = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
      if (!tab) return;

      const message = errorMessage(payload.error.code, payload.error.message);
      if (payload.error.code === "input_buffer_full") {
        stopTerminalInputBySessionId(payload.sessionId, "input_buffer_full");
        setTabStatus(tab.tabId, "connected", message, payload.error.code);
        window.setTimeout(() => {
          const current = useTerminalStore.getState().findTabBySessionId(payload.sessionId);
          if (current?.tabId !== tab.tabId || current.errorCode !== "input_buffer_full") return;
          resumeTerminalInput(tab.tabId);
          setTabStatus(tab.tabId, "connected");
        }, 1500);
        return;
      }

      stopTerminalInputBySessionId(payload.sessionId, "ssh_error_event");
      setTabStatus(tab.tabId, "error", message, payload.error.code, payload.error.details);
      if (payload.error.code === "auth_failed" || payload.error.code === "secret_not_found") {
        void retryAuthentication(tab.tabId, message);
      } else if (payload.error.code === "host_invalid" && /username|private key|password/i.test(payload.error.message)) {
        void retryAuthentication(tab.tabId, message);
      }
    }).then((dispose) => disposers.push(dispose));

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [setTabStatus]);
}
