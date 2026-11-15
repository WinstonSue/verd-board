import { VmDialog } from '../shared/components/vm-dialog';
import { WorkspaceAlert, WorkspaceButton } from '../shared/workspace-design';
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
          <WorkspaceButton type="button" disabled={busy} onClick={onClose}>
            {cancel}
          </WorkspaceButton>
          <WorkspaceButton
            danger
            busy={busy}
            type="button"
            disabled={busy}
            data-danger="true"
            onClick={onConfirm}
          >
            {confirm}
          </WorkspaceButton>
        </>
      }
    >
      <p>{message}</p>
      {error && <WorkspaceAlert type="error" title={error} />}
    </VmDialog>
  );
}
