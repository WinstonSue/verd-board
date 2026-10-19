import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import {
  CanvasPreview,
  DocumentEditor,
  DocumentPreview,
  usePreviewMount,
  type DocumentEditorChange,
  type DocumentHistoryAdapter,
  type DocumentSelection,
  type DocumentEditorController,
  type DocumentPreviewController,
  type FrameDocumentReferences,
} from '@sue/verd-board-ui';
import type {
  DocumentEditOrigin,
  WorkspaceSessionSnapshot,
} from '../session/workspace-session';
import { parseDocumentLink } from './document-links';
import { createPreviewRevisions } from './preview-revisions';

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
  border: '1px solid var(--vm-border-strong, #cbd5e1)',
  borderRadius: 6,
  background: 'var(--vm-background-subtle, #f8fafc)',
  color: 'var(--vm-foreground, #172033)',
};

const documentScrollStyle: React.CSSProperties = {
  height: '100%',
  overflow: 'auto',
  padding: 12,
  boxSizing: 'border-box',
  userSelect: 'text',
  background: '#fff',
  color: '#0f172a',
  font: '14px/1.65 system-ui, sans-serif',
};
const embeddedEditorFocus = { autoFocus: false };

/** Keep a canvas occurrence's adapter stable while its callbacks follow the session. */
export function createWorkspaceDocumentPreviewCache() {
  const entries = new Map<
    string,
    { options: PreviewOptions; adapter: FrameDocumentReferences }
  >();
  const get = (options: PreviewOptions): FrameDocumentReferences => {
    const key = JSON.stringify([options.instance, options.path]);
    const previous = entries.get(key);
    if (previous) {
      previous.options = options;
      return previous.adapter;
    }
    const dependencies = createPreviewRevisions();
    const versions = new WeakMap<
      object,
      { inputs: readonly unknown[]; token: object }
    >();
    const entry = { options, adapter: null! as FrameDocumentReferences };
    let sceneRevision:
      { inputs: readonly unknown[]; token: object } | undefined;
    const optionInputs = () => {
      const latest = entry.options;
      return [
        latest.active,
        latest.locale,
        latest.exporting,
        latest.history,
        latest.scroll,
        latest.editRequest,
        !!latest.edit,
        ...[...(latest.restore ?? [])].flat(),
      ];
    };
    const sameInputs = (a: readonly unknown[], b: readonly unknown[]) =>
      a.length === b.length && a.every((value, index) => value === b[index]);
    const current = (): PreviewOptions => ({
      ...entry.options,
      open: (...args) => entry.options.open(...args),
      openLink: (...args) => entry.options.openLink(...args),
      edit: entry.options.edit
        ? (...args) => entry.options.edit?.(...args)
        : undefined,
      rename: entry.options.rename
        ? (...args) => entry.options.rename?.(...args)
        : undefined,
    });
    entry.adapter = {
      // The root scene observes session changes; individual bodies below only
      // change when their reachable sources or editing options have changed.
      get revision() {
        const { files, documents } = entry.options.snapshot;
        const inputs = [
          ...[...files].flatMap(([id, value]) => [id, value.file]),
          ...[...documents].flatMap(([id, value]) => [id, value.file]),
          ...optionInputs(),
        ];
        if (!sceneRevision || !sameInputs(sceneRevision.inputs, inputs))
          sceneRevision = { inputs, token: {} };
        return sceneRevision.token;
      },
      get editRequest() {
        return entry.options.editRequest;
      },
      getRevision(targetId, referenceSeen) {
        const latest = entry.options;
        const source = dependencies(
          latest.snapshot,
          latest.path,
          targetId,
          referenceSeen,
        );
        const inputs = optionInputs();
        const held = versions.get(source);
        if (held && sameInputs(held.inputs, inputs)) return held.token;
        const token = {};
        versions.set(source, { inputs, token });
        return token;
      },
      title: (id) => entry.options.snapshot.documents.get(id)?.file.title,
      render: (props) => workspaceDocumentPreviews(current()).render(props),
      renderHeaderActions: (props) =>
        workspaceDocumentPreviews(current()).renderHeaderActions?.(props),
    };
    entries.set(key, entry);
    return entry.adapter;
  };
  get.retain = (instances: Iterable<string>) => {
    const retained = new Set(instances);
    for (const [key, entry] of entries)
      if (!retained.has(entry.options.instance)) entries.delete(key);
  };
  return get;
}

