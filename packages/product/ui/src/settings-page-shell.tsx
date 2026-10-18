import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

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
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={['frame-settings-page', className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!backDisabled) onBack();
      }}
    >
      <header>
        <button
          type="button"
          onClick={onBack}
          data-testid={backTestId}
          disabled={backDisabled}
        >
          <ArrowLeft size={18} aria-hidden />
          {backLabel}
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
    </dialog>
  );
}
