import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentEditorController } from '@sue/verd-board-ui';
import { createFrameCell } from '@sue/board-core';
import { parseMarkdownToTextDocument } from '@sue/board-markdown-to-text';
import { createDocumentFile } from './document-files';
import { createFrameFile } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '../session/workspace-session';
import {
  createWorkspaceDocumentPreviewCache,
  workspaceDocumentPreviews,
  type PreviewOptions,
} from './workspace-previews';

let controller: DocumentEditorController | null = null;
vi.mock('@sue/verd-board-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sue/verd-board-ui')>();
  return {
    ...actual,
    usePreviewMount: () => true,
    CanvasPreview: () => <div data-native-canvas />,
    DocumentEditor: (
      props: React.ComponentProps<typeof actual.DocumentEditor>,
    ) => (
      <actual.DocumentEditor
        {...props}
        onReady={(value) => {
          controller = value;
          props.onReady?.(value);
        }}
      />
    ),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
HTMLElement.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root | null = null;
let session: WorkspaceSession | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  session?.dispose();
  session = null;
  container?.remove();
});

const setup = async () => {
  const host = createMemoryWorkspaceHost();
  const handle = (await host.openWorkspace({ path: 'inline-doc' }))!;
  session = await openWorkspaceSession(host, handle);
  const file = {
    ...createDocumentFile('document', 'Document'),
    text: parseMarkdownToTextDocument(
      '[Jump](#section)\n\n## Section\n\nFirst body',
      { id: 'document' },
    ).document,
  };
  await session.apply({ type: 'create-file', file });
  await session.apply({
    type: 'create-file',
    file: createFrameFile(createFrameCell('diagram')),
  });
  const options: PreviewOptions = {
    snapshot: session.getState(),
    open: vi.fn(),
    openLink: vi.fn(),
    scroll: new Map([
      [JSON.stringify(['canvas', 'occurrence']), { top: 120, left: 8 }],
    ]),
    path: ['canvas'],
    instance: 'canvas',
    active: true,
    history: {
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => true,
      canRedo: () => true,
    },
    edit: vi.fn(),
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const exit = vi.fn();
  const render = async (editing: boolean, nextOptions = options) => {
    await act(async () =>
      root!.render(
        workspaceDocumentPreviews(nextOptions).render({
          kind: 'document-frame',
          targetDocumentId: 'document',
          instanceId: 'occurrence',
          cellId: 'document-shell',
          ownerFrameId: 'canvas',
          editing,
          readonly: false,
          onExitEdit: exit,
          suspended: false,
          exporting: false,
        }),
      ),
    );
    await act(
      async () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  };
  const key = async (
    key: string,
    init: KeyboardEventInit = {},
    target: Element | null = container.querySelector('.board-document-content'),
  ) => {
    await act(async () =>
      target!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      ),
    );
  };
  return { options, render, key, exit, file };
};

describe('canvas document editing', () => {
  it('keeps preview revisions through save notifications and forwards the latest callbacks', async () => {
    const { options, file } = await setup();
    const cache = createWorkspaceDocumentPreviewCache();
    const adapter = cache(options);
    const revision = adapter.getRevision!('document');
    const sceneRevision = adapter.revision;
    await act(async () =>
      root!.render(
        adapter.render({
          kind: 'document-reference',
          targetDocumentId: 'document',
          instanceId: 'occurrence',
          cellId: 'document-shell',
          ownerFrameId: 'canvas',
          editing: false,
          readonly: true,
          onExitEdit: vi.fn(),
          suspended: false,
          exporting: false,
        }),
      ),
    );
    const openLink = vi.fn();
    const snapshot = {
      ...options.snapshot,
      files: new Map(options.snapshot.files),
      documents: new Map(options.snapshot.documents),
    };
    expect(cache({ ...options, snapshot, openLink })).toBe(adapter);
    expect(adapter.revision).toBe(sceneRevision);
    expect(adapter.getRevision!('document')).toBe(revision);
    const savedSceneRevision = adapter.revision;
    cache({ ...options, snapshot, openLink, locale: 'en' });
    expect(adapter.revision).not.toBe(savedSceneRevision);
    expect(adapter.getRevision!('document')).not.toBe(revision);
    // A cached body keeps its source snapshot, but navigation always uses the
    // current session callbacks even when no content rerender was necessary.
    expect(options.openLink).not.toHaveBeenCalled();
    const link = container.querySelector('a')!;
    link.setAttribute('href', 'https://example.com');
    await act(async () => {
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(openLink).toHaveBeenCalledWith('https://example.com', 'document');
    const beforeRename = adapter.getRevision!('document');
    snapshot.documents.set(file.id, {
      ...snapshot.documents.get(file.id)!,
      file: { ...file, title: 'Renamed document' },
    });
    expect(adapter.getRevision!('document')).not.toBe(beforeRename);
    expect(adapter.title('document')).toBe('Renamed document');
  });
  it('shares the reading viewport without page chrome and keeps scroll through both transitions', async () => {
    const { options, render } = await setup();
    await render(false);
    const reading = container.querySelector<HTMLElement>(
      '[data-document-preview-scroll]',
    )!;
    const style = reading.style.cssText;
    expect(reading.closest('[data-document-preview-body]')).not.toBeNull();
    expect(reading.scrollTop).toBe(120);
    await render(true);
    const editing = container.querySelector<HTMLElement>(
      '[data-document-preview-scroll]',
    )!;
    expect(editing.style.cssText).toBe(style);
    expect(editing.scrollTop).toBe(120);
    expect(editing.scrollLeft).toBe(8);
    expect(
      container.querySelector(
        '.document-page, .doc-toolbar, .document-page__header',
      ),
    ).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    editing.scrollTop = 235;
    editing.scrollLeft = 3;
    await act(async () => editing.dispatchEvent(new Event('scroll')));
    expect(
      options.scroll.get(JSON.stringify(['canvas', 'occurrence'])),
    ).toEqual({ top: 235, left: 3 });
    await render(false);
    expect(
      container.querySelector<HTMLElement>('[data-document-preview-scroll]')!
        .scrollTop,
    ).toBe(235);
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('keeps source edits, history and restores while handling search, links and IME Escape locally', async () => {
    const { options, render, key, exit, file } = await setup();
    await render(true);
    await act(async () => controller!.replaceAll('First', 'Changed'));
    expect(options.edit).toHaveBeenCalledWith(
      'document',
      expect.objectContaining({
        source: 'replace',
        historyGroup: expect.stringContaining(':'),
        value: expect.objectContaining({
          id: 'document',
          plainText: expect.stringContaining('Changed'),
        }),
      }),
      {
        canvasId: 'canvas',
        cellId: 'document-shell',
        instanceId: 'occurrence',
      },
    );
    await key('z', { ctrlKey: true });
    expect(options.history!.undo).toHaveBeenCalledTimes(1);
    await key('z', { ctrlKey: true, shiftKey: true });
    expect(options.history!.redo).toHaveBeenCalledTimes(1);
    await key('f', { ctrlKey: true });
    expect(container.querySelector('.doc-findbar')).not.toBeNull();
    await key('Escape', {}, container.querySelector('.doc-findbar input'));
    expect(container.querySelector('.doc-findbar')).toBeNull();
    expect(exit).not.toHaveBeenCalled();
    await key('Escape', { isComposing: true });
    expect(exit).not.toHaveBeenCalled();
    const scrollIntoView = vi.fn();
    container.querySelector<HTMLElement>('h2')!.scrollIntoView = scrollIntoView;
    await act(async () =>
      container.querySelector('a')!.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    expect(scrollIntoView).toHaveBeenCalled();
    expect(options.openLink).not.toHaveBeenCalled();
    const updated = {
      ...file,
      text: parseMarkdownToTextDocument('Restored body', { id: file.id })
        .document,
    };
    const documents = new Map(options.snapshot.documents);
    documents.set(file.id, { ...documents.get(file.id)!, file: updated });
    await render(true, {
      ...options,
      snapshot: { ...options.snapshot, documents },
      restore: new Map([
        [
          'occurrence',
          { revision: 1, selection: { from: 1, to: 1, collapsed: true } },
        ],
      ]),
    });
    expect(controller!.commit().plainText).toBe('Restored body');
    expect(options.edit).toHaveBeenCalledTimes(1);
    await key('Escape');
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