const readDocumentImage = (file: File): Promise<string | null> => {
  if (
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
      file.type,
    ) ||
    file.size > 10 * 1024 * 1024
  )
    return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reader.onabort = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
  const admitted = usePreviewMount({
    active,
    force,
    viewport: viewport ?? root,
  });
  return (
    <div ref={root} style={{ height: '100%', minHeight: 0 }}>
      {admitted ? children : null}
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
        border: '1px solid var(--vm-border-strong, #cbd5e1)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--vm-background, #fff)',
        color: 'var(--vm-foreground, #172033)',
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
  const ctl = useRef<DocumentPreviewController | null>(null);
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
      data-document-preview-body
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
          <DocumentPreview value={annotation} />
        </div>
      )}
      <div
        ref={body}
        data-document-preview-scroll
        style={{
          ...documentScrollStyle,
          height: annotation ? 'calc(100% - 64px)' : '100%',
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
            <DocumentPreview
              value={file.text}
              onError={() => setReady(true)}
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
  const body = useRef<HTMLDivElement>(null);
  const controller = useRef<DocumentEditorController | null>(null);
  const restoring = useRef(true);
  const restoreFrame = useRef<number | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState<false | 'find' | 'replace'>(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matches, setMatches] = useState<
    ReturnType<DocumentEditorController['find']>
  >([]);
  const [matchIndex, setMatchIndex] = useState(-1);
  const scope = useRef(crypto.randomUUID());
  const appearance = JSON.stringify([options.instance, instanceId]);
  const scrollKey = appearance;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const english = options.locale === 'en';
  const search = (value: string) => {
    const found = controller.current?.find(value) ?? [];
    setQuery(value);
    setMatches(found);
    setMatchIndex(found.length ? 0 : -1);
    if (found[0]) controller.current?.selectMatch(found[0]);
  };
  const closeFind = () => {
    setFindOpen(false);
    controller.current?.focus('preserve');
  };
  const stepMatch = (delta: number) => {
    if (!matches.length) return;
    const index = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(index);
    controller.current?.selectMatch(matches[index]);
  };
  useEffect(() => {
    if (findOpen) findInput.current?.select();
  }, [findOpen]);
  useEffect(
    () => () => {
      if (restoreFrame.current !== null)
        cancelAnimationFrame(restoreFrame.current);
    },
    [],
  );
  if (!file) return <p>文档引用缺失 · {targetId}</p>;
  return (
    <div
      ref={root}
      data-document-preview-body
      data-document-editing={instanceId}
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
      onCopy={stop}
      onCut={stop}
      onPaste={stop}
      onContextMenu={stop}
      onKeyUp={stop}
      onClick={stop}
      onClickCapture={(event) => {
        const anchor = (event.target as Element).closest('a[href]');
        if (!anchor) return;
        event.preventDefault();
        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return;
        const href = anchor.getAttribute('href') ?? '';
        const link = href.startsWith('#')
          ? parseDocumentLink(href, targetId)
          : null;
        const heading =
          link?.kind === 'file'
            ? controller.current
                ?.getHeadings()
                .find((item) => item.anchor === link.anchor)
            : null;
        if (heading) controller.current?.locateHeading(heading.pos);
        else options.openLink(href, targetId);
      }}
      onAuxClickCapture={(event) => {
        if ((event.target as Element).closest('a[href]'))
          event.preventDefault();
      }}
      onKeyDownCapture={(event) => {
        if (event.nativeEvent.isComposing) return;
        const mod = event.metaKey || event.ctrlKey;
        if (
          mod &&
          ((!event.shiftKey && event.key.toLowerCase() === 'f') ||
            (event.shiftKey && event.key.toLowerCase() === 'h'))
        ) {
          event.preventDefault();
          event.stopPropagation();
          setFindOpen(event.shiftKey ? 'replace' : 'find');
          return;
        }
        if (event.key === 'Escape' && findOpen) {
          event.preventDefault();
          event.stopPropagation();
          closeFind();
          return;
        }
        if (
          event.key !== 'Escape' ||
          (event.target as Element).closest('input, select, textarea')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        controller.current?.commit();
        onExit();
      }}
      onKeyDown={stop}
    >
      {findOpen && (
        <div
          className="doc-findbar"
          style={{
            position: 'absolute',
            inset: '8px 8px auto',
            zIndex: 1,
            margin: 0,
            padding: 6,
            background: '#fff',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            boxShadow: '0 2px 8px #0002',
            font: '13px/20px system-ui, sans-serif',
          }}
        >
          <input
            ref={findInput}
            value={query}
            placeholder={english ? 'Find…' : '查找…'}
            onChange={(event) => search(event.target.value)}
          />
          <span className="doc-findbar__count">
            {matches.length ? `${matchIndex + 1}/${matches.length}` : '0/0'}
          </span>
          <button
            type="button"
            disabled={!matches.length}
            aria-label={english ? 'Previous' : '上一个'}
            onClick={() => stepMatch(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={!matches.length}
            aria-label={english ? 'Next' : '下一个'}
            onClick={() => stepMatch(1)}
          >
            ↓
          </button>
          {findOpen === 'replace' && (
            <>
              <input
                value={replacement}
                placeholder={english ? 'Replace with…' : '替换为…'}
                onChange={(event) => setReplacement(event.target.value)}
              />
              <button
                type="button"
                disabled={matchIndex < 0}
                onClick={() => {
                  if (matches[matchIndex])
                    controller.current?.replace(
                      matches[matchIndex],
                      replacement,
                    );
                  search(query);
                }}
              >
                {english ? 'Replace' : '替换'}
              </button>
              <button
                type="button"
                disabled={!matches.length}
                onClick={() => {
                  controller.current?.replaceAll(query, replacement);
                  search(query);
                }}
              >
                {english ? 'Replace all' : '全部替换'}
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={english ? 'Close' : '关闭'}
            onClick={closeFind}
          >
            ×
          </button>
        </div>
      )}
      <div
        ref={body}
        data-document-preview-scroll
        style={documentScrollStyle}
        onScroll={() => {
          if (body.current && !restoring.current && options.active)
            options.scroll.set(scrollKey, {
              top: body.current.scrollTop,
              left: body.current.scrollLeft,
            });
        }}
      >
        <DocumentEditor
          {...embeddedEditorFocus}
          value={file.text}
          history={options.history}
          restore={options.restore?.get(instanceId)}
          onImageFile={readDocumentImage}
          renderFrameReference={({ targetFrameId, instanceId: blockId }) => (
            <WorkspaceCanvasReference
              targetFrameId={targetFrameId}
              options={{
                ...options,
                path: [...options.path, targetId],
                instance: JSON.stringify([
                  `${appearance}/document:${targetId}`,
                  'block',
                  blockId,
                ]),
              }}
            />
          )}
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
            restoring.current = true;
            if (restoreFrame.current !== null)
              cancelAnimationFrame(restoreFrame.current);
            if (ctl) {
              ctl.focus(
                options.restore?.has(instanceId) ? 'preserve' : 'start',
              );
              restoreFrame.current = requestAnimationFrame(() => {
                const element = body.current;
                const pos = options.scroll.get(scrollKey);
                if (element && pos) {
                  element.scrollTop = pos.top;
                  element.scrollLeft = pos.left;
                }
                restoring.current = false;
                restoreFrame.current = null;
              });
            }
          }}
        />
      </div>
    </div>
  );
}
