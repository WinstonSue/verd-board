import {
  WorkspaceAlert,
  WorkspaceInput,
  WorkspaceNumberInput,
  WorkspaceTextArea,
} from './workspace-design';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import type { CommitResult } from '@sue/schema-settings-react';
const DraftContext = createContext<Map<string, () => Promise<boolean>> | null>(
  null,
);
export function SettingsDraftProvider({
  drafts,
  children,
}: {
  drafts: Map<string, () => Promise<boolean>>;
  children: ReactNode;
}) {
  return (
    <DraftContext.Provider value={drafts}>{children}</DraftContext.Provider>
  );
}
export function SettingsDraftInput({
  value,
  onSave,
  label,
  testId,
  multiline = false,
  numeric = false,
  disabled = false,
}: {
  value: string | number;
  onSave(value: string): CommitResult | Promise<CommitResult>;
  label: string;
  testId: string;
  multiline?: boolean;
  numeric?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const composing = useRef(false);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const registry = useContext(DraftContext);
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };
  const pending = useRef<Promise<boolean> | null>(null);
  const retryNeeded = useRef(false);
  const priorValue = useRef(String(value));
  const submitted = useRef<string | undefined>(undefined);
  const accepted = useRef<string | undefined>(undefined);
  useEffect(() => {
    setDraft((current) =>
      current === priorValue.current || current === submitted.current
        ? String(value)
        : current,
    );
    priorValue.current = String(value);
    accepted.current = undefined;
  }, [value]);
  const save = (): Promise<boolean> => {
    if (disabled) return Promise.resolve(true);
    if (pending.current)
      return pending.current.then((ok) => (ok ? saveRef.current() : false));
    const current = latest.current;
    if (composing.current) return Promise.resolve(false);
    if (
      (current.draft === String(current.value) ||
        current.draft === accepted.current) &&
      !retryNeeded.current
    )
      return Promise.resolve(true);
    const task = Promise.resolve().then(async () => {
      try {
        submitted.current = current.draft;
        const result = await current.onSave(current.draft);
        if (result?.status === 'rejected') throw new Error(result.message);
        retryNeeded.current = false;
        accepted.current = current.draft;
        setError('');
        return true;
      } catch (e) {
        retryNeeded.current = true;
        setError(e instanceof Error ? e.message : String(e));
        input.current?.focus();
        return false;
      } finally {
        pending.current = null;
      }
    });
    pending.current = task;
    return task;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    registry?.set(testId, () => saveRef.current());
    return () => {
      registry?.delete(testId);
    };
  }, [registry, testId]);
  const common = {
    'aria-label': label,
    'data-testid': testId,
    value: draft,
    disabled,
    status: error ? ('error' as const) : undefined,
    'aria-invalid': !!error,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onBlur: () => void save(),
    onKeyDownCapture: (e: KeyboardEvent<HTMLElement>) => {
      if (numeric && e.key === 'Enter' && composing.current) {
        e.stopPropagation();
        return;
      }
      if (
        e.key === 'Escape' &&
        (draft !== String(value) || error || retryNeeded.current)
      ) {
        e.preventDefault();
        e.stopPropagation();
        setDraft(String(value));
        setError('');
        retryNeeded.current = false;
      }
      if (
        e.key === 'Enter' &&
        (!multiline || e.metaKey || e.ctrlKey) &&
        !composing.current
      ) {
        e.preventDefault();
        e.stopPropagation();
        void save();
      }
    },
  };
  return (
    <div className="settings-draft-field">
      {numeric ? (
        <WorkspaceNumberInput
          {...common}
          ref={(node) => {
            input.current = node;
          }}
          onValueChange={setDraft}
        />
      ) : multiline ? (
        <WorkspaceTextArea
          {...common}
          ref={(node) => {
            input.current = node;
          }}
          rows={4}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <WorkspaceInput
          {...common}
          ref={(node) => {
            input.current = node;
          }}
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {error && <WorkspaceAlert type="error" role="alert" title={error} />}
    </div>
  );
}
