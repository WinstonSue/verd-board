import { useFrameAppearance } from '@sue/board-react';
import { useAppearancePreference } from './appearance-preferences';
import { type FrameSnapshot } from '@sue/board-core';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameDocumentReferences,
} from '@sue/board-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canvasPreviewSnapshot } from './canvas-preview-snapshot';
import { createVerdFramePluginSet } from './frame-plugins';

/** A private read-only runtime: never mounts a workspace editing occurrence. */
export function CanvasPreview({
  value,
  frameId,
  documentReferences,
  exporting = false,
}: {
  value: FrameSnapshot;
  frameId: string;
  documentReferences?: FrameDocumentReferences;
  exporting?: boolean;
}) {
  const inheritedAppearance = useFrameAppearance();
  const { appearance } = useAppearancePreference();
  const controller = useRef<FrameCanvasController>(null);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const previousSnapshot = useRef<FrameSnapshot | undefined>(undefined);
  const preview = useMemo(
    () => canvasPreviewSnapshot(value.store, frameId, previousSnapshot.current),
    [value.store, frameId],
  );
  previousSnapshot.current = preview;
  const pluginSet = useMemo(() => createVerdFramePluginSet(), []);
  useEffect(() => {
    const fit = () => {
      const svg = container.current?.querySelector('svg');
      const bounds = svg?.getBoundingClientRect();
      // An SVG inside a document card inherits the outer canvas transform.
      // Match its user units to the measured viewport before fitting, so the
      // preview fills the card at any outer zoom instead of scaling twice.
      if (svg && bounds && bounds.width > 0 && bounds.height > 0)
        svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      controller.current?.executeAction('canvas.view.fit');
    };
    const raf = requestAnimationFrame(() => {
      fit();
      setReady(true);
    });
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (container.current) observer?.observe(container.current);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [preview, frameId]);
  return (
    <div
      ref={container}
      data-reference-pending={exporting && !ready ? 'true' : undefined}
      style={{ height: '100%', width: '100%', pointerEvents: 'none' }}
    >
      <FrameCanvas
        appearance={inheritedAppearance ?? appearance}
        ref={controller}
        value={preview}
        frameId={frameId}
        pluginSet={pluginSet}
        documentReferences={documentReferences}
        readonly
        suspended
        exporting={exporting}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
