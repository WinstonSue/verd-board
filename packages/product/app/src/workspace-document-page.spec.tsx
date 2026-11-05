import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentPageProps } from '@sue/verd-board-ui';
import type { PreviewOptions } from './documents/workspace-previews';
import type { WorkspaceSessionSnapshot } from './session/workspace-session';
import { createDocumentFile } from './documents/document-files';
import { WorkspaceDocumentPage } from './workspace-document-page';

const rendered = vi.hoisted(() => ({ page: vi.fn(), preview: vi.fn() }));
vi.mock('@sue/verd-board-ui', () => ({
  DocumentPage: (props: DocumentPageProps) => {
    rendered.page(props);
    return (
      <article>
        {props.title}
        {props.renderFrameReference?.({
          targetFrameId: 'chart',
          instanceId: '12',
        })}
      </article>
    );
  },
}));
vi.mock('./documents/workspace-previews', () => ({
  WorkspaceCanvasReference: (props: unknown) => {
    rendered.preview(props);
    return <span>Chart preview</span>;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rendered.page.mockClear();
  rendered.preview.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function fixture() {
  const page: DocumentPageProps = {
    value: createDocumentFile('Document', 'doc').text,
    title: 'Document',
    frameChoices: [],
    onChange: vi.fn(),
    onOpenLink: vi.fn(),
    onReady: vi.fn(),
    onExport: vi.fn(),
    onNavigationResult: vi.fn(),
  };
  const snapshot = {
    store: { rootId: 'root', cells: {} },
    files: new Map(),
    documents: new Map(),
    failedFiles: new Map(),
    session: {
      tabs: [{ fileId: 'doc' }],
      activeTabId: 'doc',
      expandedDirs: [],
    },
  } as unknown as WorkspaceSessionSnapshot;
  const preview: PreviewOptions = {
    snapshot,
    open: vi.fn(),
    openLink: vi.fn(),
    path: ['doc'],
    instance: 'doc',
    scroll: new Map(),
    active: false,
    restore: new Map(),
  };
  return { page, preview };
}

const render = async (
  page: DocumentPageProps,
  preview: PreviewOptions,
  canUndo = false,
  canRedo = false,
) =>
  act(async () =>
    root.render(
      <WorkspaceDocumentPage
        page={page}
        preview={preview}
        canUndo={canUndo}
        canRedo={canRedo}
      />,
    ),
  );

describe('workspace document memo boundary', () => {
  it('skips navigation-only renders while event handlers follow the latest parent state', async () => {
    const { page, preview } = fixture();
    await render(page, preview);
    const node = container.querySelector('article');
    const first = rendered.page.mock.calls[0]![0] as DocumentPageProps;
    const firstPreview = rendered.preview.mock.calls[0]![0] as {
      options: PreviewOptions;
    };
    const nextPage = {
      ...page,
      onChange: vi.fn(),
      onReady: vi.fn(),
      onOpenLink: vi.fn(),
      onExport: vi.fn(),
      onNavigationResult: vi.fn(),
    };
    const nextPreview = {
      ...preview,
      path: ['doc'],
      snapshot: {
        ...preview.snapshot,
        failedFiles: new Map(),
        session: { ...preview.snapshot.session, activeTabId: 'another' },
      },
      open: vi.fn(),
      openLink: vi.fn(),
    };
    await render(nextPage, nextPreview);
    expect(rendered.page).toHaveBeenCalledTimes(1);
    expect(container.querySelector('article')).toBe(node);
    const change: Parameters<DocumentPageProps['onChange']>[0] = {
      value: page.value,
      changeId: 'change-1',
      historyGroup: 'typing',
      source: 'input',
      selectionBefore: { from: 1, to: 1, collapsed: true },
      selectionAfter: { from: 2, to: 2, collapsed: true },
    };
    first.onChange(change);
    first.onOpenLink?.('verd://file/chart');
    first.onExport?.('markdown');
    first.onReady?.(null);
    first.onNavigationResult?.(7, { status: 'revealed' });
    firstPreview.options.open('chart');
    firstPreview.options.openLink('verd://file/chart', 'doc');
    expect(nextPage.onChange).toHaveBeenCalledWith(change);
    expect(nextPage.onOpenLink).toHaveBeenCalledWith('verd://file/chart');
    expect(nextPage.onExport).toHaveBeenCalledWith('markdown');
    expect(nextPage.onReady).toHaveBeenCalledWith(null);
    expect(nextPage.onNavigationResult).toHaveBeenCalledWith(7, {
      status: 'revealed',
    });
    expect(nextPreview.open).toHaveBeenCalledWith('chart');
    expect(nextPreview.openLink).toHaveBeenCalledWith(
      'verd://file/chart',
      'doc',
    );
    expect(page.onChange).not.toHaveBeenCalled();
    expect(preview.open).not.toHaveBeenCalled();
  });

  it('updates preview contexts for activation, content, failures, and mutable restore requests', async () => {
    const { page, preview } = fixture();
    let options = preview;
    await render(page, options);
    const firstRenderer = rendered.page.mock.calls[0]![0].renderFrameReference;
    options = { ...options, active: true };
    await render(page, options);
    expect(rendered.preview).toHaveBeenCalledTimes(2);
    expect(rendered.page.mock.lastCall![0].renderFrameReference).toBe(
      firstRenderer,
    );
    options = {
      ...options,
      snapshot: { ...options.snapshot, store: { ...options.snapshot.store } },
    };
    await render(page, options);
    expect(rendered.preview).toHaveBeenCalledTimes(3);
    options = {
      ...options,
      snapshot: {
        ...options.snapshot,
        failedFiles: new Map([
          [
            'bad.verd.json',
            { path: 'bad.verd.json', fileId: 'chart', diagnostics: [] },
          ],
        ]),
      },
    };
    await render(page, options);
    expect(rendered.preview).toHaveBeenCalledTimes(4);
    (options.restore as Map<string, { revision: number }>).set('embedded', {
      revision: 2,
    });
    await render(page, options);
    expect(rendered.preview).toHaveBeenCalledTimes(5);
    options = { ...options, editRequest: { instanceId: 'embedded', nonce: 1 } };
    await render(page, options);
    expect(rendered.preview).toHaveBeenCalledTimes(6);
    expect(rendered.page).toHaveBeenCalledTimes(1);
    const last = rendered.preview.mock.lastCall![0] as {
      options: PreviewOptions;
    };
    expect(last.options.snapshot).toBe(options.snapshot);
    expect(last.options.restore?.get('embedded')?.revision).toBe(2);
    expect(last.options.instance).toBe('["doc","block","12"]');
  });

  it('keeps document, navigation, restore, and shared history updates visible', async () => {
    const { page, preview } = fixture();
    let props = page;
    await render(props, preview);
    props = { ...props, title: 'Renamed' };
    await render(props, preview);
    expect(container.textContent).toContain('Renamed');
    props = { ...props, value: { ...props.value, plainText: 'Updated body' } };
    await render(props, preview);
    props = {
      ...props,
      navigation: { requestId: 1, target: { kind: 'file', fileId: 'doc' } },
    };
    await render(props, preview);
    props = { ...props, restore: { revision: 1 } };
    await render(props, preview);
    await render({ ...props, restore: { revision: 1 } }, preview);
    expect(rendered.page).toHaveBeenCalledTimes(5);
    await render(props, preview, true);
    await render(props, preview, true, true);
    expect(rendered.page).toHaveBeenCalledTimes(7);
    expect(rendered.page.mock.lastCall![0]).toMatchObject({
      canUndo: true,
      canRedo: true,
    });
  });
});
