import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useFrameWheelPortal } from './frame-wheel';
import {
  Alignment,
  textWithDefaultAlignment,
  textWithoutDefaultAlignment,
  type BoardTextDocument,
  type BoardTextController,
} from '@sue/board-common';
import {
  LineText,
  ParagraphText,
  type TextChangeData,
} from '@sue/board-react-text';

export function FrameTextEditor({
  text,
  mode = text.kind,
  style,
  defaultAlign,
  readonly,
  onChange,
  onClose,
  onExitKey,
  onTab,
  onHistory,
}: {
  text: BoardTextDocument;
  mode?: 'inline' | 'block';
  /** The same base typography and layout overrides as FrameRichText. */
  style?: CSSProperties;
  defaultAlign?: Alignment;
  readonly: boolean;
  onChange(
    change: TextChangeData,
  ): void | Promise<{ status?: string } | undefined>;
  onClose(): void;
  /** Keyboard exit returns focus to the canvas. Blur keeps the control just clicked. */
  onExitKey?(): void;
  onTab?(): void;
  onHistory(action: 'undo' | 'redo'): void;
}) {
  const effectiveText = useMemo(
    () => (defaultAlign ? textWithDefaultAlignment(text, defaultAlign) : text),
    [text, defaultAlign],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useFrameWheelPortal(toolbarRef);
  useLayoutEffect(() => {
    if (readonly) return;
    let frame = 0;
    const position = () => {
      const body = bodyRef.current;
      const toolbar = toolbarRef.current;
      if (body && toolbar) {
        const anchor = body.getBoundingClientRect();
        const controls = toolbar.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(
          margin,
          Math.min(anchor.left, window.innerWidth - controls.width - margin),
        );
        const above = anchor.top - controls.height - margin;
        const top = Math.max(
          margin,
          Math.min(
            above >= margin ? above : anchor.bottom + margin,
            window.innerHeight - controls.height - margin,
          ),
        );
        if (toolbar.style.left !== `${left}px`)
          toolbar.style.left = `${left}px`;
        if (toolbar.style.top !== `${top}px`) toolbar.style.top = `${top}px`;
        if (toolbar.style.visibility !== 'visible')
          toolbar.style.visibility = 'visible';
      }
      // Camera transforms do not resize the text DOM. Track its screen rectangle
      // while editing so zoom, pan and nested/rotated frames stay anchored.
      frame = requestAnimationFrame(position);
    };
    position();
    return () => cancelAnimationFrame(frame);
  }, [readonly]);
  const [controller, setController] = useState<BoardTextController | null>(
    null,
  );
  const [epoch, setEpoch] = useState(0);
  const restoringRef = useRef(false);
  useEffect(() => {
    restoringRef.current = false;
  });
  const commit = (change: TextChangeData) => {
    refresh((value) => value + 1);
    void Promise.resolve(
      onChange(
        defaultAlign
          ? {
              ...change,
              oldText: text,
              newText: textWithoutDefaultAlignment(
                change.newText,
                text,
                defaultAlign,
              ),
            }
          : change,
      ),
    ).then((result) => {
      if (result?.status !== 'rejected') return;
      restoringRef.current = true;
      setEpoch((value) => value + 1);
    });
  };
  const selectionRef = useRef<{
    from: number;
    to: number;
    collapsed: boolean;
  } | null>(null);
  const [link, setLink] = useState('');
  const [, refresh] = useState(0);
  const restoreSelection = () => {
    const selection = selectionRef.current;
    if (selection) controller?.selectRange(selection.from, selection.to);
  };
  return (
    <div
      data-frame-text-editor=""
      ref={bodyRef}
      className="board-text-layout"
      style={{
        position: 'relative',
        textAlign: effectiveText.align ?? 'center',
        ...style,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (
          (event.target as Element).closest('[data-frame-text-toolbar]') &&
          event.key !== 'Escape'
        )
          return;
        if (
          event.key === 'Tab' &&
          onTab &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          onTab();
          return;
        }
        if (
          event.key === 'Escape' ||
          (event.key === 'Enter' &&
            (mode === 'inline'
              ? !event.shiftKey
              : event.ctrlKey || event.metaKey))
        ) {
          event.preventDefault();
          event.stopPropagation();
          onExitKey?.();
          onClose();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')
        ) {
          event.preventDefault();
          event.stopPropagation();
          onExitKey?.();
          onClose();
          onHistory(
            event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo',
          );
        }
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseUp={() => refresh((value) => value + 1)}
      onKeyUp={() => refresh((value) => value + 1)}
      onBlur={(event) => {
        if (restoringRef.current) return;
        const next = event.relatedTarget as Node | null;
        if (
          !event.currentTarget.contains(next) &&
          !toolbarRef.current?.contains(next)
        )
          onClose();
      }}
    >
      {!readonly &&
        createPortal(
          <div
            ref={toolbarRef}
            data-frame-text-toolbar
            role="toolbar"
            aria-label="Text formatting"
            onMouseDownCapture={(event) => {
              const selection = controller?.getSelection();
              if (selection) selectionRef.current = selection;
              if ((event.target as Element).closest('button'))
                event.preventDefault();
            }}
            style={{
              position: 'fixed',
              zIndex: 60,
              visibility: 'hidden',
              top: 0,
              left: 0,
              display: 'flex',
              gap: 3,
              background: '#fff',
              color: '#0f172a',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: 4,
              whiteSpace: 'nowrap',
              maxWidth: 'calc(100vw - 16px)',
              overflowX: 'auto',
              boxSizing: 'border-box',
              font: '13px system-ui, sans-serif',
              lineHeight: 1.3,
            }}
          >
            {(['bold', 'italic', 'underline', 'strike', 'code'] as const).map(
              (mark) => (
                <button
                  key={mark}
                  type="button"
                  aria-label={mark[0].toUpperCase() + mark.slice(1)}
                  aria-pressed={!!controller?.getActiveMarks()[mark]}
                  disabled={!controller}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    const selection = selectionRef.current;
                    if (selection && !selection.collapsed)
                      controller?.selectRange(selection.from, selection.to);
                    controller?.toggleMark(mark);
                    refresh((value) => value + 1);
                  }}
                  onClick={(event) => {
                    if (event.detail !== 0) return;
                    const selection = selectionRef.current;
                    if (selection && !selection.collapsed)
                      controller?.selectRange(selection.from, selection.to);
                    controller?.toggleMark(mark);
                    refresh((value) => value + 1);
                  }}
                  style={{ minWidth: 24, padding: 2 }}
                >
                  {
                    {
                      bold: 'B',
                      italic: 'I',
                      underline: 'U',
                      strike: 'S',
                      code: '<>',
                    }[mark]
                  }
                </button>
              ),
            )}
            <select
              aria-label="Font size"
              disabled={!controller}
              defaultValue={String(style?.fontSize ?? 16).replace('px', '')}
              onChange={(event) => {
                restoreSelection();
                controller?.applyMark('fontSize', Number(event.target.value));
              }}
            >
              {[12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
            <input
              aria-label="Text color"
              disabled={!controller}
              type="color"
              defaultValue={
                typeof style?.color === 'string' ? style.color : '#0f172a'
              }
              style={{ width: 28, height: 24, padding: 0 }}
              onChange={(event) => {
                restoreSelection();
                controller?.applyMark('color', event.target.value);
              }}
            />
            <select
              aria-label="Text alignment"
              disabled={!controller}
              value={
                controller?.getActiveAlign?.() ??
                effectiveText.align ??
                'center'
              }
              onChange={(event) => {
                restoreSelection();
                controller?.setAlign(event.target.value as Alignment);
                refresh((value) => value + 1);
              }}
            >
              <option value="left">左</option>
              <option value="center">中</option>
              <option value="right">右</option>
            </select>
            <input
              aria-label="Link URL"
              type="url"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="URL"
              style={{ width: 100 }}
            />
            <button
              type="button"
              aria-label="Apply link"
              disabled={!controller}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                restoreSelection();
                controller?.setLink(link ? { href: link } : null);
              }}
            >
              ↗
            </button>
          </div>,
          document.body,
        )}
      <div className="board-text-body">
        {mode === 'block' ? (
          <ParagraphText
            key={epoch}
            text={effectiveText}
            // In-place editing explicitly requests focus.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            readonly={readonly}
            onChange={commit}
            afterInit={setController}
          />
        ) : (
          <LineText
            key={epoch}
            text={effectiveText}
            // In-place editing explicitly requests focus.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            readonly={readonly}
            onChange={commit}
            afterInit={setController}
          />
        )}
      </div>
    </div>
  );
}
