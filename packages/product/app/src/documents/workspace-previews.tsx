import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import {
  CanvasPreview,
  DocumentEditor,
  DocumentPage,
  type DocumentEditorChange,
  type DocumentHistoryAdapter,
  type DocumentSelection,
  type DocumentEditorController,
  type FrameDocumentReferences,
} from '@sue/verd-board-ui';
import type {
  DocumentEditOrigin,
  WorkspaceSessionSnapshot,
} from '../session/workspace-session';
import { parseDocumentLink } from './document-links';

export interface PreviewOptions {
  snapshot: WorkspaceSessionSnapshot;
  open(fileId: string, anchor?: string | null): void;
  openLink(href: string, sourceId: string): void;
  scroll: Map<string, { top: number; left: number }>;
  path: readonly string[];
  instance: string;
  active: boolean;
  locale?: 'zh' | 'en';
  exporting?: boolean;
  history?: DocumentHistoryAdapter;
  edit?(
    id: string,
    change: DocumentEditorChange,
    origin: DocumentEditOrigin,
  ): void;
  rename?(id: string, title: string): void;
  restore?: ReadonlyMap<
    string,
    { revision: number; selection?: DocumentSelection }
  >;
  editRequest?: { instanceId: string; nonce: number };
}
// Keep passive preview controls independent of surrounding editor chrome so
// offscreen image rendering has the same geometry as the live document.
const referenceButtonStyle: React.CSSProperties = {
  height: 28,
  minHeight: 0,
  boxSizing: 'border-box',
  padding: '3px 8px',
  font: '13px/20px system-ui, sans-serif',
  whiteSpace: 'nowrap',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#f8fafc',
};

function VisiblePreview({
  active,
  force,
  children,
  viewport,
}: {
  active: boolean;
  force?: boolean;
  children: React.ReactNode;
  viewport?: React.RefObject<HTMLElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (force || !active) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '400px' },
    );
    const target = viewport?.current ?? root.current;
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [active, force, viewport]);
  return (
    <div ref={root} style={{ height: '100%', minHeight: 0 }}>
      {force || (active && visible) ? children : null}
    </div>
  );
}

