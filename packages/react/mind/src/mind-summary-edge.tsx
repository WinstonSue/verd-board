import { memo, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  isEdgeCell,
  type EdgeCell,
  type MindSummaryData,
  type Point,
} from '@sue/board-core';
import { mindSummaryGeometry, setMindSummaryRange } from '@sue/board-mind';
import { useFrameSelection, type FrameRenderContext } from '@sue/board-react';

const VisibleBracket = memo(function VisibleBracket({
  path,
  stroke,
  width,
  style,
}: {
  path: string;
  stroke: string;
  width: number;
  style?: string;
}) {
  return (
    <path
      d={path}
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeDasharray={
        style === 'dashed' ? '8 4' : style === 'dotted' ? '2 4' : undefined
      }
    />
  );
});

export function MindSummaryEdge(context: FrameRenderContext) {
  const { store, cell, scale, getGeometry, dispatch } = context;
  const selection = useFrameSelection();
  const group = useRef<SVGGElement>(null);
  const drag = useRef<
    | {
        end: 'start' | 'end';
        matrix: DOMMatrix;
        edge: EdgeCell<MindSummaryData>;
        start: Point;
      }
    | undefined
  >(undefined);
  const [preview, setPreview] = useState<MindSummaryData>();
  const bracket = useMemo(
    () =>
      isEdgeCell(cell) && 'cellId' in cell.target
        ? mindSummaryGeometry(
            store,
            preview
              ? { ...cell, data: preview }
              : (cell as EdgeCell<MindSummaryData>),
            getGeometry,
          )
        : undefined,
    [store, cell, preview, getGeometry],
  );
  if (!isEdgeCell(cell) || !('cellId' in cell.target)) return null;
  const edge = cell as EdgeCell<MindSummaryData>;
  if (!bracket) return null;
  const selected =
    context.selected || selection.ids.includes(cell.target.cellId);
  const writable = !context.readonly && !context.pending && !cell.locked;
  const stroke = selected
    ? '#6366f1'
    : (cell.appearance?.strokeColor ?? '#64748b');
  const begin = (event: PointerEvent<SVGElement>, end: 'start' | 'end') => {
    if (!writable || event.button !== 0) return;
    const matrix = group.current?.getScreenCTM()?.inverse();
    if (!matrix) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.focus();
    context.select();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix,
    );
    drag.current = { end, matrix, edge, start: [point.x, point.y] };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<SVGElement>, finish = false) => {
    const state = drag.current;
    if (!state) return;
    event.stopPropagation();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      state.matrix,
    );
    if (
      Math.hypot(point.x - state.start[0], point.y - state.start[1]) * scale <
      2
    ) {
      if (finish) {
        drag.current = undefined;
        setPreview(undefined);
      }
      return;
    }
    const original = mindSummaryGeometry(store, state.edge, getGeometry);
    if (!original) return;
    const data = state.edge.data!,
      start = original.siblings.indexOf(data.startSiblingId),
      end = original.siblings.indexOf(data.endSiblingId);
    const candidates = original.siblings.filter(
      (id, index) =>
        original.branches.has(id) &&
        (state.end === 'start' ? index <= end : index >= start),
    );
    const distance = (id: string) => {
      const bounds = original.branches.get(id)!;
      return Math.hypot(
        Math.max(bounds.x - point.x, 0, point.x - bounds.x - bounds.width),
        Math.max(bounds.y - point.y, 0, point.y - bounds.y - bounds.height),
      );
    };
    const nearest = candidates.reduce(
      (best, id) => (distance(id) < distance(best) ? id : best),
      candidates[0],
    );
    if (!nearest) return;
    const next = {
      ...data,
      [state.end === 'start' ? 'startSiblingId' : 'endSiblingId']: nearest,
    };
    if (!finish) {
      setPreview(next);
      return;
    }
    drag.current = undefined;
    setPreview(undefined);
    if (
      next.startSiblingId !== data.startSiblingId ||
      next.endSiblingId !== data.endSiblingId
    )
      void dispatch({
        id: crypto.randomUUID(),
        operations: setMindSummaryRange(
          store,
          edge.id,
          next.startSiblingId,
          next.endSiblingId,
        ),
      });
  };
  const cancel = () => {
    drag.current = undefined;
    setPreview(undefined);
  };
  return (
    <g
      ref={group}
      data-mind-summary-bracket={cell.id}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <VisibleBracket
        path={bracket.path}
        stroke={stroke}
        width={cell.appearance?.strokeWidth ?? 2}
        style={cell.appearance?.strokeStyle}
      />
      <path
        d={bracket.path}
        fill="none"
        stroke="transparent"
        strokeWidth={12 / Math.max(0.02, scale)}
        data-edge-hit={cell.id}
      />
      {selected && writable && (
        <g data-frame-export-exclude fill="#fff" stroke="#6366f1">
          {(['start', 'end'] as const).map((end) => {
            const point: Point = bracket[end];
            return (
              <circle
                key={end}
                data-summary-handle={end}
                tabIndex={0}
                role="button"
                aria-label={`Summary range ${end}`}
                cx={point[0]}
                cy={point[1]}
                r={6 / Math.max(0.02, scale)}
                strokeWidth={1 / Math.max(0.02, scale)}
                style={{ cursor: 'grab' }}
                onPointerDown={(event) => begin(event, end)}
                onPointerMove={(event) => move(event)}
                onPointerUp={(event) => move(event, true)}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    cancel();
                    return;
                  }
                  const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key)
                    ? -1
                    : ['ArrowRight', 'ArrowDown'].includes(event.key)
                      ? 1
                      : 0;
                  if (!delta || !writable) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const data = edge.data!;
                  const key =
                    end === 'start' ? 'startSiblingId' : 'endSiblingId';
                  const index = bracket.siblings.indexOf(data[key]) + delta;
                  const min =
                      end === 'start'
                        ? 0
                        : bracket.siblings.indexOf(data.startSiblingId),
                    max =
                      end === 'start'
                        ? bracket.siblings.indexOf(data.endSiblingId)
                        : bracket.siblings.length - 1;
                  if (index < min || index > max) return;
                  const next = { ...data, [key]: bracket.siblings[index] };
                  void dispatch({
                    id: crypto.randomUUID(),
                    operations: setMindSummaryRange(
                      store,
                      edge.id,
                      next.startSiblingId,
                      next.endSiblingId,
                    ),
                  });
                }}
              />
            );
          })}
        </g>
      )}
    </g>
  );
}
