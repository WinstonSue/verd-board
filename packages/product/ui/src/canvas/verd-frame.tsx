import type { CellChange, FrameSnapshot } from '@sue/board-core';
import type { WorkspaceFileTarget } from '@sue/board-common';
import {
  measureBoardText,
  type FrameHistoryAdapter,
  type FrameInstanceHost,
  type FrameOpenSource,
  type FrameCanvasController,
  type FrameLinkHost,
} from '@sue/board-react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { LinkEditorHost } from '@sue/board-react-text';
import { useI18n } from '../i18n';
import { WorkspaceLinkEditor } from '../shared/workspace-link-editor';
import { createVerdFramePluginSet } from './frame-plugins';
import { FrameProductShell } from './frame-product-shell';
import { useMindMaxWidth } from '../shared/preferences/mind-preferences';
export interface VerdFrameProps {
  presentation?: {
    active: boolean;
    fullscreenRoot: import('react').RefObject<HTMLElement | null>;
    onChange(active: boolean): void;
    onBack?(): void;
  };
  documentReferences?: import('@sue/board-react').FrameDocumentReferences;
  onReferenceDocument?(): void;
  onCreateDocumentFrame?(): void;
  onExportNative?(): void;
  onOpenMy?(): void;
  value: FrameSnapshot;
  frameId: string;
  initialFocusCellId?: string;
  onChange(change: CellChange): void;
  onOpenFrame(frameId: string, source?: FrameOpenSource): void;
  instanceHost?: FrameInstanceHost;
  suspended?: boolean;
  placing?: boolean;
  onPlace?(point: [number, number]): void;
  onCancelPlace?(): void;
  onReferenceExisting?(): void;
  navigation?: {
    requestId: number;
    target: WorkspaceFileTarget;
    signal?: AbortSignal;
  };
  onNavigationResult?(
    requestId: number,
    result: { status: 'revealed' | 'unavailable' | 'cancelled'; code?: string },
  ): void;
  onReady?(controller: FrameCanvasController | null): void;
  linkHost?: FrameLinkHost;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  showSaveStatus?: boolean;
  lastSavedAt?: number;
  onRetrySave?(): void;
  detachedFrameIds?: string[];
  /** Legacy VerdBoard and Drawnix files. Parsing must not write storage. */
  parseLegacy?(definition: string, filename: string): Promise<FrameSnapshot>;
  /**
   * Workspace hook: duplicates each selected frame-reference's target
   * closure, breaking future sharing. Absent in single-file hosts.
   */
  onDuplicateReference?(refIds: string[]): void;
  /** Workspace-scoped mind default; explicit node widths always win. */
  mindDefaultWidth?: number;
  /**
   * Workspace history source. When provided, undo/redo shortcuts and buttons
   * delegate to the shared chronological history instead of the frame-local
   * runtime stack.
   */
  history?: FrameHistoryAdapter;
  readonly?: boolean;
}

/** Full-product preset. Minimal embedding uses FrameEditor from board-react. */
export function VerdFrame(props: VerdFrameProps) {
  const host = useContext(LinkEditorHost);
  const { language } = useI18n();
  const preference = useMindMaxWidth();
  const mindMaxWidth = props.mindDefaultWidth ?? preference;
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const changed = () => setFontRevision((value) => value + 1);
    document.addEventListener('board-text-fonts-changed', changed);
    return () =>
      document.removeEventListener('board-text-fonts-changed', changed);
  }, []);
  const pluginSet = useMemo(() => {
    void fontRevision;
    return createVerdFramePluginSet({
      mind: {
        maxNodeWidth: mindMaxWidth,
        measureText: (text, width, size) =>
          measureBoardText(text, width, size, 'system-ui, sans-serif'),
      },
    });
  }, [mindMaxWidth, fontRevision]);
  const content = (
    <FrameProductShell
      {...props}
      mindMaxWidth={mindMaxWidth}
      pluginSet={pluginSet}
    />
  );
  return host ? (
    content
  ) : (
    <WorkspaceLinkEditor
      locale={language}
      scope={props.readonly || props.suspended ? null : props.frameId}
    >
      {content}
    </WorkspaceLinkEditor>
  );
}
export type { FrameInstanceHost, FrameOpenSource } from '@sue/board-react';