export function workspaceDocumentPreviews(
  options: PreviewOptions,
): FrameDocumentReferences {
  return {
    editRequest: options.editRequest,
    title: (id) => options.snapshot.documents.get(id)?.file.title,
    renderHeaderActions: (props) => {
      const openLabel =
        options.locale === 'en' ? 'Open reference details' : '打开引用详情';
      const exitLabel = options.locale === 'en' ? 'Finish editing' : '结束编辑';
      return (
        <>
          {props.editing && (
            <button
              type="button"
              className="workspace-reference-action"
              title={exitLabel}
              aria-label={exitLabel}
              onClick={props.onExitEdit}
            >
              <Check size={16} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="workspace-reference-action"
            title={openLabel}
            aria-label={openLabel}
            disabled={!options.snapshot.documents.has(props.targetDocumentId)}
            onClick={() => options.open(props.targetDocumentId)}
          >
            <ExternalLink size={16} aria-hidden />
          </button>
        </>
      );
    },
    render: (props) =>
      props.kind === 'document-frame' &&
      props.editing &&
      !props.readonly &&
      options.edit &&
      !options.path.includes(props.targetDocumentId) ? (
        <DocumentFrameEditor
          options={options}
          targetId={props.targetDocumentId}
          instanceId={props.instanceId}
          cellId={props.cellId}
          onExit={props.onExitEdit}
        />
      ) : (
        <DocumentReferencePreview
          shell={props.kind === 'document-frame' && !props.readonly}
          annotation={props.annotation}
          options={{
            ...options,
            active: options.active,
            exporting: options.exporting || props.exporting,
            instance: JSON.stringify([options.instance, props.instanceId]),
          }}
          targetId={props.targetDocumentId}
        />
      ),
  };
}

export function WorkspaceCanvasReference({
  targetFrameId,
  options,
}: {
  targetFrameId: string;
  options: PreviewOptions;
}) {
  const file = options.snapshot.files.get(targetFrameId)?.file;
  const repeated = options.path.includes(targetFrameId);
  const next = {
    ...options,
    path: [...options.path, targetFrameId],
    instance: JSON.stringify([options.instance, 'canvas', targetFrameId]),
  };
  return (
    <section
      className="workspace-canvas-reference"
      style={{
        border: '1px solid #cbd5e1',
        borderRadius: 8,
        overflow: 'hidden',
        background: '#fff',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <strong>{file?.frame.name ?? '画布引用缺失'}</strong>
        <button
          type="button"
          data-frame-export-exclude
          style={referenceButtonStyle}
          disabled={!file}
          onClick={() => options.open(targetFrameId)}
        >
          打开原图
        </button>
      </div>
      {file && !repeated ? (
        <div style={{ height: 360 }}>
          <VisiblePreview active={options.active} force={options.exporting}>
            <CanvasPreview
              value={{ store: options.snapshot.store }}
              frameId={targetFrameId}
              documentReferences={workspaceDocumentPreviews(next)}
              exporting={options.exporting}
            />
          </VisiblePreview>
        </div>
      ) : (
        <p style={{ padding: 12 }}>
          {file ? '已在当前预览路径中展示，可打开原图查看。' : targetFrameId}
        </p>
      )}
    </section>
  );
}

function DocumentReferencePreview({
  targetId,
  options,
  shell = false,
  annotation,
}: {
  targetId: string;
  options: PreviewOptions;
  shell?: boolean;
  annotation?: import('@sue/board-common').BoardTextDocument;
}) {
  const file = options.snapshot.documents.get(targetId)?.file;
  const body = useRef<HTMLDivElement>(null);
  const ctl = useRef<DocumentEditorController | null>(null);
  const restoring = useRef(true);
  const [ready, setReady] = useState(false);
  const repeated = options.path.includes(targetId);
  const next = {
    ...options,
    path: [...options.path, targetId],
    instance: `${options.instance}/document:${targetId}`,
  };
  const restoreScroll = useCallback(() => {
    const pos = options.scroll.get(options.instance);
    if (pos && body.current) {
      body.current.scrollTop = pos.top;
      body.current.scrollLeft = pos.left;
    }
  }, [options.scroll, options.instance]);
  useEffect(restoreScroll, [targetId, restoreScroll]);
  const rememberScroll = () => {
    if (body.current && !options.exporting && !restoring.current)
      options.scroll.set(options.instance, {
        top: body.current.scrollTop,
        left: body.current.scrollLeft,
      });
  };
  const stop = (event: React.SyntheticEvent) => {
    if (!shell) event.stopPropagation();
  };
  return (
    <div
      data-document-preview-body={shell ? undefined : ''}
      data-reference-pending={
        options.exporting && file && !repeated && !ready ? 'true' : undefined
      }
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
        pointerEvents: 'auto',
      }}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
      onKeyDown={stop}
      onKeyUp={stop}
      onCopy={stop}
      onCut={stop}
      onPaste={stop}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={stop}
      onClick={(event) => {
        event.stopPropagation();
        const anchor = (event.target as Element).closest('a[href]');
        if (!anchor) return;
        event.preventDefault();
        rememberScroll();
        const href = anchor.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          const link = parseDocumentLink(href, targetId);
          const heading =
            link?.kind === 'file'
              ? ctl.current
                  ?.getHeadings()
                  .find((item) => item.anchor === link.anchor)
              : null;
          if (heading) ctl.current?.locateHeading(heading.pos);
          else options.openLink(href, targetId);
        } else options.openLink(href, targetId);
      }}
    >
      {annotation && (
        <div
          data-document-reference-links
          style={{
            height: 64,
            overflow: 'auto',
            padding: '0 12px',
            boxSizing: 'border-box',
          }}
        >
          <DocumentEditor
            value={annotation}
            readonly
            onChange={() => undefined}
          />
        </div>
      )}
      <div
        ref={body}
        data-document-preview-scroll
        style={{
          height: annotation ? 'calc(100% - 64px)' : '100%',
          overflow: 'auto',
          padding: 12,
          boxSizing: 'border-box',
          userSelect: 'text',
          background: '#fff',
          color: '#0f172a',
          font: '14px/1.65 system-ui, sans-serif',
        }}
        onScroll={() => {
          if (
            body.current &&
            ctl.current &&
            options.active &&
            !restoring.current &&
            !options.exporting
          )
            options.scroll.set(options.instance, {
              top: body.current.scrollTop,
              left: body.current.scrollLeft,
            });
        }}
      >
        {!file ? (
          <p>文档引用缺失 · {targetId}</p>
        ) : repeated ? (
          <p>已在当前预览路径中展示。可通过标题栏打开引用详情。</p>
        ) : (
          <VisiblePreview
            active={options.active}
            force={options.exporting}
            viewport={body}
          >
            <DocumentEditor
              value={file.text}
              readonly
              onChange={() => undefined}
              onReady={(controller) => {
                ctl.current = controller;
                restoring.current = true;
                if (controller)
                  requestAnimationFrame(() => {
                    restoreScroll();
                    restoring.current = false;
                    setReady(true);
                  });
              }}
              renderFrameReference={({ targetFrameId, instanceId }) => (
                <WorkspaceCanvasReference
                  targetFrameId={targetFrameId}
                  options={{
                    ...next,
                    instance: JSON.stringify([
                      next.instance,
                      'block',
                      instanceId,
                    ]),
                  }}
                />
              )}
            />
          </VisiblePreview>
        )}
      </div>
    </div>
  );
}

/** Only the active occurrence writes; other occurrences continue as passive readers. */
function DocumentFrameEditor({
  options,
  targetId,
  instanceId,
  cellId,
  onExit,
}: {
  options: PreviewOptions;
  targetId: string;
  instanceId: string;
  cellId: string;
  onExit(): void;
}) {
  const file = options.snapshot.documents.get(targetId)?.file;
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<DocumentEditorController | null>(null);
  const scope = useRef(crypto.randomUUID());
  const appearance = JSON.stringify([options.instance, instanceId]);
  const scrollKey = appearance;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  if (!file) return <p>文档引用缺失 · {targetId}</p>;
  return (
    <div
      ref={root}
      data-document-preview-body
      data-document-editing={instanceId}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
      onCopy={stop}
      onCut={stop}
      onPaste={stop}
      onContextMenu={stop}
      onKeyDownCapture={(event) => {
        if (
          event.key !== 'Escape' ||
          event.nativeEvent.isComposing ||
          (event.target as Element).closest('input, select, textarea') ||
          root.current?.querySelector(
            '.doc-findbar, .doc-linkbar, .doc-frame-picker, .doc-export__menu',
          )
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        controller.current?.commit();
        onExit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          !(event.target as Element).closest('input, select, textarea')
        ) {
          event.preventDefault();
          controller.current?.commit();
          onExit();
        }
      }}
      onScrollCapture={(event) => {
        const node = event.target as HTMLElement;
        if (node.classList.contains('document-page__content'))
          options.scroll.set(scrollKey, {
            top: node.scrollTop,
            left: node.scrollLeft,
          });
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <DocumentPage
          compact
          locale={options.locale}
          value={file.text}
          title={file.title}
          saveState={
            options.snapshot.documents.get(targetId)?.conflicted
              ? 'conflicted'
              : options.snapshot.documents.get(targetId)?.dirty
                ? options.snapshot.saveStatus === 'saving'
                  ? 'saving'
                  : 'unsaved'
                : 'saved'
          }
          history={options.history}
          restore={options.restore?.get(instanceId)}
          frameChoices={[...options.snapshot.files.values()].map(
            ({ file: canvas, path }) => ({
              frameId: canvas.frame.id,
              title: canvas.frame.name ?? path,
              path,
            }),
          )}
          renderFrameReference={({ targetFrameId, instanceId: blockId }) => (
            <WorkspaceCanvasReference
              targetFrameId={targetFrameId}
              options={{
                ...options,
                path: [...options.path, targetId],
                instance: JSON.stringify([appearance, 'block', blockId]),
              }}
            />
          )}
          onOpenLink={(href) => options.openLink(href, targetId)}
          onTitleCommit={(title) => options.rename?.(targetId, title)}
          onChange={(change) =>
            options.edit?.(
              targetId,
              {
                ...change,
                historyGroup: `${scope.current}:${change.historyGroup}`,
              },
              { canvasId: options.path[0], cellId, instanceId },
            )
          }
          onReady={(ctl) => {
            controller.current = ctl;
            if (ctl) {
              ctl.focus(
                options.restore?.has(instanceId) ? 'preserve' : 'start',
              );
              requestAnimationFrame(() => {
                const element = root.current?.querySelector(
                  '.document-page__content',
                );
                const pos = options.scroll.get(scrollKey);
                if (element && pos) {
                  element.scrollTop = pos.top;
                  element.scrollLeft = pos.left;
                }
              });
            }
          }}
        />
      </div>
    </div>
  );
}
