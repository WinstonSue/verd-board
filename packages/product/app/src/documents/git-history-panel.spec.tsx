import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkspaceSession,
  WorkspaceSessionSnapshot,
} from '../session/workspace-session';
import type {
  WorkspaceGitRequest,
  WorkspaceGitResult,
  WorkspaceGitStatus,
} from '../host/workspace-git';
import { createDocumentFile } from './document-files';
import { GitHistoryPanel, gitVersionSnapshot } from './git-history-panel';

vi.mock(import('@sue/verd-board-ui'), async (original) => ({
  ...(await original()),
  WorkspaceButton: ({
    children,
    busy: _busy,
    intent: _intent,
    danger: _danger,
    ...props
  }: React.ComponentProps<'button'> & {
    busy?: boolean;
    intent?: string;
    danger?: boolean;
  }) => <button {...props}>{children}</button>,
  WorkspaceInput: (props: React.ComponentProps<'input'>) => (
    <input {...props} />
  ),
  WorkspaceAlert: ({
    title,
    description,
  }: {
    title: string;
    description?: React.ReactNode;
  }) => (
    <div role="alert">
      {title}
      {description}
    </div>
  ),
  WorkspaceEmptyState: ({ description }: { description: string }) => (
    <p>{description}</p>
  ),
  CanvasPreview: () => null,
  DocumentPreview: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { root: Root; container: HTMLElement }[] = [];
afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount());
    item.container.remove();
  }
});

const initialStatus = (): WorkspaceGitStatus => ({
  available: true,
  initialized: true,
  branch: 'main',
  head: 'a'.repeat(40),
  token: 'observed-state',
  changes: [{ path: 'notes.txt', status: 'modified', staged: false }],
  canSync: false,
  author: { name: 'Writer', email: 'writer@example.com' },
});
function setup(
  handler?: (
    request: WorkspaceGitRequest,
  ) => WorkspaceGitResult | Promise<WorkspaceGitResult>,
  status = initialStatus(),
) {
  const current = {
    files: new Map(),
    documents: new Map(),
    entries: [{ path: 'notes.txt', kind: 'file', canvas: false }],
    trash: [{ entryId: 'trash-1', originalPath: 'deleted.txt', trashedAt: 1 }],
  } as unknown as WorkspaceSessionSnapshot;
  const git = vi.fn(
    async (request: WorkspaceGitRequest): Promise<WorkspaceGitResult> => {
      if (handler) return handler(request);
      return { status, ...(request.type === 'log' ? { commits: [] } : {}) };
    },
  );
  const session = {
    getState: () => current,
    subscribe: () => () => {},
    git,
  } as unknown as WorkspaceSession;
  return { session, git, current, status };
}
async function render(
  session: WorkspaceSession,
  props: Partial<React.ComponentProps<typeof GitHistoryPanel>> = {},
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () =>
    root.render(<GitHistoryPanel session={session} locale="en" {...props} />),
  );
  return container;
}
const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find(
    (item) => item.textContent === text,
  )!;

