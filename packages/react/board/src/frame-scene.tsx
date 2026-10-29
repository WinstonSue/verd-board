import { useFrameTheme, useFrameAppearance } from './frame-theme';
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type ComponentProps,
} from 'react';
import { createInlineText } from '@sue/board-common';
import {
  frameContentViewport,
  isFrameCell,
  type BoardAppearance,
  type CellStore,
  type NodeGeometry,
  type Point,
  type FrameSnapshot,
  type CellRegistry,
} from '@sue/board-core';
import { ExternalLink } from 'lucide-react';
import {
  FrameScaleContent as InteractiveScale,
  FrameNodeAppearance as InteractiveAppearance,
} from './frame-camera-store';
import {
  FrameInteractiveEdge as InteractiveEdge,
  FrameStaticEdge,
} from './frame-edge-stroke';
import {
  createFrameLayouts,
  type FrameLayoutMemory,
} from './frame-scene-layout';
import type {
  FrameReferenceSource,
  FrameRenderExtension,
} from './frame-canvas';
import { FrameRichText, FrameRichTextPreviewContext } from './frame-rich-text';
import { FrameShell } from './frame-shell';
import { useFrameI18n } from './frame-i18n';
import { usePreviewMount } from './preview-mount';
import { useFramePaintVisibility } from './frame-content-visibility';

