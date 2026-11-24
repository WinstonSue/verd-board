import { useState } from 'react';
import { VmDialog, WorkspaceButton, WorkspaceInput } from '@sue/verd-board-ui';
import { splitIndependentFileName } from './independent-file-name';

export function IndependentFileRenameDialog({
  name,
  locale,
  onClose,
  onRename,
}: {
  name: string;
  locale: 'zh' | 'en';
  onClose(): void;
  onRename(stem: string): Promise<unknown>;
}) {
  const zh = locale === 'zh';
  const { stem, extension } = splitIndependentFileName(name);
  const [value, setValue] = useState(stem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <VmDialog
      title={zh ? '重命名文件' : 'Rename file'}
      closeLabel={zh ? '关闭' : 'Close'}
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !value.trim()) return;
          setBusy(true);
          setError('');
          void onRename(value.trim())
            .then(onClose, (cause) => setError(String(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          {zh ? '文件名' : 'File name'}
          <WorkspaceInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <span>{extension}</span>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="vm-dialog__footer">
          <WorkspaceButton disabled={busy} onClick={onClose}>
            {zh ? '取消' : 'Cancel'}
          </WorkspaceButton>
          <WorkspaceButton
            type="submit"
            intent="primary"
            disabled={busy || !value.trim()}
          >
            {zh ? '重命名' : 'Rename'}
          </WorkspaceButton>
        </div>
      </form>
    </VmDialog>
  );
}
