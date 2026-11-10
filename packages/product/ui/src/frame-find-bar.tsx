import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { findFrameCells, type CellStore } from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import { useI18n } from './i18n';
import { FindBar } from './find-bar';

export function FrameFindBar({
  store,
  frameId,
  controller,
  inputRef,
  onClose,
  open = true,
}: {
  store: CellStore;
  frameId: string;
  controller: FrameCanvasController;
  inputRef: RefObject<HTMLInputElement | null>;
  onClose(): void;
  open?: boolean;
}) {
  const { language } = useI18n();
  // Reveals follow the result, not the changing imperative handle's identity.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const matches = useMemo(
    () => (open ? findFrameCells(store, frameId, query, matchCase) : []),
    [store, frameId, query, matchCase, open],
  );
  const index = Math.max(0, current ? matches.indexOf(current) : 0);
  const target = matches[index];
  const wasOpen = useRef(false);
  useEffect(() => () => controllerRef.current.clearRevealOverrides(), []);
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        setCurrent(null);
        controllerRef.current.clearRevealOverrides();
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const request = new AbortController();
    if (target)
      void controllerRef.current.revealTarget({
        cellId: target,
        requestId: 0,
        signal: request.signal,
      });
    else controllerRef.current.clearRevealOverrides();
    return () => request.abort();
  }, [target, open]);
  return open ? (
    <FindBar
      locale={language}
      label={language === 'zh' ? '查找画布' : 'Find in canvas'}
      className="frame-findbar"
      placement="inline"
      query={query}
      matchCase={matchCase}
      index={index}
      count={matches.length}
      unit="cells"
      inputRef={inputRef}
      onQuery={(next) => {
        setQuery(next);
        setCurrent(null);
      }}
      onMatchCase={(next) => {
        setMatchCase(next);
        setCurrent(null);
      }}
      onStep={(delta) => {
        if (matches.length)
          setCurrent(
            matches[(index + delta + matches.length) % matches.length],
          );
      }}
      onClose={onClose}
    />
  ) : null;
}