/** Static content never inherits its owner's editable runtime or camera subscriptions. */
export const FrameStaticSceneContext = createContext(false);
export function FrameScaleContent(
  props: ComponentProps<typeof InteractiveScale>,
) {
  return useContext(FrameStaticSceneContext) ? (
    props.render(1)
  ) : (
    <InteractiveScale {...props} />
  );
}
export function FrameNodeAppearance(
  props: ComponentProps<typeof InteractiveAppearance>,
) {
  return useContext(FrameStaticSceneContext) ? (
    props.render(props.compute(1))
  ) : (
    <InteractiveAppearance {...props} />
  );
}
export function FrameInteractiveEdge(
  props: ComponentProps<typeof InteractiveEdge>,
) {
  return useContext(FrameStaticSceneContext) ? (
    <FrameStaticEdge {...props} />
  ) : (
    <InteractiveEdge {...props} />
  );
}
const noSubscribe = () => () => {};
export const previewProjection = {
  identity: {},
  expandedCellIds: new Set<string>(),
  purpose: 'preview' as const,
};
export interface FrameStaticScene {
  appearance?: BoardAppearance;
  store: CellStore;
  layouts: ReturnType<typeof createFrameLayouts>;
  preview: boolean;
  static: boolean;
}
export function FrameScenePreview({
  source,
  fallback,
  targetFrameId,
  geometry,
  offsets,
  extensions,
  registry,
  exporting,
  render,
}: {
  source?: FrameReferenceSource;
  fallback: CellStore;
  targetFrameId: string;
  geometry: NodeGeometry;
  offsets?: ReadonlyMap<string, Point>;
  extensions?: readonly FrameRenderExtension[];
  registry: CellRegistry;
  exporting?: boolean;
  render(
    scene: FrameStaticScene,
    geometry: NodeGeometry,
    offsets?: ReadonlyMap<string, Point>,
  ): ReactNode;
}) {
  const appearance = useFrameAppearance();
  const theme = useFrameTheme();
  const viewport = useRef<SVGGElement>(null);
  // Electron 28's Chromium 120 raster path regresses dense dragging with an
  // independent SVG root. Keep its live flat scene until a runtime passes the
  // controlled performance gate; Web and newer candidates use the paint host.
  const isolatePaint = !/\bElectron\/28\./.test(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  );
  // Observe the HTML paint boundary: older Chromium cannot observe SVG groups.
  const visibilityViewport = useRef<HTMLDivElement>(null);
  const admitted = usePreviewMount({
    force: exporting,
    viewport: visibilityViewport,
    retain: true,
  });
  useFramePaintVisibility(viewport, {
    exporting,
    viewport: visibilityViewport,
  });
  const fallbackSnapshot = useMemo<FrameSnapshot | null>(
    () =>
      isFrameCell(fallback.cells[targetFrameId])
        ? { store: { ...fallback, rootId: targetFrameId } }
        : null,
    [fallback, targetFrameId],
  );
  const getSnapshot = () =>
    source ? source.getSnapshot(targetFrameId) : fallbackSnapshot;
  const snapshot = useSyncExternalStore(
    source?.subscribe ?? noSubscribe,
    getSnapshot,
    getSnapshot,
  );
  const memory = useRef(new Map<string, FrameLayoutMemory>());
  const painter = useRef(render);
  painter.current = render;
  const localGeometry = useMemo(
    () => ({
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    }),
    [geometry.x, geometry.y, geometry.width, geometry.height],
  );
  const offsetsKey = JSON.stringify([...(offsets ?? [])]);
  const localOffsets = useMemo(
    () => new Map<string, Point>(JSON.parse(offsetsKey)),
    [offsetsKey],
  );
  const layouts = useMemo(
    () =>
      !admitted || !snapshot
        ? undefined
        : createFrameLayouts(
            snapshot.store,
            extensions,
            undefined,
            targetFrameId,
            memory.current,
            registry,
            previewProjection,
          ),
    [admitted, snapshot, extensions, targetFrameId, registry],
  );
  const content = useMemo(() => {
    if (!snapshot || !layouts) return null;
    return painter.current(
      {
        store: snapshot.store,
        layouts,
        preview: false,
        static: true,
        appearance,
      },
      localGeometry,
      localOffsets,
    );
  }, [appearance, snapshot, layouts, localGeometry, localOffsets]);
  const bounds = frameContentViewport(geometry);
  const subject = (
    <FrameStaticSceneContext.Provider value={true}>
      <FrameRichTextPreviewContext.Provider value={true}>
        <g pointerEvents="none">
          {!snapshot && (
            <text
              data-frame-missing
              x={geometry.x + 28}
              y={geometry.y + 80}
              fill={theme.adaptive ? theme.secondaryText : '#64748b'}
              fontSize={14}
            >
              引用缺失 · {targetFrameId}
            </text>
          )}
          {content}
        </g>
      </FrameRichTextPreviewContext.Provider>
    </FrameStaticSceneContext.Provider>
  );
  return (
    <g
      ref={viewport}
      data-reference-preview={targetFrameId}
      data-reference-pending={exporting && !admitted ? 'true' : undefined}
    >
      {exporting ? (
        subject
      ) : !isolatePaint ? (
        <>
          <foreignObject
            {...bounds}
            pointerEvents="none"
            data-frame-export-exclude="visibility-observer"
          >
            <div
              ref={visibilityViewport}
              style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
            />
          </foreignObject>
          {subject}
        </>
      ) : bounds.width > 0 && bounds.height > 0 ? (
        <foreignObject
          {...bounds}
          pointerEvents="none"
          data-preview-paint-boundary
        >
          <div
            ref={visibilityViewport}
            style={{
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              contain: 'layout paint',
              pointerEvents: 'none',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="100%"
              height="100%"
              viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
              data-preview-viewport
              style={{
                display: 'block',
                pointerEvents: 'none',
                background: 'transparent',
              }}
            >
              {subject}
            </svg>
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}
export function FrameDetailsButton({
  onOpen,
  disabled = false,
}: {
  onOpen(): void;
  disabled?: boolean;
}) {
  const { language } = useFrameI18n();
  const label = language === 'zh' ? '打开详情' : 'Open details';
  return (
    <button
      type="button"
      className="workspace-reference-action"
      title={label}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
    >
      <ExternalLink size={16} aria-hidden />
    </button>
  );
}
export function FrameReferenceCard({
  id,
  targetId,
  geometry,
  title,
  document = false,
  source,
  getTitle,
  onOpen,
  actions,
  appearance,
  active = false,
  titleHidden,
  onPointerDown,
  onTitleDoubleClick,
}: {
  id: string;
  targetId: string;
  geometry: NodeGeometry;
  title?: string;
  document?: boolean;
  source?: FrameReferenceSource;
  getTitle?(): string | undefined;
  onOpen?(): void;
  actions?: ReactNode;
  appearance?: ComponentProps<typeof FrameShell>['appearance'];
  active?: boolean;
  titleHidden?: boolean;
  onPointerDown?: ComponentProps<typeof FrameShell>['onPointerDown'];
  onTitleDoubleClick?: ComponentProps<typeof FrameShell>['onTitleDoubleClick'];
}) {
  const { language } = useFrameI18n();
  const getSnapshot = () => {
    const target = source?.getSnapshot(targetId)?.store.cells[targetId];
    const documentTitle = getTitle?.();
    const missing = document
      ? !!getTitle && !documentTitle
      : !!source && !isFrameCell(target);
    const name =
      title ??
      documentTitle ??
      (isFrameCell(target)
        ? (target.name ?? target.content?.label ?? 'Frame')
        : undefined) ??
      (language === 'zh' ? '引用缺失' : 'Missing reference');
    return JSON.stringify([name, missing]);
  };
  const metadata = useSyncExternalStore(
    source?.subscribe ?? noSubscribe,
    getSnapshot,
    getSnapshot,
  );
  const [name, missing] = JSON.parse(metadata) as [string, boolean];
  const theme = useFrameTheme();
  const body = frameContentViewport(geometry);
  return (
    <g
      data-cell-id={id}
      data-cell-kind={document ? 'document-reference' : 'frame-reference'}
      data-reference-card={targetId}
    >
      <FrameShell
        geometry={geometry}
        scale={1}
        active={active}
        appearance={appearance}
        titleHidden={titleHidden}
        onTitleDoubleClick={onTitleDoubleClick}
        unresolved={missing}
        titleId={id}
        title={<FrameRichText text={createInlineText(name)} />}
        actions={
          actions ?? (onOpen ? <FrameDetailsButton onOpen={onOpen} /> : null)
        }
        onPointerDown={onPointerDown ?? (() => {})}
      >
        <rect
          {...body}
          fill={theme.adaptive ? theme.background : '#f8fafc'}
          stroke="none"
        />
        <text
          x={body.x + 12}
          y={body.y + Math.min(30, body.height / 2)}
          fill={theme.adaptive ? theme.secondaryText : '#64748b'}
          fontSize={14}
        >
          {language === 'zh'
            ? document
              ? '文档引用'
              : '图表引用'
            : document
              ? 'Document reference'
              : 'Frame reference'}
        </text>
      </FrameShell>
    </g>
  );
}
