import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import {
  isNodeCell,
  roundNodeDimensions,
  type NodeCell,
} from '@sue/board-core';
import {
  FrameRichText,
  FrameTextEditor,
  type FrameRenderContext,
} from '@sue/board-react';
import { createBlockText } from '@sue/board-common';
import {
  entryAt,
  entriesInRange,
  insertTableTrack,
  mergeTableRange,
  removeTableTrack,
  resizeTableTrack,
  setSwimlaneCount,
  setSwimlaneHeader,
  splitTableEntry,
  tableGrid,
  tableResizeSegments,
  tableOperations,
  tableSelectionRange,
  transposeSwimlane,
  updateTableEntries,
  updateTableText,
  type TableCellData,
  type TableTrack,
} from '@sue/board-draw';
const allocate = () => crypto.randomUUID();
type FrameTableProps = Pick<
  FrameRenderContext,
  | 'cell'
  | 'geometry'
  | 'selected'
  | 'readonly'
  | 'pending'
  | 'dispatch'
  | 'preview'
  | 'select'
  | 'history'
>;
export function FrameTable(context: FrameRenderContext) {
  return (
    <FrameTableBody
      cell={context.cell}
      geometry={context.geometry}
      selected={context.selected}
      readonly={context.readonly}
      pending={context.pending}
      dispatch={context.dispatch}
      preview={context.preview}
      select={context.select}
      history={context.history}
    />
  );
}
const FrameTableBody = memo(function FrameTableBody(context: FrameTableProps) {
  const { cell, geometry, selected, readonly, pending, dispatch } = context;
  const [anchor, setAnchor] = useState<string>();
  const [focus, setFocus] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [preview, setPreview] = useState<NodeCell<TableCellData>>();
  const selecting = useRef(false);
  useEffect(() => {
    if (context.preview) return;
    const end = () => {
      selecting.current = false;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [context.preview]);
  const root = useRef<SVGGElement>(null);
  const resize = useRef<
    | {
        axis: TableTrack;
        index: number;
        start: number;
        size: number;
        cell: NodeCell<TableCellData>;
        matrix: DOMMatrix;
        sx: number;
        sy: number;
      }
    | undefined
  >(undefined);
  const live = useRef(context);
  live.current = context;
  const bounds = useMemo(
    () =>
      isNodeCell(cell) && geometry
        ? preview
          ? {
              ...geometry,
              width:
                (geometry.width * preview.geometry.width) / cell.geometry.width,
              height:
                (geometry.height * preview.geometry.height) /
                cell.geometry.height,
            }
          : geometry
        : undefined,
    [cell, geometry, preview],
  );
  const stableGrid = useMemo(
    () =>
      isNodeCell(cell) && bounds
        ? tableGrid((preview ?? cell) as NodeCell<TableCellData>, bounds)
        : undefined,
    [cell, bounds, preview],
  );
  if (!isNodeCell(cell) || !geometry || !bounds || !stableGrid) return null;
  const table = (preview ?? cell) as NodeCell<TableCellData>,
    data = table.data;
  if (!data?.rows?.length || !data.columns.length || !data.cells.length)
    return null;
  const grid = stableGrid;
  const active =
    data.cells.find((entry) => entry.id === focus) ?? data.cells[0];
  const range = tableSelectionRange(
    data,
    anchor ?? active.id,
    focus ?? active.id,
  );
  const ids = entriesInRange(data, range).map((entry) => entry.id);
  const writable = !readonly && !pending && !cell.locked;
  const authored = (next: NodeCell<TableCellData> | undefined) => {
    if (
      !next ||
      !isNodeCell(cell) ||
      (next.geometry.width === cell.geometry.width &&
        next.geometry.height === cell.geometry.height)
    )
      return next;
    return { ...next, geometry: roundNodeDimensions(next.geometry) };
  };
  const commit = (next: NodeCell<TableCellData> | undefined) => {
    if (writable)
      void dispatch({
        id: allocate(),
        operations: tableOperations(authored(next), cell.id),
      });
  };
  const choose = (id: string, extend = false) => {
    if (context.preview) return;
    context.select();
    if (!extend || !anchor) setAnchor(id);
    setFocus(id);
    root.current?.focus();
  };
  const beginResize = (
    event: PointerEvent<SVGLineElement>,
    axis: TableTrack,
    index: number,
  ) => {
    if (!writable) return;
    const matrix = root.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.stopPropagation();
    event.preventDefault();
    context.select();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    resize.current = {
      axis,
      index,
      start: axis === 'row' ? point.y : point.x,
      size: (axis === 'row' ? grid.rows : grid.columns)[index],
      cell: cell as NodeCell<TableCellData>,
      matrix,
      sx: geometry.width / cell.geometry.width,
      sy: geometry.height / cell.geometry.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const copy = (event: React.ClipboardEvent<SVGGElement>) => {
    if (editing) return;
    event.stopPropagation();
    event.preventDefault();
    const text = Array.from({ length: range.bottom - range.top + 1 }, (_, y) =>
      Array.from({ length: range.right - range.left + 1 }, (_, x) => {
        const entry = entryAt(data, y + range.top, x + range.left);
        return entry?.rowId === data.rows[y + range.top].id &&
          entry.columnId === data.columns[x + range.left].id
          ? (entry.text?.plainText ?? '')
          : '';
      }).join('\t'),
    ).join('\n');
    event.clipboardData.setData('text/plain', text);
  };
  return (
    <g
      ref={root}
      role="grid"
      aria-label={cell.kind === 'swimlane' ? 'Swimlane' : 'Table'}
      tabIndex={context.preview ? undefined : 0}
      data-table-id={cell.id}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerUp={() => {
        selecting.current = false;
      }}
      onPointerCancel={() => {
        selecting.current = false;
        resize.current = undefined;
        setPreview(undefined);
      }}
      onKeyDown={(event) => {
        if (editing) return;
        const key = event.key;
        if (
          (event.ctrlKey || event.metaKey) &&
          ['c', 'v', 'x'].includes(key.toLowerCase())
        ) {
          event.stopPropagation();
          return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          ['z', 'y'].includes(key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
          context.history(
            event.shiftKey || key.toLowerCase() === 'y' ? 'redo' : 'undo',
          );
          return;
        }
        let r = data.rows.findIndex((row) => row.id === active.rowId),
          c = data.columns.findIndex((column) => column.id === active.columnId);
        if (
          ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(
            key,
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (key === 'Tab') {
            const position = Math.max(
              0,
              Math.min(
                data.rows.length * data.columns.length - 1,
                r * data.columns.length +
                  c +
                  (event.shiftKey ? -1 : (active.colspan ?? 1)),
              ),
            );
            r = Math.floor(position / data.columns.length);
            c = position % data.columns.length;
          } else if (key === 'ArrowUp') r--;
          else if (key === 'ArrowDown') r += active.rowspan ?? 1;
          else if (key === 'ArrowLeft') c--;
          else c += active.colspan ?? 1;
          const next = entryAt(
            data,
            Math.max(0, Math.min(data.rows.length - 1, r)),
            Math.max(0, Math.min(data.columns.length - 1, c)),
          );
          if (next) choose(next.id, key !== 'Tab' && event.shiftKey);
        } else if (
          writable &&
          (key === 'Enter' || key === 'F2') &&
          (cell.kind !== 'swimlane' || active.role !== 'body')
        ) {
          event.preventDefault();
          event.stopPropagation();
          setEditing(active.id);
        } else if (writable && (key === 'Delete' || key === 'Backspace')) {
          event.preventDefault();
          event.stopPropagation();
          commit({
            ...table,
            data: {
              ...data,
              cells: data.cells.map((entry) =>
                ids.includes(entry.id) && entry.text
                  ? { ...entry, text: createBlockText('') }
                  : entry,
              ),
            },
          });
        } else if (
          writable &&
          key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (cell.kind !== 'swimlane' || active.role !== 'body')
        ) {
          event.preventDefault();
          event.stopPropagation();
          commit(updateTableText(table, active.id, createBlockText(key)));
          setEditing(active.id);
        }
      }}
      onCopy={copy}
      onCut={(event) => {
        copy(event);
        if (!editing && writable)
          commit({
            ...table,
            data: {
              ...data,
              cells: data.cells.map((entry) =>
                ids.includes(entry.id) && entry.text
                  ? { ...entry, text: createBlockText('') }
                  : entry,
              ),
            },
          });
      }}
      onPaste={(event) => {
        if (editing || !writable) return;
        event.stopPropagation();
        event.preventDefault();
        const rows = event.clipboardData
          .getData('text/plain')
          .replace(/\r/g, '')
          .split('\n');
        let next = table;
        const applied = new Set<string>();
        rows.forEach((row, y) =>
          row.split('\t').forEach((value, x) => {
            const entry = entryAt(data, range.top + y, range.left + x);
            if (
              entry &&
              !applied.has(entry.id) &&
              (cell.kind !== 'swimlane' || entry.role !== 'body')
            ) {
              applied.add(entry.id);
              next = updateTableText(next, entry.id, createBlockText(value));
            }
          }),
        );
        commit(next);
      }}
    >
      {grid.entries.map(({ entry, x, y, width, height }) => {
        const vertical = entry.textDirection === 'vertical',
          edit = editing === entry.id && writable;
        const textWidth = Math.max(1, (vertical ? height : width) - 8),
          textHeight = Math.max(1, (vertical ? width : height) - 8);
        return (
          <g
            key={entry.id}
            role="gridcell"
            aria-selected={selected && ids.includes(entry.id)}
            data-table-entry={entry.id}
            data-table-role={entry.role}
            onPointerDown={(event) => {
              if (event.button !== 0 || editing === entry.id) return;
              event.stopPropagation();
              event.preventDefault();
              choose(entry.id, event.shiftKey);
              selecting.current = true;
            }}
            onPointerEnter={() => {
              if (selecting.current) setFocus(entry.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (
                writable &&
                (cell.kind !== 'swimlane' || entry.role !== 'body')
              ) {
                choose(entry.id);
                setEditing(entry.id);
              }
            }}
          >
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={entry.fill ?? cell.appearance?.fill ?? '#fff'}
            />
            {entry.text && (
              <g
                transform={
                  vertical
                    ? `translate(${x + width - 4} ${y + 4}) rotate(90)`
                    : `translate(${x + 4} ${y + 4})`
                }
              >
                <foreignObject
                  x={0}
                  y={0}
                  width={textWidth}
                  height={textHeight}
                  stroke="none"
                  style={{
                    overflow: edit ? 'visible' : 'hidden',
                    pointerEvents: edit ? 'auto' : 'none',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      color: '#0f172a',
                      overflow: edit ? 'visible' : 'hidden',
                    }}
                  >
                    {edit ? (
                      <FrameTextEditor
                        text={entry.text}
                        mode="block"
                        readonly={false}
                        onHistory={context.history}
                        onClose={() => setEditing(undefined)}
                        onChange={({ newText, width, height }) => {
                          const current = live.current
                            .cell as NodeCell<TableCellData>;
                          if (live.current.pending || live.current.readonly)
                            return Promise.resolve({
                              status: 'rejected' as const,
                            });
                          return live.current.dispatch({
                            id: allocate(),
                            operations: tableOperations(
                              updateTableText(
                                current,
                                entry.id,
                                newText,
                                width !== undefined && height !== undefined
                                  ? { width, height }
                                  : undefined,
                              ),
                              cell.id,
                            ),
                          });
                        }}
                      />
                    ) : (
                      <FrameRichText text={entry.text} />
                    )}
                  </div>
                </foreignObject>
              </g>
            )}
            {selected && ids.includes(entry.id) && !editing && (
              <rect
                x={x + 1}
                y={y + 1}
                width={Math.max(1, width - 2)}
                height={Math.max(1, height - 2)}
                fill="#6366f120"
                stroke="#6366f1"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
      {selected && writable && !editing && (
        <>
          <rect
            aria-label="Move table"
            data-table-move="true"
            x={bounds.x}
            y={bounds.y - 16}
            width={bounds.width}
            height={12}
            fill="#cbd5e1"
            stroke="none"
            style={{ cursor: 'move' }}
          />
          {(['row', 'column'] as const).flatMap((axis) =>
            (axis === 'row' ? grid.rows : grid.columns).flatMap(
              (_, index, tracks) => {
                const offset = tracks
                  .slice(0, index + 1)
                  .reduce((a, b) => a + b, 0);
                return tableResizeSegments(table, axis, index, bounds).map(
                  (segment, segmentIndex) => (
                    <line
                      key={`${axis}-${index}-${segmentIndex}`}
                      data-table-resize={`${axis}-${index}`}
                      x1={
                        axis === 'row'
                          ? bounds.x + segment.start
                          : bounds.x + offset
                      }
                      y1={
                        axis === 'row'
                          ? bounds.y + offset
                          : bounds.y + segment.start
                      }
                      x2={
                        axis === 'row'
                          ? bounds.x + segment.end
                          : bounds.x + offset
                      }
                      y2={
                        axis === 'row'
                          ? bounds.y + offset
                          : bounds.y + segment.end
                      }
                      stroke="transparent"
                      strokeWidth={8}
                      style={{
                        cursor: axis === 'row' ? 'row-resize' : 'col-resize',
                      }}
                      onPointerDown={(event) => beginResize(event, axis, index)}
                      onPointerMove={(event) => {
                        const drag = resize.current;
                        if (!drag) return;
                        event.stopPropagation();
                        const point = new DOMPoint(
                          event.clientX,
                          event.clientY,
                        ).matrixTransform(drag.matrix);
                        setPreview(
                          authored(
                            resizeTableTrack(
                              drag.cell,
                              drag.axis,
                              drag.index,
                              (drag.size +
                                (drag.axis === 'row' ? point.y : point.x) -
                                drag.start) /
                                (drag.axis === 'row' ? drag.sy : drag.sx),
                            ),
                          ),
                        );
                      }}
                      onPointerUp={(event) => {
                        if (!resize.current) return;
                        event.stopPropagation();
                        const drag = resize.current,
                          point = new DOMPoint(
                            event.clientX,
                            event.clientY,
                          ).matrixTransform(drag.matrix);
                        resize.current = undefined;
                        setPreview(undefined);
                        commit(
                          resizeTableTrack(
                            drag.cell,
                            drag.axis,
                            drag.index,
                            (drag.size +
                              (drag.axis === 'row' ? point.y : point.x) -
                              drag.start) /
                              (drag.axis === 'row' ? drag.sy : drag.sx),
                          ),
                        );
                      }}
                    />
                  ),
                );
              },
            ),
          )}
          <foreignObject
            x={bounds.x}
            y={bounds.y - 42}
            width={700}
            height={38}
            stroke="none"
            style={{ overflow: 'visible' }}
          >
            <div
              role="toolbar"
              aria-label="Table controls"
              style={{
                display: 'flex',
                width: 'max-content',
                gap: 4,
                padding: 4,
                background: '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                color: '#0f172a',
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <input
                type="color"
                aria-label="Cell fill"
                value={active.fill?.startsWith('#') ? active.fill : '#ffffff'}
                onChange={(event) =>
                  commit(
                    updateTableEntries(table, ids, {
                      fill: event.target.value,
                    }),
                  )
                }
              />
              <button
                onClick={() =>
                  commit(
                    updateTableEntries(table, ids, {
                      textDirection:
                        active.textDirection === 'vertical'
                          ? 'horizontal'
                          : 'vertical',
                    }),
                  )
                }
                aria-label="Cell text direction"
              >
                ↻ 文本
              </button>
              {cell.kind === 'swimlane' ? (
                <>
                  <select
                    aria-label="Swimlane direction"
                    value={data.direction}
                    onChange={(event) => {
                      if (event.target.value !== data.direction)
                        commit(transposeSwimlane(table));
                    }}
                  >
                    <option value="horizontal">水平</option>
                    <option value="vertical">垂直</option>
                  </select>
                  <label>
                    标题
                    <input
                      type="checkbox"
                      aria-label="Swimlane title"
                      checked={!!data.header}
                      onChange={(event) =>
                        commit(
                          setSwimlaneHeader(
                            table,
                            event.target.checked,
                            allocate,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    泳道
                    <input
                      type="number"
                      aria-label="Lane count"
                      min={1}
                      max={100}
                      value={
                        data.direction === 'vertical'
                          ? data.columns.length
                          : data.rows.length
                      }
                      onChange={(event) => {
                        const count = Number(event.target.value);
                        if (
                          Number.isInteger(count) &&
                          count >= 1 &&
                          count <= 100
                        )
                          commit(setSwimlaneCount(table, count, allocate));
                      }}
                    />
                  </label>
                </>
              ) : (
                <>
                  <button
                    aria-label="Insert row"
                    onClick={() =>
                      commit(
                        insertTableTrack(
                          table,
                          'row',
                          range.bottom + 1,
                          allocate,
                        ),
                      )
                    }
                  >
                    + 行
                  </button>
                  <button
                    aria-label="Delete row"
                    onClick={() =>
                      commit(removeTableTrack(table, 'row', range.top))
                    }
                  >
                    − 行
                  </button>
                  <button
                    aria-label="Insert column"
                    onClick={() =>
                      commit(
                        insertTableTrack(
                          table,
                          'column',
                          range.right + 1,
                          allocate,
                        ),
                      )
                    }
                  >
                    + 列
                  </button>
                  <button
                    aria-label="Delete column"
                    onClick={() =>
                      commit(removeTableTrack(table, 'column', range.left))
                    }
                  >
                    − 列
                  </button>
                  <button
                    aria-label="Merge cells"
                    disabled={ids.length < 2}
                    onClick={() => commit(mergeTableRange(table, range))}
                  >
                    合并
                  </button>
                  <button
                    aria-label="Split cell"
                    disabled={!(active.rowspan! > 1 || active.colspan! > 1)}
                    onClick={() =>
                      commit(splitTableEntry(table, active.id, allocate))
                    }
                  >
                    拆分
                  </button>
                </>
              )}
            </div>
          </foreignObject>
        </>
      )}
    </g>
  );
});
