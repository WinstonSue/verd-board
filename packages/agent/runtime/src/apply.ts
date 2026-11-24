import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  openWorkspaceSession,
  workspaceFileId,
  validateNativeWorkspace,
  type CommitRequest,
  type CommitReceipt,
  type WorkspaceHost,
} from '@sue/verd-board-workspace';
import { createFsWorkspaceHost } from './node/workspace-host-fs';
import { readNativeSnapshot, withWorkspaceLock } from './node/workspace-lock';
import { migrateWorkspaceMetadataUnlocked } from './node/workspace-metadata';
import { planIntegrity } from './authoring';
import type { PreparedBatch } from './types';

/** Replays the same frozen bytes and transaction identity, never a newly generated plan. */
export async function applyPreparedBatch(root: string, plan: PreparedBatch) {
  root = path.resolve(root);
  if (
    plan.format !== 'verd-authoring-plan' ||
    plan.version !== 1 ||
    plan.integrity !== planIntegrity(plan) ||
    !/^[a-zA-Z0-9-]+$/.test(plan.transactionId)
  )
    throw new Error('INVALID_PLAN: malformed or edited prepared batch');
  if (plan.diagnostics.some((d) => d.severity === 'error'))
    throw new Error('VALIDATION_FAILED: fix plan diagnostics before applying');
  // An already confirmed transaction wins over the now-stale input snapshot.
  const receiptPath = path.join(
    root,
    '.verdscrolls',
    'receipts',
    plan.transactionId + '.json',
  );
  const readRecordedReceipt = () =>
    fs.readFile(receiptPath, 'utf8').then(
      (s) => JSON.parse(s) as CommitReceipt,
      (error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
  let recorded = await readRecordedReceipt();
  if (recorded?.outcome === 'applied') return recorded;
  await withWorkspaceLock(root, () => migrateWorkspaceMetadataUnlocked(root));
  recorded = await readRecordedReceipt();
  if (recorded?.outcome === 'applied') return recorded;
  if (
    await fs
      .access(
        path.join(
          root,
          '.verdscrolls',
          'transactions',
          plan.transactionId + '.json',
        ),
      )
      .then(
        () => true,
        () => false,
      )
  ) {
    const recovering = createFsWorkspaceHost({ defaultRoot: () => root });
    const handle = await recovering.openWorkspace({ path: root, create: true });
    if (handle) await recovering.closeWorkspace(handle);
    const confirmed = await fs.readFile(receiptPath, 'utf8').then(
      (s) => JSON.parse(s) as CommitReceipt,
      () => null,
    );
    if (confirmed?.outcome === 'applied') return confirmed;
  }
  const snapshot = await readNativeSnapshot(root);
  if ((plan.resourceId ?? null) !== (snapshot.resourceId ?? null))
    throw new Error(
      'VERSION_CONFLICT: shared tool/specification version changed; prepare a new plan',
    );
  if (snapshot.version !== plan.workspaceVersion)
    throw new Error('VERSION_CONFLICT: inspect and prepare again');
  const final = new Map(
    snapshot.entries.map((e) => [
      e.file && typeof e.file === 'object'
        ? workspaceFileId(e.file as never)
        : e.path,
      e,
    ]),
  );
  for (const id of plan.removeIds) final.delete(id);
  for (const e of plan.files)
    final.set(workspaceFileId(e.file), { ...e, source: '', version: '' });
  const baseline = new Set(
    validateNativeWorkspace(snapshot.entries, {
      folderIds: snapshot.folderIds,
    }).map((d) => JSON.stringify(d)),
  );
  const errors = validateNativeWorkspace([...final.values()], {
    folderIds: snapshot.folderIds,
  }).filter((d) => d.severity === 'error' && !baseline.has(JSON.stringify(d)));
  if (errors.length)
    throw new Error('VALIDATION_FAILED: ' + JSON.stringify(errors));
  const host = createFsWorkspaceHost({
    defaultRoot: () => root,
    pickDirectory: async () => root,
  });
  const handle = await host.openWorkspace({ path: root, create: true });
  if (!handle) throw new Error('Workspace could not be opened');
  let receipt: CommitReceipt | undefined;
  const guarded: WorkspaceHost = Object.create(host);
  guarded.commit = async (h, request: CommitRequest) => {
    receipt = await host.commit(h, {
      ...request,
      transactionId: plan.transactionId,
      expectedWorkspaceVersion: plan.workspaceVersion,
      expectedAgentResourceId: plan.resourceId ?? null,
    });
    // A reviewed batch must not fall through to autosave's per-path recovery.
    if (receipt.outcome !== 'applied')
      throw new Error('Agent batch was not committed');
    return receipt;
  };
  const session = await openWorkspaceSession(guarded, handle, {
    delayMs: 60000,
  });
  try {
    const result = await session.apply({
      type: 'batch',
      files: plan.files,
      removeIds: plan.removeIds,
      repairPaths: plan.files.map((e) => e.path),
      label: 'Agent authoring batch',
    });
    if (!result.ok)
      throw new Error(
        'VALIDATION_FAILED: ' + JSON.stringify(result.diagnostics),
      );
    const saved = await session.flush();
    if (!saved)
      throw new Error(
        receipt?.reason === 'version-conflict'
          ? 'VERSION_CONFLICT: inspect and prepare again'
          : receipt?.reason && receipt.reason !== 'io-error'
            ? 'VALIDATION_FAILED: ' + receipt.reason
            : 'COMMIT_UNCONFIRMED: retry this exact plan to confirm the transaction',
      );
    return (
      receipt ?? {
        transactionId: plan.transactionId,
        outcome: 'applied' as const,
        versions: {},
      }
    );
  } finally {
    session.dispose();
    await host.closeWorkspace(handle);
  }
}
