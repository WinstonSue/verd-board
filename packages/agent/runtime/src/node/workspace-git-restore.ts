import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  assertGitContentPath,
  type GitVersionFile,
} from '@sue/verd-board-workspace';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const area = (root: string) => path.join(root, '.verdscrolls/git-restore');
const journalPath = (root: string) => path.join(area(root), 'journal.json');
const uuidPattern =
  '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const publishTempPattern = new RegExp(
  `^(.+)(?:\\.verd-${uuidPattern}|\\.[1-9][0-9]*\\.${uuidPattern})\\.tmp$`,
);

/** Exact filenames emitted by the two application publishers, rather than arbitrary user .tmp files. */
export const appPublishTempBase = (relative: string): string | undefined =>
  publishTempPattern.exec(relative)?.[1];

export async function cleanPublishedTemps(root: string, relative: string) {
  if (
    !relative ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Invalid publication cleanup path');
  let parent = root;
  for (const part of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    const info = await stat(parent);
    if (!info) return;
    if (info.isSymbolicLink())
      throw new Error('Publication cleanup cannot follow a linked directory');
    if (!info.isDirectory()) return;
  }
  const basename = path.posix.basename(relative);
  for (const child of await fs.readdir(parent, { withFileTypes: true }))
    if (child.isFile() && appPublishTempBase(child.name) === basename)
      await fs.unlink(path.join(parent, child.name));
}
interface Operation {
  path: string;
  before: string | null;
  after: string | null;
  mode?: string;
  staged?: string;
}
interface GitUpdate {
  old: string;
  next: string;
  branch: string;
  staged: string;
  beforeIndex: string;
  afterIndex: string;
}
interface Journal {
  id: string;
  phase: 'prepared' | 'applying';
  operations: Operation[];
  gitUpdate?: GitUpdate;
}
const execute = promisify(execFile);
async function runGit(root: string, args: string[], index?: string) {
  const settings = await fs
    .readFile(path.join(root, '.verdscrolls/git-settings.json'), 'utf8')
    .then(
      (raw) => JSON.parse(raw) as { executable?: string },
      () => ({}) as { executable?: string },
    );
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
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
  return execute(
    settings.executable || 'git',
    ['--no-optional-locks', '--literal-pathspecs', '-C', root, ...args],
    {
      env: { ...environment, ...(index ? { GIT_INDEX_FILE: index } : {}) },
      timeout: 30_000,
    },
  );
}
const stat = (target: string) =>
  fs.lstat(target).catch((e) => {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  });
async function assertRestoreArea(root: string) {
  for (const relative of ['.verdscrolls', '.verdscrolls/git-restore']) {
    const info = await stat(path.join(root, relative));
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new Error('Git restore metadata must be a real directory');
  }
}
export async function assertGitDiskPath(root: string, relative: string) {
  assertGitContentPath(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await stat(current))?.isSymbolicLink())
      throw new Error('Git restore cannot follow a symlink: ' + relative);
  }
}
async function fileDigest(root: string, relative: string) {
  const target = path.join(root, relative),
    info = await stat(target);
  if (!info || info.isDirectory()) return null;
  if (!info.isFile()) throw new Error('Unsupported file type: ' + relative);
  return digest(await fs.readFile(target));
}
async function publish(target: string, bytes: Uint8Array, mode?: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = target + '.verd-' + randomUUID() + '.tmp';
  let created = false;
  try {
    const handle = await fs.open(temp, 'wx');
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode) await fs.chmod(temp, mode === '100755' ? 0o755 : 0o644);
    await fs.rename(temp, target);
  } finally {
    if (created) await fs.rm(temp, { force: true });
  }
}
async function writeJournal(root: string, journal: Journal) {
  await publish(journalPath(root), Buffer.from(JSON.stringify(journal)));
}
async function apply(root: string, journal: Journal) {
  // Tracked file removals come first; never recursively remove a content directory.
  for (const op of journal.operations) {
    await assertGitDiskPath(root, op.path);
    const target = path.join(root, op.path),
      current = await fileDigest(root, op.path);
    if (
      current === op.after &&
      (op.after === null || (await stat(target))?.isFile())
    ) {
      if (op.after !== null && op.mode)
        await fs.chmod(target, op.mode === '100755' ? 0o755 : 0o644);
      continue;
    }
    if (current !== op.before)
      throw new Error('Git restore recovery found changed content: ' + op.path);
    if (op.after === null) {
      if ((await stat(target))?.isFile()) await fs.unlink(target);
      let parent = path.dirname(target);
      while (parent !== root && parent.startsWith(root + path.sep)) {
        try {
          await fs.rmdir(parent);
        } catch {
          break;
        }
        parent = path.dirname(parent);
      }
    } else {
      const existing = await stat(target);
      if (existing?.isDirectory()) await fs.rmdir(target); // Fails safely when untracked children remain.
      const bytes = await fs.readFile(path.join(area(root), op.staged!));
      if (digest(bytes) !== op.after)
        throw new Error('Corrupt staged Git restore content');
      await publish(target, bytes, op.mode);
    }
  }
  if (journal.gitUpdate) {
    const update = journal.gitUpdate;
    const branch = (await runGit(root, ['symbolic-ref', 'HEAD'])).stdout.trim();
    const head = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    if (
      branch !== update.branch ||
      (head !== update.old && head !== update.next)
    )
      throw new Error('Git branch changed during fast-forward recovery');
    const indexPath = path.join(root, '.git/index');
    const currentIndex = digest(
      await fs.readFile(indexPath).catch(() => Buffer.alloc(0)),
    );
    if (
      currentIndex !== update.beforeIndex &&
      currentIndex !== update.afterIndex
    )
      throw new Error('Git index changed during fast-forward recovery');
    const bytes = await fs.readFile(path.join(area(root), update.staged));
    if (digest(bytes) !== update.afterIndex)
      throw new Error('Corrupt fast-forward index');
    if (head !== update.next)
      await runGit(root, [
        'update-ref',
        update.branch,
        update.next,
        update.old,
      ]);
    if (currentIndex !== update.afterIndex) await publish(indexPath, bytes);
  }
  for (const op of journal.operations) await cleanPublishedTemps(root, op.path);
  if (journal.gitUpdate) await cleanPublishedTemps(root, '.git/index');
  await publish(
    path.join(area(root), 'receipt.json'),
    Buffer.from(JSON.stringify({ id: journal.id })),
  );
  await fs.unlink(journalPath(root));
  for (const op of journal.operations)
    if (op.staged)
      await fs.rm(path.join(area(root), op.staged), { force: true });
  if (journal.gitUpdate)
    await fs.rm(path.join(area(root), journal.gitUpdate.staged), {
      force: true,
    });
}

