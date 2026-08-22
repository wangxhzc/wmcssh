import { useEffect, useState } from "react";
import { useHostStore } from "../../../stores/hostStore";
import { listHosts, updateHost } from "../../../services/tauri/hostApi";
import { connectHost } from "../../terminal/actions";
import type { ConnectionCredentials } from "../connectionCredentials";
import type { HostDto } from "../../../types/host";
import type { QuickConnectTarget } from "../quickConnect";
import { findMatchingQuickConnectHost } from "../quickConnect";

type QuickConnectDialogProps = {
  target: QuickConnectTarget | null;
  currentUsername: string;
  onClose: () => void;
};

export function QuickConnectDialog({ target, currentUsername, onClose }: QuickConnectDialogProps) {
  const createHost = useHostStore((state) => state.createHost);
  const loadHosts = useHostStore((state) => state.loadHosts);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberUsername, setRememberUsername] = useState(true);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!target) return;
    setUsername(target.username ?? currentUsername);
    setPassword("");
    setRememberUsername(true);
    setRememberPassword(false);
    setSubmitting(false);
    setError(undefined);
  }, [currentUsername, target]);

  useEffect(() => {
    if (!target || submitting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, submitting, target]);

  if (!target) return null;

  const submit = async () => {
    const normalizedUsername = username.trim();
    if (!normalizedUsername) {
      setError("请输入用户名");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      const existingHost = findMatchingQuickConnectHost((await listHosts()).hosts, target);
      let host: HostDto;
      if (existingHost) {
        host = rememberUsername || rememberPassword
          ? await updateHost(existingHost.id, {
              username: rememberUsername ? normalizedUsername : undefined,
              authType: rememberPassword ? "password" : undefined,
              password: rememberPassword ? { action: "replace", value: password } : undefined
            })
          : existingHost;
        if (rememberUsername || rememberPassword) await loadHosts();
      } else {
        host = await createHost({
          name: target.hostname,
          hostname: target.hostname,
          port: target.port,
          username: rememberUsername ? normalizedUsername : "",
          authType: "password",
          password: rememberPassword ? password : undefined
        });
      }
      const credentials: ConnectionCredentials = {
        username: normalizedUsername,
        rememberUsername: false,
        authType: "password",
        password,
        rememberAuth: false
      };
      onClose();
      await connectHost(host, credentials);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" role="presentation" onClick={() => { if (!submitting) onClose(); }}>
      <div
        className="dialog quick-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-connect-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <div className="dialog-kicker">Quick connect</div>
            <h3 id="quick-connect-title">连接到 {target.hostname}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭" disabled={submitting}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <div className="quick-connect-target">
            <span>SSH 地址</span>
            <strong>{target.hostname}:{target.port}</strong>
          </div>
          <label className="field">
            <span>用户名</span>
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="用户名"
            />
          </label>
          <label className="check-row quick-connect-remember">
            <input
              type="checkbox"
              checked={rememberUsername}
              onChange={(event) => setRememberUsername(event.target.checked)}
            />
            <span>记住账户</span>
          </label>
          <label className="field quick-connect-password">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
              placeholder="SSH 密码"
            />
          </label>
          <label className="check-row quick-connect-remember">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
            />
            <span>记住密码（保存到安全保险库）</span>
          </label>
          <p className="quick-connect-note">
            会话将自动保存为“{target.hostname}”；未勾选的凭据只用于本次连接。
          </p>
          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
        <div className="dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "正在连接..." : "连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
