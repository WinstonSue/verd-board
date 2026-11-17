import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { GripHorizontal, GripVertical } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Selection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import type { BoundAction } from '@sue/board-common';
import type { DocumentEditorController } from '../../types/document';
import { useDocumentBubble } from './document-editor-bubble';
import {
  planTableMove,
  tableHandleTarget,
  tableScope,
  tableScopeKey,
  tableSelection,
  type TableHandleTarget,
  type TableScopeKind,
} from './document-table';

type Geometry = {
  start: number;
  table: HTMLTableElement;
  rect: DOMRect;
  clip: DOMRect;
  rows: DOMRect[];
  columns: DOMRect[];
};
type Drop = {
  toIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

function tableStartAt(editor: Editor, element?: Element) {
  const table = element?.closest('table');
  if (element && !table) return null;
  const pos =
    table && editor.view.dom.contains(table)
      ? editor.view.posAtDOM(table, 0)
      : editor.state.selection.from;
  const resolved = editor.state.doc.resolve(pos);
  for (let depth = resolved.depth; depth > 0; depth--)
    if (resolved.node(depth).type.spec['tableRole'] === 'table')
      return resolved.before(depth);
  if (editor.state.doc.nodeAt(pos)?.type.spec['tableRole'] === 'table')
    return pos;
  return null;
}

function scrollParents(element: HTMLElement) {
  const parents: HTMLElement[] = [];
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  )
    if (
      /auto|scroll/.test(
        getComputedStyle(parent).overflow +
          getComputedStyle(parent).overflowY +
          getComputedStyle(parent).overflowX,
      )
    )
      parents.push(parent);
  return parents;
}

