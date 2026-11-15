import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { VersionHistoryPanel } from './version-history-panel';
import type { WorkspaceSession } from '@sue/verd-board-workspace';
import type { VersionRequest, VersionStatus } from '@sue/verd-board-workspace';
import { VersionError } from '@sue/verd-board-workspace';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
describe('provider-independent history', () => {
  it('confines a directory panel to its scope and hides provider terminology and diagnostics', async () => {
    const status: VersionStatus = {
      available: true,
      enabled: true,
      token: 'opaque',
      changes: [
        { path: 'folder/a.txt', status: 'modified' },
        { path: 'outside.txt', status: 'modified' },
      ],
      capabilities: {
        create: true,
        restore: true,
        directory: true,
        cleanup: true,
        sync: false,
      },
    };
    const versions = vi.fn(async (request: VersionRequest) => {
      if (request.type === 'create-plan')
        throw new VersionError('unsupported', 'fatal: Git object abc missing');
      return {
        status,
        versions:
          request.type === 'list'
            ? [
                {
                  id: 'opaque-revision',
                  message: 'Saved state',
                  author: 'Writer',
                  at: 1,
                },
              ]
            : [],
        plan:
          request.type === 'restore-plan'
            ? {
                id: 'restore',
                kind: 'restore' as const,
                token: 'opaque',
                paths: [],
              }
            : undefined,
      };
    });
    const session = {
      versions,
      getState: () => ({ files: new Map(), documents: new Map() }),
      subscribe: () => () => {},
    } as unknown as WorkspaceSession;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      const scope = {
        kind: 'directory' as const,
        path: 'folder',
        folderId: 'folder-id',
      };
      await act(async () =>
        root.render(
          <VersionHistoryPanel session={session} scope={scope} locale="en" />,
        ),
      );
      expect(container.textContent).toContain('folder/a.txt');
      expect(container.textContent).not.toContain('outside.txt');
      expect(container.textContent).not.toMatch(
        /Git|branch|commit|opaque-revision|workspace restore/i,
      );
      const click = async (label: string) =>
        act(async () => {
          [...container.querySelectorAll('button')]
            .find((b) => b.textContent === label)!
            .click();
        });
      await click('Restore this version…');
      expect(versions).toHaveBeenCalledWith({
        type: 'restore-plan',
        scope,
        versionId: 'opaque-revision',
      });
      await click('Cancel');
      await click('Create directory version');
      expect(container.textContent).toContain('version settings');
      expect(container.textContent).not.toContain('fatal:');
      expect(container.textContent).not.toContain('Git');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
