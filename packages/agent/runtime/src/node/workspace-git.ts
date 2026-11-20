import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  directoryCreation,
  directoryRestore,
  directoryRoot,
  directoryId,
  inDirectory,
  expandCreation,
  assertGitContentPath,
  isGitRuntimePath,
  validateGitVersionFiles,
  gitAssetReferences,
  nativeFileIdentity,
  type WorkspaceGitRequest,
  type WorkspaceGitResult,
  type WorkspaceGitStatus,
  type GitChange,
  type GitCommit,
  type GitVersionFile,
  type GitOperationPlan,
  type GitCleanupState,
} from '@sue/verd-board-workspace';
import {
  appPublishTempBase,
  assertGitDiskPath,
  publishGitRestore,
  recoverGitRestore,
} from './workspace-git-restore';

const sha = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const blobOid = (bytes: Uint8Array) =>
  createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
const exists = (target: string) =>
  fs.lstat(target).then(
    () => true,
    () => false,
  );
const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const split = (bytes: Uint8Array) => decode(bytes).split('\0').filter(Boolean);
const oidPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
interface Settings {
  executable?: string;
}
interface RemoteRef {
  remote: string;
  url: string;
  ref: string;
  old: string;
  tracking: string;
}
interface LocalCleanup {
  files: string[];
  versions: Record<string, string>;
  live: { path: string; before: string }[];
  directories: string[];
  manifests: { path: string; value: unknown; before: string }[];
  assets: string[];
  fingerprint: string;
}
interface StoredPlan {
  plan: GitOperationPlan;
  createPaths?: string[];
  message?: string;
  files?: GitVersionFile[];
  deletions?: string[];
  before?: Record<string, string | null>;
  analysis?: unknown;
  fileIds?: string[];
  trashEntryIds?: string[];
  directPaths?: string[];
  remotes?: RemoteRef[];
  local?: LocalCleanup;
  namespace?: string;
}
interface CleanupRecord {
  state: GitCleanupState;
  updates?: {
    remote: string;
    url: string;
    ref: string;
    old: string;
    next?: string;
  }[];
}
interface TreeEntry {
  path: string;
  oid: string;
  mode: string;
}
interface GitOptions {
  notify?: (paths: string[]) => void;
}
const plans = new Map<string, Map<string, StoredPlan>>();
export async function recoverGitNativeLock(
  root: string,
  gitdir = path.join(root, '.git'),
) {
  const info = await fs.lstat(gitdir).catch(() => null);
  if (!info?.isDirectory()) return;
  const refs = (await walkFiles(gitdir, 'refs'))
    .map((file) => file.path)
    .filter((relative) => relative.endsWith('.lock'));
  for (const relative of [
    'index.lock',
    'HEAD.lock',
    'packed-refs.lock',
    ...refs,
  ]) {
    const lock = path.join(gitdir, relative),
      bytes = await fs.readFile(lock, 'utf8').catch(() => null);
    if (!bytes?.startsWith('{"format":"verd-git-lock"')) continue;
    const owner = JSON.parse(bytes) as { pid: number };
    if (!Number.isInteger(owner.pid) || owner.pid <= 0)
      throw new Error('Invalid application Git lock');
    try {
      process.kill(owner.pid, 0);
      throw new Error('An application Git operation is still active');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await fs.unlink(lock);
  }
}
async function withNativeLocks<T>(
  root: string,
  names: string[],
  task: () => Promise<T>,
  gitdir = path.join(root, '.git'),
): Promise<T> {
  const held: string[] = [],
    bytes = JSON.stringify({
      format: 'verd-git-lock',
      pid: process.pid,
      nonce: randomUUID(),
    });
  try {
    for (const name of names) {
      const target = path.join(gitdir, name + '.lock');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' }).catch(() => {
        throw new Error('Git is locked by another operation: ' + name);
      });
      held.push(target);
    }
    return await task();
  } finally {
    for (const target of held.reverse())
      if ((await fs.readFile(target, 'utf8').catch(() => null)) === bytes)
        await fs.unlink(target);
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value));
  await fs.rename(temp, file);
}

const trashId = (id: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id))
    throw new Error('Invalid trash identity');
  return id;
};
async function walkFiles(
  root: string,
  relative: string,
): Promise<{ path: string; bytes: Uint8Array }[]> {
  const target = path.join(root, relative),
    info = await fs.lstat(target).catch(() => null);
  if (!info) return [];
  if (info.isSymbolicLink())
    throw new Error('History cleanup cannot follow symlinks: ' + relative);
  if (info.isFile())
    return [
      { path: relative, bytes: new Uint8Array(await fs.readFile(target)) },
    ];
  const result: { path: string; bytes: Uint8Array }[] = [];
  for (const child of await fs.readdir(target))
    result.push(...(await walkFiles(root, relative + '/' + child)));
  return result;
}
async function liveIdentityFiles(root: string): Promise<GitVersionFile[]> {
  const files: GitVersionFile[] = [];
  const visit = async (relative: string) => {
    for (const child of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (
        [
          '.git',
          '.verdscrolls',
          '.verdboard',
          '.verd-resources',
          'node_modules',
        ].includes(child.name)
      )
        continue;
      const nested = relative ? relative + '/' + child.name : child.name;
      if (child.isDirectory()) await visit(nested);
      else if (
        child.isFile() &&
        (/\.verd(?:(?:-doc)?\.json)?$/.test(child.name) ||
          child.name === '.verd-folder.json')
      ) {
        files.push({
          path: nested,
          content: new Uint8Array(await fs.readFile(path.join(root, nested))),
        });
      }
    }
  };
  await visit('');
  return files;
}
async function liveNativeIdentities(root: string): Promise<Set<string>> {
  return new Set(
    (await liveIdentityFiles(root))
      .map((file) => nativeFileIdentity(file.content))
      .filter((id): id is string => !!id),
  );
}
async function trashTargets(root: string, ids: string[]) {
  const fileIds = new Set<string>(),
    paths = new Set<string>();
  const seeds: { path: string; content: Uint8Array }[] = [];
  for (const id of ids) {
    const relative = '.verdscrolls/trash/' + trashId(id);
    const meta = await readJson<{ originalPath: string }>(
      path.join(root, relative, 'entry.json'),
    );
    if (!meta || typeof meta.originalPath !== 'string')
      throw new Error('Trash entry is missing or corrupt');
    const base = path.posix.basename(meta.originalPath);
    for (const file of await walkFiles(root, relative)) {
      if (file.path === relative + '/entry.json') continue;
      const identity = nativeFileIdentity(file.bytes);
      if (identity) fileIds.add(identity);
      else {
        const suffix = file.path.slice((relative + '/' + base).length),
          original = assertGitContentPath(meta.originalPath + suffix);
        paths.add(original);
        seeds.push({ path: original, content: file.bytes });
      }
    }
  }
  return { fileIds: [...fileIds], paths: [...paths], seeds };
}
async function localCleanup(
  root: string,
  fileIds: string[],
  explicitPaths: string[],
  exclusive: string[],
  surviving: string[],
  selectedTrash: string[],
  removedBlobs: string[] = [],
): Promise<LocalCleanup> {
  const files = new Set<string>(),
    directories = selectedTrash.map(
      (id) => '.verdscrolls/trash/' + trashId(id),
    );
  const versions: Record<string, string> = {};
  const manifests: LocalCleanup['manifests'] = [],
    candidates = new Set(exclusive),
    survivors = new Set(surviving);
  const hash = createHash('sha256');
  const live: LocalCleanup['live'] = [];
  const collect = (relative: string, bytes: Uint8Array, removed: boolean) => {
    hash.update(relative + '\0');
    hash.update(bytes);
    for (const asset of gitAssetReferences(bytes))
      (removed ? candidates : survivors).add(asset);
    if (removed) {
      files.add(relative);
      versions[relative] = sha(bytes);
    }
  };
  const inspectLive = async (relative: string) => {
    for (const child of await fs.readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      if (
        [
          '.git',
          '.verdscrolls',
          '.verdboard',
          '.verd-resources',
          'node_modules',
        ].includes(child.name)
      )
        continue;
      const nested = relative ? relative + '/' + child.name : child.name;
      if (child.isDirectory()) await inspectLive(nested);
      else if (
        child.isFile() &&
        (/\.verd(?:(?:-doc)?\.json)?$/.test(child.name) ||
          appPublishTempBase(nested))
      ) {
        const bytes = new Uint8Array(
            await fs.readFile(path.join(root, nested)),
          ),
          id = nativeFileIdentity(bytes);
        hash.update(nested + '\0');
        hash.update(bytes);
        const removed = id
          ? fileIds.includes(id)
          : !!appPublishTempBase(nested) &&
            removedBlobs.includes(blobOid(bytes));
        for (const asset of gitAssetReferences(bytes))
          (removed ? candidates : survivors).add(asset);
        if (removed) live.push({ path: nested, before: sha(bytes) });
      } else if (
        child.isSymbolicLink() &&
        (/\.verd(?:(?:-doc)?\.json)?$/.test(child.name) ||
          appPublishTempBase(nested))
      )
        throw new Error(
          'Cannot safely inspect a linked native document during cleanup: ' +
            nested,
        );
    }
  };
  await inspectLive('');
  for (const directory of [
    '.verdscrolls/resources/history',
    '.verd-resources/history',
  ]) {
    const manifestPath = directory + '/index.json';
    const raw = await fs
      .readFile(path.join(root, manifestPath))
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    const indexed = new Set<string>();
    if (raw) {
      hash.update(manifestPath + '\0');
      hash.update(raw);
      const manifest = JSON.parse(decode(raw)) as {
        version: number;
        revisions: { fileId: string; path: string }[];
        trashed?: Record<string, string[]>;
      };
      if (manifest.version !== 1 || !Array.isArray(manifest.revisions))
        throw new Error(
          'History index is corrupt; repair it before clearing sensitive history',
        );
      for (const revision of manifest.revisions)
        if (fileIds.includes(revision.fileId)) {
          const name = revision.path.split('/').pop()!;
          if (!/^[a-zA-Z0-9-]+\.snapshot\.json$/.test(name))
            throw new Error('Invalid historical snapshot path');
          indexed.add(directory + '/' + name);
        }
      manifest.revisions = manifest.revisions.filter(
        (revision) => !fileIds.includes(revision.fileId),
      );
      if (manifest.trashed)
        for (const key of Object.keys(manifest.trashed))
          manifest.trashed[key] = manifest.trashed[key]!.filter(
            (id) => !fileIds.includes(id),
          );
      manifests.push({ path: manifestPath, value: manifest, before: sha(raw) });
    }
    for (const file of await walkFiles(root, directory)) {
      if (file.path === manifestPath) continue;
      const id = nativeFileIdentity(file.bytes);
      collect(
        file.path,
        file.bytes,
        indexed.has(file.path) ||
          (id
            ? fileIds.includes(id)
            : !!appPublishTempBase(file.path) &&
              removedBlobs.includes(blobOid(file.bytes))),
      );
    }
  }
  for (const directory of [
    '.verdscrolls/resources/assets',
    '.verd-resources/assets',
  ])
    for (const file of await walkFiles(root, directory)) {
      if (!appPublishTempBase(file.path)) continue;
      const id = nativeFileIdentity(file.bytes),
        removed = id
          ? fileIds.includes(id)
          : removedBlobs.includes(blobOid(file.bytes));
      hash.update(file.path + '\0');
      hash.update(file.bytes);
      for (const asset of gitAssetReferences(file.bytes))
        (removed ? candidates : survivors).add(asset);
      if (removed) live.push({ path: file.path, before: sha(file.bytes) });
    }
  const trashRoot = '.verdscrolls/trash';
  for (const id of await fs
    .readdir(path.join(root, trashRoot))
    .catch(() => [] as string[])) {
    trashId(id);
    const relative = trashRoot + '/' + id;
    const meta = await readJson<{ originalPath: string }>(
      path.join(root, relative, 'entry.json'),
    );
    if (!meta || typeof meta.originalPath !== 'string')
      throw new Error('Trash metadata is corrupt');
    for (const file of await walkFiles(root, relative)) {
      if (file.path === relative + '/entry.json') {
        collect(file.path, file.bytes, directories.includes(relative));
        continue;
      }
      const id = nativeFileIdentity(file.bytes),
        suffix = file.path.slice(
          (relative + '/' + path.posix.basename(meta.originalPath)).length,
        );
      const original = meta.originalPath + suffix;
      collect(
        file.path,
        file.bytes,
        directories.includes(relative) ||
          (id
            ? fileIds.includes(id)
            : explicitPaths.includes(original) &&
              removedBlobs.includes(blobOid(file.bytes))),
      );
    }
  }
  return {
    files: [...files].sort(),
    versions,
    live,
    directories,
    manifests,
    assets: [...candidates].filter((asset) => !survivors.has(asset)).sort(),
    fingerprint: hash.digest('hex'),
  };
}

