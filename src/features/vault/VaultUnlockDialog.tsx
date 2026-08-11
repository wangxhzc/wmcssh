import { useEffect, useState } from "react";
import { getVaultStatus, initializeVault, unlockVault } from "../../services/tauri/vaultApi";

type Props = { onUnlocked: () => void };

export function VaultUnlockDialog({ onUnlocked }: Props) {
  const [initialized, setInitialized] = useState<boolean>();
  const [legacyCredentialsDetected, setLegacyCredentialsDetected] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void getVaultStatus().then((status) => {
      setInitialized(status.initialized);
      setLegacyCredentialsDetected(status.legacyCredentialsDetected);
      if (status.unlocked) onUnlocked();
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [onUnlocked]);

  const submit = async () => {
    if (!password) return setError("请输入主密码");
    if (!initialized && password !== confirmation) return setError("两次输入的主密码不一致");
    setBusy(true); setError(undefined);
    try {
      if (initialized) await unlockVault(password); else await initializeVault(password);
      setPassword(""); setConfirmation(""); onUnlocked();
    } catch (err) {
      const value = err as { message?: string };
      setError(value.message ?? String(err));
    } finally { setBusy(false); }
  };

  return <div className="dialog-overlay vault-overlay" role="presentation">
    <div className="dialog vault-dialog" role="dialog" aria-modal="true" aria-labelledby="vault-title">
      <div className="dialog-header"><div><div className="dialog-kicker">Credential Vault</div><h3 id="vault-title">{initialized === false ? "初始化主密码" : "解锁凭据库"}</h3></div></div>
      <div className="dialog-body">
        <p className="vault-description">{initialized === false ? legacyCredentialsDetected ? "检测到旧版凭据。请设置新的主密码，旧凭据将使用该密码加密迁移；迁移成功后会删除旧明文文件。" : "主密码不会保存到磁盘。忘记主密码后，已保存的 SSH 凭据将无法恢复。" : "输入主密码以解密已保存的 SSH 密码和私钥口令。"}</p>
        <label className="field"><span>主密码</span><input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && initialized !== false) void submit(); }} /></label>
        {initialized === false ? <label className="field"><span>确认主密码</span><input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} /></label> : null}
        {error ? <div className="dialog-error">{error}</div> : null}
      </div>
      <div className="dialog-footer"><span /> <button className="primary-button" type="button" disabled={busy || initialized === undefined} onClick={() => void submit()}>{busy ? "处理中..." : initialized === false ? legacyCredentialsDetected ? "初始化并迁移" : "初始化并进入" : "解锁"}</button></div>
    </div>
  </div>;
}
