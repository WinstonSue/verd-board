import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeWorkspaceHostContract } from '../../../packages/product/app/src/host/workspace-host.contract';
import { createFsWorkspaceHost } from './workspace-host-fs';

const tmpRoots: string[] = [];
const makeTmp = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-fs-host-'));
  tmpRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    tmpRoots
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

const sha256 = (content: string | Uint8Array) =>
  `sha256-${crypto.createHash('sha256').update(content).digest('hex')}`;

const journalDir = (root: string) =>
  path.join(root, '.verdboard', 'transactions');
const journalFile = (root: string, id: string) =>
  path.join(journalDir(root), `${id}.json`);
const stagingDir = (root: string, id: string) =>
  path.join(journalDir(root), `${id}.staging`);

const writeJournal = async (
  root: string,
  id: string,
  journal: unknown,
  staged: Record<string, string> = {},
) => {
  await fs.mkdir(stagingDir(root, id), { recursive: true });
  for (const [name, content] of Object.entries(staged))
    await fs.writeFile(path.join(stagingDir(root, id), name), content);
  await fs.writeFile(journalFile(root, id), JSON.stringify(journal, null, 2));
};

const exists = (target: string) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

describeWorkspaceHostContract('fs host', async () => {
  const root = await makeTmp();
  const host = createFsWorkspaceHost({
    defaultRoot: () => path.join(root, 'default'),
    now: () => 1_700_000_000_000,
    watchDebounceMs: 10_000,
  });
  let counter = 0;
  return {
    host,
    open: async () =>
      (await host.openWorkspace({
        path: path.join(root, `ws-${++counter}`),
      })) ?? Promise.reject(new Error('open failed')),
  };
});

