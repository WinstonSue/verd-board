import { withGitVersioning } from '@sue/verd-board-workspace';
import { canonicalRoot } from '@sue/verd-board-file-workspace';
import {
  FOLDER_ID_FILE,
  isFolderIdentityPath,
  readFolderIdentity,
} from '@sue/verd-board-workspace';
import { readWorkspaceGeneration } from './workspace-lock';
import {
  assertResourcePath,
  assertResourceLayout,
  migrateWorkspaceResourcesUnlocked,
  readResourceMetadata,
} from './workspace-resource-storage';
import { assertSkillFile } from './workspace-skills';
import {
  createNodeWorkspaceGit,
  recoverGitNativeLock,
  recoverGitPurge,
} from './workspace-git';
import {
  cleanPublishedTemps,
  recoverGitRestore,
} from './workspace-git-restore';
import * as crypto from 'crypto';
import { watch, type FSWatcher } from 'fs';
import { readProjectContentExclusions } from './workspace-exclusions';
import * as fs from 'fs/promises';
import { hostname } from 'node:os';
import * as path from 'path';
import {
  createSerialQueue,
  withWorkspaceLock,
  readNativeSnapshotUnlocked,
  readWorkspaceResourceId,
} from './workspace-lock';
import {
  migrateWorkspaceMetadataUnlocked,
  assertCurrentMetadataUnlocked,
  markCurrentMetadataUnlocked,
} from './workspace-metadata';
import {
  initializeWorkspaceAgentUnlocked,
  inspectWorkspaceAgentUnlocked,
  type AgentSetupDiagnostic,
} from './workspace-project';
import { readWorkspaceDirectoryContext } from './workspace-context';
import {
  baseName,
  isWorkspaceContentPath,
  normalizeResourceKey,
  resourceStoragePath,
  RESOURCE_DIR,
  LEGACY_RESOURCE_DIR,
  workspaceDisplayName,
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
  type FileVersion,
  type GlobalConfigSnapshot,
  type OpenWorkspaceRequest,
  type RawFileRead,
  type WorkspaceEntryMeta,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceSessionState,
  type WorkspaceHostSnapshot,
} from '@sue/verd-board-workspace';

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
const publishFile = async (
  target: string,
  content: Uint8Array,
  createParents = true,
) => {
  if (createParents) await fs.mkdir(path.dirname(target), { recursive: true });
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
      kind: 'write' | 'resource-write';
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
  | { kind: 'session'; staged: string; target?: string };

interface TransactionJournal {
  transactionId: string;
  phase: 'prepared' | 'applying' | 'applied';
  createdAt: number;
  appliedAt?: number;
  ops: JournalOp[];
}

/** Recovery records are data, never blindly trusted executable file operations. */
function isTransactionJournal(raw: unknown): raw is TransactionJournal {
  if (!raw || typeof raw !== 'object') return false;
  const journal = raw as TransactionJournal;
  if (
    typeof journal.transactionId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(journal.transactionId) ||
    !['prepared', 'applying', 'applied'].includes(journal.phase) ||
    !Array.isArray(journal.ops)
  )
    return false;
  const contentPath = (value: unknown) =>
    typeof value === 'string' &&
    (value.startsWith(LEGACY_RESOURCE_DIR + '/')
      ? normalizeResourceKey(value) ===
        value.slice(LEGACY_RESOURCE_DIR.length + 1)
      : normalizeWorkspacePath(value) === value);
  const stagedPathValid = (value: unknown) =>
    typeof value === 'string' &&
    value.startsWith(`transactions/${journal.transactionId}.staging/`) &&
    !value.includes('\\') &&
    !value.split('/').some((p) => !p || p === '.' || p === '..');
  try {
    return journal.ops.every((op) => {
      if (!op || typeof op !== 'object') return false;
      switch (op.kind) {
        case 'write':
          return (
            contentPath(op.path) &&
            typeof op.after === 'string' &&
            stagedPathValid(op.staged)
          );
        case 'resource-write':
          return (
            typeof op.path === 'string' &&
            op.path.startsWith(RESOURCE_DIR + '/') &&
            resourceStoragePath(op.path.slice(RESOURCE_DIR.length + 1)) ===
              op.path &&
            typeof op.after === 'string' &&
            stagedPathValid(op.staged)
          );
        case 'config':
          return typeof op.after === 'string' && stagedPathValid(op.staged);
        case 'session':
          return (
            stagedPathValid(op.staged) &&
            (op.target === undefined ||
              /^sessions\/[a-f0-9]{32}\.json$/.test(op.target))
          );
        case 'move':
          return contentPath(op.from) && contentPath(op.to);
        case 'mkdir':
          return contentPath(op.path);
        case 'trash':
          return (
            contentPath(op.path) &&
            normalizeTrashEntryId(op.entryId) === op.entryId
          );
        case 'purge':
          return normalizeTrashEntryId(op.entryId) === op.entryId;
        case 'restore':
          return (
            contentPath(op.to) &&
            normalizeTrashEntryId(op.entryId) === op.entryId &&
            Array.isArray(op.subtree) &&
            op.subtree.every(
              (entry) =>
                typeof entry.path === 'string' &&
                ['file', 'directory'].includes(entry.kind),
            )
          );
        default:
          return false;
      }
    });
  } catch {
    return false;
  }
}

interface FsWorkspace {
  generation: string | null;
  closing?: boolean;
  id: string;
  root: string;
  name: string;
  readonly: boolean;
  queue: <T>(task: () => Promise<T>) => Promise<T>;
  watcher: FSWatcher | null;
  /** Digests this host published, for suppressing its own watcher events. */
  ownWrites: Map<string, FileVersion>;
  listeners: Set<(hint: ChangeHint) => void>;
  /** Recovery conflicts detected at open; surfaced via snapshot diagnostics. */
  recoveryDiagnostics: string[];
  agentSetupDiagnostics: AgentSetupDiagnostic[];
}

export interface FsWorkspaceHostOptions {
  /** Root used for `{default: true}` open requests. */
  defaultRoot: () => string;
  /** Resolve content access from the host's directory policy before opening. */
  resolveReadonly?: (canonicalPath: string) => Promise<boolean>;
  /** Global config lives next to the workspaces directory by default. */
  globalConfigPath?: () => string;
  pickDirectory?: () => Promise<string | null>;
  now?: () => number;
  watchDebounceMs?: number;
  /** Versioned resources deployed outside the Desktop bundle. */
  sharedResources?: () => string | Promise<string>;
  /** Optional project context for an embedded, fixed-directory host. */
  projectRoot?: string;
  /** Isolates personal UI sessions from other hosts using the same directory. */
  sessionNamespace?: string;
  /** Explicit opt-in for CLI initialization; normal directory opens preserve instructions. */
  initializeAgent?: boolean;
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
const createFsWorkspaceHostInner = (
  options: FsWorkspaceHostOptions,
): WorkspaceHost & {
  workspaces: Map<string, FsWorkspace>;
  assertWritable: (handle: WorkspaceHandle) => void;
  suspendWorkspaceWatch: (handle: WorkspaceHandle) => () => void;
  recoverWorkspace: (
    root: string,
    expectedGeneration?: string | null,
  ) => Promise<string[]>;
  /** Resolves once every workspace write channel has drained. */
  waitIdle: () => Promise<void>;
} => {
  const workspaces = new Map<string, FsWorkspace>();
  const workspacesByRoot = new Map<string, FsWorkspace>();
  const enqueueGlobalConfigWrite = createSerialQueue();
  const now = options.now ?? Date.now;
  const debounceMs = options.watchDebounceMs ?? 120;
  const globalConfigPath =
    options.globalConfigPath ??
    (() => path.join(options.defaultRoot(), '..', GLOBAL_CONFIG_FILE));
  const sessionFile =
    'sessions/' +
    crypto
      .createHash('sha256')
      .update(
        hostname() +
          '\0' +
          globalConfigPath() +
          '\0' +
          (options.sessionNamespace ?? 'filesystem'),
      )
      .digest('hex')
      .slice(0, 32) +
    '.json';
  let counter = 0;

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
    if (op.kind === 'write' || op.kind === 'resource-write') {
      if (op.kind === 'resource-write')
        await assertResourcePath(root, op.path.slice(RESOURCE_DIR.length + 1));
      const content = await fs.readFile(metaPath(root, op.staged));
      await publishFile(
        absolute(root, op.path),
        content,
        !isFolderIdentityPath(op.path),
      );
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
          : metaPath(root, op.target ?? SESSION_FILE);
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
      if (op.kind === 'write' || op.kind === 'resource-write') {
        if (op.kind === 'resource-write') {
          try {
            await assertResourcePath(
              root,
              op.path.slice(RESOURCE_DIR.length + 1),
            );
          } catch (error) {
            return 'Recovery conflict: ' + String(error);
          }
        }
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
      if (op.kind === 'session') {
        if (staged) {
          const appliedError = await tryApply(op, 'session');
          if (appliedError) return appliedError;
        }
        continue;
      }
      if (op.kind !== 'config') return 'Invalid recovery metadata operation';
      const current = await versionAt(root, `${META_DIR}/${CONFIG_FILE}`);
      if (current === op.after) continue;
      if (current === op.before && staged) {
        const appliedError = await tryApply(op, 'config');
        if (appliedError) return appliedError;
        continue;
      }
      return `Recovery conflict at ${op.kind}: found third version`;
    }
    for (const op of journal.ops) {
      if (op.kind === 'write' || op.kind === 'resource-write')
        await cleanPublishedTemps(root, op.path);
      else if (op.kind === 'config' || op.kind === 'session')
        await cleanPublishedTemps(
          root,
          `${META_DIR}/${op.kind === 'config' ? CONFIG_FILE : (op.target ?? SESSION_FILE)}`,
        );
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
      if (
        !isTransactionJournal(journal) ||
        name !== journal.transactionId + '.json'
      ) {
        diagnostics.push(
          `Unreadable transaction log preserved; recovery required: ${name}`,
        );
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
      const resourceVersions: Record<string, FileVersion> = {};
      journal.ops.forEach((op) => {
        if (op.kind === 'write') versions[op.path] = op.after;
        if (op.kind === 'resource-write')
          resourceVersions[op.path.slice(RESOURCE_DIR.length + 1)] = op.after;
      });
      await fs.mkdir(metaPath(root, RECEIPTS_DIR), { recursive: true });
      await writeJsonFile(receiptPath(root, journal.transactionId), {
        transactionId: journal.transactionId,
        outcome: 'applied',
        versions,
        resourceVersions,
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
      if (!paths || workspace.closing || !workspace.listeners.size) return;
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
        if (external.length && !workspace.closing)
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
            (relativePath.startsWith(`${META_DIR}/`) &&
              relativePath !== `${META_DIR}/config.json` &&
              relativePath !== RESOURCE_DIR &&
              !relativePath.startsWith(RESOURCE_DIR + '/'))
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
    if (
      workspace.closing ||
      workspace.generation !== (await readWorkspaceGeneration(workspace.root))
    )
      throw new Error('WORKSPACE_REPLACED: reopen the workspace');
    await assertCurrentMetadataUnlocked(workspace.root);
    const recorded = await readReceipt(workspace.root, request.transactionId);
    if (recorded && recorded.reason !== 'io-error') return recorded;
    if (
      request.expectedAgentResourceId !== undefined &&
      request.expectedAgentResourceId !==
        (await readWorkspaceResourceId(workspace.root))
    )
      return reject(request.transactionId, 'version-conflict', {
        path: '.verdscrolls/shared',
      });
    const logs = await fs
      .readdir(metaPath(workspace.root, TRANSACTIONS_DIR))
      .catch(() => [] as string[]);
    for (const log of logs.filter((n) => n.endsWith('.json'))) {
      const pending = (await readJsonFile(
        metaPath(workspace.root, TRANSACTIONS_DIR, log),
      )) as TransactionJournal | null;
      if (
        !isTransactionJournal(pending) ||
        log !== pending.transactionId + '.json'
      )
        return reject(request.transactionId, 'invalid', {
          path: `${META_DIR}/transactions/${log}`,
        });
    }
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
          const resourceVersions: Record<string, FileVersion> = {};
          journal.ops.forEach((op) => {
            if (op.kind === 'write') versions[op.path] = op.after;
            if (op.kind === 'resource-write')
              resourceVersions[op.path.slice(RESOURCE_DIR.length + 1)] =
                op.after;
          });
          const applied: CommitReceipt = {
            transactionId: request.transactionId,
            outcome: 'applied',
            versions,
            resourceVersions,
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
    if (request.expectedWorkspaceVersion !== undefined) {
      const current = await readNativeSnapshotUnlocked(workspace.root);
      if (current.version !== request.expectedWorkspaceVersion)
        return reject(request.transactionId, 'version-conflict', {
          expected: request.expectedWorkspaceVersion,
          actual: current.version,
        });
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
      if (request.resourceWrites?.length) {
        if (workspace.recoveryDiagnostics.length)
          throw new Error('Resource migration or recovery requires attention');
        await assertResourceLayout(workspace.root);
        for (const op of request.resourceWrites)
          await assertResourcePath(workspace.root, op.path);
      }
      // A lexical relative path must not escape through a directory symlink.
      for (const relativePath of [
        ...(request.writes ?? []).map((op) => op.path),
        ...(request.moves ?? []).flatMap((op) => [op.from, op.to]),
        ...(request.trash ?? []).map((op) => op.path),
        ...(request.mkdirs ?? []),
        ...(request.restore ?? []).flatMap((op) =>
          op.toPath ? [op.toPath] : [],
        ),
      ]) {
        let current = workspace.root;
        for (const part of normalizeWorkspacePath(relativePath).split('/')) {
          current = path.join(current, part);
          const stat = await fs.lstat(current).catch((error) => {
            if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null;
            throw error;
          });
          if (stat?.isSymbolicLink())
            return fail(
              reject(request.transactionId, 'invalid', { path: relativePath }),
            );
        }
      }
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
      const writeOps = [
        ...(request.writes ?? []).map((op) => ({ op, resource: false })),
        ...(request.resourceWrites ?? []).map((op) => ({ op, resource: true })),
      ];
      for (const [index, { op, resource }] of writeOps.entries()) {
        const relativePath = resource
          ? resourceStoragePath(op.path)
          : normalizeWorkspacePath(op.path);
        if (
          isFolderIdentityPath(relativePath) &&
          (await virtualStat(parentWorkspacePath(relativePath) ?? '')) !==
            'directory'
        )
          return fail(
            reject(request.transactionId, 'source-missing', {
              path: relativePath,
            }),
          );
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
          kind: resource ? 'resource-write' : 'write',
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
        ops.push({ kind: 'session', staged, target: sessionFile });
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
    const resourceVersions: Record<string, FileVersion> = {};
    const trashEntries: { path: string; entryId: string }[] = [];
    try {
      for (const op of ops) {
        await applyJournalOp(workspace.root, op);
        if (op.kind === 'trash')
          trashEntries.push({ path: op.path, entryId: op.entryId });
      }
      for (const op of ops) {
        if (op.kind === 'write' || op.kind === 'resource-write') {
          const current = await versionAt(workspace.root, op.path);
          if (current !== op.after)
            throw new Error(`Publish verification failed: ${op.path}`);
          if (op.kind === 'resource-write')
            resourceVersions[op.path.slice(RESOURCE_DIR.length + 1)] = op.after;
          else versions[op.path] = op.after;
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
          resourceVersions,
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
      resourceVersions,
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
      ...Object.keys(resourceVersions).map(resourceStoragePath),
      ...trashEntries.map((entry) => entry.path),
      ...ops.flatMap((op) =>
        op.kind === 'move'
          ? [op.from, op.to]
          : op.kind === 'purge'
            ? [`${META_DIR}/trash/${op.entryId}`]
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
    if (!workspace || workspace.closing)
      throw new Error(`Unknown workspace: ${handle.key}`);
    return workspace;
  };
  const assertWritable = (handle: WorkspaceHandle) => {
    if (workspaceOf(handle).readonly) throw new Error('WORKSPACE_READ_ONLY');
  };

  const openUnlocked = async (
    root: string,
    create: boolean,
    name?: string,
    readonly = false,
  ): Promise<WorkspaceHandle | null> => {
    if (!(await exists(root))) {
      if (!create) return null;
      await fs.mkdir(root, { recursive: true });
    }
    await migrateWorkspaceMetadataUnlocked(root);
    let existing = workspacesByRoot.get(root);
    if (
      existing &&
      existing.generation !== (await readWorkspaceGeneration(root))
    ) {
      existing.watcher?.close();
      existing.listeners.clear();
      workspaces.delete(existing.id);
      workspacesByRoot.delete(root);
      existing = undefined;
    }
    const configTarget = metaPath(root, CONFIG_FILE);
    // Resume explicit Git mutations before initialization can recreate restored metadata.
    if (!readonly) {
      await recoverGitNativeLock(root);
      await recoverGitPurge(root);
      await recoverGitRestore(root);
    }
    const hadProjectConfig = await exists(configTarget);
    if (!hadProjectConfig) {
      if (readonly) return null;
      if (!create && (await fs.readdir(root)).length > 0) return null;
      await fs.mkdir(metaPath(root), { recursive: true });
      await fs.mkdir(metaPath(root, TRANSACTIONS_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, RECEIPTS_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, TRASH_DIR), { recursive: true });
      await fs.mkdir(metaPath(root, 'migration'), { recursive: true });
      await writeJsonFile(configTarget, {
        version: 1,
        value: {
          identity: crypto.randomUUID(),
          name: name ?? baseName(root),
          project: { description: '', entryDocumentIds: [] },
        },
      });
    }
    await markCurrentMetadataUnlocked(root);
    const recoveryDiagnostics = await recoverWorkspace(root);
    if (!recoveryDiagnostics.length) {
      try {
        await migrateWorkspaceResourcesUnlocked(root);
      } catch (error) {
        recoveryDiagnostics.push(String(error));
      }
    }
    const configStat = await fs.lstat(configTarget);
    if (!configStat.isFile() || configStat.isSymbolicLink())
      throw new Error(
        'WORKSPACE_CONFIG_INVALID: config.json must be an ordinary file',
      );
    const config = (await readJsonFile(configTarget)) as {
      value?: { identity?: string; name?: string };
    } | null;
    if (!config?.value || typeof config.value.identity !== 'string')
      throw new Error(
        'WORKSPACE_CONFIG_INVALID: config.json is unreadable or has no identity',
      );
    const agentSetupDiagnostics: AgentSetupDiagnostic[] = [];
    if (!readonly) {
      let shared: string | undefined;
      try {
        shared =
          (await options.sharedResources?.()) ??
          process.env['VERD_AGENT_RESOURCES'];
      } catch (error) {
        agentSetupDiagnostics.push({
          code: 'agent.resources-unavailable',
          message: String(error),
        });
      }
      const setup = await initializeWorkspaceAgentUnlocked(root, shared, {
        preserveContent: hadProjectConfig && !options.initializeAgent,
        setupGuide: options.initializeAgent === true,
      });
      agentSetupDiagnostics.push(
        ...setup.diagnostics.filter((d) => d.code.endsWith('-conflict')),
      );
    }
    const access = readonly ? { readonly: true } : {};
    if (existing) {
      existing.name = workspaceDisplayName(config.value.name, existing.name);
      existing.recoveryDiagnostics = recoveryDiagnostics;
      existing.agentSetupDiagnostics = agentSetupDiagnostics;
      return { key: existing.id, name: existing.name, ...access };
    }
    const workspace: FsWorkspace = {
      generation: await readWorkspaceGeneration(root),
      id: `ws-${++counter}`,
      root,
      name: workspaceDisplayName(config.value.name, name || baseName(root)),
      readonly,
      queue: createSerialQueue(),
      watcher: null,
      ownWrites: new Map(),
      listeners: new Set(),
      recoveryDiagnostics,
      agentSetupDiagnostics,
    };
    workspaces.set(workspace.id, workspace);
    workspacesByRoot.set(root, workspace);
    beginWatch(workspace);
    return { key: workspace.id, name: workspace.name, ...access };
  };

  const open = async (root: string, create: boolean, name?: string) => {
    if (options.resolveReadonly) root = await canonicalRoot(root);
    const readonly = await options.resolveReadonly?.(root);
    return withWorkspaceLock(root, () =>
      openUnlocked(root, readonly ? false : create, name, readonly),
    );
  };

  const readFileInner = async (
    workspace: FsWorkspace,
    relativePath: string,
  ): Promise<RawFileRead> => {
    const normalized = normalizeWorkspacePath(relativePath);
    try {
      if (normalized.startsWith('.agents/'))
        await assertSkillFile(workspace.root, normalized);
      const root = await fs.realpath(workspace.root);
      const target = await fs.realpath(absolute(workspace.root, normalized));
      const relative = path.relative(root, target).split(path.sep).join('/');
      normalizeWorkspacePath(relative);
      if (!(await fs.stat(target)).isFile())
        throw new Error('Not an ordinary file');
      const content = await fs.readFile(target);
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
    excluded: ReadonlySet<string>,
  ): Promise<WorkspaceEntryMeta[]> => {
    const names = await fs
      .readdir(dir ? absolute(root, dir) : root)
      .catch(() => [] as string[]);
    const entries: WorkspaceEntryMeta[] = [];
    for (const name of names.sort()) {
      if (
        name.toLowerCase() === '.git' ||
        [META_DIR, '.verdboard', LEGACY_RESOURCE_DIR, FOLDER_ID_FILE].includes(
          name,
        )
      )
        continue;
      const relativePath = dir ? `${dir}/${name}` : name;
      if (excluded.has(relativePath)) continue;
      const stat = await fs
        .lstat(absolute(root, relativePath))
        .catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        entries.push({
          path: relativePath,
          kind: 'directory',
          canvas: false,
          folderId: readFolderIdentity(
            await fs
              .readFile(
                absolute(root, `${relativePath}/${FOLDER_ID_FILE}`),
                'utf8',
              )
              .catch(() => ''),
          ),
        });
        entries.push(...(await readDirTree(root, relativePath, excluded)));
      } else if (stat.isFile()) {
        const native =
          isCanvasPath(relativePath) || isDocumentPath(relativePath);
        const deferred = !native && stat.size > 8 * 1024 * 1024;
        entries.push({
          path: relativePath,
          kind: 'file',
          canvas: isCanvasPath(relativePath),
          document: isDocumentPath(relativePath) || undefined,
          version: deferred
            ? undefined
            : ((await versionAt(root, relativePath)) ?? undefined),
          metadataRevision: deferred
            ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
            : undefined,
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
    storageKind: 'filesystem',
    capabilities: {
      pickWorkspace: !!options.pickDirectory,
      openBuiltinWorkspace: false,
      openPatternWorkspace: false,
    },
    workspaces,
    assertWritable,
    suspendWorkspaceWatch(handle) {
      const workspace = workspaces.get(handle.key);
      if (!workspace) throw new Error('Unknown workspace');
      workspace.watcher?.close();
      workspace.watcher = null;
      return () => {
        if (workspaces.has(handle.key)) beginWatch(workspace);
      };
    },
    recoverWorkspace: (root, expectedGeneration) =>
      withWorkspaceLock(root, async () => {
        if (
          expectedGeneration !== undefined &&
          expectedGeneration !== (await readWorkspaceGeneration(root))
        )
          throw new Error('WORKSPACE_REPLACED');
        await migrateWorkspaceMetadataUnlocked(root);
        return recoverWorkspace(root);
      }),
    async waitIdle() {
      await Promise.all(
        [...workspaces.values()].map((workspace) =>
          workspace.queue(() => Promise.resolve()),
        ),
      );
    },
    readGlobalConfig: readGlobalConfigInner,
    async writeGlobalConfig(value, expectedVersion) {
      return enqueueGlobalConfigWrite(async () => {
        const snapshot = await readGlobalConfigInner();
        if (snapshot.version !== expectedVersion)
          return { applied: false, snapshot };
        const next = { version: snapshot.version + 1, value };
        await writeJsonFile(globalConfigPath(), next);
        return { applied: true, snapshot: next };
      });
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
    async initializeAgent(handle) {
      assertWritable(handle);
      const workspace = workspaceOf(handle);
      return workspace.queue(() =>
        withWorkspaceLock(workspace.root, async () => {
          if (
            workspace.generation !==
            (await readWorkspaceGeneration(workspace.root))
          )
            throw new Error('WORKSPACE_REPLACED: reopen the workspace');
          const recoveryErrors = await recoverWorkspace(workspace.root);
          if (recoveryErrors.length) throw new Error(recoveryErrors.join('; '));
          const shared =
            (await options.sharedResources?.()) ??
            process.env['VERD_AGENT_RESOURCES'];
          const status = await initializeWorkspaceAgentUnlocked(
            workspace.root,
            shared,
          );
          workspace.agentSetupDiagnostics = status.diagnostics.filter((d) =>
            d.code.endsWith('-conflict'),
          );
          workspace.listeners.forEach((listener) =>
            listener({ paths: ['AGENTS.md'] }),
          );
          return status;
        }),
      );
    },
    async readSnapshot(handle) {
      const workspace = workspaceOf(handle);
      const configValue = (await readJsonFile(
        metaPath(workspace.root, CONFIG_FILE),
      )) as { version?: number; value?: Record<string, unknown> } | null;
      const session = ((await readJsonFile(
        metaPath(workspace.root, sessionFile),
      )) ?? (await readJsonFile(metaPath(workspace.root, SESSION_FILE)))) as
        (Partial<WorkspaceSessionState> & { version?: number }) | null;
      const excluded = await readProjectContentExclusions(workspace.root);
      const entries = await readDirTree(workspace.root, '', excluded);
      const canvases: WorkspaceHostSnapshot['canvases'] = [];
      const diagnostics: WorkspaceHostSnapshot['diagnostics'] =
        workspace.recoveryDiagnostics.map((message) => ({ message }));
      let resources: WorkspaceHostSnapshot['resources'] = [];
      try {
        resources = await readResourceMetadata(workspace.root, sha256);
      } catch (error) {
        diagnostics.push({ message: String(error), path: RESOURCE_DIR });
      }
      try {
        await assertResourceLayout(workspace.root);
      } catch (error) {
        diagnostics.push({ message: String(error), path: LEGACY_RESOURCE_DIR });
      }
      for (const entry of entries) {
        if (!entry.canvas || !isWorkspaceContentPath(entry.path, entries))
          continue;
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
        if (!entry.document || !isWorkspaceContentPath(entry.path, entries))
          continue;
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
        context: await readWorkspaceDirectoryContext(
          workspace.root,
          options.projectRoot,
        ),
        agent: await inspectWorkspaceAgentUnlocked(workspace.root).then(
          (status) => ({
            ...status,
            ready: status.ready && workspace.agentSetupDiagnostics.length === 0,
            diagnostics: [
              ...workspace.agentSetupDiagnostics,
              ...status.diagnostics,
            ],
          }),
        ),
        config: {
          version:
            typeof configValue?.version === 'number' ? configValue.version : 1,
          value: configValue?.value ?? {},
        },
        // Reads both the v1 `{frameId}` and v2 `{fileId}` tab shapes.
        session: normalizeWorkspaceSessionState(session),
        entries,
        resources,
        canvases,
        documents,
        trash,
        diagnostics,
      };
    },
    async readFile(handle, relativePath) {
      return readFileInner(workspaceOf(handle), relativePath);
    },
    async readResource(handle, key) {
      const workspace = workspaceOf(handle);
      const normalized = normalizeResourceKey(key);
      const target = await assertResourcePath(workspace.root, normalized);
      const content = await fs.readFile(target);
      return {
        path: normalized,
        version: sha256(content),
        content: new Uint8Array(content),
      };
    },
    async commit(handle, request) {
      const workspace = workspaceOf(handle);
      if (workspace.readonly) {
        const session = normalizeWorkspaceSessionState(request.session);
        if (
          !session ||
          Object.entries(request).some(
            ([key, value]) =>
              key !== 'transactionId' &&
              key !== 'session' &&
              value !== undefined,
          )
        )
          return reject(request.transactionId, 'invalid');
        request = { transactionId: request.transactionId, session };
      }
      return workspace.queue(() =>
        withWorkspaceLock(workspace.root, () =>
          applyCommit(workspace, request),
        ),
      );
    },
    async git(handle, request) {
      const workspace = workspaceOf(handle);
      if (
        workspace.readonly &&
        !['status', 'log', 'read'].includes(request.type)
      )
        throw new Error('WORKSPACE_READ_ONLY');
      return workspace.queue(() =>
        withWorkspaceLock(workspace.root, async () => {
          if (
            workspace.generation !==
            (await readWorkspaceGeneration(workspace.root))
          )
            throw new Error('WORKSPACE_REPLACED: reopen the workspace');
          if (!workspace.readonly) {
            const recoveryErrors = await recoverWorkspace(workspace.root);
            if (recoveryErrors.length)
              throw new Error(recoveryErrors.join('; '));
          }
          const git = createNodeWorkspaceGit(workspace.root, {
            notify: (paths) =>
              workspace.listeners.forEach((listener) => listener({ paths })),
          });
          return git(request);
        }),
      );
    },
    subscribe(handle, listener) {
      const workspace = workspaceOf(handle);
      workspace.listeners.add(listener);
      return () => workspace.listeners.delete(listener);
    },
    async resolveConflict(handle, request) {
      assertWritable(handle);
      const workspace = workspaceOf(handle);
      return workspace.queue(() =>
        withWorkspaceLock(workspace.root, async () => {
          let diskVersion: FileVersion | undefined;
          try {
            diskVersion = (await readFileInner(workspace, request.path))
              .version;
          } catch {
            diskVersion = undefined;
          }
          return applyCommit(workspace, conflictCommit(request, diskVersion));
        }),
      );
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

export const createFsWorkspaceHost = (options: FsWorkspaceHostOptions) => {
  const host = withGitVersioning(createFsWorkspaceHostInner(options));
  const readSnapshot = host.readSnapshot.bind(host);
  host.readSnapshot = (handle) => {
    const workspace = host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Unknown workspace');
    return withWorkspaceLock(workspace.root, async () => {
      if (
        workspace.closing ||
        workspace.generation !== (await readWorkspaceGeneration(workspace.root))
      )
        throw new Error('WORKSPACE_REPLACED: reopen the workspace');
      return readSnapshot(handle);
    });
  };
  const readFile = host.readFile.bind(host);
  host.readFile = (handle, file) => {
    const workspace = host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Unknown workspace');
    return withWorkspaceLock(workspace.root, async () => {
      if (
        workspace.closing ||
        workspace.generation !== (await readWorkspaceGeneration(workspace.root))
      )
        throw new Error('WORKSPACE_REPLACED: reopen the workspace');
      return readFile(handle, file);
    });
  };
  const readResource = host.readResource.bind(host);
  host.readResource = (handle, key) => {
    const workspace = host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Unknown workspace');
    return withWorkspaceLock(workspace.root, async () => {
      if (
        workspace.closing ||
        workspace.generation !== (await readWorkspaceGeneration(workspace.root))
      )
        throw new Error('WORKSPACE_REPLACED: reopen the workspace');
      return readResource(handle, key);
    });
  };
  return Object.assign(host, {
    async maintainWorkspace<T>(
      handle: WorkspaceHandle,
      task: (root: string) => Promise<T>,
    ): Promise<T> {
      const workspace = host.workspaces.get(handle.key);
      if (!workspace || workspace.closing)
        throw new Error('Workspace unavailable');
      workspace.closing = true;
      try {
        return await workspace.queue(async () => {
          const errors = await host.recoverWorkspace(
            workspace.root,
            workspace.generation,
          );
          if (errors.length) throw new Error(errors.join('; '));
          return withWorkspaceLock(workspace.root, async () => {
            if (
              workspace.generation !==
              (await readWorkspaceGeneration(workspace.root))
            )
              throw new Error('WORKSPACE_REPLACED');
            const resumeWatch = host.suspendWorkspaceWatch(handle);
            try {
              const result = await task(workspace.root);
              await host.closeWorkspace(handle);
              return result;
            } finally {
              if (
                workspace.generation !==
                (await readWorkspaceGeneration(workspace.root))
              )
                await host.closeWorkspace(handle);
              else resumeWatch();
            }
          });
        });
      } finally {
        workspace.closing = false;
      }
    },
  });
};
