import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAppInfo, type AppInfoDto } from "../../../services/tauri/settingsApi";
import { deleteTrustedHostKey, listTrustedHostKeys } from "../../../services/tauri/sshApi";
import { useSettingsStore } from "../../../stores/settingsStore";
import { defaultTerminalSettings, type TerminalSettingsDto } from "../../../types/settings";
import type { TrustedHostKey } from "../../../types/ssh";
import { TransferQueue } from "../../file-transfer/components/TransferQueue";
import { normalizeTerminalSettings, terminalSettingsChanged } from "../terminalSettingsDraft";

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

type SettingsSection = "general" | "terminal" | "security" | "transfers";

const sections: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: "general", label: "常规", description: "应用信息与外观" },
  { id: "terminal", label: "终端", description: "字体与显示行为" },
  { id: "security", label: "安全", description: "已信任的主机密钥" },
  { id: "transfers", label: "传输", description: "后台任务与进度" }
];

function errorMessage(cause: unknown) {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String(cause.message);
  }
  return String(cause);
}

function numberValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const [draft, setDraft] = useState<TerminalSettingsDto>(defaultTerminalSettings);
  const [appInfo, setAppInfo] = useState<AppInfoDto>();
  const [appInfoError, setAppInfoError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [trustedKeys, setTrustedKeys] = useState<TrustedHostKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keysError, setKeysError] = useState<string>();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const terminalSettings = useSettingsStore((state) => state.terminalSettings);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const settingsLoading = useSettingsStore((state) => state.loading);
  const loadTerminalSettings = useSettingsStore((state) => state.loadTerminalSettings);
  const updateTerminalSettings = useSettingsStore((state) => state.updateTerminalSettings);
  const dirty = useMemo(
    () => terminalSettingsChanged(draft, terminalSettings),
    [draft, terminalSettings]
  );

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    setKeysError(undefined);
    try {
      setTrustedKeys(await listTrustedHostKeys());
      setKeysLoaded(true);
    } catch (cause) {
      setKeysError(errorMessage(cause));
    } finally {
      setKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    setActiveSection("general");
    setDraft(terminalSettings);
    setSaveError(undefined);
    setSaved(false);
    setConfirmDeleteId(undefined);
    setTrustedKeys([]);
    setKeysLoaded(false);
    setKeysError(undefined);

    if (!settingsLoaded) {
      void loadTerminalSettings().catch((cause) => setSaveError(errorMessage(cause)));
    }

    void getAppInfo()
      .then((info) => {
        setAppInfo(info);
        setAppInfoError(undefined);
      })
      .catch((cause) => setAppInfoError(errorMessage(cause)));

    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open && activeSection === "security" && !keysLoaded && !keysLoading) {
      void loadKeys();
    }
  }, [activeSection, keysLoaded, keysLoading, loadKeys, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmDeleteId) {
          setConfirmDeleteId(undefined);
        } else {
          onClose();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeleteId, onClose, open]);

  useEffect(() => {
    if (open && settingsLoaded && !dirty) setDraft(terminalSettings);
  }, [dirty, open, settingsLoaded, terminalSettings]);

  if (!open) return null;

  const applyTerminalSettings = async () => {
    setSaveError(undefined);
    setSaved(false);
    try {
      const updated = await updateTerminalSettings(normalizeTerminalSettings(draft));
      setDraft(updated);
      setSaved(true);
    } catch (cause) {
      setSaveError(errorMessage(cause));
    }
  };

  const removeTrustedKey = async (id: string) => {
    setDeletingId(id);
    setKeysError(undefined);
    try {
      const result = await deleteTrustedHostKey({ id });
      if (!result.deleted) throw new Error("该主机密钥已不存在，请刷新列表");
      setTrustedKeys((keys) => keys.filter((key) => key.id !== id));
      setConfirmDeleteId(undefined);
    } catch (cause) {
      setKeysError(errorMessage(cause));
    } finally {
      setDeletingId(undefined);
    }
  };

  return (
    <div className="settings-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <span className="dialog-kicker">WMcSSH</span>
            <h2 id="settings-title">设置</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-close-button"
            onClick={onClose}
            title="关闭设置（Esc）"
            aria-label="关闭设置"
          >
            ×
          </button>
        </header>

        <div className="settings-layout">
          <nav className="settings-navigation" aria-label="设置分类">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "active" : undefined}
                onClick={() => {
                  setActiveSection(section.id);
                  setSaveError(undefined);
                  setSaved(false);
                }}
                aria-current={activeSection === section.id ? "page" : undefined}
              >
                <strong>{section.label}</strong>
                <span>{section.description}</span>
              </button>
            ))}
          </nav>

          <main className="settings-content">
            {activeSection === "general" ? (
              <GeneralSettings appInfo={appInfo} error={appInfoError} />
            ) : null}
            {activeSection === "terminal" ? (
              <TerminalSettings
                draft={draft}
                disabled={settingsLoading}
                onChange={(patch) => {
                  setDraft((current) => ({ ...current, ...patch }));
                  setSaveError(undefined);
                  setSaved(false);
                }}
              />
            ) : null}
            {activeSection === "security" ? (
              <SecuritySettings
                keys={trustedKeys}
                loading={keysLoading}
                loaded={keysLoaded}
                error={keysError}
                confirmDeleteId={confirmDeleteId}
                deletingId={deletingId}
                onRefresh={() => void loadKeys()}
                onRequestDelete={setConfirmDeleteId}
                onCancelDelete={() => setConfirmDeleteId(undefined)}
                onDelete={(id) => void removeTrustedKey(id)}
              />
            ) : null}
            {activeSection === "transfers" ? <TransferSettings /> : null}
          </main>
        </div>

        <footer className="settings-footer">
          <div className="settings-feedback" role="status">
            {saveError ? <span className="settings-error">{saveError}</span> : null}
            {!saveError && saved ? <span className="settings-success">设置已应用</span> : null}
            {!saveError && !saved && activeSection === "terminal" && dirty ? "有未应用的更改" : null}
          </div>
          <div className="settings-footer-actions">
            {activeSection === "terminal" ? (
              <button
                type="button"
                className="ghost-button"
                disabled={settingsLoading}
                title="载入内置默认值，点击应用后保存"
                onClick={() => {
                  setDraft({ ...defaultTerminalSettings });
                  setSaved(false);
                }}
              >
                载入默认值
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={onClose}>
              {activeSection === "terminal" ? "取消" : "关闭"}
            </button>
            {activeSection === "terminal" ? (
              <button
                type="button"
                className="primary-button"
                disabled={!dirty || settingsLoading}
                onClick={() => void applyTerminalSettings()}
              >
                {settingsLoading ? "应用中..." : "应用"}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

function SettingsSectionHeader({ title, description, action }: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-section-header">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function GeneralSettings({ appInfo, error }: { appInfo?: AppInfoDto; error?: string }) {
  return (
    <div className="settings-section">
      <SettingsSectionHeader
        title="常规"
        description="查看应用版本与当前运行环境。"
      />
      {error ? <div className="settings-inline-error">无法读取应用信息：{error}</div> : null}
      <div className="settings-summary-grid">
        <article className="settings-summary-card">
          <span>应用版本</span>
          <strong>{appInfo ? `v${appInfo.appVersion}` : "读取中..."}</strong>
          <small>内部契约版本 {appInfo?.contractVersion ?? "—"}</small>
        </article>
        <article className="settings-summary-card">
          <span>当前用户</span>
          <strong>{appInfo?.currentUsername || "—"}</strong>
          <small>用于快速连接的默认用户名</small>
        </article>
      </div>
      <article className="settings-info-card">
        <div>
          <strong>应用外观</strong>
          <span>当前版本使用统一深色主题，以保证终端与桌面窗口的一致性。</span>
        </div>
        <span className="settings-state-pill">深色</span>
      </article>
      <article className="settings-info-card">
        <div>
          <strong>设置保存</strong>
          <span>终端设置保存在本机应用数据库中，不会同步到远程服务。</span>
        </div>
        <span className="settings-state-pill">仅本机</span>
      </article>
    </div>
  );
}

function TerminalSettings({ draft, disabled, onChange }: {
  draft: TerminalSettingsDto;
  disabled: boolean;
  onChange: (patch: Partial<TerminalSettingsDto>) => void;
}) {
  return (
    <div className="settings-section">
      <SettingsSectionHeader
        title="终端"
        description="调整后应用到当前与之后打开的终端。"
      />
      <div className="settings-form-grid">
        <label className="settings-field settings-field-wide">
          <span>字体族</span>
          <input
            value={draft.fontFamily}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onChange({ fontFamily: event.target.value })}
          />
          <small>可填写 CSS 字体回退列表；留空时后端会恢复内置字体。</small>
        </label>
        <label className="settings-field">
          <span>字号</span>
          <div className="settings-number-input">
            <input
              type="number"
              min="8"
              max="48"
              step="1"
              value={draft.fontSize}
              disabled={disabled}
              onChange={(event) => onChange({ fontSize: numberValue(event.target.value, 14) })}
            />
            <em>px</em>
          </div>
        </label>
        <label className="settings-field">
          <span>行高</span>
          <input
            type="number"
            min="1"
            max="2"
            step="0.05"
            value={draft.lineHeight}
            disabled={disabled}
            onChange={(event) => onChange({ lineHeight: numberValue(event.target.value, 1.2) })}
          />
        </label>
        <label className="settings-field">
          <span>常规字重</span>
          <input
            type="number"
            min="100"
            max="900"
            step="100"
            value={draft.fontWeight}
            disabled={disabled}
            onChange={(event) => onChange({ fontWeight: numberValue(event.target.value, 400) })}
          />
        </label>
        <label className="settings-field">
          <span>粗体字重</span>
          <input
            type="number"
            min="100"
            max="900"
            step="100"
            value={draft.fontWeightBold}
            disabled={disabled}
            onChange={(event) => onChange({ fontWeightBold: numberValue(event.target.value, 700) })}
          />
        </label>
        <label className="settings-field">
          <span>字间距</span>
          <div className="settings-number-input">
            <input
              type="number"
              min="-1"
              max="1"
              step="0.1"
              value={draft.letterSpacing}
              disabled={disabled}
              onChange={(event) => onChange({ letterSpacing: numberValue(event.target.value, 0) })}
            />
            <em>px</em>
          </div>
        </label>
        <label className="settings-field">
          <span>回滚行数</span>
          <input
            type="number"
            min="100"
            max="1000000"
            step="100"
            value={draft.scrollback}
            disabled={disabled}
            onChange={(event) => onChange({ scrollback: numberValue(event.target.value, 10000) })}
          />
        </label>
      </div>
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={draft.cursorBlink}
          disabled={disabled}
          onChange={(event) => onChange({ cursorBlink: event.target.checked })}
        />
        <span>
          <strong>光标闪烁</strong>
          <small>在当前终端与新终端中显示闪烁光标。</small>
        </span>
      </label>
    </div>
  );
}

type SecuritySettingsProps = {
  keys: TrustedHostKey[];
  loading: boolean;
  loaded: boolean;
  error?: string;
  confirmDeleteId?: string;
  deletingId?: string;
  onRefresh: () => void;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onDelete: (id: string) => void;
};

function SecuritySettings({
  keys,
  loading,
  loaded,
  error,
  confirmDeleteId,
  deletingId,
  onRefresh,
  onRequestDelete,
  onCancelDelete,
  onDelete
}: SecuritySettingsProps) {
  return (
    <div className="settings-section">
      <SettingsSectionHeader
        title="已信任的主机密钥"
        description="连接前会用这些记录验证远程服务器身份。删除后，下次连接需要重新确认。"
        action={(
          <button type="button" className="ghost-button" disabled={loading} onClick={onRefresh}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        )}
      />
      {error ? <div className="settings-inline-error">{error}</div> : null}
      {!loaded && loading ? <div className="settings-empty">正在读取已信任的主机密钥...</div> : null}
      {loaded && !loading && keys.length === 0 ? (
        <div className="settings-empty">
          <strong>暂无已信任的主机密钥</strong>
          <span>首次连接服务器并确认指纹后，记录会显示在这里。</span>
        </div>
      ) : null}
      <div className="trusted-key-list">
        {keys.map((key) => {
          const deleting = deletingId === key.id;
          const confirming = confirmDeleteId === key.id;
          const hostLabel = key.hostname
            ? `${key.hostname}${key.port && key.port !== 22 ? `:${key.port}` : ""}`
            : key.hostPatterns;
          return (
            <article key={key.id} className="trusted-key-card">
              <div className="trusted-key-heading">
                <div>
                  <strong>{hostLabel}</strong>
                  <span>{key.keyType}{key.hashed ? " · 已哈希主机名" : ""}</span>
                </div>
                {!confirming ? (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={Boolean(deletingId)}
                    onClick={() => onRequestDelete(key.id)}
                  >
                    删除
                  </button>
                ) : null}
              </div>
              <code>{key.fingerprint}</code>
              {key.marker ? <small>OpenSSH 标记：{key.marker}</small> : null}
              {confirming ? (
                <div className="trusted-key-confirm" role="alert">
                  <span>删除后，下次连接此服务器需要重新核对指纹。</span>
                  <div>
                    <button type="button" className="ghost-button" disabled={deleting} onClick={onCancelDelete}>
                      取消
                    </button>
                    <button type="button" className="danger-button" disabled={deleting} onClick={() => onDelete(key.id)}>
                      {deleting ? "删除中..." : "确认删除"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TransferSettings() {
  return (
    <div className="settings-section">
      <SettingsSectionHeader
        title="后台传输"
        description="查看当前进程中的上传与下载任务。队列按文件传输会话串行执行，关闭标签后仍会继续。"
      />
      <TransferQueue />
    </div>
  );
}
