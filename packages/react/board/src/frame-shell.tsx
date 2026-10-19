import {
  useId,
  type ReactNode,
  type PointerEventHandler,
  type MouseEventHandler,
} from 'react';
import {
  frameContentViewport,
  frameTitleBounds,
  type NodeAppearance,
  type NodeGeometry,
} from '@sue/board-core';
import { FrameCellShadow } from './frame-shadow';

/** One shell and geometry contract for owned Frames and canvas/document references. */
export function FrameShell({
  geometry,
  appearance,
  active,
  unresolved = false,
  titleId,
  title,
  titleHidden,
  actions,
  onPointerDown,
  onDoubleClick,
  onTitleDoubleClick,
  children,
}: {
  geometry: NodeGeometry;
  appearance?: NodeAppearance;
  active: boolean;
  unresolved?: boolean;
  titleId?: string;
  title: ReactNode;
  titleHidden?: boolean;
  actions?: ReactNode;
  onPointerDown: PointerEventHandler<SVGElement>;
  onDoubleClick?: MouseEventHandler<SVGElement>;
  onTitleDoubleClick?: MouseEventHandler<SVGElement>;
  children: ReactNode;
}) {
  const scope = `frame-shell-${useId().replace(/:/g, '')}`;
  const bounds = {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };
  const titleBounds = frameTitleBounds(geometry);
  const content = frameContentViewport(geometry);
  const actionWidth = actions ? Math.min(64, titleBounds.width) : 0;
  const textBounds = {
    ...titleBounds,
    width: Math.max(0, titleBounds.width - (actions ? actionWidth + 8 : 0)),
  };
  const stroke = active ? '#6366f1' : (appearance?.strokeColor ?? '#cbd5e1');
  return (
    <>
      <FrameCellShadow shadow={appearance?.shadow} bounds={geometry}>
        {(filter) => (
          <rect
            {...bounds}
            rx={12}
            data-frame-shell
            data-frame-active={active ? 'true' : 'false'}
            filter={filter}
            fill={appearance?.fill ?? '#fff'}
            opacity={appearance?.opacity}
            stroke="none"
            onPointerDown={onPointerDown}
            onDoubleClick={onDoubleClick}
          />
        )}
      </FrameCellShadow>
      <defs>
        <clipPath id={`${scope}-outer`}>
          <rect {...bounds} rx={12} />
        </clipPath>
        <clipPath id={`${scope}-content`}>
          <rect {...content} />
        </clipPath>
      </defs>
      <g data-frame-header clipPath={`url(#${scope}-outer)`}>
        <rect
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={Math.max(0, content.y - geometry.y)}
          fill="#f1f5f9"
          opacity={appearance?.opacity}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
        />
        <g
          data-frame-title-id={titleId}
          style={{ cursor: 'move' }}
          onPointerDown={onPointerDown}
          onDoubleClick={onTitleDoubleClick}
        >
          <rect
            {...textBounds}
            fill="transparent"
            stroke="none"
            pointerEvents="all"
          />
          <foreignObject
            {...textBounds}
            stroke="none"
            data-frame-title-text
            style={{
              visibility: titleHidden ? 'hidden' : undefined,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {title}
          </foreignObject>
        </g>
        {actions && (
          <foreignObject
            x={titleBounds.x + titleBounds.width - actionWidth}
            y={titleBounds.y}
            width={actionWidth}
            height={titleBounds.height}
            data-frame-export-exclude
            data-document-header-actions
          >
            <div
              style={{
                height: '100%',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 4,
                pointerEvents: 'auto',
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => event.stopPropagation()}
            >
              {actions}
            </div>
          </foreignObject>
        )}
      </g>
      <g data-frame-contents clipPath={`url(#${scope}-content)`}>
        <rect
          {...content}
          data-frame-content-plate
          fill="transparent"
          stroke="none"
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
        />
        {content.width > 0 && content.height > 0 ? children : null}
      </g>
      {/* Paint the complete border last: header fills and HTML cannot cover it. */}
      <rect
        {...bounds}
        rx={12}
        data-frame-outline
        fill="none"
        stroke={stroke}
        opacity={appearance?.opacity}
        strokeWidth={appearance?.strokeWidth ?? 1}
        strokeDasharray={
          unresolved || appearance?.strokeStyle === 'dashed'
            ? '8 4'
            : appearance?.strokeStyle === 'dotted'
              ? '2 4'
              : undefined
        }
        pointerEvents="none"
      />
    </>
  );
}