/** Runs argv directly. Git retains its normal hooks, signing and credential helpers. */
async function execute(
  executable: string,
  root: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    input?: Uint8Array | string;
    allowFailure?: boolean;
  } = {},
) {
  return new Promise<Buffer>((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
    };
    for (const key of [
      'GIT_DIR',
      'GIT_COMMON_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_NAMESPACE',
      'GIT_PREFIX',
    ])
      delete environment[key];
    const child = spawn(
      executable,
      ['--no-optional-locks', '--literal-pathspecs', '-C', root, ...args],
      {
        env: { ...environment, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    let size = 0,
      settled = false;
    const timer = setTimeout(() => {
      child.kill();
    }, 120_000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024 * 1024) child.kill();
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      settled = true;
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code === 0 || options.allowFailure) resolve(Buffer.concat(output));
      else
        reject(
          new Error(
            decode(Buffer.concat(errors)).trim() ||
              'Git command failed (' + code + ')',
          ),
        );
    });
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}

/** Resolve through Git itself: .git may be an ancestor directory or a worktree pointer file. */
export async function discoverWorkspaceRepository(
  root: string,
  executable = 'git',
) {
  const read = async (args: string[]) =>
    decode(await execute(executable, root, args)).trim();
  let repositoryRoot: string;
  try {
    repositoryRoot = await read(['rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
  repositoryRoot = await fs.realpath(repositoryRoot);
  const workspaceRoot = await fs.realpath(root);
  const relative = path.relative(repositoryRoot, workspaceRoot);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative)
  )
    throw new Error('Workspace is outside its Git repository');
  const gitDirectory = await fs.realpath(
    await read(['rev-parse', '--absolute-git-dir']),
  );
  const commonDirectory = await fs.realpath(
    path.resolve(root, await read(['rev-parse', '--git-common-dir'])),
  );
  const managed =
    repositoryRoot === workspaceRoot &&
    gitDirectory === path.join(workspaceRoot, '.git');
  return {
    root: repositoryRoot,
    workspacePath: relative.split(path.sep).join('/'),
    gitDirectory,
    commonDirectory,
    managed,
  };
}

export function createNodeWorkspaceGit(root: string, options: GitOptions = {}) {
  const settingsPath = path.join(root, '.verdscrolls/git-settings.json');
  const cleanupPath = path.join(root, '.verdscrolls/git-cleanup.json');
  const planStore = plans.get(root) ?? new Map<string, StoredPlan>();
  plans.set(root, planStore);
  let executable = 'git';
  const run = (args: string[], extra?: Parameters<typeof execute>[3]) =>
    execute(executable, root, args, extra);
  const text = async (args: string[], allowFailure = false) =>
    decode(await run(args, { allowFailure })).trim();
  let rootGitdir = path.join(root, '.git');
  let commonGitdir = rootGitdir;
  let repository: Awaited<ReturnType<typeof discoverWorkspaceRepository>> =
    null;
  const localPath = (relative: string): string | undefined => {
    const prefix = repository?.workspacePath;
    return !prefix
      ? relative
      : relative.startsWith(prefix + '/')
        ? relative.slice(prefix.length + 1)
        : undefined;
  };

  const rootRepository = async () => {
    repository = await discoverWorkspaceRepository(root, executable);
    rootGitdir = repository?.gitDirectory ?? path.join(root, '.git');
    commonGitdir = repository?.commonDirectory ?? rootGitdir;
    return !!repository;
  };
  const token = async (
    head: string | null,
    includeRefs = true,
    excludePaths = new Set<string>(),
  ) => {
    const hash = createHash('sha256');
    hash.update(head ?? '');
    if (includeRefs)
      hash.update(
        await run(['for-each-ref', '--format=%(refname) %(objectname)']),
      );
    hash.update(
      await fs
        .readFile(path.join(rootGitdir, 'index'))
        .catch(() => Buffer.alloc(0)),
    );
    hash.update(
      await fs
        .readFile(path.join(commonGitdir, 'config'))
        .catch(() => Buffer.alloc(0)),
    );
    const paths = split(
      await run([
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
      ]),
    );
    for (const relative of [...new Set(paths)]
      .filter(
        (relative) =>
          !isGitRuntimePath(relative) && !excludePaths.has(relative),
      )
      .sort()) {
      hash.update(relative + '\0');
      const target = path.join(root, relative);
      const info = await fs.lstat(target).catch(() => null);
      if (info?.isFile()) {
        hash.update(String(info.mode & 0o777));
        hash.update(await fs.readFile(target));
      } else if (info?.isSymbolicLink()) hash.update(await fs.readlink(target));
      else hash.update(info ? 'directory' : 'missing');
    }
    const cleanup = await fs.readFile(cleanupPath).catch(() => Buffer.alloc(0));
    hash.update(cleanup);
    return hash.digest('hex');
  };
  const status = async (): Promise<WorkspaceGitStatus> => {
    try {
      await run(['--version']);
      if (!(await rootRepository()))
        return {
          available: true,
          initialized: false,
          branch: null,
          head: null,
          token: sha('uninitialized:' + executable),
          changes: [],
          canSync: false,
          remoteSupported: true,
        };
      const head =
        (await text(['rev-parse', '--verify', 'HEAD'], true)) || null;
      const branch =
        (await text(['symbolic-ref', '--quiet', '--short', 'HEAD'], true)) ||
        null;
      const raw = split(
        await run([
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
          '--',
          '.',
        ]),
      );
      const changes: GitChange[] = [];
      for (let i = 0; i < raw.length; i++) {
        const entry = raw[i]!,
          xy = entry.slice(0, 2),
          relative = localPath(entry.slice(3));
        const renamed = xy.includes('R') || xy.includes('C');
        if (renamed) i++;
        if (!relative || isGitRuntimePath(relative)) continue;
        changes.push({
          path: relative,
          staged: xy[0] !== ' ' && xy[0] !== '?',
          status:
            xy === '??'
              ? 'untracked'
              : xy.includes('U') || ['AA', 'DD'].includes(xy)
                ? 'conflicted'
                : renamed
                  ? 'renamed'
                  : xy.includes('D')
                    ? 'deleted'
                    : xy.includes('A')
                      ? 'added'
                      : 'modified',
        });
      }
      const blocked: string[] = [];
      if (changes.some((change) => change.status === 'conflicted'))
        blocked.push('Resolve Git conflicts outside the application');
      for (const name of [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'rebase-merge',
        'rebase-apply',
        'index.lock',
      ])
        if (await exists(path.join(rootGitdir, name)))
          blocked.push('Git operation in progress: ' + name);
      const authorName = await text(['config', '--get', 'user.name'], true),
        email = await text(['config', '--get', 'user.email'], true);
      const remotes = (await text(['remote'])).split('\n').filter(Boolean);
      const remoteName =
        (branch &&
          (await text(['config', '--get', `branch.${branch}.remote`], true))) ||
        (remotes.includes('origin') ? 'origin' : remotes[0]);
      const remoteUrl = remoteName
        ? await text(['remote', 'get-url', remoteName], true)
        : '';
      const merge = branch
        ? await text(['config', '--get', `branch.${branch}.merge`], true)
        : '';
      let ahead = 0,
        behind = 0;
      const remoteBranch = merge?.replace(/^refs\/heads\//, '') || branch;
      if (head && remoteName && remoteBranch) {
        const counts = await text(
          [
            'rev-list',
            '--left-right',
            '--count',
            `HEAD...refs/remotes/${remoteName}/${remoteBranch}`,
          ],
          true,
        );
        if (counts)
          [ahead, behind] = counts.split(/\s+/).map(Number) as [number, number];
      }
      const cleanup = await readJson<CleanupRecord>(cleanupPath);
      if (cleanup && cleanup.state.phase !== 'acknowledged')
        blocked.push(
          'Sensitive history cleanup is pending; ordinary synchronization is disabled',
        );
      return {
        available: true,
        initialized: true,
        head,
        branch,
        token: await token(head),
        changes,
        remote: remoteUrl
          ? {
              name: remoteName!,
              url: remoteUrl,
              branch: remoteBranch ?? undefined,
            }
          : undefined,
        ahead,
        behind,
        author: authorName && email ? { name: authorName, email } : undefined,
        blocked,
        canSync:
          !!repository?.managed &&
          !!remoteUrl &&
          !!branch &&
          !changes.length &&
          !blocked.length,
        cleanup: cleanup?.state,
        remoteSupported: !!repository?.managed,
        repositoryManaged: !!repository?.managed,
        historyCleanupSupported: !!repository?.managed,
        repository: repository
          ? {
              root: repository.root,
              workspacePath: repository.workspacePath,
              ownership: repository.managed ? 'workspace' : 'project',
            }
          : undefined,
      };
    } catch (error) {
      return {
        available: false,
        initialized: await exists(rootGitdir),
        branch: null,
        head: null,
        token: '',
        changes: [],
        canSync: false,
        error: String(error),
        remoteSupported: true,
      };
    }
  };
  const requireReady = (state: WorkspaceGitStatus, clean = false) => {
    if (!state.available || !state.initialized)
      throw new Error(state.error || 'Initialize Git first');
    if (
      state.blocked?.some((reason) => !reason.startsWith('Sensitive history'))
    )
      throw new Error(state.blocked.join('; '));
    if (clean && state.changes.length)
      throw new Error('Commit or discard Git changes before this operation');
  };
  const checkToken = (state: WorkspaceGitStatus, expected: string) => {
    if (!expected || expected !== state.token)
      throw new Error('Git state changed; review the operation again');
  };
  const resolveOid = async (oid: string) => {
    if (
      !oidPattern.test(oid) ||
      (await text(['cat-file', '-t', oid])) !== 'commit'
    )
      throw new Error('Invalid Git commit');
    return oid;
  };
  const tree = async (oid: string | null, gitdir?: string) => {
    const entries = new Map<string, TreeEntry>();
    if (!oid) return entries;
    for (const row of split(
      await run(
        ['ls-tree', '-rz', '--full-tree', oid],
        gitdir ? { env: { GIT_DIR: gitdir } } : undefined,
      ),
    )) {
      const tab = row.indexOf('\t'),
        [mode, kind, object] = row.slice(0, tab).split(' '),
        relative = localPath(row.slice(tab + 1));
      if (relative && (kind === 'blob' || mode === '160000'))
        entries.set(relative, { path: relative, oid: object!, mode: mode! });
    }
    return entries;
  };
  const blob = async (
    entry: TreeEntry,
    gitdir?: string,
  ): Promise<GitVersionFile> => ({
    path: entry.path,
    mode: entry.mode,
    content: new Uint8Array(
      await run(
        ['cat-file', 'blob', entry.oid],
        gitdir ? { env: { GIT_DIR: gitdir } } : undefined,
      ),
    ),
  });
  const versionFiles = async (oid: string | null, gitdir?: string) => {
    const files: GitVersionFile[] = [];
    for (const entry of (await tree(oid, gitdir)).values())
      if (!isGitRuntimePath(entry.path)) files.push(await blob(entry, gitdir));
    return files;
  };
  const fileIdentity = (file: GitVersionFile) => {
    if (!/\.verd(?:(?:-doc)?\.json)?$/.test(file.path)) return null;
    try {
      const parsed = JSON.parse(decode(file.content));
      return parsed.format === 'verd-document'
        ? parsed.id
        : parsed.format === 'verd-frame'
          ? parsed.frame?.id
          : null;
    } catch {
      return null;
    }
  };
  const locate = async (entries: Map<string, TreeEntry>, fileId: string) => {
    for (const entry of entries.values())
      if (
        /\.verd(?:(?:-doc)?\.json)?$/.test(entry.path) &&
        fileIdentity(await blob(entry)) === fileId
      )
        return entry.path;
    return undefined;
  };
  const followedPaths = async (
    relative: string,
  ): Promise<Map<string, string>> => {
    assertGitContentPath(relative);
    const commits = (
      await text([
        'log',
        '--follow',
        '--find-renames',
        '--format=%H',
        'HEAD',
        '--',
        relative,
      ])
    )
      .split('\n')
      .filter(Boolean);
    const result = new Map<string, string>();
    let current = relative;
    for (const oid of commits) {
      result.set(oid, current);
      let leftWorkspace = false;
      const rows = split(
        await run([
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--name-status',
          '-r',
          '--find-renames',
          '-z',
          oid,
        ]),
      );
      for (let index = 0; index < rows.length; index++) {
        if (/^R\d+$/.test(rows[index]!)) {
          const previous = localPath(rows[++index]!),
            next = localPath(rows[++index]!);
          if (next === current) {
            if (previous) current = previous;
            else leftWorkspace = true;
            break;
          }
        } else index++;
      }
      if (leftWorkspace) break;
    }
    return result;
  };
  const withIndexLock = async <T>(task: () => Promise<T>) => {
    return withNativeLocks(root, ['index'], task, rootGitdir);
  };
  const safeRemote = (url: string) => {
    if (
      /^[a-zA-Z][a-zA-Z0-9+.-]*::/.test(url) ||
      /[\r\n\0]/.test(url) ||
      url.startsWith('-')
    )
      throw new Error('Unsupported Git remote transport');
  };
  const register = (stored: StoredPlan) => {
    planStore.set(stored.plan.id, stored);
    return stored.plan;
  };

  const commit = async (
    request: Extract<WorkspaceGitRequest, { type: 'commit' }>,
    state: WorkspaceGitStatus,
  ) => {
    const message = request.message.trim() || '更新工作区';
    const author = request.author ?? state.author;
    if (!author?.name.trim() || !author.email.trim())
      throw new Error('Configure a Git author name and email');
    const tracked = new Set(split(await run(['ls-files', '--cached', '-z'])));
    if ([...tracked].some(isGitRuntimePath))
      throw new Error(
        'Git tracks application runtime files; remove them from the index with git rm --cached before committing',
      );
    const headTree = await tree(state.head);
    const candidates = [
      ...new Set([
        ...split(
          await run([
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '-z',
          ]),
        ),
        ...headTree.keys(),
      ]),
    ].filter((relative) => !isGitRuntimePath(relative));
    const selected = request.paths?.length
      ? request.paths.map(assertGitContentPath)
      : [...candidates];
    if (request.paths?.length)
      for (const relative of [...selected]) {
        const bytes = await fs
          .readFile(path.join(root, relative))
          .catch(() => null);
        if (!bytes) continue;
        const id = nativeFileIdentity(bytes);
        if (id) {
          const previous = await locate(headTree, id);
          if (previous && previous !== relative) {
            if (await exists(path.join(root, previous)))
              throw new Error(
                'A renamed native path was reused; commit the complete rename together',
              );
            if (!selected.includes(previous)) selected.push(previous);
          }
        }
        for (const asset of gitAssetReferences(bytes)) {
          assertGitContentPath(asset);
          if (!candidates.includes(asset))
            throw new Error(
              'Required attachment is unavailable or ignored: ' + asset,
            );
          if (!selected.includes(asset)) selected.push(asset);
        }
      }
    if (!selected.length) throw new Error('No content changes to commit');
    if (selected.some((relative) => !candidates.includes(relative)))
      throw new Error('Selected path is ignored or unavailable');
    const temporary = path.join(rootGitdir, 'verd-' + randomUUID() + '.index');
    const env = { GIT_INDEX_FILE: temporary };
    try {
      if (state.head) await run(['read-tree', state.head], { env });
      else await run(['read-tree', '--empty'], { env });
      await run(['add', '-A', '--', ...selected], { env });
      const treeOid = decode(await run(['write-tree'], { env })).trim();
      validateGitVersionFiles(
        await versionFiles(treeOid),
        undefined,
        await versionFiles(state.head),
      );
      if (
        state.head &&
        treeOid === (await text(['rev-parse', `${state.head}^{tree}`]))
      )
        throw new Error('Selected files have no changes');
      checkToken(await status(), state.token);
      // Intent-to-add makes newly created paths eligible for --only without staging other files.
      const untracked: string[] = [];
      for (const relative of selected)
        if (
          !tracked.has(relative) &&
          (
            await fs.lstat(path.join(root, relative)).catch(() => null)
          )?.isFile()
        )
          untracked.push(relative);
      if (untracked.length)
        await run(['add', '--intent-to-add', '--', ...untracked]);
      const commitPaths: string[] = [];
      for (const relative of selected) {
        if (
          (
            await fs.lstat(path.join(root, relative)).catch(() => null)
          )?.isDirectory() &&
          selected.some((other) => other.startsWith(relative + '/'))
        )
          continue;
        commitPaths.push(relative);
      }
      try {
        await run(['commit', '--only', '-m', message, '--', ...commitPaths], {
          env: {
            GIT_AUTHOR_NAME: author.name,
            GIT_AUTHOR_EMAIL: author.email,
            GIT_COMMITTER_NAME: author.name,
            GIT_COMMITTER_EMAIL: author.email,
          },
        });
      } catch (error) {
        throw new Error(
          'Git commit did not complete; review HEAD and index before retrying. ' +
            String(error),
        );
      }
      return text(['rev-parse', 'HEAD']);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };

  return async (request: WorkspaceGitRequest): Promise<WorkspaceGitResult> => {
    executable = (await readJson<Settings>(settingsPath))?.executable || 'git';
    await rootRepository();
    await recoverGitNativeLock(root, rootGitdir);
    await recoverGitPurge(root);
    await recoverGitRestore(root);
    let state = await status();
    if (request.type === 'status') return { status: state };
    if (
      repository &&
      !repository.managed &&
      (request.type === 'init' ||
        request.type === 'sync' ||
        request.type === 'configure' ||
        request.type === 'purge-plan' ||
        request.type === 'purge' ||
        request.type === 'cleanup-retry' ||
        request.type === 'cleanup-confirm')
    )
      throw new Error(
        'The enclosing project owns repository settings, synchronization and history cleanup; use an external Git client',
      );
    if (request.type === 'configure' && request.executable !== undefined) {
      if (!request.executable.trim() || /[\r\n\0]/.test(request.executable))
        throw new Error('Invalid Git executable');
      await execute(request.executable, root, ['--version']);
      executable = request.executable;
      await writeJson(settingsPath, { executable });
      state = await status();
      if (
        !state.initialized &&
        !request.author &&
        request.remoteUrl === undefined
      )
        return { status: state };
    }
    if (request.type === 'init') {
      if (!state.available)
        throw new Error(state.error || 'Git is unavailable');
      if (!state.initialized) await run(['init', '--initial-branch=main', '.']);
      if (request.author) {
        await run(['config', '--local', 'user.name', request.author.name]);
        await run(['config', '--local', 'user.email', request.author.email]);
      }
      return { status: await status() };
    }
    requireReady(state);
    if (request.type === 'configure') {
      if (
        request.remoteUrl !== undefined &&
        state.cleanup &&
        state.cleanup.phase !== 'acknowledged'
      )
        throw new Error(
          'Finish pending history cleanup before changing remotes',
        );
      if (request.author) {
        if (!request.author.name.trim() || !request.author.email.trim())
          throw new Error('Git author is incomplete');
        await run(['config', '--local', 'user.name', request.author.name]);
        await run(['config', '--local', 'user.email', request.author.email]);
      }
      if (request.remoteUrl !== undefined) {
        const name = request.remoteName ?? 'origin';
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) ||
          /[\r\n\0]/.test(request.remoteUrl) ||
          request.remoteUrl.startsWith('-')
        )
          throw new Error('Invalid Git remote');
        safeRemote(request.remoteUrl);
        const current = (await text(['remote'])).split('\n');
        if (!request.remoteUrl) {
          if (current.includes(name)) await run(['remote', 'remove', name]);
        } else
          await run([
            'remote',
            current.includes(name) ? 'set-url' : 'add',
            name,
            request.remoteUrl,
          ]);
      }
      return { status: await status() };
    }
    if ('expectedToken' in request) checkToken(state, request.expectedToken);
    if (request.type === 'create-plan') {
      const current: GitVersionFile[] = [];
      for (const relative of new Set(
        split(
          await run([
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '-z',
          ]),
        ),
      )) {
        if (isGitRuntimePath(relative)) continue;
        await assertGitDiskPath(root, relative);
        const info = await fs
          .lstat(path.join(root, relative))
          .catch(() => null);
        if (info?.isFile())
          current.push({
            path: relative,
            content: new Uint8Array(
              await fs.readFile(path.join(root, relative)),
            ),
            mode: info.mode & 0o111 ? '100755' : '100644',
          });
      }
      const base = await versionFiles(state.head);
      let paths =
        request.paths ??
        (request.fileId
          ? current
              .filter((f) => nativeFileIdentity(f.content) === request.fileId)
              .map((f) => f.path)
          : request.path
            ? [request.path]
            : state.changes.map((c) => c.path));
      let metadata: GitVersionFile[] = [];
      let review = false;
      if (request.directoryPath) {
        const selectedRoot = assertGitContentPath(request.directoryPath);
        await assertGitDiskPath(root, selectedRoot);
        directoryId(current, selectedRoot, request.folderId);
        const dirs: string[] = [];
        const walk = async (dir: string) => {
          if (
            isGitRuntimePath(dir) ||
            (await text(['check-ignore', '--', dir + '/'], true)).trim()
          )
            return;
          dirs.push(dir);
          for (const child of await fs.readdir(path.join(root, dir), {
            withFileTypes: true,
          })) {
            if (child.isSymbolicLink())
              throw new Error(
                'Directory versions do not support symbolic links',
              );
            if (child.isDirectory() && child.name.toLowerCase() !== '.git')
              await walk(dir + '/' + child.name);
          }
        };
        await walk(selectedRoot);
        if (!dirs.includes(selectedRoot))
          throw new Error('Selected directory is ignored');
        const result = directoryCreation(
          current,
          base,
          selectedRoot,
          dirs,
          state.changes.map((c) => c.path),
        );
        paths = result.paths;
        metadata = result.metadata;
        review = result.requiresReview;
      }
      const expanded = expandCreation([...current, ...metadata], base, paths);
      review ||= expanded.some((p) => !paths.includes(p));
      if (!expanded.length) throw new Error('No content changes to commit');
      const plan = register({
        plan: {
          id: randomUUID(),
          kind: 'create',
          scope: request.directoryPath
            ? 'directory'
            : request.path || request.fileId
              ? 'file'
              : 'workspace',
          token: state.token,
          paths: expanded.map((path) => ({
            path,
            action:
              current.some((f) => f.path === path) ||
              metadata.some((f) => f.path === path)
                ? 'write'
                : 'delete',
          })),
          warnings: [],
          requiresReview: review,
        },
        files: metadata,
        createPaths: expanded,
        message: request.message,
      });
      return { status: state, plan };
    }
    if (request.type === 'create') {
      const saved = planStore.get(request.planId);
      if (
        !saved ||
        saved.plan.kind !== 'create' ||
        saved.plan.token !== state.token
      )
        throw new Error('Create plan expired; preview again');
      if (saved.files?.length)
        await withIndexLock(() =>
          publishGitRestore(
            root,
            saved.plan.id,
            saved.files!,
            [],
            undefined,
            Object.fromEntries(saved.files!.map((f) => [f.path, null])),
          ),
        );
      const next = await status();
      if (
        (await token(
          next.head,
          true,
          new Set(saved.files?.map((file) => file.path)),
        )) !== state.token
      )
        throw new Error('Create plan expired because workspace changed');
      for (const file of saved.files ?? [])
        if (
          sha(await fs.readFile(path.join(root, file.path))) !==
          sha(file.content)
        )
          throw new Error('Directory identity changed during creation');
      const oid = await commit(
        {
          type: 'commit',
          message: saved.message!,
          paths: saved.createPaths,
          expectedToken: next.token,
        },
        next,
      );
      planStore.delete(request.planId);
      options.notify?.(saved.plan.paths.map((p) => p.path));
      return { oid, status: await status() };
    }
    if (request.type === 'commit')
      return { oid: await commit(request, state), status: await status() };
    if (request.type === 'read') {
      const entries = await tree(await resolveOid(request.oid));
      const selected = request.paths?.map(assertGitContentPath);
      const files: GitVersionFile[] = [];
      for (const entry of entries.values())
        if (
          !isGitRuntimePath(entry.path) &&
          (!selected || selected.includes(entry.path))
        )
          files.push(await blob(entry));
      return { files, status: state };
    }
    if (request.type === 'log') {
      if (!state.head) return { commits: [], status: state };
      if (request.path) assertGitContentPath(request.path);
      const limit = Math.min(100, Math.max(1, request.limit ?? 50));
      let directoryIdentity: string | undefined;
      if (request.directoryPath) {
        const marker = path.join(
          root,
          assertGitContentPath(request.directoryPath),
          '.verd-folder.json',
        );
        await assertGitDiskPath(
          root,
          request.directoryPath + '/.verd-folder.json',
        );
        const bytes = await fs.readFile(marker).catch(() => null);
        directoryIdentity = bytes
          ? directoryId(
              [
                {
                  path: request.directoryPath + '/.verd-folder.json',
                  content: bytes,
                },
              ],
              request.directoryPath,
              request.folderId,
            )
          : undefined;
        if (!directoryIdentity) return { status: state, commits: [] };
      }
      const followsPath = request.path && !request.fileId;
      const lineage = followsPath
        ? await followedPaths(request.path!)
        : undefined;
      const oids = lineage
        ? [...lineage.keys()]
        : (await text(['rev-list', '--date-order', 'HEAD', '--', '.']))
            .split('\n')
            .filter(Boolean);
      const commits: GitCommit[] = [];
      let pastCursor = !request.cursor;
      for (const oid of oids) {
        if (!pastCursor) {
          if (oid === request.cursor) pastCursor = true;
          continue;
        }
        const raw = split(
          await run([
            'show',
            '-s',
            '--format=%H%x00%B%x00%an%x00%ae%x00%at%x00%P%x00',
            oid,
          ]),
        );
        const parents = (raw[5] ?? '').trim().split(' ').filter(Boolean);
        let actualPath = lineage?.get(oid);
        if (request.directoryPath && directoryIdentity) {
          const signature = async (version: string | null) => {
            if (!version) return '';
            const files = await versionFiles(version),
              base = directoryRoot(files, directoryIdentity!);
            return base
              ? files
                  .filter((f) => inDirectory(f.path, base))
                  .map((f) => f.path + '\0' + sha(f.content) + '\0' + f.mode)
                  .sort()
                  .join('\n')
              : '';
          };
          const current = await signature(oid);
          const old = await Promise.all(
            (parents.length ? parents : [null]).map(signature),
          );
          if (old.every((value) => value === current)) continue;
        }
        if (request.fileId || (request.path && !followsPath)) {
          const current = await tree(oid),
            relative = request.fileId
              ? await locate(current, request.fileId)
              : request.path;
          const currentEntry = relative ? current.get(relative) : undefined;
          actualPath = relative;
          let changed = false;
          for (const parent of parents.length ? parents : [null]) {
            const earlier = await tree(parent),
              oldPath = request.fileId
                ? await locate(earlier, request.fileId)
                : request.path;
            const earlierEntry = oldPath ? earlier.get(oldPath) : undefined;
            actualPath ??= oldPath;
            if (
              (currentEntry?.oid ?? null) !== (earlierEntry?.oid ?? null) ||
              relative !== oldPath ||
              currentEntry?.mode !== earlierEntry?.mode
            )
              changed = true;
          }
          if (!changed) continue;
        }
        commits.push({
          oid,
          message: raw[1]?.trim() ?? '',
          author: raw[2] ?? '',
          email: raw[3] ?? '',
          at: Number(raw[4]) * 1000,
          parents,
          path:
            request.directoryPath && directoryIdentity
              ? directoryRoot(await versionFiles(oid), directoryIdentity)
              : actualPath,
        });
        if (commits.length >= limit) break;
      }
      return { status: state, commits };
    }
    if (request.type === 'restore-plan') {
      const oid = await resolveOid(request.oid),
        historical = await versionFiles(oid);
      const scope = request.directoryPath
        ? 'directory'
        : request.fileId || request.path
          ? 'file'
          : 'workspace';
      if (
        scope === 'workspace' &&
        [...(await tree(oid)).keys()].some(isGitRuntimePath)
      )
        throw new Error(
          'This Git version contains application runtime files; restore individual content files instead',
        );
      if (scope === 'workspace' && state.changes.length)
        throw new Error('Commit or discard affected changes before restoring');
      const current = new Map<string, GitVersionFile>();
      for (const relative of [
        ...new Set(
          split(
            await run([
              'ls-files',
              '--cached',
              '--others',
              '--exclude-standard',
              '-z',
            ]),
          ),
        ),
      ]) {
        if (isGitRuntimePath(relative)) continue;
        await assertGitDiskPath(root, relative);
        const info = await fs
          .lstat(path.join(root, relative))
          .catch(() => null);
        if (info?.isFile())
          current.set(relative, {
            path: relative,
            content: new Uint8Array(
              await fs.readFile(path.join(root, relative)),
            ),
            mode: info.mode & 0o111 ? '100755' : '100644',
          });
      }
      const candidate = new Map(current),
        writes = new Map<string, GitVersionFile>(),
        deletions: string[] = [];
      const historicalIds = new Map(
        historical
          .map((file) => [nativeFileIdentity(file.content), file])
          .filter(([id]) => !!id) as [string, GitVersionFile][],
      );
      const currentIds = new Map(
        [...current.values()]
          .map((file) => [nativeFileIdentity(file.content), file.path])
          .filter(([id]) => !!id) as [string, string][],
      );
      const liveIds =
        scope !== 'workspace'
          ? await liveNativeIdentities(root)
          : new Set<string>();
      const references = (bytes: Uint8Array) => {
        const ids = new Set<string>();
        const visit = (value: unknown): void => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          for (const [key, item] of Object.entries(value)) {
            if (
              (key === 'targetFrameId' || key === 'targetDocumentId') &&
              typeof item === 'string'
            )
              ids.add(item);
            else visit(item);
          }
        };
        try {
          visit(JSON.parse(decode(bytes)));
        } catch {
          /* Plain and binary files do not contain native references. */
        }
        return ids;
      };
      const install = async (file: GitVersionFile, destination = file.path) => {
        assertGitContentPath(destination);
        await assertGitDiskPath(root, destination);
        if (!['100644', '100755'].includes(file.mode ?? '100644'))
          throw new Error(
            'Git restore does not support symlinks or submodules',
          );
        const output = { ...file, path: destination };
        candidate.set(destination, output);
        writes.set(destination, output);
        const id = nativeFileIdentity(file.content);
        if (id) currentIds.set(id, destination);
        for (const asset of gitAssetReferences(file.content)) {
          if (candidate.has(asset)) continue;
          const original = historical.find((entry) => entry.path === asset);
          if (!original)
            throw new Error(
              'Historical version is missing an attachment: ' + asset,
            );
          if (await exists(path.join(root, asset))) {
            await assertGitDiskPath(root, asset);
            const bytes = new Uint8Array(
              await fs.readFile(path.join(root, asset)),
            );
            if (sha(bytes) !== sha(original.content))
              throw new Error(
                'An existing attachment differs from its historical content: ' +
                  asset,
              );
            candidate.set(asset, { ...original, content: bytes });
            continue;
          }
          await install(original);
        }
        for (const id of references(file.content)) {
          if (currentIds.has(id) || liveIds.has(id)) continue; // Existing dependency bodies remain current, including ignored files.
          const dependency = historicalIds.get(id);
          if (!dependency)
            throw new Error(
              'Historical version is missing a referenced file: ' + id,
            );
          if (candidate.has(dependency.path))
            throw new Error(
              'A local file occupies a missing dependency path: ' +
                dependency.path,
            );
          await install(dependency);
        }
      };
      if (scope === 'directory') {
        const scoped = directoryRestore(
          historical,
          [
            ...new Map(
              [...current.values(), ...(await liveIdentityFiles(root))].map(
                (file) => [file.path, file],
              ),
            ).values(),
          ],
          await versionFiles(state.head),
          request.directoryPath!,
          request.folderId,
        );
        for (const relative of scoped.deletes) {
          deletions.push(relative);
          candidate.delete(relative);
          const id = nativeFileIdentity(
            current.get(relative)?.content ?? new Uint8Array(),
          );
          if (id) {
            currentIds.delete(id);
            liveIds.delete(id);
          }
        }
        for (const file of scoped.writes) {
          const id = nativeFileIdentity(file.content);
          if (id) currentIds.set(id, file.path);
        }
        for (const file of scoped.writes) await install(file);
      } else if (scope === 'file') {
        const lineage =
          !request.fileId && request.path && state.head
            ? await followedPaths(request.path)
            : undefined;
        const historicalPath = lineage?.get(oid) ?? request.path;
        const selected = request.fileId
          ? historicalIds.get(request.fileId)
          : historical.find((file) => file.path === historicalPath);
        if (!selected)
          throw new Error('The file does not exist in this version');
        const id = nativeFileIdentity(selected.content);
        const destination = id
          ? (currentIds.get(id) ?? selected.path)
          : request.path && current.has(request.path)
            ? request.path
            : selected.path;
        if (
          current.has(destination) &&
          id &&
          nativeFileIdentity(current.get(destination)!.content) !== id
        )
          throw new Error('A different file occupies the historical path');
        await install(selected, destination);
      } else {
        candidate.clear();
        for (const file of historical) {
          assertGitContentPath(file.path);
          candidate.set(file.path, file);
          writes.set(file.path, file);
        }
        for (const relative of current.keys())
          if (!candidate.has(relative)) deletions.push(relative);
      }
      const paths: GitOperationPlan['paths'] = [];
      const files: GitVersionFile[] = [];
      for (const [relative, file] of writes) {
        assertGitContentPath(relative);
        await assertGitDiskPath(root, relative);
        if (!['100644', '100755'].includes(file.mode ?? '100644'))
          throw new Error(
            'Git restore does not support symlinks or submodules',
          );
        const old = current.get(relative);
        if (
          old &&
          sha(old.content) === sha(file.content) &&
          old.mode === file.mode
        )
          continue;
        if (!old && (await exists(path.join(root, relative)))) {
          const info = await fs.lstat(path.join(root, relative));
          if (!info.isDirectory())
            throw new Error(
              'An untracked file occupies the restore target: ' + relative,
            );
          const walk = async (dir: string): Promise<string[]> => {
            const result: string[] = [];
            for (const entry of await fs.readdir(path.join(root, dir), {
              withFileTypes: true,
            })) {
              const nested = dir + '/' + entry.name;
              if (entry.isDirectory()) result.push(...(await walk(nested)));
              else result.push(nested);
            }
            return result;
          };
          if (
            (await walk(relative)).some((entry) => !deletions.includes(entry))
          )
            throw new Error(
              'Untracked content occupies the restore target: ' + relative,
            );
        }
        files.push(file);
        paths.push({ path: relative, action: 'write' });
      }
      for (const relative of deletions)
        paths.push({ path: relative, action: 'delete' });
      const affected = paths.map((item) => item.path);
      if (
        state.changes.some((change) => affected.includes(change.path)) ||
        (state.head &&
          affected.length &&
          split(
            await run([
              'diff',
              '--name-only',
              '--no-renames',
              '-z',
              state.head,
              '--',
              ...affected,
            ]),
          ).length)
      )
        throw new Error('Commit or discard affected changes before restoring');
      const config = candidate.get('.verdscrolls/config.json');
      if (config) {
        const parsed = JSON.parse(decode(config.content));
        if (typeof parsed?.value?.identity !== 'string')
          throw new Error('Historical workspace config is invalid');
      }
      if (deletions.includes('.verdscrolls/config.json'))
        throw new Error(
          'This revision predates the workspace configuration; restore individual files instead',
        );
      validateGitVersionFiles([...candidate.values()]);
      const before = Object.fromEntries(
        paths.map((item) => [
          item.path,
          current.has(item.path) ? sha(current.get(item.path)!.content) : null,
        ]),
      );
      const plan = register({
        plan: {
          id: randomUUID(),
          kind: 'restore',
          token: state.token,
          oid,
          scope,
          paths,
          warnings: [],
        },
        files,
        deletions,
        before,
      });
      return { status: state, plan };
    }
    if (request.type === 'restore') {
      const stored = planStore.get(request.planId);
      if (
        !stored ||
        stored.plan.kind !== 'restore' ||
        stored.plan.token !== state.token
      )
        throw new Error('Restore plan expired; preview it again');
      await withIndexLock(() =>
        publishGitRestore(
          root,
          stored.plan.id,
          stored.files!,
          stored.deletions!,
          undefined,
          stored.before,
        ),
      );
      planStore.delete(request.planId);
      options.notify?.(stored.plan.paths.map((item) => item.path));
      return { status: await status() };
    }
    if (request.type === 'sync') {
      requireReady(state, true);
      if (state.cleanup && state.cleanup.phase !== 'acknowledged')
        throw new Error(
          'Finish sensitive history cleanup before synchronizing',
        );
      if (!state.remote || !state.branch)
        throw new Error(
          'Configure a remote and use a local branch before synchronizing',
        );
      safeRemote(state.remote.url);
      const remote = state.remote.name,
        branch = state.remote.branch ?? state.branch;
      const canonical = await token(state.head, false);
      const workingBefore: Record<string, string | null> = {};
      for (const relative of split(await run(['ls-files', '--cached', '-z']))) {
        if (isGitRuntimePath(relative)) continue;
        const bytes = await fs
          .readFile(path.join(root, relative))
          .catch(() => null);
        workingBefore[relative] = bytes ? sha(bytes) : null;
      }
      checkToken(await status(), state.token);
      await run(['fetch', '--prune', remote]);
      const afterFetch = await status();
      if (
        afterFetch.head !== state.head ||
        afterFetch.changes.length ||
        (await token(afterFetch.head, false)) !== canonical
      )
        throw new Error(
          'Local Git state changed while fetching; review it before synchronizing',
        );
      const remoteRef = `refs/remotes/${remote}/${branch}`;
      const remoteOid = await text(['rev-parse', '--verify', remoteRef], true);
      if (remoteOid && state.head) {
        const counts = (
          await text([
            'rev-list',
            '--left-right',
            '--count',
            `HEAD...${remoteRef}`,
          ])
        )
          .split(/\s+/)
          .map(Number);
        if (counts[0] && counts[1])
          throw new Error(
            'Local and remote Git history diverged; reconcile it in an external Git client',
          );
        if (counts[1]) {
          if ([...(await tree(remoteOid)).keys()].some(isGitRuntimePath))
            throw new Error(
              'The remote version tracks application runtime files; resolve that repository externally',
            );
          const remoteFiles = await versionFiles(remoteOid);
          validateGitVersionFiles(remoteFiles);
          for (const file of remoteFiles) {
            assertGitContentPath(file.path);
            await assertGitDiskPath(root, file.path);
            if (!['100644', '100755'].includes(file.mode ?? '100644'))
              throw new Error(
                'Fast-forward does not support symlinks or submodules',
              );
          }
          const oldTree = await tree(state.head),
            targetPaths = new Set(remoteFiles.map((file) => file.path));
          if (
            oldTree.has('.verdscrolls/config.json') &&
            !targetPaths.has('.verdscrolls/config.json')
          )
            throw new Error(
              'The remote revision removes the workspace configuration',
            );
          const remoteConfig = remoteFiles.find(
            (file) => file.path === '.verdscrolls/config.json',
          );
          if (
            remoteConfig &&
            typeof JSON.parse(decode(remoteConfig.content))?.value?.identity !==
              'string'
          )
            throw new Error('The remote workspace configuration is invalid');
          for (const file of remoteFiles)
            if (
              !oldTree.has(file.path) &&
              (await exists(path.join(root, file.path)))
            )
              throw new Error(
                'A local file occupies the remote target: ' + file.path,
              );
          const deleted = [...oldTree.keys()].filter(
            (relative) =>
              !isGitRuntimePath(relative) && !targetPaths.has(relative),
          );
          const expected: Record<string, string | null> = {};
          for (const relative of [
            ...new Set([...remoteFiles.map((file) => file.path), ...deleted]),
          ])
            expected[relative] = workingBefore[relative] ?? null;
          await withIndexLock(async () => {
            if (
              (await token(state.head, false)) !== canonical ||
              (await text(['rev-parse', 'HEAD'])) !== state.head
            )
              throw new Error(
                'Local Git content changed before fast-forward publication',
              );
            await publishGitRestore(
              root,
              randomUUID(),
              remoteFiles,
              deleted,
              {
                old: state.head!,
                next: remoteOid,
                branch: 'refs/heads/' + state.branch,
              },
              expected,
            );
          });
        }
      } else if (remoteOid && !state.head) {
        throw new Error(
          'The remote already has history; open an existing clone to import it',
        );
      }
      validateGitVersionFiles(
        await versionFiles(await text(['rev-parse', 'HEAD'])),
      );
      if (
        [...(await tree(await text(['rev-parse', 'HEAD']))).keys()].some(
          isGitRuntimePath,
        )
      )
        throw new Error(
          'The current Git commit tracks application runtime files; remove them from version control before synchronization',
        );
      await run([
        'push',
        '--set-upstream',
        remote,
        `HEAD:refs/heads/${branch}`,
      ]);
      options.notify?.([]);
      return { status: await status() };
    }
    if (request.type === 'cleanup-confirm') {
      const record = await readJson<CleanupRecord>(cleanupPath);
      if (!record) throw new Error('No history cleanup is pending');
      if (record.updates?.length)
        throw new Error(
          'Update the pending remote refs before confirming platform cleanup',
        );
      record.state = {
        phase: 'acknowledged',
        pending: [],
        message:
          'The user confirmed platform cleanup. This client has not verified physical deletion from the platform or other clones.',
      };
      await writeJson(cleanupPath, record);
      return { status: await status(), cleanup: record.state };
    }
    if (request.type === 'cleanup-retry') return retryCleanup();
    if (request.type === 'purge-plan' || request.type === 'purge')
      return purge(request, state);
    throw new Error('Unsupported Git operation');
  };

  async function retryCleanup(): Promise<WorkspaceGitResult> {
    const record = await readJson<CleanupRecord>(cleanupPath);
    if (!record) throw new Error('No history cleanup is pending');
    for (const update of [...(record.updates ?? [])]) {
      try {
        const url = await text(['remote', 'get-url', update.remote]);
        safeRemote(url);
        if (url !== update.url)
          throw new Error(
            'Remote URL changed since cleanup was planned: ' + update.remote,
          );
        const actual =
          (
            await text(['ls-remote', '--refs', update.remote, update.ref])
          ).split(/\s+/)[0] || undefined;
        if (actual !== update.next) {
          if (actual !== update.old)
            throw new Error(
              'Remote ref changed after cleanup was planned: ' +
                update.remote +
                ':' +
                update.ref,
            );
          await run([
            'push',
            `--force-with-lease=${update.ref}:${update.old}`,
            update.remote,
            `${update.next ?? ''}:${update.ref}`,
          ]);
        }
        record.updates = record.updates!.filter(
          (entry) => entry.remote !== update.remote || entry.ref !== update.ref,
        );
        await writeJson(cleanupPath, record);
      } catch (error) {
        record.state = {
          phase: 'local-cleared',
          message:
            'Local sensitive history was removed. Remote ref updates are incomplete: ' +
            String(error),
          pending: record.updates!.map(
            (entry) => entry.remote + ':' + entry.ref,
          ),
        };
        await writeJson(cleanupPath, record);
        return { status: await status(), cleanup: record.state };
      }
    }
    record.state = {
      phase: 'platform-pending',
      message:
        'Advertised remote refs were updated. Ask every hosting platform to remove retained objects, pull-request refs and caches; other clones require separate cleanup.',
      pending: [
        'Hosting platform retained objects and caches',
        'Other clones and backups',
      ],
    };
    await writeJson(cleanupPath, record);
    return { status: await status(), cleanup: record.state };
  }

  async function purge(
    request: Extract<WorkspaceGitRequest, { type: 'purge-plan' | 'purge' }>,
    state: WorkspaceGitStatus,
  ): Promise<WorkspaceGitResult> {
    const { planGitPurge, rewriteGitPurge } =
      await import('@sue/verd-board-workspace');
    if (request.type === 'purge-plan') {
      requireReady(state);
      if (state.cleanup && state.cleanup.phase !== 'acknowledged')
        throw new Error(
          'Finish pending history cleanup before starting another purge',
        );
      if (
        !state.branch ||
        !(await fs.lstat(rootGitdir)).isDirectory() ||
        (await text(['worktree', 'list', '--porcelain']))
          .split('\n')
          .filter((line) => line.startsWith('worktree ')).length > 1
      )
        throw new Error(
          'History cleanup requires one attached ordinary root repository without linked worktrees',
        );
      for (const extension of [
        'lfs',
        'modules',
        'commondir',
        'config.worktree',
        'info/sparse-checkout',
        'refs/replace',
      ])
        if (await exists(path.join(rootGitdir, extension)))
          throw new Error('History cleanup does not support ' + extension);
      for (const option of ['extensions.refStorage', 'core.sharedRepository'])
        if (await text(['config', '--get', option], true))
          throw new Error('History cleanup does not support ' + option);
      if ((await text(['rev-parse', '--show-object-format'])) !== 'sha1')
        throw new Error('History cleanup currently requires SHA-1 Git objects');
      for (const area of ['hooks', 'info/exclude', 'info/attributes'])
        await walkFiles(root, '.git/' + area);
      const derived = await trashTargets(root, request.trashEntryIds ?? []);
      const fileIds = [...new Set([...request.fileIds, ...derived.fileIds])];
      const explicitPaths = [
        ...new Set([...(request.paths ?? []), ...derived.paths]),
      ];
      if (!fileIds.length && !explicitPaths.length)
        throw new Error('No files were selected for history cleanup');
      const namespace = 'refs/remotes/verd-cleanup-' + randomUUID();
      const remotes: RemoteRef[] = [];
      for (const remote of (await text(['remote']))
        .split('\n')
        .filter(Boolean)) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(remote))
          throw new Error('Unsupported remote name');
        const url = await text(['remote', 'get-url', remote]);
        safeRemote(url);
        const advertised = (await text(['ls-remote', '--refs', remote]))
          .split('\n')
          .filter(Boolean)
          .map((row) => row.split(/\s+/));
        if (
          advertised.some(([, ref]) => !/^refs\/(heads|tags)\//.test(ref ?? ''))
        )
          throw new Error(
            'Remote exposes references that require external history cleanup: ' +
              remote,
          );
        await run([
          'fetch',
          '--no-tags',
          remote,
          `+refs/heads/*:${namespace}/${remote}/heads/*`,
          `+refs/tags/*:${namespace}/${remote}/tags/*`,
        ]);
        for (const [old, ref] of advertised) {
          if (!old || !ref) continue;
          const tracking = `${namespace}/${remote}/${ref.slice(5)}`;
          if ((await text(['rev-parse', '--verify', tracking])) !== old)
            throw new Error('Remote refs changed while preparing cleanup');
          remotes.push({ remote, url, ref, old, tracking });
        }
      }
      state = await status();
      requireReady(state);
      const analysis = await planGitPurge({
        fs: { promises: fs },
        dir: root,
        fileIds,
        paths: explicitPaths,
        plainSeeds: derived.seeds,
        preserveHooks: true,
      });
      if (analysis.blocked.length) throw new Error(analysis.blocked.join('; '));
      const local = await localCleanup(
        root,
        fileIds,
        explicitPaths,
        analysis.exclusiveAssets,
        analysis.survivingAssets,
        request.trashEntryIds ?? [],
        analysis.removedBlobOids,
      );
      const protectedAssets = analysis.exclusiveAssets.filter(
        (asset) => !local.assets.includes(asset),
      );
      analysis.exclusiveAssets = analysis.exclusiveAssets.filter((asset) =>
        local.assets.includes(asset),
      );
      analysis.paths = analysis.paths.filter(
        (relative) => !protectedAssets.includes(relative),
      );
      if (protectedAssets.length) {
        const preserved = new Set<string>();
        for (const oid of (await text(['rev-list', '--all']))
          .split('\n')
          .filter(Boolean)) {
          const entries = await tree(oid);
          for (const asset of protectedAssets)
            if (entries.has(asset)) preserved.add(entries.get(asset)!.oid);
        }
        analysis.removedBlobOids = analysis.removedBlobOids.filter(
          (oid) => !preserved.has(oid),
        );
      }
      const headPlain = state.head
        ? (analysis.plainVersions[state.head] ?? [])
        : [];
      for (const seed of derived.seeds)
        if (
          headPlain.includes(seed.path) &&
          (await exists(path.join(root, seed.path)))
        )
          throw new Error(
            'An ordinary file reappeared at the trashed path; its ownership is ambiguous: ' +
              seed.path,
          );
      const headFiles = await tree(state.head);
      for (const change of state.changes) {
        if (local.assets.includes(change.path)) continue;
        const bytes = await fs
          .readFile(path.join(root, change.path))
          .catch(() => null);
        const currentId = bytes ? nativeFileIdentity(bytes) : undefined;
        const previous = headFiles.get(change.path),
          previousId = previous
            ? nativeFileIdentity((await blob(previous)).content)
            : undefined;
        const plainTarget =
          (request.paths ?? []).includes(change.path) ||
          (headPlain.includes(change.path) &&
            (!bytes || analysis.removedBlobOids.includes(blobOid(bytes))));
        const managedTarget =
          bytes &&
          local.live.some(
            (file) => file.path === change.path && file.before === sha(bytes),
          );
        const targeted =
          managedTarget ||
          (currentId
            ? fileIds.includes(currentId)
            : bytes
              ? plainTarget
              : previousId
                ? fileIds.includes(previousId)
                : plainTarget);
        if (!targeted)
          throw new Error(
            'Commit or discard unrelated changes before cleanup: ' +
              change.path,
          );
        if (change.staged) {
          const staged = await run(['show', ':' + change.path], {
            allowFailure: true,
          });
          const stagedId = nativeFileIdentity(staged);
          if (stagedId && !fileIds.includes(stagedId))
            throw new Error(
              'Unrelated staged content occupies a cleanup path: ' +
                change.path,
            );
          if (
            appPublishTempBase(change.path) &&
            !stagedId &&
            staged.length &&
            !analysis.removedBlobOids.includes(blobOid(staged))
          )
            throw new Error(
              'Unrelated staged content occupies an application publication copy: ' +
                change.path,
            );
        }
      }
      const plan = register({
        plan: {
          id: randomUUID(),
          kind: 'purge',
          token: state.token,
          scope: 'workspace',
          fileIds,
          paths: [
            ...new Set([
              ...analysis.paths,
              ...local.files,
              ...local.live.map((file) => file.path),
              ...local.assets,
            ]),
          ].map((relative) => ({ path: relative, action: 'delete' as const })),
          refs: Object.keys(analysis.refs).filter(
            (ref) => !ref.startsWith(namespace + '/'),
          ),
          warnings: [
            ...analysis.warnings,
            'This rewrites Git history and removes local unreachable objects. Signatures on rewritten commits or tags become invalid and are removed. Only refs already present on each remote are updated; platform retained objects and other clones require separate cleanup.',
          ],
        },
        analysis,
        fileIds,
        trashEntryIds: request.trashEntryIds,
        directPaths: request.paths,
        remotes,
        local,
        namespace,
      });
      return { status: state, plan };
    }
    requireReady(state);
    const stored = planStore.get(request.planId);
    if (
      !stored ||
      stored.plan.kind !== 'purge' ||
      stored.plan.token !== state.token
    )
      throw new Error('Cleanup plan expired; review it again');
    const analysis = stored.analysis as Awaited<
      ReturnType<typeof planGitPurge>
    >;
    const fresh = await localCleanup(
      root,
      analysis.fileIds,
      analysis.explicitPaths,
      analysis.exclusiveAssets,
      analysis.survivingAssets,
      stored.trashEntryIds ?? [],
      analysis.removedBlobOids,
    );
    if (fresh.fingerprint !== stored.local!.fingerprint)
      throw new Error('Local history or trash changed; review cleanup again');
    await withIndexLock(async () => {
      const rewritten = await rewriteGitPurge({
        fs: { promises: fs },
        dir: root,
        analysis,
      });
      const stage = path.join(root, '.verdscrolls/git-purge-' + stored.plan.id),
        newDir = path.join(stage, 'new.git');
      await fs.mkdir(stage);
      try {
        await fs.mkdir(newDir);
        for (const [relative, bytes] of rewritten.files) {
          if (
            !relative ||
            relative.startsWith('/') ||
            relative.split('/').some((part: string) => part === '..')
          )
            throw new Error('Invalid rewritten Git path');
          if (stored.namespace && relative.startsWith(stored.namespace + '/'))
            continue;
          await fs.mkdir(path.dirname(path.join(newDir, relative)), {
            recursive: true,
          });
          await fs.writeFile(path.join(newDir, relative), bytes);
        }
        for (const area of ['hooks', 'info/exclude', 'info/attributes'])
          for (const file of await walkFiles(root, '.git/' + area)) {
            const relative = file.path.slice('.git/'.length),
              target = path.join(newDir, relative);
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, file.bytes);
            await fs.chmod(
              target,
              (await fs.stat(path.join(root, file.path))).mode & 0o777,
            );
          }
        await run(
          state.head ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'],
          { env: { GIT_DIR: newDir } },
        );
        validateGitVersionFiles(
          await versionFiles(state.head ? 'HEAD' : null, newDir),
        );
        const retained = await run(
          ['cat-file', '--batch-check=%(objectname) %(objecttype)'],
          {
            env: { GIT_DIR: newDir },
            input: analysis.removedBlobOids.join('\n') + '\n',
          },
        );
        if (
          decode(retained)
            .split('\n')
            .some((row) => /^[a-f0-9]+ (blob|tree|commit|tag)$/.test(row))
        )
          throw new Error(
            'Sensitive Git objects remain reachable through unselected content; review the cleanup scope',
          );
        const updates = (stored.remotes ?? [])
          .filter((entry) => rewritten.refs[entry.tracking] !== entry.old)
          .map((entry) => ({
            remote: entry.remote,
            url: entry.url,
            ref: entry.ref,
            old: entry.old,
            next: rewritten.refs[entry.tracking],
          }));
        const worktree: { path: string; before: string }[] = [];
        for (const relative of [
          ...new Set([
            ...analysis.paths,
            ...state.changes.map((change) => change.path),
          ]),
        ]) {
          if (isGitRuntimePath(relative)) continue;
          assertGitContentPath(relative);
          await assertGitDiskPath(root, relative);
          const bytes = await fs
            .readFile(path.join(root, relative))
            .catch(() => null);
          if (!bytes) continue;
          const id = nativeFileIdentity(bytes);
          const plainTarget =
            stored.directPaths?.includes(relative) ||
            ((state.head
              ? analysis.plainVersions[state.head]?.includes(relative)
              : false) &&
              analysis.removedBlobOids.includes(blobOid(bytes)));
          if (
            id
              ? analysis.fileIds.includes(id)
              : plainTarget || fresh.assets.includes(relative)
          )
            worktree.push({ path: relative, before: sha(bytes) });
        }
        for (const file of fresh.live)
          if (!worktree.some((entry) => entry.path === file.path))
            worktree.push(file);
        const assets = [] as { path: string; before: string }[];
        for (const relative of fresh.assets) {
          assertGitContentPath(relative);
          await assertGitDiskPath(root, relative);
          const bytes = await fs
            .readFile(path.join(root, relative))
            .catch(() => null);
          if (bytes) assets.push({ path: relative, before: sha(bytes) });
        }
        const record: CleanupRecord = {
          state: {
            phase: 'local-cleared',
            message: 'Sensitive history cleanup is in progress',
            pending: updates.map((entry) => entry.remote + ':' + entry.ref),
          },
          updates,
        };
        const actualRefs = await text([
          'for-each-ref',
          '--format=%(refname) %(objectname)',
        ]);
        const expectedRefs = Object.entries(analysis.refs)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ref, oid]) => ref + ' ' + oid)
          .join('\n');
        if (
          actualRefs.split('\n').sort().join('\n') !==
          expectedRefs.split('\n').sort().join('\n')
        )
          throw new Error('Git references changed during history rewrite');
        await withNativeLocks(
          root,
          ['HEAD', 'packed-refs', ...Object.keys(analysis.refs)],
          async () => {
            checkToken(await status(), state.token);
            if (
              (
                await text([
                  'for-each-ref',
                  '--format=%(refname) %(objectname)',
                ])
              )
                .split('\n')
                .sort()
                .join('\n') !== expectedRefs.split('\n').sort().join('\n')
            )
              throw new Error('Git references changed before publication');
            await writeJson(path.join(root, '.verdscrolls/git-purge.json'), {
              stage,
              worktree,
              assets,
              local: fresh,
              cleanup: record,
              beforeRefs: analysis.refs,
              phase: 'prepared',
            });
            await recoverGitPurge(root, true);
          },
        );
      } catch (error) {
        if (!(await exists(path.join(root, '.verdscrolls/git-purge.json'))))
          await fs.rm(stage, { recursive: true, force: true });
        throw error;
      }
    });
    options.notify?.(stored.plan.paths.map((entry) => entry.path));
    planStore.delete(request.planId);
    if (stored.remotes?.length) return retryCleanup();
    const record: CleanupRecord = {
      state: {
        phase: 'acknowledged',
        message:
          'Local Git history was cleaned. No remote refs were present; other clones or backups are not inspected.',
        pending: [],
      },
    };
    await writeJson(cleanupPath, record);
    return { status: await status(), cleanup: record.state };
  }
}

