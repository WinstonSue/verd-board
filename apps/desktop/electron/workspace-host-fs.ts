import * as crypto from 'crypto';
import { watch, type FSWatcher } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createSerialQueue } from './storage-file';
import {
  baseName,
  conflictCommit,
  isCanvasPath,
  isDocumentPath,
  normalizeWorkspacePath,
  normalizeTrashEntryId,
  normalizeWorkspaceSessionState,
  parentWorkspacePath,
  WORKSPACE_META_DIR,
  type ChangeHint,
  type CommitReceipt,
  type CommitRequest,
  type ConflictResolution,
  type FileVersion,
  type GlobalConfigSnapshot,
  type OpenWorkspaceRequest,
  type RawFileRead,
  type WorkspaceEntryMeta,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceSessionState,
  type WorkspaceHostSnapshot,
} from '../../../packages/product/app/src/host/workspace-host';

const META_DIR = WORKSPACE_META_DIR;
const TRANSACTIONS_DIR = 'transactions';
const RECEIPTS_DIR = 'receipts';
const TRASH_DIR = 'trash';
const CONFIG_FILE = 'config.json';
const SESSION_FILE = 'session.json';
const GLOBAL_CONFIG_FILE = 'verdboard-global-config.json';

const sha256 = (content: Uint8Array): FileVersion =>
  `sha256-${crypto.createHash('sha256').update(content).digest('hex')}`;

const encode = (content: Uint8Array | string): Uint8Array =>
  typeof content === 'string' ? new TextEncoder().encode(content) : content;

const reject = (
  transactionId: string,
  reason: CommitReceipt['reason'],
  extra: Partial<CommitReceipt> = {},
): CommitReceipt => ({ transactionId, outcome: 'rejected', reason, ...extra });

const exists = async (target: string) =>
  fs
    .access(target)
    .then(() => true)
    .catch(() => false);

const fsyncFile = async (target: string) => {
  try {
    const handle = await fs.open(target, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* fsync is best-effort */
  }
};

const fsyncDir = async (target: string) => {
  try {
    const handle = await fs.open(target, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* directory fsync unsupported on some platforms */
  }
};

/** Publishes bytes atomically: same-directory temp file plus rename. */
const publishFile = async (target: string, content: Uint8Array) => {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content);
  const handle = await fs.open(tmp, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, target);
  await fsyncDir(path.dirname(target));
};

const writeJsonFile = (target: string, value: unknown) =>
  publishFile(target, encode(JSON.stringify(value, null, 2)));

const readJsonFile = async (target: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await fs.readFile(target, 'utf-8'));
  } catch {
    return null;
  }
};

type JournalOp =
  | {
      kind: 'write';
      path: string;
      before: FileVersion | null;
      after: FileVersion;
      staged: string;
    }
  | {
      kind: 'move';
      from: string;
      to: string;
      before: FileVersion | null;
      directory: boolean;
    }
  | { kind: 'mkdir'; path: string }
  | { kind: 'purge'; entryId: string }
  | {
      kind: 'trash';
      path: string;
      before: FileVersion | null;
      directory: boolean;
      entryId: string;
    }
  | {
      kind: 'restore';
      entryId: string;
      basename: string;
      to: string;
      subtree: { path: string; kind: 'file' | 'directory' }[];
    }
  | {
      kind: 'config';
      before: FileVersion | null;
      after: FileVersion;
      staged: string;
    }
  | { kind: 'session'; staged: string };

interface TransactionJournal {
  transactionId: string;
  phase: 'prepared' | 'applying' | 'applied';
  createdAt: number;
  appliedAt?: number;
  ops: JournalOp[];
}

interface FsWorkspace {
  id: string;
  root: string;
  name: string;
  queue: <T>(task: () => Promise<T>) => Promise<T>;
  watcher: FSWatcher | null;
  /** Digests this host published, for suppressing its own watcher events. */
  ownWrites: Map<string, FileVersion>;
  listeners: Set<(hint: ChangeHint) => void>;
  /** Recovery conflicts detected at open; surfaced via snapshot diagnostics. */
  recoveryDiagnostics: string[];
}

export interface FsWorkspaceHostOptions {
  /** Root used for `{default: true}` open requests. */
  defaultRoot: () => string;
  /** Global config lives next to the workspaces directory by default. */
  globalConfigPath?: () => string;
  pickDirectory?: () => Promise<string | null>;
  now?: () => number;
  watchDebounceMs?: number;
}

const metaPath = (root: string, ...parts: string[]) =>
  path.join(root, META_DIR, ...parts);

const isValidCanvas = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as {
    format?: unknown;
    version?: unknown;
    frame?: { id?: unknown; cellType?: unknown };
    cells?: Record<string, { id?: unknown; cellType?: unknown }>;
  };
  return (
    candidate.format === 'verd-frame' &&
    candidate.version === 2 &&
    !!candidate.frame &&
    typeof candidate.frame === 'object' &&
    candidate.frame.cellType === 'frame' &&
    typeof candidate.frame.id === 'string' &&
    !!candidate.cells &&
    typeof candidate.cells === 'object' &&
    !Array.isArray(candidate.cells) &&
    Object.entries(candidate.cells).every(
      ([id, cell]) =>
        !!cell &&
        typeof cell === 'object' &&
        cell.id === id &&
        cell.cellType !== 'frame',
    )
  );
};

