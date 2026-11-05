import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentTools } from './content-tools';
import { createDocumentFile } from './document-files';
import type { WorkspaceSession } from '../session/workspace-session';

vi.mock(import('@sue/verd-board-ui'), async (importOriginal) => ({
  ...(await importOriginal()),
  VmDialog: ({ children }: { children: React.ReactNode }) => (
    <section role="dialog">{children}</section>
  ),
  DocumentPreview: () => null,
  CanvasPreview: () => null,
  ContentPropertiesPanel: () => null,
  ContentImageProperties: () => null,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('content conflict action delegation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['success', 'failure', 'readonly'] as const)(
    '%s keeps the action and dialog state consistent',
    async (scenario) => {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      const resolveConflict = vi.fn();
      const file = createDocumentFile('doc', 'Conflict');
      const session = {
        getState: () => ({
          documents: new Map([['doc', { file, conflicted: true }]]),
          files: new Map(),
          entries: [],
        }),
        readRawFile: vi.fn().mockRejectedValue(new Error('No revisions')),
        resolveConflict,
      } as unknown as WorkspaceSession;
      const onKeepBoth = vi.fn(async () => {
        if (scenario === 'failure') throw new Error('Conflict action failed');
      });
      try {
        await act(async () =>
          root.render(
            <ContentTools
              session={session}
              fileId="doc"
              readonly={scenario === 'readonly'}
              onKeepBoth={onKeepBoth}
              request={{ nonce: 1, tab: 'conflict' }}
            />,
          ),
        );
        const button = [...container.querySelectorAll('button')].find(
          (item) => item.textContent === '保留两份',
        )!;
        expect(button.disabled).toBe(scenario === 'readonly');
        await act(async () => button.click());
        expect(onKeepBoth).toHaveBeenCalledTimes(
          scenario === 'readonly' ? 0 : 1,
        );
        expect(resolveConflict).not.toHaveBeenCalled();
        expect(container.querySelector('[role="dialog"]') !== null).toBe(
          scenario !== 'success',
        );
        if (scenario === 'failure')
          expect(
            container.querySelector('[role="alert"]')?.textContent,
          ).toContain('Conflict action failed');
      } finally {
        await act(async () => root.unmount());
        container.remove();
      }
    },
  );
});
