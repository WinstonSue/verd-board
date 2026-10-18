import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdownToTextDocument } from '@sue/board-markdown-to-text';
import { createFrameCell } from '@sue/board-core';
import { WorkspaceApp } from './workspace-app';
import {
  createDocumentFile,
  type DocumentFileV1,
} from './documents/document-files';
import {
  createDocumentLink,
  parseDocumentLink,
} from './documents/document-links';
import { createFrameFile } from './frames/frame-files';
import { createMemoryWorkspaceHost } from './host/memory-workspace-host';
import { openWorkspaceSession } from './session/workspace-session';

// Keep the workspace, document page and TipTap editor real; canvas rendering
// has separate coverage and is not involved in document link activation.
vi.mock('@sue/verd-board-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sue/verd-board-ui')>();
  return {
    ...actual,
    VerdFrame: ({ frameId }: { frameId: string }) => (
      <div data-canvas={frameId} />
    ),
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
HTMLElement.prototype.scrollIntoView ??= () => {};

let root: Root | null = null;
let container: HTMLDivElement;

const doc = (id: string, title: string, markdown: string): DocumentFileV1 => ({
  ...createDocumentFile(id, title),
  text: parseMarkdownToTextDocument(markdown, { id }).document,
});
const source = () =>
  doc(
    'source',
    'Source',
    [
      `[Target](${createDocumentLink('target', '重复章节-1')})`,
      `[Canvas](${createDocumentLink('canvas')})`,
      '[Same document](#本页章节)',
      `[Missing](${createDocumentLink('missing')})`,
      '## 本页章节',
      'Local section.',
    ].join('\n\n'),
  );
const target = () =>
  doc(
    'target',
    'Target',
    ['## 重复章节', 'First section.', '## 重复章节', 'Second section.'].join(
      '\n\n',
    ),
  );

const waitFor = async (assertion: () => void) => {
  let failure: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 15)));
    try {
      assertion();
      return;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
};
const activePane = () => container.querySelector('.workspace-pane.is-active')!;
const title = () =>
  activePane()?.querySelector<HTMLInputElement>('.document-page__title')?.value;
const selectedHeading = () =>
  document
    .getSelection()
    ?.anchorNode?.parentElement?.closest('h1,h2,h3,h4,h5,h6');
const clickLink = async (label: string) => {
  const link = [...activePane().querySelectorAll('a')].find(
    (item) => item.textContent === label,
  )!;
  expect(link).toBeTruthy();
  await act(async () => {
    link.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    );
  });
};
const openTreeFile = async (name: string) => {
  const row = [
    ...container.querySelectorAll<HTMLElement>('.file-tree-name'),
  ].find((item) => item.textContent === name)!;
  expect(row).toBeTruthy();
  await act(async () => row.click());
};
const setup = async () => {
  const host = createMemoryWorkspaceHost();
  const path = `nav-${Math.random()}`;
  const handle = (await host.openWorkspace({ path }))!;
  const files = [
    source(),
    target(),
    createFrameFile({ ...createFrameCell('canvas'), name: 'Canvas' }),
  ];
  await host.commit(handle, {
    transactionId: 'seed',
    writes: files.map((file, index) => ({
      path: `${index}.verd${file.format === 'verd-document' ? '-doc' : ''}.json`,
      content: JSON.stringify(file),
      expectedVersion: null,
    })),
    session: {
      tabs: [{ fileId: 'source' }],
      activeTabId: 'source',
      expandedDirs: [],
    },
  });
  const commit = vi.spyOn(host, 'commit');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(<WorkspaceApp host={host} workspace={{ path }} />),
  );
  return { host, handle, commit };
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
});

describe('WorkspaceApp document navigation', () => {
  it('opens an unmounted target, locates duplicate headings and opens a canvas without editing files', async () => {
    const { host, handle, commit } = await setup();
    await waitFor(() => expect(title()).toBe('Source'));
    expect(container.querySelectorAll('.document-page')).toHaveLength(1);
    expect(
      activePane().querySelector<HTMLButtonElement>('button[title="撤销"]')
        ?.disabled,
    ).toBe(true);
    await clickLink('Target');
    await waitFor(() => {
      expect(title()).toBe('Target');
      expect(selectedHeading()).toBe(activePane().querySelectorAll('h2')[1]);
    });
    expect(
      activePane().querySelector<HTMLButtonElement>('button[title="撤销"]')
        ?.disabled,
    ).toBe(true);
    await openTreeFile('Source');
    await clickLink('Canvas');
    await waitFor(() =>
      expect(activePane().querySelector('[data-canvas="canvas"]')).toBeTruthy(),
    );
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(
      commit.mock.calls.every(([, request]) => !request.writes?.length),
    ).toBe(true);
    const saved = await host.readSnapshot(handle);
    expect(
      saved.documents?.find((entry) => entry.file?.id === 'source')?.file,
    ).toEqual(source());
    expect(
      saved.documents?.find((entry) => entry.file?.id === 'target')?.file,
    ).toEqual(target());
  });

  it('handles same-document sections and rejects missing files without opening an empty tab', async () => {
    await setup();
    await waitFor(() => expect(title()).toBe('Source'));
    await clickLink('Same document');
    await waitFor(() =>
      expect(selectedHeading()?.textContent).toBe('本页章节'),
    );
    const panes = container.querySelectorAll('.workspace-pane').length;
    await clickLink('Missing');
    expect(title()).toBe('Source');
    expect(container.querySelectorAll('.workspace-pane')).toHaveLength(panes);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '文件不存在',
    );
  });

  it('resolves the same identity after a document is renamed and moved on disk', async () => {
    const { host, handle } = await setup();
    await waitFor(() => expect(title()).toBe('Source'));
    const before = await host.readSnapshot(handle);
    const entry = before.documents!.find((item) => item.file?.id === 'target')!;
    const next = { ...target(), title: 'Moved target' };
    await act(async () => {
      await host.commit(handle, {
        transactionId: 'external-move',
        moves: [
          {
            from: entry.path,
            to: 'docs/Moved.verd-doc.json',
            expectedVersion: entry.version,
          },
        ],
        writes: [
          {
            path: 'docs/Moved.verd-doc.json',
            content: JSON.stringify(next),
            expectedVersion: entry.version,
          },
        ],
      });
    });
    await clickLink('Target');
    await waitFor(() => {
      expect(title()).toBe('Moved target');
      expect(selectedHeading()).toBe(activePane().querySelectorAll('h2')[1]);
    });
  });

  it('keeps same-document fragments local after duplication and identity-colliding import', async () => {
    const host = createMemoryWorkspaceHost();
    const handle = (await host.openWorkspace({ path: 'fragment-copies' }))!;
    const session = await openWorkspaceSession(host, handle);
    const file = doc(
      'original',
      'Original',
      '[Section](#章节)\n\n## 章节\n\nBody',
    );
    await session.apply({ type: 'create-file', file });
    await session.apply({ type: 'duplicate-file', fileId: file.id });
    await session.apply({ type: 'import-files', files: [file] });
    const docs = [...session.getState().documents.values()];
    expect(docs).toHaveLength(3);
    expect(new Set(docs.map((entry) => entry.file.id)).size).toBe(3);
    for (const entry of docs) {
      const href = entry.file.text.content.content![0].content![0].marks![0]
        .attrs!.href as string;
      expect(parseDocumentLink(href, entry.file.id)).toEqual({
        kind: 'file',
        fileId: entry.file.id,
        anchor: '章节',
      });
    }
    session.dispose();
  });
});
