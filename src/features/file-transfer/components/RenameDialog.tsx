import { useRef, useState } from "react";
import { useDialogFocus } from "../../../app/useDialogFocus";
import { normalizeAppError } from "../../../types/errors";
import type { RemoteFileEntry } from "../../../types/fileTransfer";

type RenameDialogProps = {
  entry: RemoteFileEntry;
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
};

export function RenameDialog({ entry, onRename, onClose }: RenameDialogProps) {
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(true, onClose, submitting);

  const submit = async () => {
    if (pending.current) return;
    if (!name.trim() || name === "." || name === ".." || /[/\\\0]/.test(name)) {
      setError("名称不能为空、. 或 ..，也不能包含 /、\\ 或空字符");
      return;
    }
    if (name === entry.name) { onClose(); return; }
    pending.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      await onRename(name);
      onClose();
    } catch (cause) {
      setError(normalizeAppError(cause).message);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-overlay" role="presentation" onClick={() => { if (!submitting) onClose(); }}>
      <form ref={dialogRef} className="dialog rename-dialog" role="dialog" aria-modal="true"
        aria-labelledby="rename-title" onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="dialog-header"><h3 id="rename-title">重命名{entry.entryType === "directory" ? "目录" : "文件"}</h3></div>
        <div className="dialog-body">
          <label className="field">
            <span>新名称</span>
            <input value={name} disabled={submitting} onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => { setName(event.target.value); setError(undefined); }}
              aria-invalid={!!error} aria-describedby={error ? "rename-error" : undefined} />
          </label>
          {error ? <div id="rename-error" className="dialog-error" role="alert">{error}</div> : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="ghost-button" disabled={submitting} onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={submitting || !name.trim()}>
            {submitting ? "重命名中..." : "重命名"}
          </button>
        </div>
      </form>
    </div>
  );
}
