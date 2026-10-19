import { useEffect, useRef } from 'react';
import {
  registerUmlCells,
  layoutUmlCells,
  umlClassMetrics,
  layoutUmlEdges,
  layoutUmlSequence,
  moveUmlEvent,
  sequenceEventLocations,
} from '@sue/board-uml';
import {
  isNodeCell,
  type CellRegistry,
  type NodeCell,
  type EdgeCell,
  type UmlClassData,
  type UmlParticipantData,
  type UmlFragmentData,
} from '@sue/board-core';
import type {
  FrameRenderContext,
  FrameRenderExtension,
} from '@sue/board-react';
function UmlShape(context: FrameRenderContext) {
  const { cell, geometry: b, store, frameId } = context;
  if (!isNodeCell(cell) || !b) return null;
  const stroke = cell.appearance?.strokeColor ?? '#475569',
    fill = cell.appearance?.fill ?? '#ffffff';
  if (cell.kind === 'uml-class') {
    const data = cell.data as UmlClassData,
      metrics = umlClassMetrics({
        ...cell,
        geometry: b,
      } as NodeCell<UmlClassData>),
      divider = b.y + metrics.divider;
    return (
      <g data-uml-class>
        <rect
          {...{ x: b.x, y: b.y, width: b.width, height: b.height }}
          fill={fill}
          stroke={stroke}
        />
        <path
          d={`M ${b.x} ${b.y + 54} H ${b.x + b.width} M ${b.x} ${divider} H ${b.x + b.width}`}
          stroke={stroke}
        />
        {data.classifier !== 'class' && (
          <text
            x={b.x + b.width / 2}
            y={b.y + 17}
            fontSize={12}
            textAnchor="middle"
            stroke="none"
            fill={stroke}
          >{`«${data.classifier}»`}</text>
        )}
        {[...metrics.attributes, ...metrics.methods].map((row, i) => (
          <foreignObject
            key={i}
            x={b.x + 10}
            y={b.y + row.y + 2}
            width={Math.max(1, b.width - 20)}
            height={row.height}
            stroke="none"
          >
            <div
              style={{
                fontSize: 14,
                lineHeight: '24px',
                color: stroke,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              {row.text}
            </div>
          </foreignObject>
        ))}
      </g>
    );
  }
  if (cell.kind === 'uml-participant') {
    const actor = (cell.data as UmlParticipantData).actorType === 'actor',
      cx = b.x + b.width / 2;
    const layout = layoutUmlSequence(store, frameId);
    return (
      <g data-uml-lifeline>
        <line
          x1={cx}
          x2={cx}
          y1={b.y + (actor ? 84 : 65)}
          y2={b.y + b.height}
          stroke={stroke}
          strokeDasharray="6 5"
        />
        {actor ? (
          <g fill="none" stroke={stroke}>
            <circle cx={cx} cy={b.y + 10} r={8} />
            <path
              d={`M ${cx} ${b.y + 18} v 18 m -20 -10 h 40 m -20 10 l -15 14 m 15 -14 l 15 14`}
            />
          </g>
        ) : (
          <rect
            x={b.x}
            y={b.y}
            width={b.width}
            height={52}
            fill={fill}
            stroke={stroke}
          />
        )}{' '}
        {layout.activations
          .filter((a) => a.participantId === cell.id)
          .map((a) => (
            <rect
              key={a.startId}
              data-uml-activation={a.startId}
              x={a.x}
              y={a.y}
              width={a.width}
              height={a.height}
              fill={fill}
              stroke={stroke}
              onPointerDown={(e) => {
                e.stopPropagation();
                context.select();
              }}
            >
              <title>Activation</title>
            </rect>
          ))}
      </g>
    );
  }
  if (cell.kind === 'uml-fragment') {
    const data = cell.data as UmlFragmentData,
      layout = layoutUmlSequence(store, frameId);
    return (
      <g
        data-uml-fragment
        fill="none"
        stroke={stroke}
        pointerEvents="visiblePainted"
      >
        <rect x={b.x} y={b.y} width={b.width} height={b.height} />
        <path d={`M ${b.x} ${b.y + 28} h 65 l 12 -12 v -16`} />
        <text
          x={b.x + 8}
          y={b.y + 20}
          fill={stroke}
          stroke="none"
          fontSize={14}
        >
          {data.operator}
        </text>
        {data.operands.map((operand, i) => {
          const row = layout.branches.get(operand.id);
          return (
            row && (
              <g key={operand.id}>
                {i > 0 && (
                  <line
                    x1={b.x}
                    x2={b.x + b.width}
                    y1={row.y}
                    y2={row.y}
                    strokeDasharray="5 4"
                  />
                )}
                <text
                  x={b.x + 14}
                  y={row.y + 20}
                  fill={stroke}
                  stroke="none"
                  fontSize={14}
                >{`[${operand.guard}]`}</text>
              </g>
            )
          );
        })}
      </g>
    );
  }
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.width}
      height={b.height}
      fill={cell.appearance?.fill ?? '#fef9c3'}
      stroke={stroke}
    />
  );
}
function MessageDrag(context: FrameRenderContext) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cleanup.current?.(), []);
  if (
    (!context.selected && !context.hovered) ||
    context.readonly ||
    context.pending
  )
    return null;
  const layout = layoutUmlSequence(context.store, context.frameId),
    edge = layout.edges.get(context.cell.id);
  if (!edge || !('points' in edge.route) || !edge.route.points?.length)
    return null;
  const points = edge.route.points,
    x = (points[0][0] + points.at(-1)![0]) / 2,
    y = points[0][1];
  return (
    <g
      data-uml-message-drag
      role="button"
      aria-label="Reorder message"
      style={{ cursor: 'ns-resize' }}
      onPointerDown={(event) => {
        event.stopPropagation();
        context.select();
        if (event.button !== 0) return;
        const start = event.clientY;
        const up = (e: PointerEvent) => {
          cleanup.current?.();
          if (Math.abs(e.clientY - start) < 3) return;
          const targetY = y + (e.clientY - start) / context.scale;
          const locations = sequenceEventLocations(
            context.store,
            context.frameId,
          ).filter((location) => location.cellId !== context.cell.id);
          const next = locations.find(
            (location) =>
              (layout.rows.get(location.cellId) ?? Infinity) > targetY,
          );
          const branch = [...layout.branches]
            .filter(([, b]) => targetY >= b.y && targetY <= b.y + b.height)
            .sort((a, b) => a[1].height - b[1].height)[0];
          const operandId = branch?.[0] ?? next?.operandId;
          const current = sequenceEventLocations(
            context.store,
            context.frameId,
          ).find((location) => location.cellId === context.cell.id);
          const at =
            next && next.operandId === operandId
              ? next.at -
                (current &&
                current.operandId === operandId &&
                current.at < next.at
                  ? 1
                  : 0)
              : undefined;
          void context.dispatch({
            id: crypto.randomUUID(),
            operations: moveUmlEvent(
              context.store,
              context.frameId,
              context.cell.id,
              operandId,
              at,
            ),
          });
        };
        const cancel = () => {
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
        };
        cleanup.current?.();
        cleanup.current = cancel;
        window.addEventListener('pointerup', up, { once: true });
        window.addEventListener('pointercancel', cancel, { once: true });
      }}
    >
      <circle
        cx={x}
        cy={y}
        r={9 / context.scale}
        fill="#fff"
        stroke="#6366f1"
      />
      <path
        d={`M ${x} ${y - 5 / context.scale} v ${10 / context.scale} m ${-3 / context.scale} ${-7 / context.scale} l ${3 / context.scale} ${-3 / context.scale} l ${3 / context.scale} ${3 / context.scale}`}
        stroke="#6366f1"
        fill="none"
      />
    </g>
  );
}
export function createUmlFrameExtensions(
  registry: CellRegistry,
): FrameRenderExtension[] {
  registerUmlCells(registry);
  return [
    { layout: layoutUmlCells, layoutEdges: layoutUmlEdges },
    ...['uml-class', 'uml-participant', 'uml-note', 'uml-fragment'].map(
      (kind) => ({
        kind,
        renderShape: (context: FrameRenderContext) => <UmlShape {...context} />,
        textBounds: ({ cell, geometry }: FrameRenderContext) => {
          const b = geometry ?? (cell as NodeCell).geometry;
          if (kind === 'uml-fragment')
            return { x: b.x, y: b.y, width: 0, height: 0 };
          if (kind === 'uml-class')
            return {
              x: b.x,
              y:
                b.y +
                ((cell as NodeCell<UmlClassData>).data!.classifier === 'class'
                  ? 8
                  : 20),
              width: b.width,
              height: 34,
            };
          if (kind === 'uml-participant')
            return {
              x: b.x,
              y:
                b.y +
                ((cell as NodeCell<UmlParticipantData>).data!.actorType ===
                'actor'
                  ? 48
                  : 8),
              width: b.width,
              height: 36,
            };
          return b;
        },
      }),
    ),
    {
      kind: 'uml-message',
      renderControls: (context) => <MessageDrag {...context} />,
    },
  ];
}
