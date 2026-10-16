import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  isNodeCell,
  nodeShapeGeometry,
  type MindNodeData,
} from '@sue/board-core';
import {
  mindCellMetrics,
  mindNoteColor,
  type MindMetricsOptions,
} from '@sue/board-mind';
import {
  FrameRichText,
  measureBoardText,
  FrameTextEditor,
  type FrameRenderContext,
} from '@sue/board-react';
import {
  Alignment,
  isBoardTextDocument,
  sameBoardText,
  type BoardTextDocument,
} from '@sue/board-common';

const defaultMetricsOptions: MindMetricsOptions = {
  measureText: measureBoardText,
};
export const mindCellTextBounds = (
  { cell, geometry }: FrameRenderContext,
  options: MindMetricsOptions = defaultMetricsOptions,
) => {
  if (!isNodeCell(cell) || !geometry)
    return { x: 0, y: 0, width: 0, height: 0 };
  const metrics = mindCellMetrics(
    { ...cell, geometry },
    { ...options, width: geometry.width },
  );
  return {
    x: geometry.x,
    y: geometry.y + metrics.imageHeight + metrics.emojiHeight,
    width: geometry.width,
    height:
      geometry.height -
      metrics.imageHeight -
      metrics.emojiHeight -
      metrics.noteHeight,
  };
};

type MindTopicShapeProps = {
  metricsOptions: MindMetricsOptions;
  /** Resolved from the frame's mind scheme; passed so memo comparison sees it. */
  noteColor: string;
} & Pick<
  FrameRenderContext,
  | 'cell'
  | 'geometry'
  | 'store'
  | 'readonly'
  | 'pending'
  | 'select'
  | 'dispatch'
  | 'history'
>;
function MindTopicShape(context: MindTopicShapeProps) {
  const latest = useRef(context);
  latest.current = context;
  const select = useCallback(() => latest.current.select(), []);
  const dispatch = useCallback(
    (...args: Parameters<MindTopicShapeProps['dispatch']>) =>
      latest.current.dispatch(...args),
    [],
  );
  const history = useCallback(
    (...args: Parameters<MindTopicShapeProps['history']>) =>
      latest.current.history(...args),
    [],
  );
  return (
    <MindTopicContent
      metricsOptions={context.metricsOptions}
      cell={context.cell}
      geometry={context.geometry}
      noteColor={context.noteColor}
      readonly={context.readonly}
      pending={context.pending}
      latest={latest}
      select={select}
      dispatch={dispatch}
      history={history}
    />
  );
}
const MindTopicContent = memo(function MindTopicContent(
  context: Omit<MindTopicShapeProps, 'store'> & {
    latest: RefObject<MindTopicShapeProps>;
  },
) {
  const noteStyle = {
    fontSize: 13,
    color: context.noteColor,
    pointerEvents: 'auto',
    alignItems: 'flex-start',
  } as const;
  const { cell, geometry } = context;
  const [zoom, setZoom] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const metrics = useMemo(
    () =>
      isNodeCell(cell) && geometry
        ? mindCellMetrics(
            { ...cell, geometry },
            { ...context.metricsOptions, width: geometry.width },
          )
        : undefined,
    [cell, geometry, context.metricsOptions],
  );
  const parts = useMemo(
    () =>
      geometry
        ? nodeShapeGeometry(geometry.outline ?? 'roundRectangle')?.parts?.(
            geometry,
          )
        : undefined,
    [geometry],
  );
  if (!isNodeCell(cell) || !geometry || !metrics) return null;
  const data = cell.data as MindNodeData | undefined;
  const commitNote = (text: BoardTextDocument) => {
    const latest = context.latest.current.store.cells[cell.id];
    if (!isNodeCell(latest)) return;
    const previous = (latest.data as MindNodeData | undefined)?.note;
    if (isBoardTextDocument(previous) && sameBoardText(previous, text)) return;
    return context.dispatch({
      id: crypto.randomUUID(),
      operations: [
        {
          type: 'replace_cell',
          cell: {
            ...latest,
            data: { ...(latest.data as object), note: text },
          },
        },
      ],
    });
  };
  return (
    <>
      {(typeof geometry.outline === 'object'
        ? geometry.outline.kind
        : geometry.outline) === 'underline' && (
        <rect
          data-frame-export-exclude
          data-mind-hit-box
          x={geometry.x}
          y={geometry.y}
          width={geometry.width}
          height={geometry.height}
          fill="transparent"
          stroke="none"
        />
      )}
      {parts?.map((part, index) => (
        <path key={index} d={part.d} fill={part.fill} />
      ))}
      {data?.image && (
        <image
          data-mind-image
          href={data.image.url}
          x={geometry.x + (geometry.width - metrics.imageWidth) / 2}
          y={geometry.y + 4}
          width={metrics.imageWidth}
          height={Math.max(1, metrics.imageHeight - 8)}
          preserveAspectRatio="xMidYMid meet"
          style={{ cursor: 'zoom-in' }}
          onPointerDown={(event) => {
            event.stopPropagation();
            setZoom(true);
          }}
        />
      )}
      {!!metrics.emojiHeight && (
        <foreignObject
          data-mind-emojis
          x={geometry.x + 8}
          y={geometry.y + metrics.imageHeight}
          width={Math.max(1, geometry.width - 16)}
          height={metrics.emojiHeight}
          stroke="none"
        >
          <div
            style={{
              fontSize: 18,
              lineHeight: '24px',
              textAlign: 'center',
              overflowWrap: 'anywhere',
            }}
          >
            {data?.emojis?.map((emoji) => emoji.name).join(' ')}
          </div>
        </foreignObject>
      )}
      {isBoardTextDocument(data?.note) && !data?.noteCollapsed && (
        <foreignObject
          data-mind-note
          x={geometry.x + 8}
          y={geometry.y + geometry.height - metrics.noteHeight}
          width={Math.max(1, geometry.width - 16)}
          height={Math.max(1, metrics.noteHeight - 4)}
          stroke="none"
          onPointerDown={(event) => {
            event.stopPropagation();
            context.select();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            if (!context.readonly && !context.pending) setEditingNote(true);
          }}
        >
          {editingNote ? (
            <FrameTextEditor
              text={data.note}
              defaultAlign={Alignment.left}
              style={noteStyle}
              mode="block"
              readonly={context.readonly || context.pending}
              onClose={() => setEditingNote(false)}
              onHistory={context.history}
              onChange={({ newText }) => commitNote(newText)}
            />
          ) : (
            <FrameRichText
              text={data.note}
              defaultAlign={Alignment.left}
              style={noteStyle}
            />
          )}
        </foreignObject>
      )}
      {zoom &&
        data?.image &&
        createPortal(
          // The overlay closes when the backdrop is clicked.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            role="dialog"
            aria-label="Mind image"
            onClick={() => setZoom(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 80,
              display: 'grid',
              placeItems: 'center',
              background: '#0f172acc',
            }}
          >
            <img
              alt=""
              src={data.image.url}
              style={{ maxWidth: '90vw', maxHeight: '90vh' }}
            />
          </div>,
          document.body,
        )}
    </>
  );
});

export const renderMindCellShape = (
  context: FrameRenderContext,
  options: MindMetricsOptions = defaultMetricsOptions,
) => (
  <MindTopicShape
    metricsOptions={options}
    cell={context.cell}
    geometry={context.geometry}
    store={context.store}
    readonly={context.readonly}
    pending={context.pending}
    select={context.select}
    dispatch={context.dispatch}
    history={context.history}
    noteColor={mindNoteColor(context.store, context.cell.id, context.frameId)}
  />
);
