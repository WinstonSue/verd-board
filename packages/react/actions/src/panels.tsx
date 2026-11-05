import { X } from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  actionLabel,
  type ActionLanguage,
  type ActionResult,
  type BoundAction,
} from '@sue/board-common';
import type { ActionSource } from './scope';
import { formatActionShortcut } from './shortcuts';

export type ActionPanelFocus = HTMLElement | (() => HTMLElement | null);
interface PanelProps {
  /** Mount to open. The target is captured on mount before the input is focused. */
  actions: readonly BoundAction[];
  sources?: readonly ActionSource[];
  language?: ActionLanguage;
  onClose(): void;
  returnFocus?: ActionPanelFocus;
}
const emptySources: readonly ActionSource[] = [];
function usePanelActions(
  actions: readonly BoundAction[],
  sources: readonly ActionSource[],
) {
  const [captured] = useState(() => actions.map((action) => action.capture()));
  const subscribe = useCallback(
    (notify: () => void) => {
      const cleanups = sources.map((source) => source.subscribe(notify));
      return () => cleanups.forEach((cleanup) => cleanup());
    },
    [sources],
  );
  const snapshot = useCallback(
    () => sources.map((source) => source.revision).join(':'),
    [sources],
  );
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return captured;
}
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}
function matches(action: BoundAction, query: string, language: ActionLanguage) {
  const haystack = normalize(
    [
      actionLabel(action.label, language),
      action.category,
      ...(action.keywords ?? []),
    ].join(' '),
  );
  return normalize(query)
    .trim()
    .split(/\s+/)
    .every((part) => haystack.includes(part));
}
function sortActions(actions: readonly BoundAction[]) {
  return [...actions].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
}
function ModalFrame({
  title,
  children,
  onClose,
  className,
  returnFocus,
  closeLabel = 'Close',
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  className?: string;
  returnFocus?: ActionPanelFocus;
  closeLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useId();
  useLayoutEffect(() => {
    const active = document.activeElement;
    const dialog = ref.current;
    // Focusing a palette input can collapse the browser's contenteditable
    // selection even though the editor still owns the original logical range.
    const selection = document.getSelection();
    const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, at) =>
      selection!.getRangeAt(at).cloneRange(),
    ).filter((range) => active?.contains(range.commonAncestorContainer));
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      const target =
        typeof returnFocus === 'function'
          ? returnFocus()
          : (returnFocus ?? active);
      if (
        (target instanceof HTMLElement || target instanceof SVGElement) &&
        target.isConnected &&
        (dialog?.contains(document.activeElement) ||
          document.activeElement === document.body)
      ) {
        target.focus();
        // Adding a DOM range can focus its contenteditable; respect toolbar return targets.
        if (
          ranges.length &&
          ranges.every(
            (range) =>
              target.contains(range.startContainer) &&
              target.contains(range.endContainer),
          )
        ) {
          selection?.removeAllRanges();
          for (const range of ranges) selection?.addRange(range);
        }
      }
    };
    // Capture the logical opener once per open panel, before its search takes focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      const focusable = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'input, button:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
      if (
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  };
  return (
    <div
      className="verd-actions-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        data-action-panel=""
        ref={ref}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={labelId}
        className={`verd-actions-panel ${className ?? ''}`}
        onKeyDown={keyboard}
      >
        <header>
          <h2 id={labelId}>{title}</h2>
          <button type="button" onClick={onClose} aria-label={closeLabel}>
            <X strokeWidth={1.75} size={16} aria-hidden />
          </button>
        </header>
        {children}
      </dialog>
    </div>
  );
}
export interface CommandPaletteProps extends PanelProps {
  onResult?(result: ActionResult, actionId: string): void;
}
export function CommandPalette({
  actions,
  sources = emptySources,
  language = 'zh',
  onClose,
  onResult,
  returnFocus,
}: CommandPaletteProps) {
  const captured = usePanelActions(actions, sources);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const filtered = sortActions(captured).filter(
    (action) =>
      action.palette !== false &&
      action.getState().visible &&
      matches(action, query, language),
  );
  const index = Math.min(selected, Math.max(0, filtered.length - 1));
  const invoke = (action: BoundAction | undefined) => {
    if (!action) return;
    const state = action.getState();
    if (!state.visible || !state.enabled) return;
    const work = action.execute(undefined, { source: 'palette' });
    onClose();
    void work.then((result) => onResult?.(result, action.id));
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelected(
        filtered.length
          ? (index + delta + filtered.length) % filtered.length
          : 0,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      invoke(filtered[index]);
    }
  };
  return (
    <ModalFrame
      title={language === 'zh' ? '命令面板' : 'Command palette'}
      onClose={onClose}
      className="verd-actions-palette"
      returnFocus={returnFocus}
      closeLabel={language === 'zh' ? '关闭命令面板' : 'Close command palette'}
    >
      <input
        aria-label={language === 'zh' ? '搜索命令' : 'Search commands'}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={
          filtered[index] ? `${listId}-${index}` : undefined
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={keyboard}
      />
      <div
        role="listbox"
        id={listId}
        aria-label={language === 'zh' ? '命令' : 'Commands'}
        className="verd-actions-list"
      >
        {filtered.map((action, at) => {
          const state = action.getState();
          return (
            <button
              key={action.id}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={at === index}
              aria-disabled={!state.enabled}
              data-action-id={action.id}
              data-checked={state.checked || undefined}
              type="button"
              title={state.reason}
              onPointerMove={() => setSelected(at)}
              onClick={() => invoke(action)}
            >
              <span className="verd-actions-label">
                {actionLabel(action.label, language)}
                <small>
                  {action.category}
                  {!state.enabled && state.reason ? ` · ${state.reason}` : ''}
                </small>
              </span>
              <span className="verd-actions-keys">
                {action.shortcuts
                  ?.filter((shortcut) => action.shortcutEnabled(shortcut))
                  .map((shortcut, at) => (
                    <kbd key={at}>{formatActionShortcut(shortcut)}</kbd>
                  ))}
              </span>
            </button>
          );
        })}
        {!filtered.length && (
          <p>{language === 'zh' ? '没有匹配的命令' : 'No matching commands'}</p>
        )}
      </div>
    </ModalFrame>
  );
}
export function ActionHelp({
  actions,
  sources = emptySources,
  language = 'zh',
  onClose,
  returnFocus,
}: PanelProps) {
  const captured = usePanelActions(actions, sources);
  const [query, setQuery] = useState('');
  const filtered = sortActions(captured).filter(
    (action) =>
      action.shortcuts?.length &&
      action.getState().visible &&
      matches(action, query, language),
  );
  const categories = useMemo(
    () => [...new Set(filtered.map((action) => action.category))],
    [filtered],
  );
  return (
    <ModalFrame
      title={language === 'zh' ? '快捷键' : 'Keyboard shortcuts'}
      onClose={onClose}
      className="verd-actions-help"
      returnFocus={returnFocus}
      closeLabel={
        language === 'zh' ? '关闭快捷键帮助' : 'Close keyboard shortcuts'
      }
    >
      <input
        type="search"
        aria-label={language === 'zh' ? '搜索快捷键' : 'Search shortcuts'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="verd-actions-list">
        {categories.map((category) => (
          <section key={category}>
            <h3>{category}</h3>
            {filtered
              .filter((action) => action.category === category)
              .map((action) => (
                <div
                  key={action.id}
                  className="verd-actions-help-row"
                  data-action-id={action.id}
                >
                  <span>{actionLabel(action.label, language)}</span>
                  <span className="verd-actions-keys">
                    {action.shortcuts?.map((shortcut, at) => (
                      <kbd key={at}>{formatActionShortcut(shortcut)}</kbd>
                    ))}
                  </span>
                </div>
              ))}
          </section>
        ))}
        {!filtered.length && (
          <p role="status">
            {language === 'zh' ? '没有匹配的快捷键' : 'No matching shortcuts'}
          </p>
        )}
      </div>
    </ModalFrame>
  );
}
