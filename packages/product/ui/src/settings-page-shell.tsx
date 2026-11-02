import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { PortalRootContext } from './components/portal-root';
import { useState } from 'react';

export function SettingsPageShell({
  title,
  backLabel,
  onBack,
  testId,
  backTestId,
  children,
  className,
  contentClassName,
  backDisabled = false,
}: {
  title: string;
  backLabel: string;
  onBack(): void;
  testId: string;
  backTestId: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  backDisabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [portalRoot, setPortalRoot] = useState<HTMLDialogElement | null>(null);
  const setDialogRef = useCallback((node: HTMLDialogElement | null) => {
    dialog.current = node;
    setPortalRoot(node);
  }, []);
  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={setDialogRef}
      className={['frame-settings-page', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!backDisabled) onBack();
      }}
    >
      <PortalRootContext.Provider value={portalRoot}>
        <header className="settings-shell-header">
          <button
            type="button"
            aria-label={backLabel}
            onClick={onBack}
            data-testid={backTestId}
            disabled={backDisabled}
          >
            <X size={18} aria-hidden />
          </button>
          <h1 id={titleId}>{title}</h1>
        </header>
        <div
          className={['frame-settings-content', contentClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </PortalRootContext.Provider>
    </dialog>
  );
}
