import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameCell } from '@sue/board-core';
import { CanvasPreview } from '@sue/verd-board-ui';
import {
  WorkspaceContentBoundary,
  WorkspaceFileError,
} from './workspace-content-boundary';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function ThrowingChild({ effect = false }: { effect?: boolean }) {
  useEffect(() => {
    if (effect) throw new Error('mount failed');
  }, [effect]);
  if (!effect) throw new Error('render failed');
  return <p>Body</p>;
}

describe('workspace content boundary', () => {
  it.each([false, true])(
    'contains render/mount failure (effect: %s) without unmounting siblings',
    async (effect) => {
      await act(async () =>
        root.render(
          <>
            <nav>File tree</nav>
            <WorkspaceContentBoundary resetKeys={['one']} path="broken.verd">
              <ThrowingChild effect={effect} />
            </WorkspaceContentBoundary>
            <article>Healthy document</article>
          </>,
        ),
      );
      expect(container.querySelector('nav')?.textContent).toBe('File tree');
      expect(container.querySelector('article')?.textContent).toBe(
        'Healthy document',
      );
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        effect ? 'mount failed' : 'render failed',
      );
    },
  );

  it('contains a real FrameCanvas runtime failure and resets when content changes', async () => {
    const frame = createFrameCell('preview');
    const invalid = {
      store: {
        rootId: frame.id,
        cells: { [frame.id]: { ...frame, children: ['missing'] } },
      },
    };
    const valid = { store: { rootId: frame.id, cells: { [frame.id]: frame } } };
    await act(async () =>
      root.render(
        <WorkspaceContentBoundary resetKeys={[invalid]}>
          <CanvasPreview value={invalid} frameId={frame.id} />
        </WorkspaceContentBoundary>,
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Missing child',
    );
    await act(async () =>
      root.render(
        <WorkspaceContentBoundary resetKeys={[valid]}>
          <CanvasPreview value={valid} frameId={frame.id} />
        </WorkspaceContentBoundary>,
      ),
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector('svg[aria-label="Frame canvas"]'),
    ).not.toBeNull();
  });

  it('does not reset on a save-only render and retries explicitly', async () => {
    const key = {};
    const retry = vi.fn();
    const render = (body: boolean, active = true) => (
      <WorkspaceContentBoundary
        pane
        active={active}
        resetKeys={[key]}
        onRetry={retry}
      >
        {body ? <p>Recovered</p> : <ThrowingChild />}
      </WorkspaceContentBoundary>
    );
    await act(async () => root.render(render(false)));
    await act(async () => root.render(render(true, false)));
    expect(container.textContent).not.toContain('Recovered');
    expect(
      container
        .querySelector('.workspace-pane')
        ?.classList.contains('is-active'),
    ).toBe(false);
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === '重试')!
        .click(),
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Recovered');
  });

  it('reports asynchronous retry failure locally', async () => {
    await act(async () =>
      root.render(
        <WorkspaceFileError
          message="Invalid source"
          onRetry={async () => {
            throw new Error('Read failed');
          }}
        />,
      ),
    );
    await act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === '重试')!
        .click(),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Read failed',
    );
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
});