/**
 * Envelope check only — deep text-schema validation lives in the session
 * (renderer side); the host just decides which payload channel a file
 * belongs to so unknown bodies still surface as diagnostics, not loss.
 */
const isValidDocument = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as {
    format?: unknown;
    version?: unknown;
    id?: unknown;
    title?: unknown;
    text?: { id?: unknown; kind?: unknown; content?: unknown };
  };
  return (
    candidate.format === 'verd-document' &&
    candidate.version === 1 &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    !!candidate.text &&
    typeof candidate.text === 'object' &&
    candidate.text.kind === 'block' &&
    candidate.text.id === candidate.id &&
    !!candidate.text.content &&
    typeof candidate.text.content === 'object'
  );
};

/**
 * File-system WorkspaceHost. Every commit runs inside a per-workspace serial
 * channel as a journaled transaction: `prepared` validates versions and stages
 * bytes without touching user files, `applying` publishes via same-directory
 * temp + rename, `applied` cleans staging. Recovery at open replays journals
 * by comparing before/after/current digests and stops on third-party versions.
 */
export const createFsWorkspaceHost = (
  options: FsWorkspaceHostOptions,
): WorkspaceHost & {
  workspaces: Map<string, FsWorkspace>;
  recoverWorkspace: (root: string) => Promise<string[]>;
  /** Resolves once every workspace write channel has drained. */
  waitIdle: () => Promise<void>;
} => {
  const workspaces = new Map<string, FsWorkspace>();
  const workspacesByRoot = new Map<string, FsWorkspace>();
  const now = options.now ?? Date.now;
  const debounceMs = options.watchDebounceMs ?? 120;
  const globalConfigPath =
    options.globalConfigPath ??
    (() => path.join(options.defaultRoot(), '..', GLOBAL_CONFIG_FILE));
  let counter = 0;

  const relative = (root: string, absolute: string) =>
    path.relative(root, absolute).split(path.sep).join('/');
  const absolute = (root: string, relativePath: string) =>
    path.join(root, ...relativePath.split('/'));

  const versionAt = async (
    root: string,
    relativePath: string,
  ): Promise<FileVersion | null> => {
    try {
      return sha256(await fs.readFile(absolute(root, relativePath)));
    } catch {
      return null;
    }
  };

  const listSubtree = async (
    root: string,
    relativePath: string,
  ): Promise<{ path: string; kind: 'file' | 'directory' }[]> => {
    const target = absolute(root, relativePath);
    const stat = await fs.stat(target).catch(() => null);
    if (!stat) return [];
    const base = [
      {
        path: relativePath,
        kind: stat.isDirectory() ? ('directory' as const) : ('file' as const),
      },
    ];
    if (!stat.isDirectory()) return base;
    const children = await fs.readdir(target);
    const nested = await Promise.all(
      children.map((child) => listSubtree(root, `${relativePath}/${child}`)),
    );
    return base.concat(...nested);
  };

  const journalPath = (root: string, transactionId: string) =>
    metaPath(root, TRANSACTIONS_DIR, `${transactionId}.json`);
  const stagingDir = (root: string, transactionId: string) =>
    metaPath(root, TRANSACTIONS_DIR, `${transactionId}.staging`);
  const receiptPath = (root: string, transactionId: string) =>
    metaPath(root, RECEIPTS_DIR, `${transactionId}.json`);
  /** Meta-relative staged path so journal ops stay self-contained. */
  const stagedPath = (transactionId: string, name: string) =>
    `${TRANSACTIONS_DIR}/${transactionId}.staging/${name}`;

  const readReceipt = async (
    root: string,
    transactionId: string,
  ): Promise<CommitReceipt | null> => {
    const value = await readJsonFile(receiptPath(root, transactionId));
    return value &&
      typeof value === 'object' &&
      (value as CommitReceipt).transactionId === transactionId
      ? (value as CommitReceipt)
      : null;
  };

  const writeJournal = async (root: string, journal: TransactionJournal) => {
    const target = journalPath(root, journal.transactionId);
    await writeJsonFile(target, journal);
    await fsyncFile(target);
  };

  const removeDir = async (target: string) => {
    await fs.rm(target, { recursive: true, force: true });
  };

  const publishSubtreeMove = async (root: string, from: string, to: string) => {
    await fs.mkdir(path.dirname(absolute(root, to)), { recursive: true });
    await fs.rename(absolute(root, from), absolute(root, to));
    await fsyncDir(path.dirname(absolute(root, to)));
  };

  const applyJournalOp = async (root: string, op: JournalOp) => {
    if (op.kind === 'write') {
      const content = await fs.readFile(metaPath(root, op.staged));
      await publishFile(absolute(root, op.path), content);
      return;
    }
    if (op.kind === 'move') {
      if (!(await exists(absolute(root, op.to))))
        await publishSubtreeMove(root, op.from, op.to);
      return;
    }
    if (op.kind === 'mkdir') {
      await fs.mkdir(absolute(root, op.path), { recursive: true });
      return;
    }
    if (op.kind === 'purge') {
      await removeDir(
        metaPath(root, TRASH_DIR, normalizeTrashEntryId(op.entryId)),
      );
      return;
    }
    if (op.kind === 'trash') {
      const entryDir = metaPath(root, TRASH_DIR, op.entryId);
      await fs.mkdir(entryDir, { recursive: true });
      // entry.json first: a half-finished trash is recognizable and resumable.
      await writeJsonFile(path.join(entryDir, 'entry.json'), {
        entryId: op.entryId,
        originalPath: op.path,
        trashedAt: now(),
      });
      const parent = parentWorkspacePath(op.path);
      const stored = (nodePath: string) =>
        path.join(
          entryDir,
          ...(parent ? nodePath.slice(parent.length + 1) : nodePath)
            .split('/')
            .filter(Boolean),
        );
      const subtree = (await listSubtree(root, op.path)).sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      for (const node of subtree) {
        const source = absolute(root, node.path);
        if (!(await exists(source))) continue;
        const destination = stored(node.path);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        if (node.kind === 'directory')
          await fs.mkdir(destination, { recursive: true });
        else await fs.rename(source, destination);
      }
      for (const node of [...subtree].reverse()) {
        if (node.kind === 'directory')
          await fs.rmdir(absolute(root, node.path)).catch(() => undefined);
      }
      return;
    }
    if (op.kind === 'restore') {
      const entryDir = metaPath(root, TRASH_DIR, op.entryId);
      for (const node of op.subtree) {
        const source = path.join(
          entryDir,
          op.basename,
          ...node.path.slice(op.to.length).split('/').filter(Boolean),
        );
        if (!(await exists(source))) continue;
        const destination = absolute(root, node.path);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        if (node.kind === 'directory')
          await fs.mkdir(destination, { recursive: true });
        else await fs.rename(source, destination);
      }
      await removeDir(entryDir);
      return;
    }
    if (op.kind === 'config' || op.kind === 'session') {
      const content = await fs.readFile(metaPath(root, op.staged));
      const target =
        op.kind === 'config'
          ? metaPath(root, CONFIG_FILE)
          : metaPath(root, SESSION_FILE);
      await publishFile(target, content);
    }
  };

  /** Replays an `applying` journal; returns a conflict description or null. */
  const finishJournal = async (
    root: string,
    journal: TransactionJournal,
  ): Promise<string | null> => {
    const stagedContent = async (staged: string) => {
      try {
        return await fs.readFile(metaPath(root, staged));
      } catch {
        return null;
      }
    };
    const tryApply = async (op: JournalOp, label: string) => {
      try {
        await applyJournalOp(root, op);
        return null;
      } catch (error) {
        return `Recovery could not apply ${label}: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    };
    for (const op of journal.ops) {
      if (op.kind === 'write') {
        const current = await versionAt(root, op.path);
        if (current === op.after) continue;
        if (current === op.before && (await stagedContent(op.staged))) {
          const appliedError = await tryApply(op, `write ${op.path}`);
          if (appliedError) return appliedError;
          continue;
        }
        return `Recovery conflict at ${op.path}: found third version`;
      }
      if (op.kind === 'move') {
        if (await exists(absolute(root, op.to))) continue;
        const stat = await fs.stat(absolute(root, op.from)).catch(() => null);
        if (!stat) return `Recovery conflict at ${op.from}: source vanished`;
        if (stat.isFile()) {
          const current = await versionAt(root, op.from);
          if (current !== op.before)
            return `Recovery conflict at ${op.from}: found third version`;
        }
        const appliedError = await tryApply(op, `move ${op.from}`);
        if (appliedError) return appliedError;
        continue;
      }
      if (op.kind === 'mkdir') {
        const appliedError = await tryApply(op, `mkdir ${op.path}`);
        if (appliedError) return appliedError;
        continue;
      }
      if (op.kind === 'purge') {
        const appliedError = await tryApply(op, `purge ${op.entryId}`);
        if (appliedError) return appliedError;
        continue;
      }
      if (op.kind === 'trash') {
        const stat = await fs.stat(absolute(root, op.path)).catch(() => null);
        if (!stat) {
          if (await exists(metaPath(root, TRASH_DIR, op.entryId))) continue;
          return `Recovery conflict at ${op.path}: source vanished`;
        }
        const current = await versionAt(root, op.path);
        if (op.directory || current === op.before) {
          const appliedError = await tryApply(op, `trash ${op.path}`);
          if (appliedError) return appliedError;
          continue;
        }
        return `Recovery conflict at ${op.path}: found third version`;
      }
      if (op.kind === 'restore') {
        if (await exists(absolute(root, op.to))) continue;
        if (await exists(metaPath(root, TRASH_DIR, op.entryId))) {
          const appliedError = await tryApply(op, `restore ${op.entryId}`);
          if (appliedError) return appliedError;
          continue;
        }
        return `Recovery conflict at ${op.entryId}: trash entry vanished`;
      }
      const staged = await stagedContent(op.staged);
      const current = await versionAt(
        root,
        `${META_DIR}/${op.kind === 'config' ? CONFIG_FILE : SESSION_FILE}`,
      );
      if (op.kind === 'session') {
        if (staged) {
          const appliedError = await tryApply(op, 'session');
          if (appliedError) return appliedError;
        }
        continue;
      }
      if (current === op.after) continue;
      if (current === op.before && staged) {
        const appliedError = await tryApply(op, 'config');
        if (appliedError) return appliedError;
        continue;
      }
      return `Recovery conflict at ${op.kind}: found third version`;
    }
    return null;
  };

  /** Startup recovery: finish or clean each journal before the workspace loads. */
  const recoverWorkspace = async (root: string): Promise<string[]> => {
    const diagnostics: string[] = [];
    const dir = metaPath(root, TRANSACTIONS_DIR);
    const names = (await fs.readdir(dir).catch(() => [] as string[]))
      .filter((name) => name.endsWith('.json'))
      .sort();
    for (const name of names) {
      const journal = (await readJsonFile(
        path.join(dir, name),
      )) as TransactionJournal | null;
      if (!journal || typeof journal.phase !== 'string') {
        diagnostics.push(`Discarding unreadable transaction log: ${name}`);
        await fs.rm(path.join(dir, name), { force: true });
        continue;
      }
      if (journal.phase === 'prepared') {
        await removeDir(stagingDir(root, journal.transactionId));
        await fs.rm(path.join(dir, name), { force: true });
        continue;
      }
      if (journal.phase === 'applied') {
        await removeDir(stagingDir(root, journal.transactionId));
        await fs.rm(path.join(dir, name), { force: true });
        continue;
      }
      const prior = await readReceipt(root, journal.transactionId);
      if (prior?.outcome === 'applied') {
        await removeDir(stagingDir(root, journal.transactionId));
        await fs.rm(path.join(dir, name), { force: true });
        continue;
      }
      const conflict = await finishJournal(root, journal);
      if (conflict) {
        diagnostics.push(conflict);
        continue;
      }
      const versions: Record<string, FileVersion> = {};
      journal.ops.forEach((op) => {
        if (op.kind === 'write') versions[op.path] = op.after;
      });
      await fs.mkdir(metaPath(root, RECEIPTS_DIR), { recursive: true });
      await writeJsonFile(receiptPath(root, journal.transactionId), {
        transactionId: journal.transactionId,
        outcome: 'applied',
        versions,
        trashEntries: journal.ops.flatMap((op) =>
          op.kind === 'trash' ? [{ path: op.path, entryId: op.entryId }] : [],
        ),
      } satisfies CommitReceipt);
      await removeDir(stagingDir(root, journal.transactionId));
      await fs.rm(path.join(dir, name), { force: true });
    }
    return diagnostics;
  };

  const beginWatch = (workspace: FsWorkspace) => {
    if (workspace.watcher) return;
    let pending: Set<string> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const paths = pending;
      pending = null;
      if (!paths || !workspace.listeners.size) return;
      void (async () => {
        const external: string[] = [];
        for (const relativePath of paths) {
          const current = await versionAt(workspace.root, relativePath);
          if (
            current !== null &&
            current === workspace.ownWrites.get(relativePath)
          )
            continue;
          if (current === null && workspace.ownWrites.has(relativePath)) {
            workspace.ownWrites.delete(relativePath);
            continue;
          }
          external.push(relativePath);
        }
        if (external.length)
          workspace.listeners.forEach((listener) =>
            listener({ paths: external }),
          );
      })();
    };
    try {
      workspace.watcher = watch(
        workspace.root,
        { recursive: true },
        (_event, name) => {
          if (!name) return;
          const relativePath = name.split(path.sep).join('/');
          if (
            !relativePath ||
            relativePath === META_DIR ||
            relativePath.startsWith(`${META_DIR}/`)
          )
            return;
          pending ??= new Set();
          pending.add(relativePath);
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, debounceMs);
        },
      );
      workspace.watcher.on('error', () => {
        workspace.watcher?.close();
        workspace.watcher = null;
      });
    } catch {
      workspace.watcher = null;
    }
  };

  const applyCommit = async (
    workspace: FsWorkspace,
    request: CommitRequest,
  ): Promise<CommitReceipt> => {
    const recorded = await readReceipt(workspace.root, request.transactionId);
    if (recorded && recorded.reason !== 'io-error') return recorded;
    if (recorded?.reason === 'io-error') {
      const journal = (await readJsonFile(
        journalPath(workspace.root, request.transactionId),
      )) as TransactionJournal | null;
      if (journal?.phase === 'applying' || journal?.phase === 'applied') {
        const conflict =
          journal.phase === 'applying'
            ? await finishJournal(workspace.root, journal)
            : null;
        if (!conflict) {
          const versions: Record<string, FileVersion> = {};
          journal.ops.forEach((op) => {
            if (op.kind === 'write') versions[op.path] = op.after;
          });
          const applied: CommitReceipt = {
            transactionId: request.transactionId,
            outcome: 'applied',
            versions,
            trashEntries: journal.ops.flatMap((op) =>
              op.kind === 'trash'
                ? [{ path: op.path, entryId: op.entryId }]
                : [],
            ),
          };
          await writeJsonFile(
            receiptPath(workspace.root, request.transactionId),
            applied,
          );
          await removeDir(stagingDir(workspace.root, request.transactionId));
          await fs.rm(journalPath(workspace.root, request.transactionId), {
            force: true,
          });
          return applied;
        }
        return recorded;
      } else {
        // A stale io-error receipt with no journal must not block a retry.
        await fs.rm(receiptPath(workspace.root, request.transactionId), {
          force: true,
        });
      }
    }
    const stage = stagingDir(workspace.root, request.transactionId);
    await fs.mkdir(stage, { recursive: true });
    const ops: JournalOp[] = [];
    const fail = async (receipt: CommitReceipt): Promise<CommitReceipt> => {
      await fs.mkdir(metaPath(workspace.root, RECEIPTS_DIR), {
        recursive: true,
      });
      await writeJsonFile(
        receiptPath(workspace.root, request.transactionId),
        receipt,
      );
      await removeDir(stage);
      return receipt;
    };
    // Ops see the workspace as earlier ops in this same commit leave it —
    // a `planned` overlay tracks virtual versions so `trash + write` on one
    // path validates against the post-trash state, not the stale disk state.
    type Planned = 'absent' | 'directory' | FileVersion;
    const planned = new Map<string, Planned>();
    const planAbsent = (target: string) => {
      planned.set(target, 'absent');
      for (const key of [...planned.keys()])
        if (key.startsWith(`${target}/`)) planned.set(key, 'absent');
    };
    const planParents = (target: string) => {
      let parent = parentWorkspacePath(target);
      while (parent) {
        planned.set(parent, 'directory');
        parent = parentWorkspacePath(parent);
      }
    };
    const virtualStat = async (
      target: string,
    ): Promise<'absent' | 'file' | 'directory'> => {
      const mark = planned.get(target);
      if (mark === 'absent' || mark === 'directory') return mark;
      if (mark !== undefined) return 'file';
      const stat = await fs
        .stat(absolute(workspace.root, target))
        .catch(() => null);
      if (!stat) return 'absent';
      return stat.isDirectory() ? 'directory' : 'file';
    };
    const virtualVersion = async (target: string) => {
      const mark = planned.get(target);
      if (mark === 'absent' || mark === 'directory') return null;
      if (mark !== undefined) return mark;
      return versionAt(workspace.root, target);
    };
    try {
      // prepared: verify expectations and stage bytes; user files untouched.
      for (const dir of request.mkdirs ?? []) {
        const relativePath = normalizeWorkspacePath(dir);
        if ((await virtualStat(relativePath)) !== 'absent')
          return fail(
            reject(request.transactionId, 'target-exists', {
              path: relativePath,
            }),
          );
        planParents(relativePath);
        planned.set(relativePath, 'directory');
        ops.push({ kind: 'mkdir', path: relativePath });
      }
      for (const op of request.trash ?? []) {
        const relativePath = normalizeWorkspacePath(op.path);
        const stat = await virtualStat(relativePath);
        if (stat === 'absent')
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path: relativePath,
              expected: op.expectedVersion ?? null,
              actual: null,
            }),
          );
        if (stat === 'directory' && op.expectedVersion !== undefined)
          return fail(
            reject(request.transactionId, 'invalid', { path: relativePath }),
          );
        const current = await virtualVersion(relativePath);
        if (stat === 'file' && current !== op.expectedVersion)
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path: relativePath,
              expected: op.expectedVersion ?? null,
              actual: current,
            }),
          );
        const entryId = `trash-${now().toString(36)}-${crypto
          .randomUUID()
          .slice(0, 8)}`;
        ops.push({
          kind: 'trash',
          path: relativePath,
          before: current,
          directory: stat === 'directory',
          entryId,
        });
        planAbsent(relativePath);
      }
      for (const op of request.restore ?? []) {
        const entryId = normalizeTrashEntryId(op.entryId);
        const entryDir = metaPath(workspace.root, TRASH_DIR, entryId);
        const meta = (await readJsonFile(
          path.join(entryDir, 'entry.json'),
        )) as { originalPath?: string } | null;
        if (!meta || typeof meta.originalPath !== 'string')
          return fail(
            reject(request.transactionId, 'source-missing', { path: entryId }),
          );
        const original = meta.originalPath;
        const to = normalizeWorkspacePath(op.toPath ?? original);
        const stored = (await fs.readdir(entryDir).catch(() => [])).filter(
          (name) => name !== 'entry.json',
        );
        if (stored.length !== 1)
          return fail(
            reject(request.transactionId, 'invalid', { path: entryId }),
          );
        const basename = stored[0];
        const subtree = (await listSubtree(entryDir, basename)).map((node) => ({
          path: to + node.path.slice(basename.length),
          kind: node.kind,
        }));
        for (const node of subtree) {
          if ((await virtualStat(node.path)) !== 'absent')
            return fail(
              reject(request.transactionId, 'target-exists', {
                path: node.path,
              }),
            );
        }
        for (const node of subtree) {
          if (node.kind === 'directory') planned.set(node.path, 'directory');
          else {
            const rel = node.path.slice(to.length);
            const storedFile = path.join(
              entryDir,
              basename,
              ...rel.split('/').filter(Boolean),
            );
            planned.set(node.path, sha256(await fs.readFile(storedFile)));
          }
        }
        ops.push({
          kind: 'restore',
          entryId,
          basename,
          to,
          subtree,
        });
      }
      for (const entryId of request.purge ?? [])
        ops.push({ kind: 'purge', entryId: normalizeTrashEntryId(entryId) });
      for (const op of request.moves ?? []) {
        const from = normalizeWorkspacePath(op.from);
        const to = normalizeWorkspacePath(op.to);
        const stat = await virtualStat(from);
        if (stat === 'absent')
          return fail(
            reject(request.transactionId, 'source-missing', { path: from }),
          );
        const current = await virtualVersion(from);
        if (
          stat === 'file' &&
          (op.expectedVersion === undefined || current !== op.expectedVersion)
        )
          return fail(
            reject(request.transactionId, 'version-conflict', {
              path: from,
              expected: op.expectedVersion ?? null,
              actual: current,
            }),
          );
        if ((await virtualStat(to)) !== 'absent')
          return fail(
            reject(request.transactionId, 'target-exists', { path: to }),
          );
        if (to === from || to.startsWith(`${from}/`))
          return fail(reject(request.transactionId, 'invalid', { path: to }));
        ops.push({
          kind: 'move',
          from,
          to,
          before: current,
          directory: stat === 'directory',
        });
        const moved = new Map<string, Planned>();
        for (const [key, mark] of planned)
          if (key === from || key.startsWith(`${from}/`)) {
            moved.set(to + key.slice(from.length), mark);
            planned.delete(key);
          }
        planned.set(from, 'absent');
        planned.set(to, stat === 'directory' ? 'directory' : current!);
        for (const [key, mark] of moved) planned.set(key, mark);
      }
      for (const [index, op] of (request.writes ?? []).entries()) {
        const relativePath = normalizeWorkspacePath(op.path);
        if (op.expectedVersion === null) {
          const stat = await virtualStat(relativePath);
          if (stat !== 'absent')
            return fail(
              reject(request.transactionId, 'target-exists', {
                path: relativePath,
                expected: null,
                actual: (await virtualVersion(relativePath)) ?? 'directory',
              }),
            );
        } else {
          const current = await virtualVersion(relativePath);
          if (current !== op.expectedVersion)
            return fail(
              reject(request.transactionId, 'version-conflict', {
                path: relativePath,
                expected: op.expectedVersion,
                actual: current,
              }),
            );
        }
        const staged = stagedPath(request.transactionId, `${index}.bin`);
        const content = encode(op.content);
        await fs.writeFile(metaPath(workspace.root, staged), content);
        const readBack = await fs.readFile(metaPath(workspace.root, staged));
        if (sha256(readBack) !== sha256(content))
          return fail(
            reject(request.transactionId, 'io-error', { path: relativePath }),
          );
        ops.push({
          kind: 'write',
          path: relativePath,
          before: await virtualVersion(relativePath),
          after: sha256(content),
          staged,
        });
        planned.set(relativePath, sha256(content));
        planParents(relativePath);
      }
      if (request.config) {
        const target = metaPath(workspace.root, CONFIG_FILE);
        const currentValue = (await readJsonFile(target)) as {
          version?: number;
        } | null;
        const currentVersion =
          typeof currentValue?.version === 'number' ? currentValue.version : 1;
        if (currentVersion !== request.config.expectedVersion)
          return fail(
            reject(request.transactionId, 'version-conflict', {
              expected: String(request.config.expectedVersion),
              actual: String(currentVersion),
            }),
          );
        const staged = stagedPath(request.transactionId, 'config.json');
        const content = encode(
          JSON.stringify(
            {
              version: currentVersion + 1,
              value: request.config.value,
            },
            null,
            2,
          ),
        );
        await fs.writeFile(metaPath(workspace.root, staged), content);
        ops.push({
          kind: 'config',
          before: await versionAt(workspace.root, `${META_DIR}/${CONFIG_FILE}`),
          after: sha256(content),
          staged,
        });
      }
      if (request.session) {
        const staged = stagedPath(request.transactionId, 'session.json');
        await writeJsonFile(metaPath(workspace.root, staged), {
          format: 'verd-workspace-session',
          version: 1,
          ...request.session,
        });
        ops.push({ kind: 'session', staged });
      }
    } catch (error) {
      return fail(
        reject(request.transactionId, 'invalid', {
          path: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const journal: TransactionJournal = {
      transactionId: request.transactionId,
      phase: 'prepared',
      createdAt: now(),
      ops,
    };
    await writeJournal(workspace.root, journal);
    journal.phase = 'applying';
    await writeJournal(workspace.root, journal);
    const versions: Record<string, FileVersion> = {};
    const trashEntries: { path: string; entryId: string }[] = [];
    try {
      for (const op of ops) {
        await applyJournalOp(workspace.root, op);
        if (op.kind === 'trash')
          trashEntries.push({ path: op.path, entryId: op.entryId });
      }
      for (const op of ops) {
        if (op.kind === 'write') {
          const current = await versionAt(workspace.root, op.path);
          if (current !== op.after)
            throw new Error(`Publish verification failed: ${op.path}`);
          versions[op.path] = op.after;
          workspace.ownWrites.set(op.path, op.after);
        }
        if (op.kind === 'move') {
          const current = await versionAt(workspace.root, op.to);
          if (current !== null) {
            versions[op.to] = current;
            workspace.ownWrites.set(op.to, current);
          }
        }
        if (op.kind === 'restore') {
          for (const node of op.subtree) {
            if (node.kind !== 'file') continue;
            const current = await versionAt(workspace.root, node.path);
            if (current !== null) {
              versions[node.path] = current;
              workspace.ownWrites.set(node.path, current);
            }
          }
        }
      }
    } catch (error) {
      // Publish failed mid-`applying`: try to reconcile immediately via the
      // same replay logic startup recovery uses. Staging + journal stay put
      // either way; a recorded failure means the caller sees rejection now
      // while a later restart can still finish the transaction.
      const conflict = await finishJournal(workspace.root, journal).catch(
        (recoveryError) =>
          `Recovery replay failed: ${
            recoveryError instanceof Error
              ? recoveryError.message
              : String(recoveryError)
          }`,
      );
      const receipt = reject(request.transactionId, 'io-error', {
        path:
          conflict ?? (error instanceof Error ? error.message : String(error)),
      });
      if (!conflict) {
        const appliedReceipt: CommitReceipt = {
          transactionId: request.transactionId,
          outcome: 'applied',
          versions,
          trashEntries: trashEntries.length ? trashEntries : undefined,
        };
        await fs.mkdir(metaPath(workspace.root, RECEIPTS_DIR), {
          recursive: true,
        });
        await writeJsonFile(
          receiptPath(workspace.root, request.transactionId),
          appliedReceipt,
        );
        await removeDir(stage);
        await fs.rm(journalPath(workspace.root, request.transactionId), {
          force: true,
        });
        return appliedReceipt;
      }
      await fs.mkdir(metaPath(workspace.root, RECEIPTS_DIR), {
        recursive: true,
      });
      await writeJsonFile(
        receiptPath(workspace.root, request.transactionId),
        receipt,
      );
      return receipt;
    }
    const receipt: CommitReceipt = {
      transactionId: request.transactionId,
      outcome: 'applied',
      versions,
      trashEntries: trashEntries.length ? trashEntries : undefined,
    };
    await fs.mkdir(metaPath(workspace.root, RECEIPTS_DIR), { recursive: true });
    await writeJsonFile(
      receiptPath(workspace.root, request.transactionId),
      receipt,
    );
    await removeDir(stagingDir(workspace.root, request.transactionId));
    await fs.rm(journalPath(workspace.root, request.transactionId), {
      force: true,
    });
    const touched = [
      ...Object.keys(versions),
      ...trashEntries.map((entry) => entry.path),
      ...ops.flatMap((op) =>
        op.kind === 'move'
          ? [op.from, op.to]
          : op.kind === 'purge'
            ? [`.verdboard/trash/${op.entryId}`]
            : op.kind === 'trash'
              ? [op.path]
              : [],
      ),
    ];
    if (touched.length)
      workspace.listeners.forEach((listener) =>
        listener({ paths: [...new Set(touched)] }),
      );
    return receipt;
  };

  const workspaceOf = (handle: WorkspaceHandle): FsWorkspace => {
    const workspace = workspaces.get(handle.key);
    if (!workspace) throw new Error(`Unknown workspace: ${handle.key}`);
    return workspace;
  };

  const open = async (
    root: string,
    create: boolean,
    name?: string,
  ): Promise<WorkspaceHandle | null> => {
    const existing = workspacesByRoot.get(root);
    if (existing) return { key: existing.id, name: existing.name };
    if (!(await exists(root))) {
      if (!create) return null;
      await fs.mkdir(root, { recursive: true });
    }
    const configTarget = metaPath(root, CONFIG_FILE);
    if (!(await exists(configTarget))) {
      if (!create && (await fs.readdir(root)).length > 0) return null;
      await fs.mkdir(metaPath(root), { recursive: true });
      await fs.mkdir(metaPath(root, TRANSACTIONS_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, RECEIPTS_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, TRASH_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, 'migration'), { recursive: true });
      await writeJsonFile(configTarget, {
        version: 1,
        value: { identity: crypto.randomUUID() },
      });
    }
    const recoveryDiagnostics = await recoverWorkspace(root);
    const workspace: FsWorkspace = {
      id: `ws-${++counter}`,
      root,
      name: name ?? baseName(root),
      queue: createSerialQueue(),
      watcher: null,
      ownWrites: new Map(),
      listeners: new Set(),
      recoveryDiagnostics,
    };
    workspaces.set(workspace.id, workspace);
    workspacesByRoot.set(root, workspace);
    beginWatch(workspace);
    return { key: workspace.id, name: workspace.name };
  };

  const readFileInner = async (
    workspace: FsWorkspace,
    relativePath: string,
  ): Promise<RawFileRead> => {
    const normalized = normalizeWorkspacePath(relativePath);
    try {
      const content = await fs.readFile(absolute(workspace.root, normalized));
      return {
        path: normalized,
        version: sha256(content),
        content: new Uint8Array(content),
      };
    } catch {
      throw new Error(`Missing file: ${normalized}`);
    }
  };

  const readDirTree = async (
    root: string,
    dir: string,
  ): Promise<WorkspaceEntryMeta[]> => {
    const names = await fs
      .readdir(dir ? absolute(root, dir) : root)
      .catch(() => [] as string[]);
    const entries: WorkspaceEntryMeta[] = [];
    for (const name of names.sort()) {
      if (dir === '' && name === META_DIR) continue;
      const relativePath = dir ? `${dir}/${name}` : name;
      const stat = await fs
        .stat(absolute(root, relativePath))
        .catch(() => null);
      if (!stat) continue;
      if (stat.isDirectory()) {
        entries.push({
          path: relativePath,
          kind: 'directory',
          canvas: false,
        });
        entries.push(...(await readDirTree(root, relativePath)));
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          kind: 'file',
          canvas: isCanvasPath(relativePath),
          document: isDocumentPath(relativePath) || undefined,
          version: (await versionAt(root, relativePath)) ?? undefined,
          size: stat.size,
        });
      }
    }
    return entries;
  };

  const readGlobalConfigInner = async (): Promise<GlobalConfigSnapshot> => {
    const value = (await readJsonFile(globalConfigPath())) as {
      version?: number;
      value?: Record<string, unknown>;
    } | null;
    return {
      version: typeof value?.version === 'number' ? value.version : 0,
      value: value?.value ?? {},
    };
  };

  return {
    workspaces,
    recoverWorkspace,
    async waitIdle() {
      await Promise.all(
        [...workspaces.values()].map((workspace) =>
          workspace.queue(() => Promise.resolve()),
        ),
      );
    },
    readGlobalConfig: readGlobalConfigInner,
    async writeGlobalConfig(value, expectedVersion) {
      const snapshot = await readGlobalConfigInner();
      if (snapshot.version !== expectedVersion)
        return { applied: false, snapshot };
      const next = { version: snapshot.version + 1, value };
      await writeJsonFile(globalConfigPath(), next);
      return { applied: true, snapshot: next };
    },
    async openWorkspace(request: OpenWorkspaceRequest = { default: true }) {
      if (request.pick) {
        const picked = (await options.pickDirectory?.()) ?? null;
        if (picked === null) return null;
        return open(picked, request.create !== false, request.name);
      }
      const root = request.default
        ? options.defaultRoot()
        : request.path
          ? path.resolve(request.path)
          : options.defaultRoot();
      return open(root, request.create !== false, request.name);
    },
    async readSnapshot(handle) {
      const workspace = workspaceOf(handle);
      const configValue = (await readJsonFile(
        metaPath(workspace.root, CONFIG_FILE),
      )) as { version?: number; value?: Record<string, unknown> } | null;
      const session = (await readJsonFile(
        metaPath(workspace.root, SESSION_FILE),
      )) as (Partial<WorkspaceSessionState> & { version?: number }) | null;
      const entries = await readDirTree(workspace.root, '');
      const canvases: WorkspaceHostSnapshot['canvases'] = [];
      const diagnostics: WorkspaceHostSnapshot['diagnostics'] =
        workspace.recoveryDiagnostics.map((message) => ({ message }));
      for (const entry of entries) {
        if (!entry.canvas) continue;
        try {
          const raw = await fs.readFile(
            absolute(workspace.root, entry.path),
            'utf-8',
          );
          const parsed: unknown = JSON.parse(raw);
          if (!isValidCanvas(parsed)) {
            canvases.push({
              path: entry.path,
              version: entry.version!,
              file: null,
              diagnostic: 'Not a v2 frame file',
            });
            diagnostics.push({
              path: entry.path,
              message: 'Not a v2 frame file',
            });
            continue;
          }
          canvases.push({
            path: entry.path,
            version: entry.version!,
            file: parsed as never,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          canvases.push({
            path: entry.path,
            version: entry.version!,
            file: null,
            diagnostic: message,
          });
          diagnostics.push({ path: entry.path, message });
        }
      }
      const documents: WorkspaceHostSnapshot['documents'] = [];
      for (const entry of entries) {
        if (!entry.document) continue;
        try {
          const raw = await fs.readFile(
            absolute(workspace.root, entry.path),
            'utf-8',
          );
          const parsed: unknown = JSON.parse(raw);
          if (!isValidDocument(parsed)) {
            documents!.push({
              path: entry.path,
              version: entry.version!,
              file: null,
              diagnostic: 'Not a v1 document file',
            });
            diagnostics.push({
              path: entry.path,
              message: 'Not a v1 document file',
            });
            continue;
          }
          documents!.push({
            path: entry.path,
            version: entry.version!,
            file: parsed as never,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          documents!.push({
            path: entry.path,
            version: entry.version!,
            file: null,
            diagnostic: message,
          });
          diagnostics.push({ path: entry.path, message });
        }
      }
      const trashRoot = metaPath(workspace.root, TRASH_DIR);
      const trash: WorkspaceHostSnapshot['trash'] = [];
      for (const name of await fs
        .readdir(trashRoot)
        .catch(() => [] as string[])) {
        const meta = (await readJsonFile(
          path.join(trashRoot, name, 'entry.json'),
        )) as {
          entryId?: string;
          originalPath?: string;
          trashedAt?: number;
        } | null;
        if (meta?.entryId && typeof meta.originalPath === 'string')
          trash.push({
            entryId: meta.entryId,
            originalPath: meta.originalPath,
            trashedAt: typeof meta.trashedAt === 'number' ? meta.trashedAt : 0,
          });
      }
      return {
        config: {
          version:
            typeof configValue?.version === 'number' ? configValue.version : 1,
          value: configValue?.value ?? {},
        },
        // Reads both the v1 `{frameId}` and v2 `{fileId}` tab shapes.
        session: normalizeWorkspaceSessionState(session),
        entries,
        canvases,
        documents,
        trash,
        diagnostics,
      };
    },
    async readFile(handle, relativePath) {
      return readFileInner(workspaceOf(handle), relativePath);
    },
    async commit(handle, request) {
      const workspace = workspaceOf(handle);
      return workspace.queue(() => applyCommit(workspace, request));
    },
    subscribe(handle, listener) {
      const workspace = workspaceOf(handle);
      workspace.listeners.add(listener);
      return () => workspace.listeners.delete(listener);
    },
    async resolveConflict(handle, request) {
      const workspace = workspaceOf(handle);
      return workspace.queue(async () => {
        let diskVersion: FileVersion | undefined;
        try {
          diskVersion = (await readFileInner(workspace, request.path)).version;
        } catch {
          diskVersion = undefined;
        }
        return applyCommit(workspace, conflictCommit(request, diskVersion));
      });
    },
    async closeWorkspace(handle) {
      const workspace = workspaces.get(handle.key);
      if (!workspace) return;
      workspace.watcher?.close();
      workspace.listeners.clear();
      workspaces.delete(workspace.id);
      workspacesByRoot.delete(workspace.root);
    },
    onShutdown() {
      // Stop watching so quit-time publishes cannot queue behind a dead
      // window; the close flow awaits waitIdle() for pending commits.
      for (const workspace of workspaces.values()) {
        workspace.watcher?.close();
        workspace.watcher = null;
      }
      return () => {};
    },
  };
};
