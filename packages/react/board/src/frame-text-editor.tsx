import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link as LinkIcon,
  MoreHorizontal,
} from 'lucide-react';
import { useFrameTheme, frameThemeStyle } from './frame-theme';
import { useFrameI18n } from './frame-i18n';
import './frame-text-editor.scss';
import { useContext } from 'react';
import { useRichTextLinks } from '@sue/board-react-text';
import {
  FrameRichTextLinkContext,
  FrameRichTextLinkPolicyContext,
} from './frame-rich-text';
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
import { FrameColorInput } from './frame-color-input';
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
  const host = useContext(FrameRichTextLinkContext);
  const policy = useContext(FrameRichTextLinkPolicyContext);
  const linkEvents = useRichTextLinks({
    ...policy,
    readonly,
    onOpenLink: host
      ? (href) => {
          void host.openLink(href);
        }
      : undefined,
  });
  const theme = useFrameTheme();
  const { language } = useFrameI18n();
  const zh = language === 'zh';
  const [selectionVisible, setSelectionVisible] = useState(false);
  const [panel, setPanel] = useState<'link' | 'more' | null>(null);
  const composing = useRef(false);
  const selectedRange = useRef<Range | null>(null);
  const effectiveText = useMemo(
    () => (defaultAlign ? textWithDefaultAlignment(text, defaultAlign) : text),
    [text, defaultAlign],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useFrameWheelPortal(toolbarRef);
  useLayoutEffect(() => {
    if (readonly || !selectionVisible) return;
    let frame = 0;
    const position = () => {
      const body = bodyRef.current;
      const toolbar = toolbarRef.current;
      if (body && toolbar) {
        const anchor =
          selectedRange.current?.getBoundingClientRect() ??
          body.getBoundingClientRect();
        const controls = toolbar.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(
          margin,
          Math.min(
            anchor.left + (anchor.width - controls.width) / 2,
            window.innerWidth - controls.width - margin,
          ),
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
  }, [readonly, selectionVisible, panel]);
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
  useEffect(() => {
    let pending = 0;
    const update = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        if (toolbarRef.current?.contains(document.activeElement)) return;
        const native = window.getSelection();
        const selection = controller?.getSelection();
        const visible =
          !readonly &&
          !composing.current &&
          !!selection &&
          !selection.collapsed &&
          (!!bodyRef.current?.contains(document.activeElement) ||
            !!bodyRef.current?.contains(native?.anchorNode ?? null));
        if (visible) {
          const previous = selectionRef.current;
          if (
            previous?.from !== selection.from ||
            previous?.to !== selection.to
          ) {
            refresh((value) => value + 1);
          }
          selectionRef.current = selection;
          if (
            native &&
            !native.isCollapsed &&
            native.rangeCount &&
            bodyRef.current?.contains(native.anchorNode)
          )
            selectedRange.current = native.getRangeAt(0).cloneRange();
        } else setPanel(null);
        setSelectionVisible(visible);
      });
    };
    document.addEventListener('selectionchange', update);
    update();
    return () => {
      cancelAnimationFrame(pending);
      document.removeEventListener('selectionchange', update);
    };
  }, [controller, readonly]);
  const apply = (run: () => void) => {
    restoreSelection();
    run();
    refresh((value) => value + 1);
  };
  return (
    <div
      data-frame-text-editor=""
      {...linkEvents}
      ref={bodyRef}
      className="board-text-layout"
      style={{
        position: 'relative',
        textAlign: effectiveText.align ?? 'center',
        ...style,
      }}
      onCompositionStart={() => {
        composing.current = true;
        setSelectionVisible(false);
        setPanel(null);
      }}
      onCompositionEnd={() => {
        composing.current = false;
        document.dispatchEvent(new Event('selectionchange'));
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.altKey && event.key === 'F10' && selectionVisible) {
          event.preventDefault();
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>('button')
            ?.focus();
          return;
        }
        if (event.key === 'Escape' && panel) {
          event.preventDefault();
          event.stopPropagation();
          setPanel(null);
          restoreSelection();
          bodyRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
          return;
        }
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
        const scope = event.currentTarget.closest('[data-action-scope]');
        if (
          scope &&
          next instanceof Element &&
          next.closest('[data-action-panel]') &&
          next.closest('[data-action-scope]') === scope
        )
          return;
        if (
          !event.currentTarget.contains(next) &&
          !toolbarRef.current?.contains(next)
        )
          onClose();
      }}
    >
      {!readonly &&
        selectionVisible &&
        createPortal(
          <div
            ref={toolbarRef}
            data-frame-text-toolbar
            role="toolbar"
            aria-label="Text formatting"
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLButtonElement) ||
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              const buttons = [
                ...(toolbarRef.current?.querySelectorAll<HTMLButtonElement>(
                  '.frame-text-toolbar__row:first-child > button:not(:disabled)',
                ) ?? []),
              ];
              const at = buttons.indexOf(event.target);
              buttons[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (at +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        buttons.length) %
                      buttons.length
              ]?.focus();
            }}
            onMouseDownCapture={(event) => {
              const selection = controller?.getSelection();
              if (selection) selectionRef.current = selection;
              if ((event.target as Element).closest('button'))
                event.preventDefault();
            }}
            className="frame-text-toolbar"
            style={{
              ...frameThemeStyle(theme),
              position: 'fixed',
              visibility: 'hidden',
              top: 0,
              left: 0,
            }}
          >
            <div className="frame-text-toolbar__row">
              {(['bold', 'italic', 'underline'] as const).map((mark) => (
                <button
                  key={mark}
                  type="button"
                  aria-label={
                    zh
                      ? { bold: '加粗', italic: '斜体', underline: '下划线' }[
                          mark
                        ]
                      : mark[0].toUpperCase() + mark.slice(1)
                  }
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
                  {(() => {
                    const Icon = {
                      bold: Bold,
                      italic: Italic,
                      underline: Underline,
                    }[mark];
                    return <Icon size={16} />;
                  })()}
                </button>
              ))}
              <button
                type="button"
                aria-label={zh ? '链接' : 'Link'}
                aria-expanded={panel === 'link'}
                onClick={() => {
                  setLink(controller?.getActiveLink()?.href ?? '');
                  setPanel(panel === 'link' ? null : 'link');
                }}
              >
                <LinkIcon size={16} />
              </button>
              <button
                type="button"
                aria-label={zh ? '更多文字格式' : 'More text formatting'}
                aria-expanded={panel === 'more'}
                onClick={() => setPanel(panel === 'more' ? null : 'more')}
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
            {panel === 'more' && (
              <div
                className="frame-text-toolbar__panel"
                role="group"
                aria-label={zh ? '更多文字格式' : 'More text formatting'}
              >
                <div className="frame-text-toolbar__row">
                  <button
                    type="button"
                    aria-label={zh ? '删除线' : 'Strikethrough'}
                    aria-pressed={!!controller?.getActiveMarks().strike}
                    onClick={() =>
                      apply(() => controller?.toggleMark('strike'))
                    }
                  >
                    <Strikethrough size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={zh ? '行内代码' : 'Inline code'}
                    aria-pressed={!!controller?.getActiveMarks().code}
                    onClick={() => apply(() => controller?.toggleMark('code'))}
                  >
                    <Code size={16} />
                  </button>
                </div>
                <label>
                  {zh ? '字号' : 'Font size'}
                  <select
                    aria-label="Font size"
                    disabled={!controller}
                    value={String(
                      controller?.getActiveMarks().fontSize ??
                        style?.fontSize ??
                        16,
                    ).replace('px', '')}
                    onChange={(event) => {
                      restoreSelection();
                      controller?.applyMark(
                        'fontSize',
                        Number(event.target.value),
                      );
                    }}
                  >
                    {[12, 13, 14, 16, 18, 20, 24, 28, 32, 40, 48].map(
                      (size) => (
                        <option key={size}>{size}</option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  {zh ? '文字颜色' : 'Text color'}
                  <FrameColorInput
                    aria-label="Text color"
                    disabled={!controller}
                    value={
                      controller?.getActiveMarks().color ??
                      (typeof style?.color === 'string'
                        ? style.color
                        : '#0f172a')
                    }
                    style={{ width: 28, height: 24, padding: 0 }}
                    onValue={(value) => {
                      restoreSelection();
                      controller?.applyMark('color', value);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Reset text color to theme"
                    disabled={!controller}
                    onClick={() => {
                      restoreSelection();
                      controller?.applyMark('color');
                      refresh((value) => value + 1);
                    }}
                  >
                    {zh ? '跟随主题' : 'Theme color'}
                  </button>
                </label>
                <label>
                  {zh ? '对齐' : 'Align'}
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
                    <option value="left">{zh ? '左' : 'Left'}</option>
                    <option value="center">{zh ? '中' : 'Center'}</option>
                    <option value="right">{zh ? '右' : 'Right'}</option>
                  </select>
                </label>
              </div>
            )}
            {panel === 'link' && (
              <div
                className="frame-text-toolbar__panel"
                role="group"
                aria-label={zh ? '链接设置' : 'Link settings'}
              >
                <input
                  aria-label="Link URL"
                  type="url"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                  placeholder="https://…"
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
                    setPanel(null);
                  }}
                >
                  {zh ? '应用链接' : 'Apply link'}
                </button>
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() => {
                    apply(() => controller?.setLink(null));
                    setPanel(null);
                  }}
                >
                  {zh ? '移除链接' : 'Remove link'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPanel(null);
                    restoreSelection();
                    bodyRef.current
                      ?.querySelector<HTMLElement>('.ProseMirror')
                      ?.focus();
                  }}
                >
                  {zh ? '取消' : 'Cancel'}
                </button>
              </div>
            )}
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