describe('Git version controls', () => {
  it.each(['zh', 'en'] as const)(
    'provides official platform cleanup steps and clone guidance in %s',
    async (locale) => {
      const { session } = setup(undefined, {
        ...initialStatus(),
        cleanup: {
          phase: 'platform-pending',
          message: 'Platform cleanup remains',
          pending: ['Provider and other clones'],
        },
      });
      const container = await render(session, { locale });
      const instructions = container.querySelector<HTMLElement>(
        `[aria-label="${locale === 'zh' ? '托管平台清理说明' : 'Hosting platform cleanup instructions'}"]`,
      )!;
      expect(instructions).not.toBeNull();
      expect(
        [...instructions.querySelectorAll('a')].map((link) => link.href),
      ).toEqual([
        'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository',
        'https://docs.gitlab.com/user/project/repository/repository_size/',
        'https://docs.gitlab.com/administration/housekeeping/',
      ]);
      for (const link of instructions.querySelectorAll('a')) {
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
      }
      expect(instructions.textContent).toContain(
        locale === 'zh'
          ? '不受理普通非敏感数据清理'
          : 'does not remove non-sensitive data',
      );
      expect(instructions.textContent).toContain(
        locale === 'zh'
          ? '重新克隆清理后的仓库'
          : 'clone the cleaned repository again',
      );
      expect(instructions.textContent).toContain('Prune unreachable objects');
    },
  );

  it('previews a renamed file through the commit alias while restoring to its current path', async () => {
    const status = initialStatus();
    const { session, git } = setup(async (request) => {
      if (request.type === 'log')
        return {
          status,
          commits: [
            {
              oid: 'd'.repeat(40),
              message: 'Before rename',
              author: 'Writer',
              email: '',
              at: 1000,
              parents: [],
              path: 'old-notes.txt',
            },
          ],
        };
      if (request.type === 'read')
        return {
          status,
          files: [
            {
              path: 'old-notes.txt',
              content: new TextEncoder().encode('Content before renaming'),
            },
          ],
        };
      return { status };
    });
    const container = await render(session);
    await act(async () => button(container, 'View history').click());
    await act(async () => button(container, 'Preview').click());
    expect(
      container.querySelector('[data-testid="git-version-preview"]')
        ?.textContent,
    ).toContain('Content before renaming');
    expect(
      container.querySelector<HTMLSelectElement>(
        '[data-testid="git-version-preview"] select',
      )?.value,
    ).toBe('path:old-notes.txt');
    await act(async () => button(container, 'Restore file…').click());
    expect(git).toHaveBeenCalledWith({
      type: 'restore-plan',
      oid: 'd'.repeat(40),
      path: 'notes.txt',
    });
  });

  it('allows Desktop remote configuration before a remote is configured', async () => {
    const { session } = setup(undefined, {
      ...initialStatus(),
      remoteSupported: true,
      canSync: false,
    });
    const container = await render(session);
    const remoteFieldset = [...container.querySelectorAll('fieldset')].find(
      (item) => item.textContent?.includes('Repository URL'),
    )!;
    expect(remoteFieldset.disabled).toBe(false);
    expect(button(container, 'Sync').disabled).toBe(true);
  });

  it('commits only the selected paths and shows native reference dependencies', async () => {
    const status = initialStatus();
    status.changes.push({
      path: 'reference.verd-doc.json',
      status: 'added',
      staged: false,
    });
    const { session, git, current } = setup(undefined, status);
    current.fileIdByPath = new Map([['notes.txt', 'source']]);
    current.references = {
      targetsOf: new Map([
        [
          'source',
          [{ sourceId: 'source', targetId: 'target', targetKind: 'document' }],
        ],
      ]),
      referencedBy: new Map(),
    };
    current.documents = new Map([
      [
        'target',
        {
          file: createDocumentFile('target'),
          path: 'reference.verd-doc.json',
          dirty: false,
        },
      ],
    ]);
    const container = await render(session);
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('[aria-label="Select notes.txt"]')!
        .click(),
    );
    expect(container.textContent).toContain(
      'Include dependencies that have not been committed',
    );
    await act(async () =>
      container
        .querySelector<HTMLInputElement>(
          '[aria-label="Select reference.verd-doc.json"]',
        )!
        .click(),
    );
    await act(async () =>
      button(container, 'Commit selected files (2)').click(),
    );
    expect(git).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commit',
        paths: ['notes.txt', 'reference.verd-doc.json'],
      }),
    );
  });

  it('commits an ordinary file with the observed token and a default message', async () => {
    const { session, git } = setup();
    const container = await render(session);
    await act(async () => button(container, 'Commit this file').click());
    expect(git).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commit',
        paths: ['notes.txt'],
        expectedToken: 'observed-state',
        message: 'Update workspace',
      }),
    );
    expect(git.mock.calls.some(([request]) => request.type === 'sync')).toBe(
      false,
    );
    expect(button(container, 'Sync').disabled).toBe(true);
  });

  it('requires a reviewed plan before restoring, and retains failed plans for review', async () => {
    const status = initialStatus();
    const { session, git } = setup(async (request) => {
      if (request.type === 'log')
        return {
          status,
          commits: [
            {
              oid: 'b'.repeat(40),
              message: 'Earlier version',
              author: 'Writer',
              email: 'writer@example.com',
              at: 1000,
              parents: [],
            },
          ],
        };
      if (request.type === 'restore-plan')
        return {
          status,
          plan: {
            id: 'restore-plan',
            kind: 'restore',
            token: 'planned-state',
            scope: 'workspace',
            paths: [{ path: 'notes.txt', action: 'write' }],
            warnings: ['Replaces current content'],
          },
        };
      if (request.type === 'restore')
        throw new Error('Workspace changed; prepare another preview');
      return { status };
    });
    const container = await render(session);
    await act(async () => button(container, 'Restore workspace…').click());
    expect(git.mock.calls.some(([request]) => request.type === 'restore')).toBe(
      false,
    );
    expect(
      container.querySelector('[aria-label="Restore preview"]')?.textContent,
    ).toContain('notes.txt');
    await act(async () => button(container, 'Confirm restore').click());
    expect(git).toHaveBeenCalledWith({
      type: 'restore',
      planId: 'restore-plan',
      expectedToken: 'planned-state',
    });
    expect(container.textContent).toContain('Workspace changed');
    expect(button(container, 'Confirm restore')).toBeDefined();
  });

  it('filters ordinary-file history and prepares a file restore by its path', async () => {
    const status = initialStatus();
    const { session, git } = setup(async (request) => ({
      status,
      ...(request.type === 'log'
        ? {
            commits: [
              {
                oid: 'c'.repeat(40),
                message: 'Text file version',
                author: 'Writer',
                email: '',
                at: 1000,
                parents: [],
              },
            ],
          }
        : {}),
    }));
    const container = await render(session);
    await act(async () => button(container, 'View history').click());
    expect(git).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'log', path: 'notes.txt' }),
    );
    await act(async () => button(container, 'Restore file…').click());
    expect(git).toHaveBeenCalledWith({
      type: 'restore-plan',
      oid: 'c'.repeat(40),
      path: 'notes.txt',
    });
  });

  it('requires explicit acknowledgement of platform cleanup and leaves readonly operations disabled', async () => {
    const status = {
      ...initialStatus(),
      cleanup: {
        phase: 'platform-pending' as const,
        message: 'Provider cleanup required',
        pending: ['Other clones'],
      },
    };
    const { session, git } = setup(undefined, status);
    const container = await render(session);
    expect(button(container, 'Acknowledge cleanup').disabled).toBe(true);
    const checkbox = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((item) =>
      item.parentElement?.textContent?.includes('platform instructions'),
    )!;
    await act(async () => checkbox.click());
    await act(async () => button(container, 'Acknowledge cleanup').click());
    expect(git).toHaveBeenCalledWith({
      type: 'cleanup-confirm',
      expectedToken: 'observed-state',
    });
    const readonlyContainer = await render(session, { readonly: true });
    expect(button(readonlyContainer, 'Commit this file').disabled).toBe(true);
  });
});

it('builds historical references from one commit and excludes live-only files', () => {
  const live = createDocumentFile('live-only', 'Current content');
  const old = createDocumentFile('old-document', 'Historical content');
  const { current } = setup();
  current.documents = new Map([
    ['live-only', { file: live, path: 'Live.verd-doc.json', dirty: false }],
  ]);
  const snapshot = gitVersionSnapshot(
    current,
    [
      {
        path: 'Old.verd-doc.json',
        content: new TextEncoder().encode(JSON.stringify(old)),
      },
    ],
    'old-commit',
  );
  expect([...snapshot.documents.keys()]).toEqual(['old-document']);
  expect(snapshot.documents.get('old-document')?.file.title).toBe(
    'Historical content',
  );
  expect(snapshot.fileIdByPath.get('Old.verd-doc.json')).toBe('old-document');
  expect(snapshot.references.targetsOf.has('live-only')).toBe(false);
});
