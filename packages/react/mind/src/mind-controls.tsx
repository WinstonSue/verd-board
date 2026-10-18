import { isNodeCell } from '@sue/board-core';
import {
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
    !['mind-root', 'mind-child'].includes(cell.kind)
  )
    return null;
  const children = mindChildIds(store, cell.id);
  const collapsed = !!(cell.data as { collapsed?: boolean } | undefined)
    ?.collapsed;
  if (!children.length || (!collapsed && !context.hovered && !context.selected))
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
  const label = collapsed ? 'Expand child topics' : 'Collapse child topics';
  const toggle = () => {
    if (context.pending) return;
    const latest = store.cells[cell.id];
    if (!isNodeCell(latest)) return;
    context.select();
    void context.dispatch({
      id: crypto.randomUUID(),
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...latest,
            data: {
              ...(latest.data as object),
              collapsed: !(latest.data as { collapsed?: boolean } | undefined)
                ?.collapsed,
            },
          },
        },
      ],
    });
  };
  return (
    <g data-mind-controls={cell.id}>
      <g
        data-mind-fold={cell.id}
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-disabled={context.pending}
        style={{ cursor: 'pointer' }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.ownerSVGElement?.focus();
          toggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          toggle();
        }}
      >
        <title>
          {collapsed
            ? `${label} (${mindDescendantCount(store, cell.id)})`
            : label}
        </title>
        <circle
          cx={point[0]}
          cy={point[1]}
          r={radius}
          fill="#fff"
          stroke="#6366f1"
        />
        <path
          d={`M ${point[0] - radius / 2} ${point[1]} H ${point[0] + radius / 2}${collapsed ? ` M ${point[0]} ${point[1] - radius / 2} V ${point[1] + radius / 2}` : ''}`}
          stroke="#6366f1"
          strokeWidth={1.5 / Math.max(0.02, context.scale)}
        />
      </g>
    </g>
  );
};
