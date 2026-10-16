import { isNodeCell } from '@sue/board-core';
import {
  addMindChild,
  createMindChildCell,
  mindChildIds,
  mindDescendantCount,
  mindGrowthSide,
} from '@sue/board-mind';
import type { FrameRenderContext } from '@sue/board-react';

export const renderMindControls = (context: FrameRenderContext) => {
  const { cell, geometry, store } = context;
  if (
    !isNodeCell(cell) ||
    !geometry ||
    context.readonly ||
    (!context.hovered && !context.selected) ||
    !['mind-root', 'mind-child'].includes(cell.kind)
  )
    return null;
  const side = mindGrowthSide(store, cell.id);
  const pad = 22 / Math.max(0.02, context.scale);
  const point =
    side === 'left'
      ? [geometry.x - pad, geometry.y + geometry.height / 2]
      : side === 'right'
        ? [geometry.x + geometry.width + pad, geometry.y + geometry.height / 2]
        : side === 'top'
          ? [geometry.x + geometry.width / 2, geometry.y - pad]
          : [
              geometry.x + geometry.width / 2,
              geometry.y + geometry.height + pad,
            ];
  const radius = 11 / Math.max(0.02, context.scale);
  const children = mindChildIds(store, cell.id);
  const collapsed = !!(cell.data as { collapsed?: boolean } | undefined)
    ?.collapsed;
  const toggle = () => {
    const latest = store.cells[cell.id];
    if (!isNodeCell(latest)) return;
    void context.dispatch({
      id: crypto.randomUUID(),
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...latest,
            data: {
              ...(latest.data as object),
              collapsed: !collapsed,
            },
          },
        },
      ],
    });
  };
  return (
    <g data-mind-controls={cell.id}>
      <g
        data-mind-add={cell.id}
        style={{ cursor: 'pointer' }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (context.pending) return;
          const child = createMindChildCell(crypto.randomUUID());
          void context
            .dispatch({
              id: crypto.randomUUID(),
              operations: addMindChild(
                store,
                cell.id,
                child,
                crypto.randomUUID(),
              ),
            })
            .then((result) => {
              if (result.status === 'accepted') context.edit?.(child.id);
            });
        }}
      >
        <circle
          cx={point[0]}
          cy={point[1]}
          r={radius}
          fill="#fff"
          stroke="#6366f1"
        />
        <path
          d={`M ${point[0] - radius / 2} ${point[1]} H ${point[0] + radius / 2} M ${point[0]} ${point[1] - radius / 2} V ${point[1] + radius / 2}`}
          stroke="#6366f1"
          strokeWidth={1.5 / Math.max(0.02, context.scale)}
        />
      </g>
      {!!children.length && (
        <g
          data-mind-fold={cell.id}
          style={{ cursor: 'pointer' }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            toggle();
          }}
        >
          <circle
            cx={geometry.x + geometry.width - radius}
            cy={geometry.y + radius}
            r={radius * 0.8}
            fill="#fff"
            stroke="#64748b"
          />
          {collapsed && (
            <text
              x={geometry.x + geometry.width - radius}
              y={geometry.y + radius}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10 / Math.max(0.02, context.scale)}
              fill="#334155"
              stroke="none"
            >
              {mindDescendantCount(store, cell.id)}
            </text>
          )}
        </g>
      )}
    </g>
  );
};
