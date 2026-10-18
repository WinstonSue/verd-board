import { useEffect, useId, useRef } from 'react';

export function WorkspaceActionConfirmation({
  title,
  message,
  confirm,
  cancel,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  cancel: string;
  busy: boolean;
  error: string;
  onConfirm(): void;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="file-tree-prompt workspace-action-confirmation"
      data-testid="workspace-action-confirmation"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) onClose();
      }}
    >
      <h2 id={heading} className="file-tree-prompt__title">
        {title}
      </h2>
      <p>{message}</p>
      {error && <p role="alert">{error}</p>}
      <div className="file-tree-prompt__actions">
        <button type="button" disabled={busy} onClick={onClose}>
          {cancel}
        </button>
        <button
          type="button"
          disabled={busy}
          data-danger="true"
          onClick={onConfirm}
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
