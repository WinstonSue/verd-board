import { GripVertical } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { BoundAction } from '@sue/board-common';
import type { DocumentEditorController } from '../../types/document';
import {
  blockAtBoundary,
  operableBlock,
  planBlockOrder,
} from './document-block-order';
import { useDocumentBubble } from './document-editor-bubble';
import { DocumentSelectionToolbar } from './document-selection-toolbar';
import { DocumentTableControls } from './document-table-controls';
import { tableSelection, tableScopeKey } from './document-table';
import {
  documentBlockHandleLeft,
  hasDocumentTextSelection,
} from './document-controls';

const highlightKey = new PluginKey('documentBlockHighlight');
const blockSelector =
  'p,h1,h2,h3,h4,h5,h6,pre,li,ul,ol,blockquote,summary,table,hr,img,[data-type],[data-node-view-wrapper]';

function targetAt(editor: Editor, position: number, boundary = false) {
  const doc = editor.state.doc;
  const block =
    (boundary
      ? blockAtBoundary(doc, position)
      : operableBlock(doc.resolve(position))) ?? blockAtBoundary(doc, position);
  if (!block) return null;
  const element = editor.view.nodeDOM(block.start);
  return element instanceof HTMLElement
    ? { ...block, doc, element, position }
    : null;
}
type Block = NonNullable<ReturnType<typeof targetAt>>;
type OpenBlock = {
  block: Block;
  previous: Selection;
  actions: Map<string, BoundAction>;
};
type DropTarget = { toIndex: number; left: number; top: number; width: number };

function pointerTarget(editor: Editor, event: MouseEvent) {
  if (!(event.target instanceof Element)) return null;
  const { view } = editor;
  const element = event.target.closest(blockSelector);
  if (
    !element ||
    !view.dom.contains(element) ||
    event.target.closest('.tiptap') !== view.dom ||
    event.target.closest('input, textarea, select, button, [data-math-editor]')
  )
    return null;
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const pos = view.posAtDOM(element, 0);
  if (pos < 0) return null;
  if (element.matches('hr,img,[data-node-view-wrapper]')) {
    for (const candidate of [pos, pos - 1, at?.inside ?? -1]) {
      const block = candidate >= 0 ? targetAt(editor, candidate, true) : null;
      if (block?.element.contains(element)) return block;
    }
  }
  if (element.matches('li,ul,ol,blockquote,table,[data-type=details]')) {
    const outer = targetAt(editor, pos);
    if (outer?.element === element) return outer;
  }
  return targetAt(
    editor,
    at && element.contains(view.domAtPos(at.pos).node) ? at.pos : pos,
  );
}

function scrollContainer(element: HTMLElement) {
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  return null;
}

function leadingTextblock(block: Block) {
  if (block.node.isTextblock) return block.start;
  if (block.node.isAtom || block.node.type.name === 'table') return null;
  let start: number | null = null;
  block.node.descendants((node, offset) => {
    if (start !== null || node.isAtom || node.type.name === 'table')
      return false;
    if (!node.isTextblock) return true;
    start = block.start + 1 + offset;
    return false;
  });
  return start;
}

function dropTarget(
  editor: Editor,
  source: Block,
  x: number,
  y: number,
  scroll: HTMLElement | null,
): DropTarget | null {
  if (source.doc !== editor.state.doc) return null;
  const parentDom =
    source.parentStart === 0
      ? editor.view.dom
      : editor.view.nodeDOM(source.parentStart - 1);
  if (!(parentDom instanceof HTMLElement)) return null;
  const bounds = parentDom.getBoundingClientRect();
  const clip = scroll?.getBoundingClientRect();
  if (
    x < bounds.left - 30 ||
    x > bounds.right ||
    y < Math.max(bounds.top, clip?.top ?? 0) ||
    y > Math.min(bounds.bottom, clip?.bottom ?? window.innerHeight)
  )
    return null;
  const siblings: { index: number; rect: DOMRect }[] = [];
  source.parent.forEach((_, offset, index) => {
    const element = editor.view.nodeDOM(source.parentStart + offset);
    if (!(element instanceof HTMLElement)) return;
    const rect = element.getBoundingClientRect();
    if (rect.height) siblings.push({ index, rect });
  });
  let closest = siblings.find(({ rect }) => y < rect.top + rect.height / 2);
  const before = !!closest;
  closest ??= siblings.at(-1);
  if (!closest) return null;
  const boundary = closest.index + (before ? 0 : 1);
  const toIndex = boundary - (source.index < boundary ? 1 : 0);
  if (!planBlockOrder(source.doc, source.start, toIndex)) return null;
  const top = before ? closest.rect.top : closest.rect.bottom;
  if (clip && (top < clip.top || top > clip.bottom)) return null;
  return { toIndex, left: closest.rect.left, width: closest.rect.width, top };
}