/** Finishes only an explicit, journaled history rewrite; never creates a new commit. */
export async function recoverGitPurge(
  root: string,
  lockOwned = false,
): Promise<void> {
  const marker = path.join(root, '.verdscrolls/git-purge.json');
  const record = await readJson<{
    stage: string;
    worktree: { path: string; before: string }[];
    assets: { path: string; before: string }[];
    local: LocalCleanup;
    cleanup: CleanupRecord;
    beforeRefs: Record<string, string>;
  }>(marker);
  if (!record) {
    const metadata = path.join(root, '.verdscrolls');
    for (const name of await fs.readdir(metadata).catch(() => [] as string[])) {
      if (!/^git-purge-[a-f0-9-]{36}$/.test(name)) continue;
      const target = path.join(metadata, name),
        info = await fs.lstat(target);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error('Invalid abandoned Git rewrite staging directory');
      await fs.rm(target, { recursive: true, force: true });
    }
    return;
  }
  if (!lockOwned && (await exists(path.join(root, '.git'))))
    return withNativeLocks(root, ['index', 'HEAD', 'packed-refs'], () =>
      recoverGitPurge(root, true),
    );
  if (
    path.dirname(record.stage) !== path.join(root, '.verdscrolls') ||
    !path.basename(record.stage).startsWith('git-purge-')
  )
    throw new Error('Invalid Git purge journal');
  const gitdir = path.join(root, '.git'),
    old = path.join(record.stage, 'old.git'),
    next = path.join(record.stage, 'new.git');
  if (await exists(next)) {
    if (await exists(gitdir)) {
      if (await exists(old))
        throw new Error('Git purge directory recovery conflict');
      const settings = await readJson<Settings>(
        path.join(root, '.verdscrolls/git-settings.json'),
      );
      const refs = decode(
        await execute(settings?.executable || 'git', root, [
          'for-each-ref',
          '--format=%(refname) %(objectname)',
        ]),
      ).trim();
      if (
        refs.split('\n').sort().join('\n') !==
        Object.entries(record.beforeRefs)
          .map(([ref, oid]) => ref + ' ' + oid)
          .sort()
          .join('\n')
      )
        throw new Error('Git references changed before cleanup recovery');
      await fs.rename(gitdir, old);
    }
    await fs.rename(next, gitdir);
  }
  if (!(await exists(gitdir)))
    throw new Error('Rewritten Git repository is missing');
  await writeJson(
    path.join(root, '.verdscrolls/git-cleanup.json'),
    record.cleanup,
  );
  const remove = async (relative: string, before: string, internal = false) => {
    if (internal) {
      if (
        !/^(?:\.verdscrolls\/(?:resources\/history|trash)|\.verd-resources\/history)\//.test(
          relative,
        ) ||
        relative.split('/').some((part) => part === '..' || !part)
      )
        throw new Error('Invalid local cleanup path');
      let parent = root;
      for (const part of relative.split('/')) {
        parent = path.join(parent, part);
        if ((await fs.lstat(parent).catch(() => null))?.isSymbolicLink())
          throw new Error('History cleanup cannot follow a symlink');
      }
    } else {
      assertGitContentPath(relative);
      await assertGitDiskPath(root, relative);
    }
    const bytes = await fs
      .readFile(path.join(root, relative))
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (!bytes) return;
    if (sha(bytes) !== before)
      throw new Error('Content changed during cleanup recovery: ' + relative);
    await fs.unlink(path.join(root, relative));
  };
  for (const file of [...record.worktree, ...record.assets])
    await remove(file.path, file.before);
  for (const relative of record.local.files)
    await remove(relative, record.local.versions[relative]!, true);
  for (const manifest of record.local.manifests) {
    if (
      !/^(?:\.verdscrolls\/resources|\.verd-resources)\/history\/index\.json$/.test(
        manifest.path,
      )
    )
      throw new Error('Invalid history index path');
    const current = await fs.readFile(path.join(root, manifest.path)),
      after = Buffer.from(JSON.stringify(manifest.value));
    if (sha(current) !== manifest.before && sha(current) !== sha(after))
      throw new Error('History index changed during cleanup recovery');
    if (sha(current) !== sha(after))
      await writeJson(path.join(root, manifest.path), manifest.value);
  }
  const removeEmpty = async (relative: string) => {
    for (const child of await fs
      .readdir(path.join(root, relative), { withFileTypes: true })
      .catch(() => []))
      if (child.isDirectory()) await removeEmpty(relative + '/' + child.name);
    await fs.rmdir(path.join(root, relative)).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  };
  for (const relative of record.local.directories) {
    if (!/^\.verdscrolls\/trash\/[a-zA-Z0-9_-]+$/.test(relative))
      throw new Error('Invalid trash cleanup directory');
    await removeEmpty(relative);
  }
  await fs.rm(old, { recursive: true, force: true });
  await fs.rm(record.stage, { recursive: true, force: true });
  await fs.unlink(marker);
}
