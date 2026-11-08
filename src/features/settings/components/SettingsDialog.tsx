import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAppInfo, type AppInfoDto } from "../../../services/tauri/settingsApi";
import { deleteTrustedHostKey, listTrustedHostKeys } from "../../../services/tauri/sshApi";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useTerminalStore } from "../../../stores/terminalStore";
import { defaultTerminalSettings, type TerminalSettingsDto } from "../../../types/settings";
import type { TrustedHostKey } from "../../../types/ssh";
import { normalizeTerminalSettings, terminalSettingsChanged } from "../terminalSettingsDraft";
import { useDialogFocus } from "../../../app/useDialogFocus";

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

type SettingsSection = "terminal" | "security" | "about";

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "terminal", label: "终端" },
  { id: "security", label: "主机密钥" },
  { id: "about", label: "关于" }
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
  const [activeSection, setActiveSection] = useState<SettingsSection>("terminal");
  const [draft, setDraft] = useState<TerminalSettingsDto>(defaultTerminalSettings);
  const [draftReady, setDraftReady] = useState(false);
  const [loadError, setLoadError] = useState<string>();
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
  const [closePrompt, setClosePrompt] = useState(false);
  const [saving, setSaving] = useState(false);
  const terminalSettings = useSettingsStore((state) => state.terminalSettings);
  const highlightUnavailable = useTerminalStore((state) =>
    state.tabs.some((tab) => tab.kind === "terminal" && tab.renderer === "dom") &&
    !state.tabs.some((tab) => tab.kind === "terminal" && tab.renderer === "webgl"));
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const settingsLoading = useSettingsStore((state) => state.loading);
  const loadTerminalSettings = useSettingsStore((state) => state.loadTerminalSettings);
  const updateTerminalSettings = useSettingsStore((state) => state.updateTerminalSettings);
  const dirty = useMemo(
    () => draftReady && terminalSettingsChanged(draft, terminalSettings),
    [draft, draftReady, terminalSettings]
  );
  const requestClose = () => {
    if (saving) return;
    if (dirty) setClosePrompt(true); else onClose();
  };
  const dialogRef = useDialogFocus<HTMLElement>(open, () => {
    if (confirmDeleteId) setConfirmDeleteId(undefined); else requestClose();
  }, saving);
  const confirmRef = useDialogFocus(open && closePrompt, () => setClosePrompt(false), saving);

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
    setClosePrompt(false);
    setDraft(terminalSettings);
    setDraftReady(settingsLoaded);
    setLoadError(undefined);
    setSaveError(undefined);
    setSaved(false);
    setConfirmDeleteId(undefined);
    setTrustedKeys([]);
    setKeysLoaded(false);
    setKeysError(undefined);

    if (!settingsLoaded) {
      void loadTerminalSettings().catch((cause) => setLoadError(errorMessage(cause)));
    }
  }, [open]);

  useEffect(() => {
    if (!open || activeSection !== "about") return;
    let cancelled = false;
    setAppInfoError(undefined);
    void getAppInfo()
      .then((info) => {
        if (cancelled) return;
        setAppInfo(info);
        setAppInfoError(undefined);
      })
      .catch((cause) => { if (!cancelled) setAppInfoError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [open, activeSection]);

  useEffect(() => {
    if (open && activeSection === "security" && !keysLoaded && !keysLoading && !keysError) {
      void loadKeys();
    }
  }, [activeSection, keysError, keysLoaded, keysLoading, loadKeys, open]);

  useEffect(() => {
    if (open && settingsLoaded && !draftReady) {
      setDraft(terminalSettings);
      setDraftReady(true);
      setLoadError(undefined);
    }
  }, [draftReady, open, settingsLoaded, terminalSettings]);

  if (!open) return null;

  const applyTerminalSettings = async () => {
    if (saving || settingsLoading || !draftReady) return false;
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    try {
      const updated = await updateTerminalSettings(normalizeTerminalSettings(draft));
      setDraft(updated);
      setSaved(true);
      return true;
    } catch (cause) {
      setSaveError(errorMessage(cause));
      return false;
    } finally {
      setSaving(false);
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
            <h2 id="settings-title">设置</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-close-button"
            onClick={requestClose}
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
                  setConfirmDeleteId(undefined);
                }}
                aria-current={activeSection === section.id ? "page" : undefined}
              >
                <strong>{section.label}</strong>
              </button>
            ))}
          </nav>

          <main className="settings-content">
            {activeSection === "about" ? (
              <AboutSettings appInfo={appInfo} error={appInfoError} />
            ) : null}
            {activeSection === "terminal" ? (
              <div className="settings-terminal-content">
                {loadError ? <div className="settings-inline-error" role="alert">
                  <span>{loadError}</span>
                  <button type="button" className="ghost-button" disabled={settingsLoading} onClick={() => {
                    setLoadError(undefined);
                    void loadTerminalSettings().catch((cause) => setLoadError(errorMessage(cause)));
                  }}>重试</button>
                </div> : null}
                <TerminalSettings
                  draft={draft}
                  highlightUnavailable={highlightUnavailable}
                  disabled={settingsLoading || saving || !draftReady}
                  onChange={(patch) => {
                    setDraft((current) => ({ ...current, ...patch }));
                    setSaveError(undefined);
                    setSaved(false);
                  }}
                />
              </div>
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
          </main>
        </div>

        <footer className="settings-footer">
          <div className="settings-feedback" role="status">
            {saveError ? <span className="settings-error">{saveError}</span> : null}
            {!saveError && saved ? <span className="settings-success">已保存</span> : null}
            {!saveError && !saved && dirty ? "有未保存的更改" : null}
            {!saveError && !draftReady && settingsLoading ? "正在读取设置..." : null}
          </div>
          <div className="settings-footer-actions">
            {activeSection === "terminal" ? (
              <button
                type="button"
                className="ghost-button"
                disabled={settingsLoading || saving || !draftReady}
                title="恢复终端默认值，保存后生效"
                onClick={() => {
                  setDraft({ ...defaultTerminalSettings });
                  setSaveError(undefined);
                  setSaved(false);
                }}
              >
                恢复默认
              </button>
            ) : null}
            <button type="button" className="ghost-button" onClick={requestClose} disabled={saving}>
              关闭
            </button>
            {activeSection === "terminal" || dirty ? (
              <button
                type="button"
                className="primary-button"
                disabled={!dirty || settingsLoading || saving || !draftReady}
                onClick={() => void applyTerminalSettings()}
              >
                {saving ? "保存中..." : "保存并应用"}
              </button>
            ) : null}
          </div>
        </footer>
      </section>
      {closePrompt ? <div className="dialog-overlay settings-confirm-overlay">
        <div ref={confirmRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
          <div className="dialog-body"><h3 id="unsaved-title">保存设置更改？</h3><p>更改尚未保存。</p>
            {saveError ? <p role="alert" className="dialog-error">{saveError}</p> : null}
          </div>
          <div className="dialog-footer">
            <button className="ghost-button" disabled={saving} onClick={() => setClosePrompt(false)}>继续编辑</button>
            <button className="ghost-button" disabled={saving} onClick={() => { setClosePrompt(false); onClose(); }}>放弃更改</button>
            <button className="primary-button" disabled={saving || settingsLoading} onClick={async () => { if (await applyTerminalSettings()) { setClosePrompt(false); onClose(); } }}>{saving ? "保存中..." : "保存并关闭"}</button>
          </div>
        </div>
      </div> : null}
    </div>
  );
}
function SettingsSectionHeader({ title, description, action }: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="settings-section-header">
      <div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function AboutSettings({ appInfo, error }: { appInfo?: AppInfoDto; error?: string }) {
  return (
    <div className="settings-section">
      <SettingsSectionHeader title="关于" />
      {error ? <div className="settings-inline-error">无法读取应用信息：{error}</div> : null}
      <div className="settings-about-brand">wmcssh</div>
      <dl className="settings-about-details">
        <dt>版本</dt><dd>{appInfo ? `v${appInfo.appVersion}` : error ? "无法读取" : "读取中..."}</dd>
      </dl>
    </div>
  );
}

function TerminalSettings({ draft, disabled, highlightUnavailable, onChange }: {
  draft: TerminalSettingsDto;
  disabled: boolean;
  highlightUnavailable: boolean;
  onChange: (patch: Partial<TerminalSettingsDto>) => void;
}) {
  return (
    <div className="settings-section">
      <SettingsSectionHeader title="终端" />
      <fieldset className="settings-group" disabled={disabled}>
        <legend>显示</legend>
        <div className="settings-form-grid">
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
              <em aria-hidden="true">px</em>
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
        </div>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.cursorBlink}
            disabled={disabled}
            onChange={(event) => onChange({ cursorBlink: event.target.checked })}
          />
          <span><strong>光标闪烁</strong></span>
        </label>
      </fieldset>
      <fieldset className="settings-group" disabled={disabled}>
        <legend>输出与历史</legend>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.outputHighlight && !highlightUnavailable}
            disabled={disabled || highlightUnavailable}
            onChange={(event) => onChange({ outputHighlight: event.target.checked })}
          />
          <span title={highlightUnavailable ? "当前图形环境不支持输出高亮" : undefined}><strong>输出高亮{highlightUnavailable ? "（当前不可用）" : ""}</strong></span>
        </label>
        <label className="settings-field settings-history-field">
          <span>回滚行数</span>
          <input type="number" min="100" max="1000000" step="100" value={draft.scrollback}
            onChange={(event) => onChange({ scrollback: numberValue(event.target.value, 10000) })} />
        </label>
      </fieldset>
      <details className="settings-advanced">
        <summary tabIndex={0}>高级字体设置</summary>
        <fieldset className="settings-group" disabled={disabled} aria-label="高级字体设置">
          <div className="settings-form-grid">
            <label className="settings-field settings-field-wide">
              <span>字体与回退列表</span>
              <input value={draft.fontFamily} spellCheck={false}
                onChange={(event) => onChange({ fontFamily: event.target.value })} />
            </label>
            <label className="settings-field">
              <span>常规字重</span>
              <select value={draft.fontWeight} onChange={(event) => onChange({ fontWeight: Number(event.target.value) })}>
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span>粗体字重</span>
              <select value={draft.fontWeightBold} onChange={(event) => onChange({ fontWeightBold: Number(event.target.value) })}>
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </select>
            </label>
            <label className="settings-field">
              <span>字间距</span>
              <div className="settings-number-input">
                <input type="number" min="-1" max="1" step="0.1" value={draft.letterSpacing}
                  onChange={(event) => onChange({ letterSpacing: numberValue(event.target.value, 0) })} />
                <em aria-hidden="true">px</em>
              </div>
            </label>
          </div>
        </fieldset>
      </details>
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
          <button type="button" className="ghost-button" disabled={loading} aria-busy={loading} onClick={onRefresh}>
            刷新
          </button>
        )}
      />
      {error ? <div className="settings-inline-error">{error}</div> : null}
      {!loaded && loading ? <div className="settings-empty">正在读取已信任的主机密钥...</div> : null}
      {loaded && keys.length === 0 ? (
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
