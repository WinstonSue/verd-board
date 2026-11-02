import { VmDialog } from './components/vm-dialog';
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
  return (
    <VmDialog
      className="workspace-action-confirmation"
      data-testid="workspace-action-confirmation"
      title={title}
      closeLabel={cancel === '取消' ? '关闭' : 'Close'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button
            className="vm-btn vm-btn--secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {cancel}
          </button>
          <button
            className="vm-btn vm-btn--danger"
            type="button"
            disabled={busy}
            data-danger="true"
            onClick={onConfirm}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p>{message}</p>
      {error && <p role="alert">{error}</p>}
    </VmDialog>
  );
}
