import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FrameReferenceBoundary } from './frame-reference-boundary';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the containing content alive when a reference renderer fails and recovers on source change', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const open = vi.fn();
  function Broken(): never {
    throw new Error('Embedded renderer failed');
  }
  try {
    await act(async () =>
      root.render(
        <>
          <p>Parent content</p>
          <FrameReferenceBoundary revision={1} language="zh" onOpen={open}>
            <Broken />
          </FrameReferenceBoundary>
        </>,
      ),
    );
    expect(container.textContent).toContain('Parent content');
    expect(
      container.querySelector('[data-reference-error]')?.textContent,
    ).toContain('Embedded renderer failed');
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === '打开原图')!
        .click(),
    );
    expect(open).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        <>
          <p>Parent content</p>
          <FrameReferenceBoundary revision={2} language="zh" onOpen={open}>
            <p>Repaired reference</p>
          </FrameReferenceBoundary>
        </>,
      ),
    );
    expect(container.querySelector('[data-reference-error]')).toBeNull();
    expect(container.textContent).toContain('Repaired reference');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    error.mockRestore();
  }
});
