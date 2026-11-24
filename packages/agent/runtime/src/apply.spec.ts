import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyPreparedBatch } from './apply';
import { prepareAuthoringBatch } from './authoring';
import { readNativeSnapshot } from './node/workspace-lock';
import { initializeWorkspaceProject } from './node/workspace-init';

const staged = vi.hoisted(() => ({
  failure: undefined as 'version-conflict' | 'lost-response' | undefined,
  commits: 0,
}));
vi.mock('./node/workspace-host-fs', async (load) => {
  const runtime = await load<typeof import('./node/workspace-host-fs')>();
  return {
    ...runtime,
    createFsWorkspaceHost(
      ...args: Parameters<typeof runtime.createFsWorkspaceHost>
    ) {
      const host = runtime.createFsWorkspaceHost(...args);
      const commit = host.commit.bind(host);
      host.commit = async (handle, request) => {
        if (!request.expectedWorkspaceVersion) return commit(handle, request);
        ++staged.commits;
        if (staged.failure === 'version-conflict') {
          return {
            outcome: 'rejected',
            transactionId: request.transactionId,
            reason: 'version-conflict',
            path: '.verdscrolls/shared',
          };
        }
        const receipt = await commit(handle, request);
        if (staged.failure === 'lost-response')
          throw new Error('Lost response');
        return receipt;
      };
      return host;
    },
  };
});

let root: string | undefined;
afterEach(async () => {
  staged.failure = undefined;
  staged.commits = 0;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function twoFilePlan() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-batch-'));
  await initializeWorkspaceProject(root);
  const snapshot = await readNativeSnapshot(root);
  const files = ['one', 'two'];
  const plan = await prepareAuthoringBatch(
    snapshot,
    files.map((name) => ({
      type: 'file.create',
      kind: 'document',
      id: name,
      title: name,
      path: name + '.verd-doc.json',
    })),
  );
  return { root, snapshot, plan };
}

it('stops a reviewed batch after a path-specific conditional commit rejection', async () => {
  const { root, snapshot, plan } = await twoFilePlan();
  staged.failure = 'version-conflict';
  await expect(applyPreparedBatch(root, plan)).rejects.toThrow(
    'VERSION_CONFLICT',
  );
  expect(staged.commits).toBe(1);
  expect((await readNativeSnapshot(root)).entries).toEqual(snapshot.entries);
});

it('confirms a written multi-file batch from its original receipt after a lost response', async () => {
  const { root, plan } = await twoFilePlan();
  staged.failure = 'lost-response';
  await expect(applyPreparedBatch(root, plan)).rejects.toThrow(
    'COMMIT_UNCONFIRMED',
  );
  const after = await readNativeSnapshot(root);
  expect(after.entries.map((entry) => entry.path).sort()).toEqual([
    'one.verd-doc.json',
    'two.verd-doc.json',
  ]);
  expect(await applyPreparedBatch(root, plan)).toMatchObject({
    outcome: 'applied',
    transactionId: plan.transactionId,
  });
  expect(staged.commits).toBe(1);
  expect(await readNativeSnapshot(root)).toEqual(after);
});