/** Called at workspace open, before normal content is loaded. This only resumes an explicit restore. */
export async function recoverGitRestore(root: string, lockOwned = false) {
  await assertRestoreArea(root);
  const raw = await fs.readFile(journalPath(root), 'utf8').catch((e) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (!raw) {
    for (const name of await fs.readdir(area(root)).catch(() => [] as string[]))
      if (/^[a-zA-Z0-9-]+-(?:[0-9]+|index)\.bin(?:\.lock)?$/.test(name))
        await fs.rm(path.join(area(root), name), { force: true });
    return;
  }
  const journal = JSON.parse(raw) as Journal;
  if (
    !/^[a-zA-Z0-9-]+$/.test(journal.id) ||
    !['prepared', 'applying'].includes(journal.phase) ||
    !Array.isArray(journal.operations)
  )
    throw new Error('Invalid Git restore journal');
  for (const op of journal.operations) {
    assertGitContentPath(op.path);
    if (op.staged && !/^[a-zA-Z0-9-]+\.bin$/.test(op.staged))
      throw new Error('Invalid staged Git restore path');
  }
  if (
    journal.gitUpdate &&
    (!journal.gitUpdate.branch.startsWith('refs/heads/') ||
      /[\0\r\n\\]/.test(journal.gitUpdate.branch) ||
      journal.gitUpdate.branch
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(journal.gitUpdate.old) ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(journal.gitUpdate.next) ||
      !/^[a-zA-Z0-9-]+\.bin$/.test(journal.gitUpdate.staged))
  )
    throw new Error('Invalid fast-forward journal');
  if (journal.phase === 'prepared') {
    await fs.unlink(journalPath(root));
    for (const op of journal.operations)
      if (op.staged)
        await fs.rm(path.join(area(root), op.staged), { force: true });
    if (journal.gitUpdate)
      await fs.rm(path.join(area(root), journal.gitUpdate.staged), {
        force: true,
      });
    return;
  }
  if (lockOwned) await apply(root, journal);
  else {
    const lockPath = path.join(root, '.git/index.lock');
    const lock = await fs.open(lockPath, 'wx');
    await lock.writeFile(
      JSON.stringify({ format: 'verd-git-lock', pid: process.pid }),
    );
    try {
      await apply(root, journal);
    } finally {
      await lock.close();
      await fs.rm(lockPath, { force: true });
    }
  }
}

/** The caller owns the workspace lock and native index.lock. HEAD and index are untouched. */
export async function publishGitRestore(
  root: string,
  id: string,
  files: GitVersionFile[],
  deletions: string[],
  gitUpdate?: { old: string; next: string; branch: string },
  expected?: Record<string, string | null>,
) {
  if (!/^[a-zA-Z0-9-]+$/.test(id))
    throw new Error('Invalid restore transaction identity');
  await assertRestoreArea(root);
  await recoverGitRestore(root, true);
  await fs.mkdir(area(root), { recursive: true });
  try {
    const operations: Operation[] = [];
    const before = async (relative: string) => {
      const actual = await fileDigest(root, relative);
      if (expected && relative in expected && actual !== expected[relative])
        throw new Error('Content changed before Git publication: ' + relative);
      return expected && relative in expected ? expected[relative]! : actual;
    };
    for (const relative of [...deletions].sort((a, b) => b.length - a.length)) {
      await assertGitDiskPath(root, relative);
      operations.push({
        path: relative,
        before: await before(relative),
        after: null,
      });
    }
    for (const [index, file] of files.entries()) {
      await assertGitDiskPath(root, file.path);
      if (file.mode && !['100644', '100755'].includes(file.mode))
        throw new Error('Unsupported Git file mode: ' + file.path);
      const staged = `${id}-${index}.bin`;
      const handle = await fs.open(path.join(area(root), staged), 'wx');
      try {
        await handle.writeFile(file.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      operations.push({
        path: file.path,
        before: deletions.includes(file.path) ? null : await before(file.path),
        after: digest(file.content),
        mode: file.mode,
        staged,
      });
    }
    const journal: Journal = { id, phase: 'prepared', operations };
    if (gitUpdate) {
      const staged = `${id}-index.bin`,
        target = path.join(area(root), staged);
      await runGit(root, ['read-tree', gitUpdate.next], target);
      journal.gitUpdate = {
        ...gitUpdate,
        staged,
        beforeIndex: digest(
          await fs
            .readFile(path.join(root, '.git/index'))
            .catch(() => Buffer.alloc(0)),
        ),
        afterIndex: digest(await fs.readFile(target)),
      };
    }
    await writeJournal(root, journal);
    journal.phase = 'applying';
    await writeJournal(root, journal);
    await apply(root, journal);
  } catch (error) {
    if (!(await fs.stat(journalPath(root)).catch(() => null))) {
      for (const name of await fs
        .readdir(area(root))
        .catch(() => [] as string[]))
        if (name.startsWith(id + '-') && /\.bin(?:\.lock)?$/.test(name))
          await fs.rm(path.join(area(root), name), { force: true });
    }
    throw error;
  }
}
