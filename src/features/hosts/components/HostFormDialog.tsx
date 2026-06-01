import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createHost as createHostApi, updateHost as updateHostApi } from "../../../services/tauri/hostApi";
import { connectHost } from "../../terminal/actions";
import { useHostStore } from "../../../stores/hostStore";
import type {
  AuthType,
  CreateHostInput,
  HostDto,
  SecretUpdate,
  UpdateHostInput
} from "../../../types/host";

type HostFormDialogProps = {
  open: boolean;
  onClose: () => void;
  host?: HostDto | null;
};

type FormState = {
  name: string;
  hostname: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  connectTimeoutMs: string;
  keepaliveIntervalSecs: string;
  connectAfterCreate: boolean;
};

const initialFormState = (): FormState => ({
  name: "",
  hostname: "",
  port: "22",
  username: "",
  authType: "password",
  password: "",
  privateKeyPath: "",
  privateKeyPassphrase: "",
  connectTimeoutMs: "10000",
  keepaliveIntervalSecs: "30",
  connectAfterCreate: false
});

function hostToFormState(host: HostDto): FormState {
  return {
    name: host.name,
    hostname: host.hostname,
    port: String(host.port),
    username: host.username,
    authType: host.authType,
    password: "",
    privateKeyPath: host.privateKeyPath ?? "",
    privateKeyPassphrase: "",
    connectTimeoutMs: String(host.connectTimeoutMs),
    keepaliveIntervalSecs: String(host.keepaliveIntervalSecs),
    connectAfterCreate: false
  };
}

function buildCreateInput(form: FormState): CreateHostInput {
  const input: CreateHostInput = {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    authType: form.authType,
    connectTimeoutMs: Number(form.connectTimeoutMs),
    keepaliveIntervalSecs: Number(form.keepaliveIntervalSecs)
  };

  if (form.authType === "password") {
    input.password = form.password;
  } else {
    input.privateKeyPath = form.privateKeyPath.trim();
    if (form.privateKeyPassphrase.trim()) {
      input.privateKeyPassphrase = form.privateKeyPassphrase;
    }
  }

  return input;
}

function buildUpdateSecret(value: string): SecretUpdate {
  return value.trim() ? { action: "replace", value } : { action: "keep" };
}

function buildUpdateInput(form: FormState): UpdateHostInput {
  return {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    port: Number(form.port),
    username: form.username.trim(),
    authType: form.authType,
    password: form.authType === "password" ? buildUpdateSecret(form.password) : undefined,
    privateKeyPath: form.authType === "private_key" ? form.privateKeyPath.trim() : undefined,
    privateKeyPassphrase:
      form.authType === "private_key"
        ? buildUpdateSecret(form.privateKeyPassphrase)
        : undefined,
    connectTimeoutMs: Number(form.connectTimeoutMs),
    keepaliveIntervalSecs: Number(form.keepaliveIntervalSecs)
  };
}

function validateForm(form: FormState): string | undefined {
  if (!form.name.trim()) return "请输入主机名称";
  if (!form.hostname.trim()) return "请输入主机地址";
  if (!form.username.trim()) return "请输入用户名";

  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "端口必须在 1 到 65535 之间";

  const timeout = Number(form.connectTimeoutMs);
  if (!Number.isInteger(timeout) || timeout < 1000) return "连接超时至少为 1000 毫秒";

  const keepalive = Number(form.keepaliveIntervalSecs);
  if (!Number.isInteger(keepalive) || keepalive < 0) return "保活间隔不能小于 0";

  if (form.authType === "password" && !form.password) return "密码登录需要填写密码";
  if (form.authType === "private_key" && !form.privateKeyPath.trim()) return "私钥登录需要填写私钥路径";

  return undefined;
}

export function HostFormDialog({ open, onClose, host }: HostFormDialogProps) {
  const loadHosts = useHostStore((state) => state.loadHosts);
  const [form, setForm] = useState<FormState>(() => initialFormState());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (open) {
      setForm(host ? hostToFormState(host) : initialFormState());
      setError(undefined);
    }
  }, [host, open]);

  if (!open) return null;

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectPrivateKeyPath = async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "选择 SSH 私钥"
    });

    if (!selected || Array.isArray(selected)) return;
    updateField("privateKeyPath", selected);
  };

  const submit = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(undefined);

    try {
      const savedHost = host
        ? await updateHostApi(host.id, buildUpdateInput(form))
        : await createHostApi(buildCreateInput(form));
      await loadHosts();
      onClose();

      if (!host && form.connectAfterCreate) {
        await connectHost(savedHost);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="host-form-title" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <div className="dialog-kicker">Host</div>
            <h3 id="host-form-title">{host ? "编辑主机" : "新建主机"}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="dialog-body">
          <div className="form-grid">
            <label className="field">
              <span>主机名称</span>
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="例如：生产堡垒机" />
            </label>
            <label className="field">
              <span>主机地址</span>
              <input value={form.hostname} onChange={(event) => updateField("hostname", event.target.value)} placeholder="例如：10.0.0.12" />
            </label>
            <label className="field">
              <span>端口</span>
              <input value={form.port} onChange={(event) => updateField("port", event.target.value)} inputMode="numeric" />
            </label>
            <label className="field">
              <span>用户名</span>
              <input value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="例如：root" />
            </label>
            <label className="field">
              <span>认证方式</span>
              <select value={form.authType} onChange={(event) => updateField("authType", event.target.value as AuthType)}>
                <option value="password">密码</option>
                <option value="private_key">私钥</option>
              </select>
            </label>
            {form.authType === "password" ? (
              <label className="field field-wide">
                <span>密码</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => updateField("password", event.target.value)}
                  placeholder="请输入 SSH 密码"
                />
              </label>
            ) : (
              <>
                <label className="field field-wide">
                  <span>私钥路径</span>
                  <div className="input-with-action">
                    <input
                      value={form.privateKeyPath}
                      onChange={(event) => updateField("privateKeyPath", event.target.value)}
                      placeholder="/home/user/.ssh/id_rsa"
                    />
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void selectPrivateKeyPath()}
                    >
                      选择
                    </button>
                  </div>
                </label>
                <label className="field field-wide">
                  <span>私钥口令</span>
                  <input
                    type="password"
                    value={form.privateKeyPassphrase}
                    onChange={(event) => updateField("privateKeyPassphrase", event.target.value)}
                    placeholder="可选"
                  />
                </label>
              </>
            )}
            <label className="field">
              <span>连接超时(ms)</span>
              <input
                value={form.connectTimeoutMs}
                onChange={(event) => updateField("connectTimeoutMs", event.target.value)}
                inputMode="numeric"
              />
            </label>
            <label className="field">
              <span>保活间隔(s)</span>
              <input
                value={form.keepaliveIntervalSecs}
                onChange={(event) => updateField("keepaliveIntervalSecs", event.target.value)}
                inputMode="numeric"
              />
            </label>
          </div>

          {!host ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.connectAfterCreate}
                onChange={(event) => updateField("connectAfterCreate", event.target.checked)}
              />
              <span>创建后立即连接</span>
            </label>
          ) : null}

          {error ? <div className="dialog-error">{error}</div> : null}
        </div>

        <div className="dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={submit} disabled={submitting}>
            {submitting ? (host ? "保存中..." : "创建中...") : host ? "保存更改" : "创建主机"}
          </button>
        </div>
      </div>
    </div>
  );
}
