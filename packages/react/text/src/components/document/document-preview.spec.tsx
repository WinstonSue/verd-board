import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  createBlockText,
  type BoardTextDocument,
  type BoardTextNode,
} from '@sue/board-common';
import {
  DocumentPreview,
  type DocumentPreviewController,
} from './document-preview';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (value: string) => ({
  type: 'paragraph',
  content: [text(value)],
});
const heading = (value: string) => ({
  type: 'heading',
  attrs: { level: 2 },
  content: [text(value)],
});
const reference = (targetFrameId: string) => ({
  type: 'frameReference',
  attrs: { targetFrameId },
});
const documentWith = (...content: BoardTextNode[]): BoardTextDocument => ({
  ...createBlockText(''),
  content: { type: 'doc', content },
});

describe('DocumentPreview', () => {
  it('displays schema rich text without creating an editor DOM', async () => {
    const container = document.createElement('div');
    container.setAttribute('contenteditable', 'true');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <DocumentPreview
            value={documentWith(
              heading('Title'),
              { type: 'paragraph' },
              { type: 'codeBlock', content: [text('<script>  code')] },
              {
                type: 'table',
                content: [
                  {
                    type: 'tableRow',
                    content: [
                      { type: 'tableHeader', content: [paragraph('Header')] },
                      { type: 'tableCell', content: [paragraph('Cell')] },
                    ],
                  },
                ],
              },
              {
                type: 'image',
                attrs: { src: 'data:image/png;base64,AA==', alt: 'Image' },
              },
              {
                type: 'paragraph',
                content: [text('Trailing'), { type: 'hardBreak' }],
              },
            )}
          />,
        ),
      );
      expect(
        container.querySelector('.board-document-editor.readonly'),
      ).not.toBeNull();
      expect(container.querySelector('h2')?.textContent).toBe('Title');
      expect(container.querySelector('h2 + p')?.innerHTML).toBe('<br>');
      expect(container.querySelector('pre code')?.textContent).toBe(
        '<script>  code',
      );
      expect(container.querySelector('script')).toBeNull();
      expect(
        container.querySelector('.tableWrapper table th')?.textContent,
      ).toBe('Header');
      expect(container.querySelector('td')?.textContent).toBe('Cell');
      expect(container.querySelector('img')?.alt).toBe('Image');
      expect(
        container.querySelectorAll('.board-document-content > p:last-child br'),
      ).toHaveLength(2);
      expect(
        container.querySelector(
          '[contenteditable="true"], .ProseMirror, .tiptap',
        ),
      ).toBeNull();
      expect(
        container
          .querySelector('.board-document-content')
          ?.getAttribute('contenteditable'),
      ).toBe('false');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps duplicate heading anchors, document positions and the controller current', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let controller: DocumentPreviewController | null = null;
    const ready = vi.fn((value: DocumentPreviewController | null) => {
      controller = value;
    });
    try {
      await act(async () =>
        root.render(
          <DocumentPreview
            value={documentWith(heading('Repeat'), heading('Repeat'))}
            onReady={ready}
          />,
        ),
      );
      const firstController = controller!;
      expect(firstController.getHeadings()).toEqual([
        { level: 2, text: 'Repeat', anchor: 'repeat', pos: 0 },
        { level: 2, text: 'Repeat', anchor: 'repeat-1', pos: 8 },
      ]);
      const target = container.querySelectorAll('h2')[1];
      const scrollIntoView = vi.fn();
      target.scrollIntoView = scrollIntoView;
      firstController.locateHeading(8);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: 'start',
        inline: 'nearest',
      });
      await act(async () =>
        root.render(
          <DocumentPreview
            value={documentWith(heading('Updated'))}
            onReady={ready}
          />,
        ),
      );
      expect(controller).toBe(firstController);
      expect(controller!.getHeadings()).toEqual([
        { level: 2, text: 'Updated', anchor: 'updated', pos: 0 },
      ]);
      expect(container.querySelector('h2')?.textContent).toBe('Updated');
      expect(ready).toHaveBeenCalledTimes(1);
      await act(async () => root.unmount());
      expect(ready).toHaveBeenLastCalledWith(null);
      expect(firstController.getHeadings()).toEqual([]);
      firstController.locateHeading(8);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      if (container.firstChild) await act(async () => root.unmount());
    }
  });

  it('keeps native reference instances through surrounding edits and cleans removed occurrences', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const mounted = vi.fn();
    const disposed = vi.fn();
    function NativePreview({ id }: { id: string }) {
      useEffect(() => {
        mounted(id);
        return () => disposed(id);
      }, [id]);
      return <button type="button">Canvas {id}</button>;
    }
    const render = ({ instanceId }: { instanceId: string }) => (
      <NativePreview id={instanceId} />
    );
    const value = documentWith(reference('board/图'), reference('board/图'));
    const ids = [0, 1].map((occurrence) =>
      JSON.stringify(['board/图', occurrence]),
    );
    let controller: DocumentPreviewController | null = null;
    const ready = (value: DocumentPreviewController | null) => {
      controller = value;
    };
    const show = (value: BoardTextDocument) =>
      root.render(
        <DocumentPreview
          value={value}
          renderFrameReference={render}
          onReady={ready}
        />,
      );
    try {
      await act(async () => show(value));
      expect(
        [...container.querySelectorAll('button')].map(
          (button) => button.textContent,
        ),
      ).toEqual(ids.map((id) => `Canvas ${id}`));
      expect(
        container.querySelectorAll('[data-frame-reference="board/图"]'),
      ).toHaveLength(2);
      const body = container.querySelector('.board-document-content');
      const firstHost = container.querySelector('[data-frame-reference]');
      const firstButton = container.querySelector('button');
      await act(async () => show({ ...value }));
      expect(container.querySelector('.board-document-content')).toBe(body);
      expect(mounted).toHaveBeenCalledTimes(2);
      expect(disposed).not.toHaveBeenCalled();
      for (const prefix of ['Edited', 'More text']) {
        await act(async () =>
          show(
            documentWith(
              paragraph(prefix),
              heading('Current'),
              reference('board/图'),
              reference('board/图'),
            ),
          ),
        );
        expect(container.querySelector('.board-document-content')).not.toBe(
          body,
        );
        expect(container.querySelector('[data-frame-reference]')).toBe(
          firstHost,
        );
        expect(container.querySelector('button')).toBe(firstButton);
        expect(controller!.getHeadings()).toEqual([
          {
            level: 2,
            text: 'Current',
            anchor: 'current',
            pos: prefix.length + 2,
          },
        ]);
        expect(mounted).toHaveBeenCalledTimes(2);
        expect(disposed).not.toHaveBeenCalled();
      }
      await act(async () =>
        show(documentWith(reference('board/new'), reference('board/图'))),
      );
      expect(mounted).toHaveBeenCalledTimes(3);
      expect(disposed.mock.calls).toEqual([[ids[1]]]);
      expect(container.querySelector('[data-frame-reference="board/图"]')).toBe(
        firstHost,
      );
      expect(
        container.querySelector('[data-frame-reference="board/图"] button'),
      ).toBe(firstButton);
      await act(async () => show(documentWith(paragraph('Replacement'))));
      expect(container.querySelector('button')).toBeNull();
      expect(container.textContent).toBe('Replacement');
      expect(disposed.mock.calls).toEqual([
        [ids[1]],
        [JSON.stringify(['board/new', 0])],
        [ids[0]],
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('preserves workspace links and lets the host handle internal anchors', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const click = vi.fn((event: React.MouseEvent) => event.preventDefault());
    try {
      await act(async () =>
        root.render(
          <div onClick={click}>
            <DocumentPreview
              value={documentWith(
                {
                  type: 'paragraph',
                  content: [
                    {
                      ...text('Jump'),
                      marks: [{ type: 'link', attrs: { href: '#repeat-1' } }],
                    },
                  ],
                },
                reference('board/图'),
              )}
            />
          </div>,
        ),
      );
      const links = container.querySelectorAll('a');
      expect(links[0].getAttribute('href')).toBe('#repeat-1');
      expect(links[1].getAttribute('href')).toBe(
        'verd://file/board%2F%E5%9B%BE',
      );
      await act(async () =>
        links[0].dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        ),
      );
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shows unsupported content explicitly instead of silently dropping it', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <DocumentPreview value={documentWith({ type: 'unsupported' })} />,
        ),
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        '无法打开文档正文',
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('only publishes a ready controller for valid content and recovers after an error', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const ready =
      vi.fn<(controller: DocumentPreviewController | null) => void>();
    const error = vi.fn<(message: string) => void>();
    const invalid = documentWith({ type: 'unsupported' });
    const valid = documentWith(heading('Ready'), reference('board/example'));
    try {
      await act(async () =>
        root.render(
          <DocumentPreview value={invalid} onReady={ready} onError={error} />,
        ),
      );
      expect(ready).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toContain('unsupported');
      expect(container.querySelector('.board-document-content')).toBeNull();
      await act(async () =>
        root.render(
          <DocumentPreview
            value={invalid}
            onReady={ready}
            onError={(message) => error(message)}
          />,
        ),
      );
      expect(error).toHaveBeenCalledTimes(1);
      await act(async () =>
        root.render(
          <DocumentPreview value={valid} onReady={ready} onError={error} />,
        ),
      );
      const controller = ready.mock.calls[0][0]!;
      expect(error).toHaveBeenCalledTimes(1);
      expect(controller.getHeadings()[0].anchor).toBe('ready');
      expect(container.querySelector('[data-frame-reference]')).not.toBeNull();
      await act(async () =>
        root.render(
          <DocumentPreview value={invalid} onReady={ready} onError={error} />,
        ),
      );
      expect(ready).toHaveBeenLastCalledWith(null);
      expect(error).toHaveBeenCalledTimes(2);
      expect(controller.getHeadings()).toEqual([]);
      expect(
        container.querySelector(
          '.board-document-content, [data-frame-reference]',
        ),
      ).toBeNull();
      await act(async () =>
        root.render(
          <DocumentPreview value={valid} onReady={ready} onError={error} />,
        ),
      );
      expect(ready).toHaveBeenLastCalledWith(controller);
      expect(ready).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenCalledTimes(2);
      expect(controller.getHeadings()[0].anchor).toBe('ready');
    } finally {
      await act(async () => root.unmount());
    }
    expect(ready).toHaveBeenLastCalledWith(null);
  });
});