function measureTable(editor: Editor, start: number): Geometry | null {
  const node = editor.state.doc.nodeAt(start);
  const dom = editor.view.nodeDOM(start);
  const table =
    dom instanceof HTMLTableElement
      ? dom
      : dom instanceof HTMLElement
        ? dom.querySelector('table')
        : null;
  if (!table || node?.type.spec['tableRole'] !== 'table') return null;
  const map = TableMap.get(node);
  const rect = table.getBoundingClientRect();
  let left = 0,
    top = 0,
    right = window.innerWidth,
    bottom = window.innerHeight;
  for (const parent of scrollParents(table)) {
    const bounds = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    if (/auto|scroll|hidden/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/auto|scroll|hidden/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (
    rect.bottom <= top ||
    rect.top >= bottom ||
    rect.right <= left ||
    rect.left >= right
  )
    return null;
  const rows = [...table.rows].map((row) => row.getBoundingClientRect());
  const columns = Array.from({ length: map.width }, (_, index) => {
    const pos = map.map[index];
    const cell = editor.view.nodeDOM(start + 1 + pos);
    if (!(cell instanceof HTMLElement)) return new DOMRect();
    const bounds = cell.getBoundingClientRect(),
      span = map.findCell(pos);
    const width = bounds.width / (span.right - span.left);
    return new DOMRect(
      bounds.left + (index - span.left) * width,
      rect.top,
      width,
      rect.height,
    );
  });
  return {
    start,
    table,
    rect,
    rows,
    columns,
    clip: new DOMRect(left, top, right - left, bottom - top),
  };
}

export function DocumentTableControls({
  editor,
  controller,
  zh,
  onNotice,
}: {
  editor: Editor;
  controller: DocumentEditorController;
  zh: boolean;
  onNotice(message: string): void;
}) {
  useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.revision,
  );
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [target, setTarget] = useState<TableHandleTarget | null>(null);
  const [dismissed, setDismissed] = useState<Selection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  const active = useRef<number | null>(null);
  const controls = useRef<HTMLDivElement>(null);
  const handles = useRef<TableHandleTarget | null>(null);
  const refresh = useRef<(() => void) | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  const suppressClick = useRef(false);
  const previous = useRef<Selection | null>(null);
  const running = useRef(false);
  const drag = useRef<{
    button: HTMLButtonElement;
    pointer: number;
    axis: 'row' | 'column';
    state: typeof editor.state;
    action: BoundAction;
    start: number;
    target: TableHandleTarget;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    frame: number;
  } | null>(null);
  const text = (cn: string, en: string) => (zh ? cn : en);
  const scope = tableScope(editor.state);
  const latest = useRef({ geometry, scope });
  latest.current = { geometry, scope };
  const visible =
    !!scope &&
    !(
      dismissed?.$from.doc === editor.state.doc &&
      dismissed.eq(editor.state.selection)
    ) &&
    !running.current &&
    !dragging;
  const stopDrag = useCallback(() => {
    const current = drag.current;
    drag.current = null;
    if (current) {
      cancelAnimationFrame(current.frame);
      if (current.button.hasPointerCapture(current.pointer))
        current.button.releasePointerCapture(current.pointer);
    }
    setDragging(false);
    setDrop(null);
    refresh.current?.();
  }, []);

  useEffect(() => {
    let hovered: Element | null = null;
    let pointer: { x: number; y: number } | null = null;
    let focused: Node | null = document.activeElement;
    let heldDoc = editor.state.doc;
    const owns = (element: Node | null) =>
      !!element &&
      (controls.current?.contains(element) || menu.current?.contains(element));
    const update = () => {
      if (editor.isDestroyed) return;
      if (hovered && !editor.view.dom.contains(hovered)) hovered = null;
      const next =
        drag.current?.target ??
        (hovered
          ? tableHandleTarget(editor.state, editor.view.posAtDOM(hovered, 0))
          : null) ??
        (owns(focused)
          ? heldDoc === editor.state.doc
            ? handles.current
            : tableHandleTarget(editor.state)
          : editor.view.hasFocus()
            ? tableHandleTarget(editor.state)
            : null);
      if (next) active.current = next.start;
      else active.current = tableStartAt(editor);
      handles.current = next;
      heldDoc = editor.state.doc;
      setTarget((current) =>
        current?.start === next?.start &&
        current?.cell === next?.cell &&
        current?.row === next?.row &&
        current?.column === next?.column
          ? current
          : next,
      );
      setGeometry(
        active.current === null ? null : measureTable(editor, active.current),
      );
    };
    const bridge = (x: number, y: number) => {
      const current = handles.current;
      const bounds = current && measureTable(editor, current.start);
      if (!bounds || !current) return false;
      const row = bounds.rows[current.row];
      const column = bounds.columns[current.column];
      const left = Math.max(bounds.rect.left, bounds.clip.left);
      return (
        (row &&
          x >= left - 18 &&
          x <= left &&
          y >= row.top &&
          y <= row.bottom) ||
        (column &&
          y >= bounds.rect.top - 18 &&
          y <= bounds.rect.top &&
          x >= column.left &&
          x <= column.right)
      );
    };
    const hoverAt = (element: Element | null, x: number, y: number) => {
      const cell = element?.closest('td,th');
      if (cell && editor.view.dom.contains(cell)) hovered = cell;
      else if (!owns(element) && (!hovered || !bridge(x, y))) hovered = null;
    };
    const hover = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (drag.current) return;
      const previous = hovered;
      hoverAt(
        event.target instanceof Element ? event.target : null,
        pointer.x,
        pointer.y,
      );
      if (previous !== hovered || event.type === 'pointerover') update();
    };
    const remeasure = () => {
      if (pointer && !drag.current)
        hoverAt(
          document.elementFromPoint(pointer.x, pointer.y),
          pointer.x,
          pointer.y,
        );
      update();
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget !== null || drag.current) return;
      pointer = null;
      hovered = null;
      update();
    };
    const focus = (event: FocusEvent) => {
      const destination =
        event.type === 'blur' ? event.relatedTarget : event.target;
      focused = destination instanceof Node ? destination : null;
      update();
    };
    const changed = ({
      transaction,
    }: {
      transaction: import('@tiptap/pm/state').Transaction;
    }) => {
      if (transaction.getMeta('verd-table-menu-focus')) {
        focusRequested.current = true;
        previous.current = transaction.getMeta(
          'verd-table-previous',
        ) as Selection;
        setDismissed(null);
      }
      if (drag.current && drag.current.state.doc !== editor.state.doc)
        stopDrag();
      remeasure();
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(remeasure);
    observer?.observe(editor.view.dom);
    refresh.current = remeasure;
    document.addEventListener('pointerover', hover);
    document.addEventListener('pointermove', hover);
    document.addEventListener('pointerout', leave);
    // Capture the destination before TipTap dispatches its blur transaction.
    document.addEventListener('blur', focus, true);
    document.addEventListener('focusin', focus);
    editor.on('transaction', changed);
    window.addEventListener('scroll', remeasure, true);
    window.addEventListener('resize', remeasure);
    update();
    return () => {
      refresh.current = null;
      observer?.disconnect();
      document.removeEventListener('pointerover', hover);
      document.removeEventListener('pointermove', hover);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('blur', focus, true);
      document.removeEventListener('focusin', focus);
      editor.off('transaction', changed);
      window.removeEventListener('scroll', remeasure, true);
      window.removeEventListener('resize', remeasure);
      stopDrag();
    };
  }, [editor, stopDrag]);

  const close = useCallback(
    (restore = false) => {
      const selection =
        restore && previous.current?.$from.doc === editor.state.doc
          ? previous.current
          : editor.state.selection;
      setDismissed(selection);
      if (!selection.eq(editor.state.selection))
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
    },
    [editor],
  );
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (drag.current || !(event.target instanceof Element)) return;
      if (
        event.target.closest(
          '.document-table-menu,.document-table-handle,.document-block-handle',
        )
      )
        return;
      setDismissed(editor.state.selection);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.key !== 'Escape' ||
        (!visible && !drag.current)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick.current = true;
      stopDrag();
      close(true);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [close, editor, stopDrag, visible]);

  const anchor = useCallback(() => {
    const { scope } = latest.current;
    if (!scope) return null;
    const geometry =
      latest.current.geometry?.start === scope.tableStart - 1
        ? latest.current.geometry
        : measureTable(editor, scope.tableStart - 1);
    if (!geometry) return null;
    const first =
      scope.kind === 'row'
        ? geometry.rows[scope.top]
        : scope.kind === 'column'
          ? geometry.columns[scope.left]
          : geometry.rect;
    if (!first) return null;
    return {
      contextElement: geometry.table,
      getBoundingClientRect: () =>
        new DOMRect(
          Math.max(first.left, geometry.clip.left),
          Math.max(first.top, geometry.clip.top),
          Math.min(first.width, geometry.clip.width),
          16,
        ),
    };
  }, [editor]);
  const positioned = useCallback(() => {
    if (focusRequested.current) {
      menu.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus({ preventScroll: true });
      focusRequested.current = false;
    }
  }, []);
  const host = useDocumentBubble(
    editor,
    'documentTableMenu',
    visible && !!geometry,
    anchor,
    positioned,
    'top-start',
    undefined,
    true,
  );

  const select = (
    kind: TableScopeKind,
    index = 0,
    extend = false,
    preserve = false,
  ) => {
    if (!geometry) return;
    const current = tableScope(editor.state);
    const same =
      current?.kind === kind && current.tableStart - 1 === geometry.start;
    const first = kind === 'row' ? current?.top : current?.left;
    const end = kind === 'row' ? current?.bottom : current?.right;
    if (preserve && same && index >= first! && index < end!) return;
    const start = extend && same ? Math.min(first!, index) : index;
    const last = extend && same ? Math.max(end! - 1, index) : index;
    const selection = tableSelection(
      editor.state.doc,
      geometry.start,
      kind,
      start,
      last,
    );
    if (!selection) return;
    if (selection.eq(editor.state.selection) && current?.kind === kind) {
      setDismissed(null);
      return;
    }
    previous.current = editor.state.selection;
    editor.view.dispatch(
      editor.state.tr.setSelection(selection).setMeta(tableScopeKey, kind),
    );
    setDismissed(null);
  };

  const dropAt = (current: NonNullable<typeof drag.current>): Drop | null => {
    if (editor.state.doc !== current.state.doc) return null;
    const bounds = measureTable(editor, current.start);
    const selected = tableScope(current.state);
    if (!bounds || !selected) return null;
    if (
      current.x < bounds.clip.left - 24 ||
      current.x > bounds.clip.right + 24 ||
      current.y < bounds.clip.top - 24 ||
      current.y > bounds.clip.bottom + 24
    )
      return null;
    const items = current.axis === 'row' ? bounds.rows : bounds.columns;
    const coordinate = current.axis === 'row' ? current.y : current.x;
    let boundary = items.findIndex(
      (rect) =>
        coordinate <
        (current.axis === 'row'
          ? rect.top + rect.height / 2
          : rect.left + rect.width / 2),
    );
    if (boundary < 0) boundary = items.length;
    const from = current.axis === 'row' ? selected.top : selected.left;
    const end = current.axis === 'row' ? selected.bottom : selected.right;
    if (boundary > from && boundary < end) return null;
    const toIndex = boundary >= end ? boundary - (end - from) : boundary;
    if (!planTableMove(current.state, current.axis, toIndex)) return null;
    const edge = items[Math.min(boundary, items.length - 1)];
    const position =
      current.axis === 'row'
        ? boundary === items.length
          ? edge.bottom
          : edge.top
        : boundary === items.length
          ? edge.right
          : edge.left;
    return current.axis === 'row'
      ? {
          toIndex,
          left: Math.max(bounds.rect.left, bounds.clip.left),
          top: position,
          width:
            Math.min(bounds.rect.right, bounds.clip.right) -
            Math.max(bounds.rect.left, bounds.clip.left),
          height: 2,
        }
      : {
          toIndex,
          left: position,
          top: Math.max(bounds.rect.top, bounds.clip.top),
          width: 2,
          height:
            Math.min(bounds.rect.bottom, bounds.clip.bottom) -
            Math.max(bounds.rect.top, bounds.clip.top),
        };
  };
  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    axis: 'row' | 'column',
    index: number,
  ) => {
    if (event.button !== 0 || editor.view.composing || !geometry) return;
    event.preventDefault();
    suppressClick.current = false;
    select(axis, index, event.shiftKey, !event.shiftKey);
    const action = controller
      .actions()
      .find((entry) => entry.id === `document.move-${axis}`)
      ?.capture();
    if (!action) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      button: event.currentTarget,
      pointer: event.pointerId,
      axis,
      action,
      state: editor.state,
      start: geometry.start,
      target: handles.current!,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      frame: 0,
    };
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (
      current.active ||
      Math.hypot(current.x - current.startX, current.y - current.startY) < 6
    )
      return;
    current.active = true;
    suppressClick.current = true;
    setDragging(true);
    const tick = () => {
      if (drag.current !== current) return;
      const bounds = measureTable(editor, current.start);
      if (bounds)
        for (const parent of scrollParents(bounds.table)) {
          const rect = parent.getBoundingClientRect();
          if (
            current.axis === 'row' &&
            current.x >= rect.left - 24 &&
            current.x <= rect.right + 24
          ) {
            if (current.y < rect.top + 32) parent.scrollTop -= 10;
            if (current.y > rect.bottom - 32) parent.scrollTop += 10;
          }
          if (
            current.axis === 'column' &&
            current.y >= rect.top - 24 &&
            current.y <= rect.bottom + 24
          ) {
            if (current.x < rect.left + 32) parent.scrollLeft -= 10;
            if (current.x > rect.right - 32) parent.scrollLeft += 10;
          }
        }
      setDrop(dropAt(current));
      current.frame = requestAnimationFrame(tick);
    };
    tick();
  };
  const run = async (action: BoundAction, args?: unknown) => {
    running.current = true;
    setDismissed(editor.state.selection);
    try {
      const result = await action.execute(args, { source: 'menu' });
      if ('code' in result) onNotice(result.message ?? result.code);
    } finally {
      running.current = false;
      if (!editor.isDestroyed) {
        setDismissed(editor.state.selection);
        editor.view.focus();
      }
    }
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    current.x = event.clientX;
    current.y = event.clientY;
    const target = current.active ? dropAt(current) : null;
    stopDrag();
    if (target) void run(current.action, { toIndex: target.toIndex });
  };
  const item = (
    id: string,
    cn: string,
    en: string,
    args?: unknown,
    disabled = false,
  ) => {
    const action = controller
      .actions()
      .find((entry) => entry.id === `document.${id}`)
      ?.capture();
    const state = action?.getState(args);
    return (
      <button
        type="button"
        key={`${id}-${cn}`}
        data-action-id={`document.${id}`}
        disabled={disabled || !state?.enabled}
        title={
          disabled
            ? text('请先选择行或列', 'Select rows or columns first')
            : undefined
        }
        onClick={() => action && void run(action, args)}
      >
        {text(cn, en)}
      </button>
    );
  };
  const selectedStart = scope?.kind === 'row' ? scope.top : (scope?.left ?? 0);
  const menuContent = visible && scope && (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The dialog navigates between its child buttons with arrow keys.
    <div
      className="document-block-popover document-table-menu"
      ref={menu}
      role="dialog"
      tabIndex={-1}
      aria-label={text(
        scope.kind === 'table'
          ? '表格操作'
          : scope.kind === 'row'
            ? '行操作'
            : '列操作',
        scope.kind === 'table'
          ? 'Table options'
          : scope.kind === 'row'
            ? 'Row options'
            : 'Column options',
      )}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        ];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        event.preventDefault();
        buttons[
          (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
            buttons.length
        ]?.focus();
      }}
    >
      {scope.kind !== 'column' && (
        <>
          {item('add-row-before', '上方插入行', 'Insert row above')}
          {item('add-row-after', '下方插入行', 'Insert row below')}
        </>
      )}
      {scope.kind !== 'row' && (
        <>
          {item('add-column-before', '左侧插入列', 'Insert column left')}
          {item('add-column-after', '右侧插入列', 'Insert column right')}
        </>
      )}
      {scope.kind === 'row' && (
        <>
          {item('move-row', '上移行', 'Move rows up', {
            toIndex: selectedStart - 1,
          })}
          {item('move-row', '下移行', 'Move rows down', {
            toIndex: selectedStart + 1,
          })}
          {item('delete-row', '删除行', 'Delete rows')}
        </>
      )}
      {scope.kind === 'column' && (
        <>
          {item('move-column', '左移列', 'Move columns left', {
            toIndex: selectedStart - 1,
          })}
          {item('move-column', '右移列', 'Move columns right', {
            toIndex: selectedStart + 1,
          })}
          {item('delete-column', '删除列', 'Delete columns')}
        </>
      )}
      {scope.kind === 'table' ? (
        <>
          <hr />
          {item('delete-row', '删除行', 'Delete rows', undefined, true)}
          {item('delete-column', '删除列', 'Delete columns', undefined, true)}
          {item('move-row', '上移行', 'Move rows up', { toIndex: 0 }, true)}
          {item('move-row', '下移行', 'Move rows down', { toIndex: 0 }, true)}
          {item(
            'move-column',
            '左移列',
            'Move columns left',
            { toIndex: 0 },
            true,
          )}
          {item(
            'move-column',
            '右移列',
            'Move columns right',
            { toIndex: 0 },
            true,
          )}
          <span className="document-block-caption">
            {text('请先选择行或列', 'Select rows or columns first')}
          </span>
          <hr />
          {item('toggle-header-row', '表头行', 'Header row')}
          {item('toggle-header-column', '表头列', 'Header column')}
          <hr />
          {item('anchor-block', '复制表格链接', 'Copy table link')}
          {item('block-duplicate', '复制表格', 'Duplicate table')}
          {item('block-up', '整表上移', 'Move table up')}
          {item('block-down', '整表下移', 'Move table down')}
          {item('delete-table', '删除表格', 'Delete table')}
        </>
      ) : (
        <>
          <hr />
          <button type="button" onClick={() => select('table')}>
            {text('全选表格', 'Select table')}
          </button>
        </>
      )}
    </div>
  );
  const shell = editor.view.dom.closest('.board-document-editor');
  return (
    <>
      {geometry &&
        shell &&
        createPortal(
          <div className="document-table-controls" ref={controls}>
            {(['row', 'column'] as const).flatMap((axis) =>
              (axis === 'row' ? geometry.rows : geometry.columns).map(
                (rect, index) => {
                  const top =
                    axis === 'row'
                      ? rect.top + rect.height / 2 - 8
                      : geometry.rect.top - 18;
                  const left =
                    axis === 'column'
                      ? rect.left + rect.width / 2 - 8
                      : Math.max(geometry.rect.left, geometry.clip.left) - 18;
                  if (
                    (axis === 'row' &&
                      (top < geometry.clip.top ||
                        top + 16 > geometry.clip.bottom)) ||
                    (axis === 'column' &&
                      (left < geometry.clip.left ||
                        left + 16 > geometry.clip.right))
                  )
                    return null;
                  return (
                    <button
                      type="button"
                      className="document-table-handle"
                      data-visible={
                        target?.start === geometry.start &&
                        target[axis] === index
                          ? ''
                          : undefined
                      }
                      key={`${axis}-${index}`}
                      aria-label={text(
                        `选择第 ${index + 1} ${axis === 'row' ? '行' : '列'}`,
                        `Select ${axis} ${index + 1}`,
                      )}
                      aria-haspopup="dialog"
                      style={{ left, top }}
                      onPointerDown={(event) => startDrag(event, axis, index)}
                      onPointerMove={moveDrag}
                      onPointerUp={finishDrag}
                      onPointerCancel={stopDrag}
                      onLostPointerCapture={stopDrag}
                      onClick={(event) => {
                        if (!suppressClick.current) {
                          select(axis, index, event.shiftKey);
                          focusRequested.current = true;
                        }
                        suppressClick.current = false;
                      }}
                    >
                      {axis === 'row' ? (
                        <GripVertical size={12} />
                      ) : (
                        <GripHorizontal size={12} />
                      )}
                    </button>
                  );
                },
              ),
            )}
            {drop && (
              <div
                className="document-table-drop-line"
                aria-hidden="true"
                style={{
                  left: drop.left,
                  top: drop.top,
                  width: drop.width,
                  height: drop.height,
                }}
              />
            )}
          </div>,
          shell,
        )}
      {menuContent && createPortal(menuContent, host)}
    </>
  );
}