const grip = <GripVertical size={16} strokeWidth={1.75} aria-hidden="true" />;

export function DocumentBlockPopover({
  editor,
  controller,
  readonly,
  locale,
  onNotice,
  onEditLink,
  selectionAction,
  suspended,
}: {
  editor: Editor;
  controller: DocumentEditorController | null;
  readonly: boolean;
  locale: 'zh' | 'en';
  onNotice(message: string): void;
  onEditLink?: () => void;
  selectionAction?: { label: string; select(text: string): void };
  suspended?: boolean;
}) {
  const [target, setTarget] = useState<Block | null>(null);
  const [open, setOpen] = useState<OpenBlock | null>(null);
  const [gripPosition, setGripPosition] = useState<{
    left: number;
    centerY: number;
  } | null>(null);
  const [textToolbarVisible, setTextToolbarVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [line, setLine] = useState<DropTarget | null>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);
  const focusedMenu = useRef<OpenBlock | null>(null);
  const dismissedSelection = useRef<Selection | null>(null);
  const rightSelection = useRef<Selection | null>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    block: Block;
    action: BoundAction;
    pointer: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    active: boolean;
    scroll: HTMLElement | null;
    frame: number;
  } | null>(null);
  const zh = locale === 'zh';
  const label = zh ? '段落操作' : 'Block options';

  const openMenu = (block: Block, previous = editor.state.selection) => {
    if (
      !controller ||
      block.doc !== editor.state.doc ||
      editor.view.composing ||
      suspended
    )
      return;
    const { state, view } = editor;
    if (block.node.type.name === 'table' && !readonly) {
      const selection = tableSelection(state.doc, block.start, 'table');
      if (selection) {
        setOpen(null);
        setTextToolbarVisible(false);
        view.dispatch(
          state.tr
            .setSelection(selection)
            .setMeta(tableScopeKey, 'table')
            .setMeta('verd-table-menu-focus', true)
            .setMeta('verd-table-previous', previous),
        );
      }
      return;
    }
    if (
      readonly &&
      !block.node.attrs['blockId'] &&
      !state.doc.resolve(block.position).parent.attrs['blockId']
    )
      return;
    const position = state.doc.resolve(block.position);
    const selection =
      position.parent.isTextblock && block.position > block.start
        ? TextSelection.create(state.doc, block.position)
        : block.node.isAtom
          ? NodeSelection.create(state.doc, block.start)
          : Selection.near(state.doc.resolve(block.start + 1));
    view.dispatch(state.tr.setSelection(selection));
    const actions = new Map(
      controller.actions().map((action) => [action.id, action.capture()]),
    );
    setTextToolbarVisible(false);
    setOpen({ block, previous, actions });
  };

  const close = (restore = false) => {
    setOpen(null);
    if (restore && open && open.previous.$from.doc === editor.state.doc) {
      editor.view.dispatch(editor.state.tr.setSelection(open.previous));
      editor.view.focus();
    }
  };

  const stopDrag = useCallback((reset = true) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    cancelAnimationFrame(current.frame);
    if (handle.current?.hasPointerCapture?.(current.pointer))
      handle.current.releasePointerCapture(current.pointer);
    if (reset) {
      setLine(null);
      setDragging(false);
    }
  }, []);

  const closeText = () => {
    dismissedSelection.current = editor.state.selection;
    setTextToolbarVisible(false);
    if (document.activeElement?.closest('.document-selection-popover'))
      editor.view.focus();
  };

  useEffect(() => {
    if (editor.isDestroyed) return;
    const { dom } = editor.view;
    const shell = dom.closest<HTMLElement>('.board-document-editor');
    const inTextToolbar = (element: EventTarget | null) =>
      element instanceof Element &&
      element.closest('.board-document-editor') === shell &&
      (!!element.closest('.document-selection-popover') ||
        (element.matches('.document-block-popover-host') &&
          !!element.querySelector('.document-selection-popover')));
    const updateToolbar = () => {
      if (open || drag.current || suspended) return;
      const { selection, doc } = editor.state;
      const dismissed = dismissedSelection.current;
      if (
        dismissed &&
        (dismissed.$from.doc !== doc || !dismissed.eq(selection))
      )
        dismissedSelection.current = null;
      setTextToolbarVisible(
        !selecting.current &&
          !dismissedSelection.current &&
          !readonly &&
          !editor.view.composing &&
          hasDocumentTextSelection(selection) &&
          (editor.view.hasFocus() || inTextToolbar(document.activeElement)),
      );
    };
    const fromSelection = () => {
      if (open || drag.current || suspended) return;
      updateToolbar();
      const { selection } = editor.state;
      setTarget(
        targetAt(editor, selection.from, selection instanceof NodeSelection),
      );
    };
    const down = (event: PointerEvent) => {
      if (event.button === 2) rightSelection.current = editor.state.selection;
      else if (event.button === 0) {
        dismissedSelection.current = null;
        selecting.current = true;
        setTextToolbarVisible(false);
      }
    };
    const up = () => {
      if (!selecting.current) return;
      selecting.current = false;
      fromSelection();
    };
    const hover = (event: PointerEvent) => {
      if (open || drag.current || suspended || selecting.current) return;
      const block = pointerTarget(editor, event);
      if (block)
        setTarget((old) =>
          old?.element === block.element && old.doc === block.doc ? old : block,
        );
    };
    const context = (event: MouseEvent) => {
      if (!controller || suspended) return;
      const block = pointerTarget(editor, event);
      if (!block) return;
      const previous = rightSelection.current;
      rightSelection.current = null;
      if (
        readonly &&
        !block.node.attrs['blockId'] &&
        !editor.state.doc.resolve(block.position).parent.attrs['blockId']
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(
        block,
        previous?.$from.doc === editor.state.doc ? previous : undefined,
      );
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || drag.current) return;
      if (
        open &&
        !menu.current?.contains(event.target) &&
        !handle.current?.contains(event.target) &&
        !(event.button === 2 && dom.contains(event.target))
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== 'Escape' || !drag.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = true;
      stopDrag();
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && (open || textToolbarVisible)) {
        event.preventDefault();
        event.stopPropagation();
        if (open) close(true);
        else closeText();
      } else if (event.altKey && event.key === 'F10') {
        const { selection } = editor.state;
        const block = targetAt(
          editor,
          selection.from,
          selection instanceof NodeSelection,
        );
        if (block) {
          event.preventDefault();
          openMenu(block);
        }
      } else if (event.altKey && event.key === 'F9' && textToolbarVisible) {
        event.preventDefault();
        dom
          .closest('.board-document-editor')
          ?.querySelector<HTMLButtonElement>(
            '.document-selection-tools button:not(:disabled)',
          )
          ?.focus();
      }
    };
    const changed = () => {
      if (open && editor.state.doc !== open.block.doc) close();
      if (drag.current && editor.state.doc !== drag.current.block.doc) {
        suppressClick.current = true;
        stopDrag();
      }
    };
    const composing = () => {
      setTextToolbarVisible(false);
      close();
      stopDrag();
    };
    let compositionFrame = 0;
    const compositionEnd = () => {
      cancelAnimationFrame(compositionFrame);
      compositionFrame = requestAnimationFrame(updateToolbar);
    };
    const focusOut = (event: FocusEvent) => {
      if (event.target !== dom && !inTextToolbar(event.target)) return;
      if (event.relatedTarget === dom || inTextToolbar(event.relatedTarget))
        return;
      dismissedSelection.current = null;
      setTextToolbarVisible(false);
    };
    dom.addEventListener('pointerdown', down, true);
    dom.addEventListener('pointermove', hover);
    dom.addEventListener('contextmenu', context);
    dom.addEventListener('keydown', shortcut);
    dom.addEventListener('compositionstart', composing);
    dom.addEventListener('compositionend', compositionEnd);
    shell?.addEventListener('focusout', focusOut);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
    document.addEventListener('keydown', escape, true);
    editor.on('selectionUpdate', fromSelection);
    editor.on('update', fromSelection);
    editor.on('focus', fromSelection);
    editor.on('transaction', changed);
    updateToolbar();
    return () => {
      dom.removeEventListener('pointerdown', down, true);
      dom.removeEventListener('pointermove', hover);
      dom.removeEventListener('contextmenu', context);
      dom.removeEventListener('keydown', shortcut);
      dom.removeEventListener('compositionstart', composing);
      dom.removeEventListener('compositionend', compositionEnd);
      shell?.removeEventListener('focusout', focusOut);
      cancelAnimationFrame(compositionFrame);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      document.removeEventListener('keydown', escape, true);
      editor.off('selectionUpdate', fromSelection);
      editor.off('update', fromSelection);
      editor.off('focus', fromSelection);
      editor.off('transaction', changed);
    };
  }, [
    controller,
    editor,
    open,
    readonly,
    stopDrag,
    suspended,
    textToolbarVisible,
  ]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    const { selection } = editor.state;
    setTarget(
      targetAt(editor, selection.from, selection instanceof NodeSelection),
    );
    return () => stopDrag(false);
  }, [editor, stopDrag]);

  useEffect(() => {
    if (suspended || readonly) stopDrag();
    if (suspended) {
      setOpen(null);
      setTextToolbarVisible(false);
    }
  }, [readonly, stopDrag, suspended]);

  const anchor = useCallback(() => {
    if (!open || editor.isDestroyed || open.block.doc !== editor.state.doc)
      return null;
    const element = editor.view.nodeDOM(open.block.start);
    return element instanceof HTMLElement
      ? {
          contextElement: element,
          getBoundingClientRect: () => element.getBoundingClientRect(),
        }
      : null;
  }, [editor, open]);
  const positioned = useCallback(
    (host: HTMLElement) => {
      if (!open || focusedMenu.current === open) return;
      focusedMenu.current = open;
      host
        .querySelector<HTMLElement>(
          'button:not(:disabled), select:not(:disabled)',
        )
        ?.focus({ preventScroll: true });
    },
    [open],
  );
  const host = useDocumentBubble(
    editor,
    'documentBlockPopover',
    !!open && !suspended,
    anchor,
    positioned,
  );

  useEffect(() => {
    if (!open || editor.isDestroyed) return;
    const { doc, node, start } = open.block;
    editor.registerPlugin(
      new Plugin({
        key: highlightKey,
        props: {
          decorations: (state) =>
            state.doc === doc
              ? DecorationSet.create(doc, [
                  Decoration.node(start, start + node.nodeSize, {
                    class: 'document-block-active',
                  }),
                ])
              : null,
        },
      }),
    );
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(highlightKey);
    };
  }, [editor, open]);

  const shown = open?.block ?? target;
  useEffect(() => {
    if (!shown) {
      setGripPosition(null);
      return;
    }
    const textStart = leadingTextblock(shown);
    const viewport = scrollContainer(shown.element);
    const measure = () => {
      if (editor.isDestroyed || shown.doc !== editor.state.doc) {
        setGripPosition(null);
        return;
      }
      const { view } = editor;
      const element = view.nodeDOM(shown.start);
      if (!(element instanceof HTMLElement)) {
        setGripPosition(null);
        return;
      }
      const bounds = element.getBoundingClientRect();
      let centerY = bounds.top + Math.min(bounds.height / 2, 14);
      if (shown.node.type.name === 'table') {
        const table = element.querySelector('table') ?? element;
        centerY = table.getBoundingClientRect().top;
      }
      if (textStart !== null) {
        const text = view.nodeDOM(textStart);
        const textBounds =
          text instanceof HTMLElement ? text.getBoundingClientRect() : null;
        if (textBounds?.height) {
          const line = view.coordsAtPos(textStart + 1, 1);
          centerY =
            line.bottom > line.top
              ? (line.top + line.bottom) / 2
              : textBounds.top + textBounds.height / 2;
        }
      }
      const clip = viewport?.getBoundingClientRect();
      setGripPosition(
        bounds.height &&
          centerY >= Math.max(0, clip?.top ?? 0) &&
          centerY < Math.min(window.innerHeight, clip?.bottom ?? Infinity)
          ? { left: documentBlockHandleLeft(element), centerY }
          : null,
      );
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const resize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null;
    resize?.observe(shown.element);
    // The paragraph can move horizontally without changing its own size.
    if (viewport) resize?.observe(viewport);
    if (resize && textStart !== null && textStart !== shown.start) {
      const text = editor.view.nodeDOM(textStart);
      if (text instanceof HTMLElement) resize.observe(text);
    }
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      resize?.disconnect();
    };
  }, [editor, shown]);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    suppressClick.current = false;
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      !shown ||
      readonly ||
      suspended ||
      editor.view.composing
    )
      return;
    const action = controller
      ?.actions()
      .find((entry) => entry.id === 'document.block-move')
      ?.capture();
    if (!action) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      block: shown,
      action,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      scroll: scrollContainer(shown.element),
      active: false,
      frame: 0,
    };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active) {
      if (
        Math.hypot(current.x - current.startX, current.y - current.startY) < 6
      )
        return;
      current.active = true;
      suppressClick.current = true;
      setDragging(true);
      setTextToolbarVisible(false);
      close();
      let previousX: number | undefined;
      let previousY: number | undefined;
      let previousScroll: number | undefined;
      const tick = () => {
        if (drag.current !== current) return;
        const clip = current.scroll?.getBoundingClientRect();
        if (
          clip &&
          current.x >= clip.left &&
          current.x <= clip.right &&
          current.y >= clip.top - 16 &&
          current.y <= clip.bottom + 16
        ) {
          if (current.y < clip.top + 36) current.scroll!.scrollTop -= 12;
          if (current.y > clip.bottom - 36) current.scroll!.scrollTop += 12;
        }
        const scrollTop = current.scroll?.scrollTop;
        if (
          current.x !== previousX ||
          current.y !== previousY ||
          scrollTop !== previousScroll
        ) {
          previousX = current.x;
          previousY = current.y;
          previousScroll = scrollTop;
          setLine(
            dropTarget(
              editor,
              current.block,
              current.x,
              current.y,
              current.scroll,
            ),
          );
        }
        current.frame = requestAnimationFrame(tick);
      };
      tick();
    }
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const drop =
      current.active &&
      dropTarget(
        editor,
        current.block,
        event.clientX,
        event.clientY,
        current.scroll,
      );
    stopDrag();
    if (drop)
      void current.action
        .execute(
          { source: current.block.start, toIndex: drop.toIndex },
          { source: 'menu' },
        )
        .then((result) => {
          if ('code' in result) onNotice(result.message ?? result.code);
        });
  };

  const invoke = async (action: BoundAction) => {
    close();
    editor.view.focus();
    const result = await action.execute(undefined, { source: 'menu' });
    if ('code' in result) onNotice(result.message ?? result.code);
  };
  const item = (id: string, title: string, danger = false) => {
    const action = open?.actions.get('document.' + id);
    const state = action?.getState();
    if (!action || !state?.visible) return null;
    return (
      <button
        key={id}
        type="button"
        className={danger ? 'document-block-danger' : undefined}
        disabled={!state.enabled}
        onClick={() => void invoke(action)}
      >
        {title}
      </button>
    );
  };
  const types = [
    ['set-paragraph', zh ? '正文' : 'Paragraph'],
    ...Array.from({ length: 6 }, (_, i) => [
      `heading-${i + 1}`,
      zh ? `标题 ${i + 1}` : `Heading ${i + 1}`,
    ]),
    ['toggle-bullet-list', zh ? '无序列表' : 'Bullet list'],
    ['toggle-ordered-list', zh ? '有序列表' : 'Numbered list'],
    ['toggle-blockquote', zh ? '引用' : 'Quote'],
    ['toggle-code-block', zh ? '代码块' : 'Code block'],
  ];
  const atom = !!open?.block.node.isAtom;
  const group = open?.block.node.type.name;
  return (
    <>
      {controller && !readonly && !suspended && !dragging && (
        <DocumentTableControls
          editor={editor}
          controller={controller}
          zh={zh}
          onNotice={onNotice}
        />
      )}
      {shown &&
        (gripPosition || dragging) &&
        !suspended &&
        (!readonly || shown.node.attrs['blockId']) && (
          <button
            ref={handle}
            type="button"
            className="document-block-handle"
            aria-label={label}
            title={
              readonly
                ? label
                : zh
                  ? '点击打开菜单，拖动排序'
                  : 'Click for options, drag to reorder'
            }
            aria-haspopup="dialog"
            aria-expanded={!!open}
            aria-keyshortcuts="Alt+F10"
            style={{
              top: gripPosition?.centerY ?? 0,
              left: gripPosition?.left ?? 0,
              visibility: dragging ? 'hidden' : undefined,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={() => {
              suppressClick.current = true;
              stopDrag();
            }}
            onLostPointerCapture={() => {
              if (drag.current) {
                suppressClick.current = true;
                stopDrag();
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!dragging) openMenu(shown);
            }}
            onClick={() => {
              if (!suppressClick.current) open ? close(true) : openMenu(shown);
              suppressClick.current = false;
            }}
          >
            {grip}
          </button>
        )}
      {line && (
        <div
          className="document-block-drop-line"
          aria-hidden="true"
          style={{ left: line.left, top: line.top, width: line.width }}
        />
      )}
      {textToolbarVisible &&
        !open &&
        !dragging &&
        !readonly &&
        !suspended &&
        controller && (
          <DocumentSelectionToolbar
            editor={editor}
            controller={controller}
            zh={zh}
            onEditLink={onEditLink}
            selectionAction={selectionAction}
            onNotice={onNotice}
            close={closeText}
          />
        )}
      {open &&
        !suspended &&
        createPortal(
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The dialog handles navigation between its child controls.
          <div
            ref={menu}
            className="document-block-popover"
            role="dialog"
            tabIndex={-1}
            aria-label={label}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close(true);
              }
              if (
                (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                event.target instanceof HTMLButtonElement
              ) {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)',
                  ),
                ];
                const index = buttons.indexOf(event.target);
                if (index < 0) return;
                event.preventDefault();
                buttons[
                  (index +
                    (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            {!readonly && (
              <>
                {group && ['listItem', 'details', 'table'].includes(group) && (
                  <span className="document-block-caption">
                    {group === 'listItem'
                      ? zh
                        ? '列表项'
                        : 'List item'
                      : group === 'details'
                        ? zh
                          ? '折叠块'
                          : 'Fold block'
                        : zh
                          ? '表格'
                          : 'Table'}
                  </span>
                )}
                {!atom && group !== 'table' && (
                  <>
                    <select
                      aria-label={zh ? '转换类型' : 'Turn into'}
                      value=""
                      onChange={(event) => {
                        const action = open.actions.get(
                          'document.' + event.target.value,
                        );
                        if (action?.getState().enabled) void invoke(action);
                      }}
                    >
                      <option value="" disabled>
                        {zh ? '转换类型' : 'Turn into'}
                      </option>
                      {types.map(([id, title]) => (
                        <option
                          key={id}
                          value={id}
                          disabled={
                            !open.actions.get('document.' + id)?.getState()
                              .enabled
                          }
                        >
                          {title}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={zh ? '对齐' : 'Alignment'}
                      value=""
                      onChange={(event) => {
                        const action = open.actions.get(
                          'document.' + event.target.value,
                        );
                        if (action?.getState().enabled) void invoke(action);
                      }}
                    >
                      <option value="" disabled>
                        {zh ? '对齐' : 'Alignment'}
                      </option>
                      <option value="align-left">
                        {zh ? '左对齐' : 'Left'}
                      </option>
                      <option value="align-center">
                        {zh ? '居中' : 'Center'}
                      </option>
                      <option value="align-right">
                        {zh ? '右对齐' : 'Right'}
                      </option>
                    </select>
                    <hr />
                  </>
                )}
              </>
            )}
            {item('anchor-block', zh ? '复制此段链接' : 'Copy block link')}
            {!readonly && (
              <>
                {item('block-duplicate', zh ? '复制' : 'Duplicate')}
                {item('block-up', zh ? '上移' : 'Move up')}
                {item('block-down', zh ? '下移' : 'Move down')}
                <hr />
                {item('block-delete', zh ? '删除' : 'Delete', true)}
              </>
            )}
          </div>,
          host,
        )}
    </>
  );
}
