import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export function SettingsPageShell({
  title,
  backLabel,
  onBack,
  testId,
  backTestId,
  children,
}: {
  title: string;
  backLabel: string;
  onBack(): void;
  testId: string;
  backTestId: string;
  children: ReactNode;
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
      className="frame-settings-page"
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(event) => {
        event.preventDefault();
        onBack();
      }}
    >
      <header>
        <button type="button" onClick={onBack} data-testid={backTestId}>
          <ArrowLeft size={18} aria-hidden />
          {backLabel}
        </button>
        <h1 id={titleId}>{title}</h1>
      </header>
      <div className="frame-settings-content">{children}</div>
    </dialog>
  );
}
