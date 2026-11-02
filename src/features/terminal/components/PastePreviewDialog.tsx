import { useDialogFocus } from "../../../app/useDialogFocus";

export function PastePreviewDialog({ text, onConfirm, onClose }: {
  text: string; onConfirm: () => void; onClose: () => void;
}) {
  const ref = useDialogFocus(true, onClose);
  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      <div ref={ref} className="dialog paste-preview-dialog" role="dialog" aria-modal="true"
        aria-labelledby="paste-preview-title" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header"><h3 id="paste-preview-title">粘贴预览</h3></div>
        <div className="dialog-body">
          <p>{text.split(/\r\n|\r|\n/).length} 行 · {text.length} 个字符{/[\r\n]$/.test(text) ? " · 结尾包含换行" : ""}</p>
          <textarea aria-label="待粘贴内容" readOnly value={text} spellCheck={false} />
        </div>
        <div className="dialog-footer">
          <button type="button" className="ghost-button" onClick={onClose}>取消</button>
          <button type="button" className="primary-button" onClick={onConfirm}>确认粘贴</button>
        </div>
      </div>
    </div>
  );
}
