import { createUmlFrameExtensions } from '@sue/board-react-uml';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FrameCanvas,
  type FrameCanvasController,
  type FrameDocumentReferences,
} from '@sue/board-react';
import { createCellRegistry, type FrameSnapshot } from '@sue/board-core';
import { registerDrawCells } from '@sue/board-draw';
import { createMindFrameExtensions } from '@sue/board-react-mind';
import { createWorkflowFrameExtensions } from '@sue/board-react-workflow';
import { createArchitectureFrameExtensions } from '@sue/board-react-architecture';
import { measureBoardText } from '@sue/board-react-text';
import { frameDrawExtensions } from './frame-draw-extension';

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
  const controller = useRef<FrameCanvasController>(null);
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const registry = useMemo(() => {
    const result = createCellRegistry();
    registerDrawCells(result);
    return result;
  }, []);
  const extensions = useMemo(
    () => [
      ...createMindFrameExtensions(registry, {
        measureText: (text, width, size) =>
          measureBoardText(text, width, size, 'system-ui, sans-serif'),
      }),
      ...createWorkflowFrameExtensions(registry),
      ...createArchitectureFrameExtensions(registry),
      ...createUmlFrameExtensions(registry),
      ...frameDrawExtensions,
    ],
    [registry],
  );
  useEffect(() => {
    const fit = () => {
      const svg = container.current?.querySelector('svg');
      const bounds = svg?.getBoundingClientRect();
      // An SVG inside a document card inherits the outer canvas transform.
      // Match its user units to the measured viewport before fitting, so the
      // preview fills the card at any outer zoom instead of scaling twice.
      if (svg && bounds && bounds.width > 0 && bounds.height > 0)
        svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
      controller.current?.fit();
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
  }, [value, frameId]);
  return (
    <div
      ref={container}
      data-reference-pending={exporting && !ready ? 'true' : undefined}
      style={{ height: '100%', width: '100%', pointerEvents: 'none' }}
    >
      <FrameCanvas
        ref={controller}
        value={value}
        frameId={frameId}
        registry={registry}
        extensions={extensions}
        documentReferences={documentReferences}
        readonly
        suspended
        exporting={exporting}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
