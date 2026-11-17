import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import type { Editor } from '@tiptap/react';
import type { BoundAction } from '@sue/board-common';
import {
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Code,
  EllipsisVertical,
  Eraser,
  Highlighter,
  Italic,
  Link2,
  Sigma,
  Strikethrough,
  Subscript,
  Superscript,
  Type,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import type { DocumentEditorController } from '../../types/document';
import { useDocumentBubble } from './document-editor-bubble';
import { hasDocumentTextSelection } from './document-controls';
import {
  documentAlignments,
  documentBlockFormats,
  documentFormatColors,
  selectionColor,
} from './document-format-options';

const sizes = [12, 14, 16, 18, 20, 24, 28, 32];
type Panel = 'block' | 'align' | 'color' | 'more' | 'link';
export const selectionToolbarKey = 'documentSelectionToolbar';

export function DocumentSelectionToolbar({
  editor,
  controller,
  zh,
  onEditLink,
  onNotice,
  close,
}: {
  editor: Editor;
  controller: DocumentEditorController;
  zh: boolean;
  onEditLink?: () => void;
  onNotice(message: string): void;
  close(): void;
}) {
  const [activePanel, setPanel] = useState<Panel | null>(null);
  const [link, setLink] = useState('');
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const panelId = useId();
  const triggers = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const panel = useRef<HTMLDivElement>(null);
  const focusPanel = useRef(false);
  const captured = useRef<Map<string, BoundAction> | null>(null);
  const scope = useRef({
    doc: editor.state.doc,
    selection: editor.state.selection,
  });
  const running = useRef(false);
  const closePanel = useCallback(() => {
    setPanel(null);
    captured.current = null;
  }, []);
  useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.revision,
  );
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const hidden = new Set<string>();
  const main = [
    ['block', 40],
    ['align', 40],
    ['bold', 32],
    ['code', 32],
    ['math', 32],
    ['italic', 32],
    ['link', 32],
    ['strike', 32],
    ['underline', 32],
    ['color', 40],
    ['more', 32],
  ] as const;
  const mainWidth = () => {
    const shown = main.filter(([id]) => !hidden.has(id));
    const dividers =
      2 + Number(!hidden.has('block')) + Number(!hidden.has('align'));
    return (
      shown.reduce((total, [, width]) => total + width, 0) +
      (shown.length - 1) * 2 +
      dividers * 7 +
      10
    );
  };
  for (const id of ['code', 'math', 'strike', 'block', 'align']) {
    if (mainWidth() <= viewport - 16) break;
    hidden.add(id);
  }
  const triggerFor = useCallback(
    (name: Panel) => triggers.current[name] ?? triggers.current.more,
    [],
  );
  const openPanel = (name: Panel, keyboard = false) => {
    if (activePanel === name) {
      closePanel();
      return;
    }
    captured.current = new Map(
      controller.actions().map((action) => [action.id, action.capture()]),
    );
    scope.current = {
      doc: editor.state.doc,
      selection: editor.state.selection,
    };
    focusPanel.current = keyboard;
    setPanel(name);
  };
  const canShow = useCallback(
    () => hasDocumentTextSelection(editor.state.selection),
    [editor],
  );
  const host = useDocumentBubble(
    editor,
    selectionToolbarKey,
    true,
    undefined,
    undefined,
    'top',
    canShow,
  );
  useLayoutEffect(() => {
    if (activePanel && focusPanel.current) {
      panel.current
        ?.querySelector<HTMLElement>('button:not(:disabled), select, input')
        ?.focus({ preventScroll: true });
      focusPanel.current = false;
    }
  }, [activePanel]);
  useEffect(() => {
    if (!activePanel || editor.isDestroyed) return;
    const trigger = triggerFor(activePanel),
      floating = panel.current;
    if (!trigger || !floating) return;
    const editorDom = editor.view.dom;
    let disposed = false;
    delete floating.dataset['positioned'];
    const stopPositioning = autoUpdate(trigger, floating, () => {
      void computePosition(trigger, floating, {
        placement:
          activePanel === 'block' || activePanel === 'align'
            ? 'bottom-start'
            : 'bottom-end',
        middleware: [
          offset(6),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            padding: 8,
            apply({ availableHeight, availableWidth }) {
              if (disposed) return;
              floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
              floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (disposed) return;
        floating.style.left = `${x}px`;
        floating.style.top = `${y}px`;
        floating.dataset['positioned'] = '';
      });
    });
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !floating.contains(event.target) &&
        !trigger.contains(event.target)
      )
        closePanel();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closePanel();
    };
    const changed = () => {
      if (
        !running.current &&
        (scope.current.doc !== editor.state.doc ||
          !scope.current.selection.eq(editor.state.selection))
      )
        closePanel();
    };
    editor.on('transaction', changed);
    editorDom.addEventListener('keydown', escape, true);
    editorDom.ownerDocument.addEventListener('pointerdown', dismiss, true);
    return () => {
      disposed = true;
      stopPositioning();
      editor.off('transaction', changed);
      editorDom.removeEventListener('keydown', escape, true);
      editorDom.ownerDocument.removeEventListener('pointerdown', dismiss, true);
    };
  }, [activePanel, closePanel, editor, triggerFor, viewport]);
  const toolbarState = controller.getToolbarState();
  const text = (cn: string, en: string) => (zh ? cn : en);
  const run = async (id: string, args?: unknown, dismiss = false) => {
    if (running.current) return;
    const action =
      (activePanel ? captured.current?.get('document.' + id) : undefined) ??
      controller
        .actions()
        .find((item) => item.id === 'document.' + id)
        ?.capture();
    if (!action) return;
    running.current = true;
    try {
      const result = await action.execute(args, { source: 'menu' });
      if ('code' in result) onNotice(result.message ?? result.code);
      if (
        dismiss ||
        result.status === 'cancelled' ||
        result.status === 'rejected'
      )
        closePanel();
      else if (activePanel) {
        captured.current = new Map(
          controller.actions().map((item) => [item.id, item.capture()]),
        );
        scope.current = {
          doc: editor.state.doc,
          selection: editor.state.selection,
        };
      }
    } finally {
      running.current = false;
    }
  };
  const actionButton = (
    id: string,
    label: string,
    Icon: LucideIcon,
    row = false,
  ) => {
    const state = controller.getActionState('document.' + id);
    return (
      <button
        key={id}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={state.checked}
        disabled={!state.enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void run(id)}
      >
        <Icon aria-hidden="true" />
        {row && <span>{label}</span>}
      </button>
    );
  };
  const dropdown = (
    name: Panel,
    label: string,
    Icon: LucideIcon,
    arrow = true,
  ) => (
    <button
      ref={(element) => {
        triggers.current[name] = element;
      }}
      type="button"
      aria-label={label}
      title={label}
      className={arrow ? 'document-selection-dropdown' : undefined}
      aria-expanded={activePanel === name}
      aria-haspopup={name === 'more' ? undefined : 'menu'}
      aria-controls={activePanel === name ? panelId : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          openPanel(name, true);
        }
      }}
      onClick={(event) =>
        openPanel(name, event.detail === 0 && name !== 'more')
      }
    >
      <Icon aria-hidden="true" />
      {arrow && (
        <ChevronDown
          strokeWidth={1.75}
          size={16}
          className="document-selection-caret"
          aria-hidden="true"
        />
      )}
    </button>
  );
  const divider = (
    <span className="document-selection-divider" aria-hidden="true" />
  );
  const currentBlock =
    toolbarState.block === 'heading'
      ? `heading-${toolbarState.headingLevel}`
      : (
          {
            paragraph: 'set-paragraph',
            bulletList: 'toggle-bullet-list',
            orderedList: 'toggle-ordered-list',
            blockquote: 'toggle-blockquote',
            codeBlock: 'toggle-code-block',
          } as const
        )[toolbarState.block];
  const BlockIcon =
    documentBlockFormats.find(([id]) => id === currentBlock)?.[3] ?? Type;
  const AlignmentIcon =
    documentAlignments.find(
      ([id]) => id === `align-${toolbarState.align}`,
    )?.[3] ?? documentAlignments[0][3];
  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.nativeEvent.isComposing ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLInputElement
    )
      return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select, input',
      ),
    );
    const index = items.indexOf(
      event.currentTarget.ownerDocument.activeElement as HTMLElement,
    );
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) %
            items.length;
    event.preventDefault();
    items[next]?.focus({ preventScroll: true });
    items[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const blockMenu = documentBlockFormats.map(([id, cn, en, Icon]) => (
    <button
      key={id}
      type="button"
      role="menuitemradio"
      aria-checked={id === currentBlock}
      disabled={!controller.getActionState('document.' + id).enabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (id === currentBlock) {
          closePanel();
          editor.commands.focus();
        } else void run(id, undefined, true);
      }}
    >
      <Icon aria-hidden="true" />
      <span>{text(cn, en)}</span>
      {id === currentBlock && (
        <Check strokeWidth={1.75} size={16} aria-hidden="true" />
      )}
    </button>
  ));
  const colorSection = (background: boolean) => {
    const value = selectionColor(editor, background),
      id = background ? 'set-highlight' : 'set-text-color';
    const caption = background
      ? text('背景高亮', 'Background')
      : text('文字颜色', 'Text color');
    const choose = (color: string | null) => void run(id, color, true);
    const enabled = controller.getActionState('document.' + id, null).enabled;
    return (
      <div
        role="group"
        aria-label={caption}
        className="document-selection-colors"
      >
        <div className="document-selection-caption">{caption}</div>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={value === null}
          disabled={!enabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(null)}
        >
          <span aria-hidden="true" className="document-color-swatch">
            A
          </span>
          <span>
            {background
              ? text('默认背景', 'Default background')
              : text('默认颜色', 'Default color')}
          </span>
          {value === null && (
            <Check strokeWidth={1.75} size={16} aria-hidden="true" />
          )}
        </button>
        {documentFormatColors.map(([cn, en, foreground, fill]) => {
          const color = background ? fill : foreground;
          const label = background
            ? text(cn + '背景', en + ' background')
            : text(cn + '文字', en + ' text');
          return (
            <button
              key={en}
              type="button"
              role="menuitemradio"
              aria-label={label}
              aria-checked={value === color}
              disabled={!enabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(color)}
            >
              <span
                aria-hidden="true"
                className="document-color-swatch"
                style={
                  background
                    ? { background: color, color: '#252525' }
                    : { color }
                }
              >
                A
              </span>
              <span>{text(cn, en)}</span>
              {value === color && (
                <Check strokeWidth={1.75} size={16} aria-hidden="true" />
              )}
            </button>
          );
        })}
        <label className="document-selection-row">
          {background ? (
            <Highlighter strokeWidth={1.75} size={16} aria-hidden="true" />
          ) : (
            <Baseline strokeWidth={1.75} size={16} aria-hidden="true" />
          )}
          <span>{text('自定义', 'Custom')}</span>
          <input
            type="color"
            disabled={!enabled}
            aria-label={
              background
                ? text('自定义高亮', 'Custom highlight')
                : text('自定义文字颜色', 'Custom text color')
            }
            value={
              value && value !== 'mixed' && /^#[\da-f]{6}$/i.test(value)
                ? value
                : background
                  ? '#fef08a'
                  : '#787878'
            }
            onChange={(event) => void run(id, event.target.value)}
          />
        </label>
      </div>
    );
  };
  let content: ReactNode = null;
  if (activePanel === 'block') content = blockMenu;
  else if (activePanel === 'align')
    content = documentAlignments.map(([id, cn, en, Icon]) => (
      <button
        key={id}
        type="button"
        role="menuitemradio"
        aria-checked={id === `align-${toolbarState.align}`}
        disabled={!controller.getActionState('document.' + id).enabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void run(id, undefined, true)}
      >
        <Icon aria-hidden="true" />
        <span>{text(cn, en)}</span>
        {id === `align-${toolbarState.align}` && (
          <Check strokeWidth={1.75} size={16} aria-hidden="true" />
        )}
      </button>
    ));
  else if (activePanel === 'color')
    content = (
      <>
        {colorSection(false)}
        <hr />
        {colorSection(true)}
      </>
    );
  else if (activePanel === 'more')
    content = (
      <>
        <label className="document-selection-row">
          <Type strokeWidth={1.75} size={16} aria-hidden="true" />
          <span>{text('字号', 'Font size')}</span>
          <select
            aria-label={text('字号', 'Font size')}
            value={toolbarState.marks.fontSize ?? ''}
            onChange={(event) =>
              void run('set-font-size', event.target.value || null)
            }
          >
            <option value="">{text('默认', 'Default')}</option>
            {sizes.map((value) => (
              <option key={value} value={value + 'px'}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {hidden.has('block') && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => openPanel('block', event.detail === 0)}
          >
            <BlockIcon aria-hidden="true" />
            <span>{text('块类型', 'Block type')}</span>
            <ChevronDown strokeWidth={1.75} size={16} aria-hidden="true" />
          </button>
        )}
        {hidden.has('align') && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => openPanel('align', event.detail === 0)}
          >
            <AlignmentIcon aria-hidden="true" />
            <span>{text('对齐', 'Alignment')}</span>
            <ChevronDown strokeWidth={1.75} size={16} aria-hidden="true" />
          </button>
        )}
        {hidden.has('code') &&
          actionButton(
            'toggle-code',
            text('行内代码', 'Inline code'),
            Code,
            true,
          )}
        {hidden.has('math') &&
          actionButton(
            'insert-inline-math',
            text('行内公式', 'Inline equation'),
            Sigma,
            true,
          )}
        {hidden.has('strike') &&
          actionButton(
            'toggle-strike',
            text('删除线', 'Strikethrough'),
            Strikethrough,
            true,
          )}
        {actionButton(
          'toggle-superscript',
          text('上标', 'Superscript'),
          Superscript,
          true,
        )}
        {actionButton(
          'toggle-subscript',
          text('下标', 'Subscript'),
          Subscript,
          true,
        )}
        <hr />
        {actionButton(
          'clear-formatting',
          text('清除格式', 'Clear formatting'),
          Eraser,
          true,
        )}
      </>
    );
  else if (activePanel === 'link')
    content = (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run('set-link', link.trim() || null, true);
        }}
      >
        <label className="document-selection-row">
          {text('链接地址', 'Link URL')}
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
        </label>
        <button type="submit">{text('应用', 'Apply')}</button>
      </form>
    );
  const panelLabel =
    activePanel === 'block'
      ? text('块类型', 'Block type')
      : activePanel === 'align'
        ? text('对齐', 'Alignment')
        : activePanel === 'color'
          ? text('颜色与背景', 'Color and background')
          : activePanel === 'link'
            ? text('链接', 'Link')
            : text('更多格式', 'More formatting');
  return createPortal(
    <div
      className="document-selection-popover"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key !== 'Escape') return;
        event.stopPropagation();
        event.preventDefault();
        if (activePanel) {
          triggerFor(activePanel)?.focus({ preventScroll: true });
          closePanel();
        } else close();
      }}
    >
      <div
        role="toolbar"
        aria-label={text('文字格式', 'Text formatting')}
        className="document-selection-tools"
      >
        {!hidden.has('block') && (
          <>
            {dropdown('block', text('块类型', 'Block type'), BlockIcon)}
            {divider}
          </>
        )}
        {!hidden.has('align') && (
          <>
            {dropdown('align', text('对齐', 'Alignment'), AlignmentIcon)}
            {divider}
          </>
        )}
        {actionButton('toggle-bold', text('加粗', 'Bold'), Bold)}
        {!hidden.has('code') &&
          actionButton('toggle-code', text('行内代码', 'Inline code'), Code)}
        {!hidden.has('math') &&
          actionButton(
            'insert-inline-math',
            text('行内公式', 'Inline equation'),
            Sigma,
          )}
        {actionButton('toggle-italic', text('斜体', 'Italic'), Italic)}
        <button
          ref={(element) => {
            triggers.current.link = element;
          }}
          type="button"
          aria-label={text('链接', 'Link')}
          title={text('链接', 'Link')}
          aria-pressed={!!toolbarState.link}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            if (onEditLink) {
              closePanel();
              onEditLink();
            } else {
              setLink(toolbarState.link ?? '');
              openPanel('link', event.detail === 0);
            }
          }}
        >
          <Link2 strokeWidth={1.75} size={16} aria-hidden="true" />
        </button>
        {!hidden.has('strike') &&
          actionButton(
            'toggle-strike',
            text('删除线', 'Strikethrough'),
            Strikethrough,
          )}
        {actionButton(
          'toggle-underline',
          text('下划线', 'Underline'),
          Underline,
        )}
        {divider}
        {dropdown(
          'color',
          text('颜色与背景', 'Color and background'),
          Highlighter,
        )}
        {divider}
        {dropdown(
          'more',
          text('更多格式', 'More formatting'),
          EllipsisVertical,
          false,
        )}
      </div>
      {activePanel && (
        <div
          ref={panel}
          id={panelId}
          className="document-selection-extra"
          role={
            activePanel === 'more' || activePanel === 'link' ? 'group' : 'menu'
          }
          aria-label={panelLabel}
          onKeyDown={menuKey}
        >
          {content}
        </div>
      )}
    </div>,
    host,
  );
}
