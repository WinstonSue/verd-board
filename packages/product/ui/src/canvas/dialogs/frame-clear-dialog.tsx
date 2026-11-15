import { useEffect, useRef } from 'react';

export function FrameClearDialog({
  domain,
  language,
  onClose,
  onClear,
}: {
  domain: boolean;
  language: string;
  onClose(): void;
  onClear(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="frame-clear-confirm"
      aria-label="Clear frame"
      onCancel={onClose}
    >
      <p>
        {language === 'zh'
          ? '清空当前容器的内容？此操作可以撤销。'
          : 'Clear the current frame? You can undo this operation.'}
      </p>
      {domain && (
        <p>
          {language === 'zh'
            ? '保留必需的中心主题、开始事件或最后一层。'
            : 'Required topics, start events or the last layer will be retained.'}
        </p>
      )}
      <button onClick={onClose}>{language === 'zh' ? '取消' : 'Cancel'}</button>
      <button aria-label="Confirm clear frame" onClick={onClear}>
        {language === 'zh' ? '确认清空' : 'Clear frame'}
      </button>
    </dialog>
  );
}
