import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  DocumentEditorController,
  DocumentSearchMatch,
} from '@sue/board-react-text';
import type { ActionResult } from '@sue/board-common';
import { FindBar } from '../shared/find-bar';

function sameMatch(
  left: DocumentSearchMatch | undefined,
  right: DocumentSearchMatch,
) {
  return (
    left?.from === right.from &&
    left.to === right.to &&
    left.replaceable === right.replaceable
  );
}
const succeeded = (result: ActionResult) =>
  result.status === 'completed' || result.status === 'noop';

/** Mounted while closed to retain this document instance's search preferences. */
export function DocumentFindBar({
  controller,
  mode,
  locale,
  readonly,
  inputRef,
  onMode,
  onClose,
}: {
  controller: DocumentEditorController | null;
  mode: false | 'find' | 'replace';
  locale: 'zh' | 'en';
  readonly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onMode(mode: 'find' | 'replace'): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [matches, setMatches] = useState<DocumentSearchMatch[]>([]);
  const [index, setIndex] = useState(-1);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const latest = useRef({
    query,
    matchCase,
    matches,
    index,
    readonly,
    controller,
  });
  latest.current = { query, matchCase, matches, index, readonly, controller };
  const content = useRef('');
  const refresh = (
    value = latest.current.query,
    sensitive = latest.current.matchCase,
    reset = false,
    delta = 0,
  ) => {
    const ctl = latest.current.controller;
    if (!ctl) return [];
    const found = value ? ctl.find(value, { caseSensitive: sensitive }) : [];
    const previous = latest.current.matches[latest.current.index];
    let next = reset
      ? 0
      : found.findIndex((match) => sameMatch(previous, match));
    if (next < 0)
      next = Math.min(Math.max(latest.current.index, 0), found.length - 1);
    next = found.length ? (next + delta + found.length) % found.length : -1;
    // Set this before selectMatch emits a view-only transaction.
    content.current = JSON.stringify(ctl.getDocument().content);
    latest.current = {
      ...latest.current,
      query: value,
      matchCase: sensitive,
      matches: found,
      index: next,
    };
    setMatches(found);
    setIndex(next);
    if (next >= 0) ctl.selectMatch(found[next], { focus: false });
    else ctl.clearReveal?.();
    return found;
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const open = !!mode;
  useEffect(() => {
    if (!open) return;
    const bar = inputRef.current?.closest<HTMLElement>('.find-bar');
    const header = bar?.closest<HTMLElement>('.document-page__header');
    const main = header?.parentElement;
    if (!bar || !header || !main) return;
    const measure = () => {
      const styles = getComputedStyle(bar);
      const gap = Number.parseFloat(styles.getPropertyValue('--find-gap')) || 4;
      // Keep the scroll viewport below the anchored panel, including replace rows.
      const height =
        styles.position === 'absolute' ? bar.offsetHeight + gap * 2 : 0;
      main.style.setProperty('--document-find-space', `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(header);
    return () => {
      observer.disconnect();
      main.style.removeProperty('--document-find-space');
    };
  }, [open, inputRef]);
  useEffect(() => {
    if (!controller || !open) return;
    setError('');
    refreshRef.current(undefined, undefined, true);
    const unsubscribe = controller.subscribe(() => {
      const next = JSON.stringify(controller.getDocument().content);
      if (next !== content.current) {
        content.current = next;
        refreshRef.current();
      }
    });
    return () => {
      unsubscribe();
      controller.clearReveal?.();
    };
  }, [controller, open]);

  const replace = async (all: boolean) => {
    const context = latest.current;
    const ctl = context.controller;
    if (!ctl || context.readonly || pending.current || !context.query) return;
    const match = context.matches[context.index];
    pending.current = true;
    setBusy(true);
    setError('');
    const failure = (result: ActionResult) =>
      new Error(
        'message' in result && result.message
          ? result.message
          : locale === 'zh'
            ? '替换未完成，请重试。'
            : 'Replacement did not complete. Please retry.',
      );
    try {
      const receipt = await ctl.flushEditing();
      if (!succeeded(receipt)) throw failure(receipt);
      if (
        !alive.current ||
        latest.current.controller !== ctl ||
        latest.current.readonly
      )
        return;
      const found = ctl.find(context.query, {
        caseSensitive: context.matchCase,
      });
      const fresh = found.find((item) => sameMatch(match, item));
      if (!all && (!fresh || fresh.replaceable === false)) {
        refreshRef.current();
        throw new Error(
          locale === 'zh'
            ? '匹配内容已变化，请重新定位后替换。'
            : 'The match changed. Locate it again before replacing.',
        );
      }
      if (all && !found.some((item) => item.replaceable !== false)) return;
      const result = await ctl.executeAction(
        all ? 'document.replace-all' : 'document.replace',
        all
          ? {
              query: context.query,
              text: replacement,
              options: { caseSensitive: context.matchCase },
            }
          : { match: fresh!, text: replacement },
      );
      if (!succeeded(result)) throw failure(result);
      if (alive.current && latest.current.controller === ctl)
        refreshRef.current();
    } catch (cause) {
      if (alive.current && latest.current.controller === ctl)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (!open) return null;
  const current = matches[index];
  const editable = !!controller && !readonly;
  return (
    <FindBar
      locale={locale}
      label={locale === 'zh' ? '查找文档' : 'Find in document'}
      className={`doc-findbar${mode === 'replace' && editable ? ' doc-findbar--replace' : ''}`}
      placement="inline"
      query={query}
      matchCase={matchCase}
      index={index}
      count={matches.length}
      unit="text"
      inputRef={inputRef}
      onQuery={(next) => {
        setQuery(next);
        setError('');
        refresh(next, matchCase, true);
      }}
      onMatchCase={(next) => {
        setMatchCase(next);
        setError('');
        refresh(query, next, true);
      }}
      onStep={(delta) => refresh(undefined, undefined, false, delta)}
      onClose={onClose}
      replace={
        editable
          ? {
              open: mode === 'replace',
              value: replacement,
              busy,
              error,
              canReplace:
                !!current &&
                current.replaceable !== false &&
                !!controller.getActionState('document.replace', {
                  match: current,
                  text: replacement,
                }).enabled,
              canReplaceAll:
                matches.some((match) => match.replaceable !== false) &&
                !!controller.getActionState('document.replace-all', {
                  query,
                  text: replacement,
                  options: { caseSensitive: matchCase },
                }).enabled,
              onToggle: () => onMode(mode === 'replace' ? 'find' : 'replace'),
              onChange: setReplacement,
              onReplace: () => void replace(false),
              onReplaceAll: () => void replace(true),
            }
          : undefined
      }
    />
  );
}
