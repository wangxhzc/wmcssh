import { useEffect, useState } from "react";
import { useDialogFocus } from "../../../app/useDialogFocus";
import { open } from "@tauri-apps/plugin-dialog";
import type { AuthType, HostDto } from "../../../types/host";
import {
  CONNECTION_CREDENTIALS_EVENT,
  type ConnectionCredentials
} from "../connectionCredentials";

type Request = { host: HostDto; resolve: (value: ConnectionCredentials | null) => void; force?: boolean; message?: string };

export function ConnectionCredentialsDialog() {
  const [request, setRequest] = useState<Request>();
  const [stage, setStage] = useState<"username" | "auth">("username");
  const [username, setUsername] = useState("");
  const [rememberUsername, setRememberUsername] = useState(true);
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [rememberAuth, setRememberAuth] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useDialogFocus(!!request, () => { request?.resolve(null); setRequest(undefined); });

  useEffect(() => {
    const listener = (event: Event) => {
      const next = (event as CustomEvent<Request>).detail;
      setRequest(next);
      setStage(next.force || !next.host.username.trim() ? "username" : "auth");
      setUsername(next.host.username);
      setAuthType(next.host.authType);
      setPassword("");
      setPrivateKeyPath(next.host.privateKeyPath ?? "");
      setPrivateKeyPassphrase("");
      setRememberUsername(true);
      setRememberAuth(false);
      setError(undefined);
    };
    window.addEventListener(CONNECTION_CREDENTIALS_EVENT, listener);
    return () => window.removeEventListener(CONNECTION_CREDENTIALS_EVENT, listener);
  }, []);

  if (!request) return null;
  const needsAuth = request.force || (request.host.authType === "password" ? !request.host.hasPassword : !request.host.privateKeyPath);
  const close = (result: ConnectionCredentials | null) => {
    request.resolve(result);
    setRequest(undefined);
  };
  const finish = () => close({ username, rememberUsername, authType, password: authType === "password" ? password || undefined : undefined, privateKeyPath: authType === "private_key" ? privateKeyPath : undefined, privateKeyPassphrase: authType === "private_key" ? privateKeyPassphrase || undefined : undefined, rememberAuth });
  const next = () => {
    if (!username.trim()) return setError("请输入用户名");
    setError(undefined);
    if (needsAuth) setStage("auth"); else finish();
  };
  const submitAuth = () => {
    if (authType === "password" && !password) return setError("请输入密码");
    if (authType === "private_key" && !privateKeyPath.trim()) return setError("请选择私钥");
    finish();
  };

  return <div className="dialog-overlay" role="presentation">
    <div ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="credentials-title">
      <div className="dialog-header"><div><div className="dialog-kicker">身份认证</div><h3 id="credentials-title">{stage === "username" ? "输入用户名" : "选择认证方式"}</h3><p>{request.host.name} · {request.host.hostname}:{request.host.port}</p></div></div>
      <div className="dialog-body">
        {request.message ? <div className="dialog-error">{request.message}</div> : null}
        {stage === "username" ? <>
          <label className="field"><span>用户名</span><input value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") next(); }} /></label>
          <label className="check-row"><input type="checkbox" checked={rememberUsername} onChange={(e) => setRememberUsername(e.target.checked)} /><span>记住用户名</span></label>
        </> : <>
          <label className="field"><span>认证方式</span><select value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)}><option value="password">密码</option><option value="private_key">私钥</option></select></label>
          {authType === "password" ? <label className="field"><span>密码</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitAuth(); }} /></label> : <>
            <label className="field field-wide"><span>私钥路径</span><div className="input-with-action"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} /><button className="ghost-button" type="button" onClick={async () => { const path = await open({ multiple: false, directory: false, title: "选择 SSH 私钥" }); if (path && !Array.isArray(path)) setPrivateKeyPath(path); }}>选择</button></div></label>
            <label className="field"><span>私钥口令（可选）</span><input type="password" value={privateKeyPassphrase} onChange={(e) => setPrivateKeyPassphrase(e.target.value)} /></label>
          </>}
          <label className="check-row"><input type="checkbox" checked={rememberAuth} onChange={(e) => setRememberAuth(e.target.checked)} /><span>{authType === "password" ? "记住密码（加密保存到凭据库）" : "记住私钥路径和口令（口令加密保存）"}</span></label>
        </>}
        {error ? <div className="dialog-error">{error}</div> : null}
      </div>
      <div className="dialog-footer"><button className="ghost-button" type="button" onClick={() => close(null)}>取消</button><button className="primary-button" type="button" onClick={stage === "username" ? next : submitAuth}>{stage === "username" && needsAuth ? "下一步" : "连接"}</button></div>
    </div>
  </div>;
}
