import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { IconButton } from './icon-button';
import { PortalRootContext } from './portal-root';
export function VmDialog({
  title,
  children,
  footer,
  onClose,
  closeLabel = 'Close',
  busy = false,
  className = '',
  ...props
}: Omit<ComponentProps<'dialog'>, 'title' | 'onClose'> & {
  title?: ReactNode;
  footer?: ReactNode;
  onClose(): void;
  closeLabel?: string;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef(
    typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [portalRoot, setPortalRoot] = useState<HTMLDialogElement | null>(null);
  const id = useId();
  const setDialogRef = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setPortalRoot(node);
  }, []);
  useEffect(() => {
    const opener = openerRef.current;
    const dialog = ref.current!;
    dialog.showModal();
    dialog
      .querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
      )
      ?.focus();
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      {...props}
      ref={setDialogRef}
      className={`vm-dialog ${className}`}
      aria-labelledby={title ? id : props['aria-labelledby']}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <PortalRootContext.Provider value={portalRoot}>
        {title && (
          <header className="vm-dialog__header">
            <h2 id={id} className="vm-dialog__title">
              {title}
            </h2>
            <IconButton
              icon={X}
              tooltip={false}
              aria-label={closeLabel}
              disabled={busy}
              onClick={onClose}
            />
          </header>
        )}
        <div className="vm-dialog__body">{children}</div>
        {footer && <footer className="vm-dialog__footer">{footer}</footer>}
      </PortalRootContext.Provider>
    </dialog>
  );
}