describe('fs host transaction recovery', () => {
  const setup = async () => {
    const root = await makeTmp();
    const workspace = path.join(root, 'ws');
    const host = createFsWorkspaceHost({
      defaultRoot: () => path.join(root, 'default'),
      now: () => 1_700_000_000_000,
      watchDebounceMs: 10_000,
    });
    const handle = await host.openWorkspace({ path: workspace });
    if (!handle) throw new Error('open failed');
    return { root, workspace, host, handle };
  };

  it('discards `prepared` journals and staging without touching files', async () => {
    const { workspace, handle, host } = await setup();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [{ path: 'a.txt', content: 'before', expectedVersion: null }],
    });
    await writeJournal(
      workspace,
      'tx-prepared',
      {
        transactionId: 'tx-prepared',
        phase: 'prepared',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: 'a.txt',
            before: sha256('before'),
            after: sha256('after'),
            staged: 'transactions/tx-prepared.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'after' },
    );
    await host.recoverWorkspace(workspace);
    expect(await exists(journalFile(workspace, 'tx-prepared'))).toBe(false);
    expect(await exists(stagingDir(workspace, 'tx-prepared'))).toBe(false);
    expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf-8')).toBe(
      'before',
    );
  });

  it('re-publishes `applying` ops whose target still equals `before`', async () => {
    const { workspace, handle, host } = await setup();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [{ path: 'a.txt', content: 'before', expectedVersion: null }],
    });
    await writeJournal(
      workspace,
      'tx-applying',
      {
        transactionId: 'tx-applying',
        phase: 'applying',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: 'a.txt',
            before: sha256('before'),
            after: sha256('after'),
            staged: 'transactions/tx-applying.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'after' },
    );
    await host.recoverWorkspace(workspace);
    expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf-8')).toBe(
      'after',
    );
    expect(await exists(journalFile(workspace, 'tx-applying'))).toBe(false);
    expect(await exists(stagingDir(workspace, 'tx-applying'))).toBe(false);
  });

  it('skips `applying` ops already published at `after`', async () => {
    const { workspace, host } = await setup();
    await fs.writeFile(path.join(workspace, 'a.txt'), 'after');
    await writeJournal(
      workspace,
      'tx-done',
      {
        transactionId: 'tx-done',
        phase: 'applying',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: 'a.txt',
            before: sha256('before'),
            after: sha256('after'),
            staged: 'transactions/tx-done.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'after' },
    );
    await host.recoverWorkspace(workspace);
    expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf-8')).toBe(
      'after',
    );
    expect(await exists(journalFile(workspace, 'tx-done'))).toBe(false);
  });

  it('finishes `applying` creates whose target never appeared', async () => {
    const { workspace, host } = await setup();
    await writeJournal(
      workspace,
      'tx-create',
      {
        transactionId: 'tx-create',
        phase: 'applying',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: 'new.txt',
            before: null,
            after: sha256('created'),
            staged: 'transactions/tx-create.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'created' },
    );
    await host.recoverWorkspace(workspace);
    expect(await fs.readFile(path.join(workspace, 'new.txt'), 'utf-8')).toBe(
      'created',
    );
  });

  it('redoes an `applying` move that has not happened', async () => {
    const { workspace, handle, host } = await setup();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [{ path: 'from.txt', content: 'moved', expectedVersion: null }],
    });
    await writeJournal(workspace, 'tx-move', {
      transactionId: 'tx-move',
      phase: 'applying',
      createdAt: 1,
      ops: [
        {
          kind: 'move',
          from: 'from.txt',
          to: 'to.txt',
          before: sha256('moved'),
          directory: false,
        },
      ],
    });
    await host.recoverWorkspace(workspace);
    expect(await exists(path.join(workspace, 'from.txt'))).toBe(false);
    expect(await fs.readFile(path.join(workspace, 'to.txt'), 'utf-8')).toBe(
      'moved',
    );
  });

  it('stops recovery on third-party versions and keeps the journal', async () => {
    const { root, workspace, handle, host } = await setup();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [{ path: 'a.txt', content: 'before', expectedVersion: null }],
    });
    // A third party overwrote the file mid-transaction.
    await fs.writeFile(path.join(workspace, 'a.txt'), 'third-party');
    await writeJournal(
      workspace,
      'tx-conflict',
      {
        transactionId: 'tx-conflict',
        phase: 'applying',
        createdAt: 1,
        ops: [
          {
            kind: 'write',
            path: 'a.txt',
            before: sha256('before'),
            after: sha256('after'),
            staged: 'transactions/tx-conflict.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'after' },
    );
    const diagnostics = await host.recoverWorkspace(workspace);
    expect(diagnostics.some((d) => d.includes('a.txt'))).toBe(true);
    expect(await exists(journalFile(workspace, 'tx-conflict'))).toBe(true);
    expect(await exists(stagingDir(workspace, 'tx-conflict'))).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf-8')).toBe(
      'third-party',
    );
    // A restart surfaces the kept journal as a snapshot diagnostic.
    const restarted = createFsWorkspaceHost({
      defaultRoot: () => path.join(root, 'default'),
      watchDebounceMs: 10_000,
    });
    const reopened = await restarted.openWorkspace({ path: workspace });
    const snapshot = await restarted.readSnapshot(reopened!);
    expect(snapshot.diagnostics.some((d) => d.message.includes('a.txt'))).toBe(
      true,
    );
  });

  it('only cleans staging for `applied` journals', async () => {
    const { workspace, host } = await setup();
    await fs.writeFile(path.join(workspace, 'a.txt'), 'after');
    await writeJournal(
      workspace,
      'tx-applied',
      {
        transactionId: 'tx-applied',
        phase: 'applied',
        createdAt: 1,
        appliedAt: 2,
        ops: [
          {
            kind: 'write',
            path: 'a.txt',
            before: sha256('before'),
            after: sha256('after'),
            staged: 'transactions/tx-applied.staging/0.bin',
          },
        ],
      },
      { '0.bin': 'after' },
    );
    await host.recoverWorkspace(workspace);
    expect(await exists(journalFile(workspace, 'tx-applied'))).toBe(false);
    expect(await exists(stagingDir(workspace, 'tx-applied'))).toBe(false);
    expect(await fs.readFile(path.join(workspace, 'a.txt'), 'utf-8')).toBe(
      'after',
    );
  });

  it('keeps the journal for recovery when publishing hits an I/O fault', async () => {
    const { root, workspace, handle, host } = await setup();
    await host.commit(handle, {
      transactionId: 'seed',
      writes: [{ path: 'blocked', content: 'a file', expectedVersion: null }],
    });
    // Publishing into a path whose parent is a file always fails.
    const receipt = await host.commit(handle, {
      transactionId: 'tx-fault',
      writes: [
        { path: 'blocked/inner.txt', content: 'x', expectedVersion: null },
      ],
    });
    expect(receipt.outcome).toBe('rejected');
    expect(receipt.reason).toBe('io-error');
    // The journal stays `applying` so a restart surfaces the conflict.
    expect(await exists(journalFile(workspace, 'tx-fault'))).toBe(true);
    const restarted = createFsWorkspaceHost({
      defaultRoot: () => path.join(root, 'default'),
      watchDebounceMs: 10_000,
    });
    const reopened = await restarted.openWorkspace({ path: workspace });
    const snapshot = await restarted.readSnapshot(reopened!);
    expect(snapshot.diagnostics.length).toBeGreaterThan(0);
    expect(await exists(journalFile(workspace, 'tx-fault'))).toBe(true);
  });

  it('replays rejected receipts from the receipts area', async () => {
    const { workspace, handle, host } = await setup();
    const rejected = await host.commit(handle, {
      transactionId: 'tx-reject',
      writes: [
        { path: 'nope/../evil.txt', content: 'x', expectedVersion: null },
      ],
    });
    expect(rejected.outcome).toBe('rejected');
    const receipts = await fs.readdir(
      path.join(workspace, '.verdboard', 'receipts'),
    );
    expect(receipts).toContain('tx-reject.json');
    const again = await host.commit(handle, {
      transactionId: 'tx-reject',
      writes: [{ path: 'ok.txt', content: 'y', expectedVersion: null }],
    });
    expect(again).toEqual(rejected);
  });

  it('persists workspaces across host instances', async () => {
    const root = await makeTmp();
    const workspace = path.join(root, 'ws');
    const hostA = createFsWorkspaceHost({
      defaultRoot: () => path.join(root, 'default'),
      watchDebounceMs: 10_000,
    });
    const handleA = await hostA.openWorkspace({ path: workspace });
    await hostA.commit(handleA!, {
      transactionId: 'tx-1',
      writes: [{ path: 'persist.txt', content: 'p', expectedVersion: null }],
    });
    await hostA.closeWorkspace(handleA!);
    const hostB = createFsWorkspaceHost({
      defaultRoot: () => path.join(root, 'default'),
      watchDebounceMs: 10_000,
    });
    const handleB = await hostB.openWorkspace({ path: workspace });
    const raw = await hostB.readFile(handleB!, 'persist.txt');
    expect(new TextDecoder().decode(raw.content)).toBe('p');
  });
});
