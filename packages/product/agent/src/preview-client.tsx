import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  frameSnapshotToImage,
  type FrameDocumentReferences,
} from '@sue/board-react';
import { DocumentPreview } from '@sue/board-react-text';
import { CanvasPreview, createVerdFramePluginSet } from '@sue/verd-board-ui';
import {
  assembleWorkspaceStore,
  type WorkspaceFile,
} from '@sue/verd-board-app/headless';
import { isNodeCell } from '@sue/board-core';
import '@sue/verd-board-ui/style.css';

declare global {
  interface Window {
    renderAgentPreview: (
      files: WorkspaceFile[],
      fileId: string,
      format: 'svg' | 'png',
    ) => Promise<{ data?: string; document?: boolean; warnings: unknown[] }>;
  }
}
window.renderAgentPreview = async (files, fileId, format) => {
  const file = files.find(
    (f) => (f.format === 'verd-document' ? f.id : f.frame.id) === fileId,
  );
  if (!file) throw new Error('Unknown preview target');
  const pluginSet = createVerdFramePluginSet();
  const { store, diagnostics } = assembleWorkspaceStore(
    files.filter((f) => f.format === 'verd-frame'),
    pluginSet.registry,
  );
  if (diagnostics.length) throw new Error(JSON.stringify(diagnostics));
  const snapshot = { store };
  const documents = new Map(
    files.filter((f) => f.format === 'verd-document').map((d) => [d.id, d]),
  );
  const renderDocument = (id: string, seen: string[]): React.ReactNode => {
    const doc = documents.get(id);
    if (!doc) return <div>Missing document: {id}</div>;
    if (seen.includes(id)) return <div>Referenced document: {doc.title}</div>;
    const next = [...seen, id];
    return (
      <DocumentPreview
        value={doc.text}
        renderFrameReference={({ targetFrameId }) =>
          next.includes(targetFrameId) ? (
            <div>Referenced canvas: {targetFrameId}</div>
          ) : (
            <div style={{ width: '100%', height: 480 }}>
              <CanvasPreview
                value={snapshot}
                frameId={targetFrameId}
                documentReferences={makeReferences([...next, targetFrameId])}
                exporting
              />
            </div>
          )
        }
      />
    );
  };
  const makeReferences = (seen: string[]): FrameDocumentReferences => ({
    title: (id) => documents.get(id)?.title,
    render: (props) => renderDocument(props.targetDocumentId, seen),
  });
  const references = makeReferences([fileId]);
  const warnings: { code: string; cellId?: string; message: string }[] = [];
  if (file.format === 'verd-document') {
    if (format !== 'png') throw new Error('Document preview supports PNG');
    const host = document.getElementById('root')!;
    host.style.cssText =
      'width:1000px;min-height:200px;padding:32px;box-sizing:border-box;background:white;color:#172033;';
    flushSync(() => createRoot(host).render(renderDocument(file.id, [])));
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const started = performance.now();
    while (host.querySelector('[data-reference-pending="true"]')) {
      if (performance.now() - started > 10000)
        throw new Error('Document reference preview timed out');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await Promise.all(
      [...host.querySelectorAll('img')].map((img) => img.decode()),
    );
    return { document: true, warnings };
  }
  const blob = await frameSnapshotToImage(snapshot, {
    frameId: file.frame.id,
    pluginSet,
    documentReferences: references,
    format,
    ratio: 1.5,
    background: '#fff',
  });
  const svg = format === 'svg' ? await blob.text() : undefined;
  // Re-export SVG for measurable bounds when the requested artifact is PNG.
  const measured =
    svg ??
    (await (
      await frameSnapshotToImage(snapshot, {
        frameId: file.frame.id,
        pluginSet,
        documentReferences: references,
        format: 'svg',
      })
    ).text());
  const box = document.createElement('div');
  box.innerHTML = measured;
  document.body.append(box);
  const records = Object.values(file.cells)
    .filter(isNodeCell)
    .filter(
      (c) =>
        !c.hidden &&
        !['architecture-layer', 'swimlane', 'uml-fragment'].includes(c.kind),
    )
    .map((c) => {
      const element = [
        ...box.querySelectorAll<SVGElement>('[data-cell-id]'),
      ].find((n) => n.getAttribute('data-cell-id') === c.id);
      const rect = element?.getBoundingClientRect();
      element
        ?.querySelectorAll<HTMLElement>(
          '[contenteditable], .board-text, .board-document-content',
        )
        .forEach((text) => {
          if (
            text.clientHeight > 0 &&
            text.scrollHeight > text.clientHeight + 3
          )
            warnings.push({
              code: 'visual.text-overflow',
              cellId: c.id,
              message: 'Rendered text may exceed its visible area',
            });
        });
      return { c, rect };
    });
  for (let i = 0; i < records.length; i++)
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i],
        b = records[j];
      if (!a.rect || !b.rect) continue;
      const x = a.rect,
        y = b.rect;
      const contains = (l: DOMRect, r: DOMRect) =>
        l.left <= r.left &&
        l.top <= r.top &&
        l.right >= r.right &&
        l.bottom >= r.bottom;
      if (
        Math.min(x.right, y.right) - Math.max(x.left, y.left) > 3 &&
        Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 3 &&
        !contains(x, y) &&
        !contains(y, x)
      )
        warnings.push({
          code: 'visual.overlap',
          cellId: a.c.id,
          message: 'Possible overlap with ' + b.c.id,
        });
    }
  box.remove();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { data, warnings };
};
