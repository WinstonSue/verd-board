import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgePanel } from './knowledge-panel';
import { createKnowledgeIndexer } from './knowledge-index';
import { createDocumentFile } from '@sue/verd-board-workspace';
import type { PreviewOptions } from './workspace-previews';
vi.mock('@sue/verd-board-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sue/verd-board-ui')>()),
  DocumentPreview: () => <div data-testid="static-preview">只读正文</div>,
}));
vi.mock('./workspace-previews', () => ({
  WorkspaceCanvasReference: () => <div>只读画布</div>,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
document.body.appendChild(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.restoreAllMocks();
});
const click = async (label: string) => {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )!;
  await act(async () => button.click());
};
async function setup(href = 'verd://file/b') {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const a = createDocumentFile('a', '方案'),
    b = createDocumentFile('b', '结论');
  a.text.content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '参考结论',
            marks: [{ type: 'link', attrs: { href: 'verd://file/b' } }],
          },
        ],
      },
    ],
  };
  const knowledge = createKnowledgeIndexer()([a, b]);
  const open = vi.fn(),
    locate = vi.fn();
  const preview = {
    locale: 'zh',
    snapshot: {
      documents: new Map([
        ['a', { file: a }],
        ['b', { file: b }],
      ]),
      files: new Map(),
    },
  } as unknown as PreviewOptions;
  await act(async () =>
    root.render(
      <KnowledgePanel
        fileId="a"
        {...knowledge}
        preview={preview}
        open={open}
        locate={locate}
        request={{ href, nonce: 1 }}
        active
      />,
    ),
  );
  return { open, locate };
}
describe('knowledge preview', () => {
  it('previews without navigation or mutation and opens only on explicit request', async () => {
    const { open } = await setup();
    expect(container.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(
      container.querySelector('[data-testid="static-preview"]'),
    ).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
    await click('打开原内容');
    expect(open).toHaveBeenCalledWith({ kind: 'file', fileId: 'b' });
    expect(container.querySelector('dialog')).toBeNull();
  });
  it('marks missing targets unavailable and disables opening/copying', async () => {
    const { open } = await setup('verd://file/missing');
    expect(container.textContent).toContain('目标已删除或不可用');
    expect(
      [...container.querySelectorAll('button')].find(
        (b) => b.textContent === '打开原内容',
      )?.disabled,
    ).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
  it('locates an incoming/outgoing occurrence using the source address', async () => {
    const { locate } = await setup();
    await click('定位来源');
    expect(locate).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFileId: 'a', context: '参考结论' }),
    );
  });
  it('closes on Escape without navigating', async () => {
    const { open } = await setup();
    await act(async () =>
      container
        .querySelector('dialog')!
        .dispatchEvent(
          new Event('cancel', { bubbles: false, cancelable: true }),
        ),
    );
    expect(container.querySelector('dialog')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
