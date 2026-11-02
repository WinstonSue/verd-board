import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
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
}: {
  value: string | number;
  onSave(value: string): CommitResult | Promise<CommitResult>;
  label: string;
  testId: string;
  multiline?: boolean;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const composing = useRef(false);
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const registry = useContext(DraftContext);
  const latest = useRef({ draft, value, onSave });
  latest.current = { draft, value, onSave };
  const pending = useRef<Promise<boolean> | null>(null);
  const retryNeeded = useRef(false);
  const priorValue = useRef(String(value));
  const submitted = useRef<string | undefined>(undefined);
  useEffect(() => {
    setDraft((current) =>
      current === priorValue.current || current === submitted.current
        ? String(value)
        : current,
    );
    priorValue.current = String(value);
  }, [value]);
  const save = (): Promise<boolean> => {
    if (pending.current)
      return pending.current.then((ok) => (ok ? saveRef.current() : false));
    const current = latest.current;
    if (current.draft === String(current.value) && !retryNeeded.current)
      return Promise.resolve(true);
    if (composing.current) return Promise.resolve(false);
    const task = (async () => {
      try {
        submitted.current = current.draft;
        const result = await current.onSave(current.draft);
        if (result?.status === 'rejected') throw new Error(result.message);
        retryNeeded.current = false;
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
    })();
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
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className="settings-draft-field">
      <Tag
        ref={input}
        type={numeric ? 'number' : 'text'}
        aria-label={label}
        data-testid={testId}
        value={draft}
        aria-invalid={!!error}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(String(value));
            setError('');
          }
          if (
            e.key === 'Enter' &&
            (!multiline || e.metaKey || e.ctrlKey) &&
            !composing.current
          ) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
