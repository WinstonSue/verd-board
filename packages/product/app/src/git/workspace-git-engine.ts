import {
  directoryCreation,
  directoryRestore,
  directoryRoot,
  directoryId,
  inDirectory,
  expandCreation,
} from './directory-versions';
import './buffer-shim';
import * as git from 'isomorphic-git';
import {
  assertGitContentPath,
  isGitRuntimePath,
  type GitCommit,
  type GitOperationPlan,
  type GitVersionFile,
  type WorkspaceGitRequest,
  type WorkspaceGitResult,
  type WorkspaceGitStatus,
} from '../host/workspace-git';
import { validateGitVersionFiles } from '../session/workspace-git-validation';
import { isWorkspaceFile } from '../documents/document-files';
import { workspaceReferences } from '../documents/workspace-references';
import { GitMemoryFs } from './memory-fs';
import {
  allGitCommits,
  filterHistoryManifest,
  planGitPurge,
  rewriteGitPurge,
  type GitPurgeAnalysis,
} from './purge';
import { traceGitPaths } from './path-history';
import {
  decodeGitText,
  gitAssetReferences,
  nativeFileIdentity,
  readGitTree,
  writeGitTree,
} from './tree';

export interface GitWorkspaceData {
  files: Map<string, Uint8Array>;
  directories?: Set<string>;
  trash: Map<string, { files: Map<string, Uint8Array> }>;
  /** Host-private compare-and-swap snapshot. Never persisted by this engine. */
  source?: unknown;
}
export interface GitWorkspaceStorage {
  load(): Promise<GitWorkspaceData>;
  /** Publish files and trash in one transaction, rejecting any stale source. */
  publish(before: GitWorkspaceData, after: GitWorkspaceData): Promise<void>;
  now?: () => number;
}
const ROOT = '/workspace';
const text = (value: Uint8Array | undefined) =>
  value ? decodeGitText(value) : '';
const contentFiles = (files: Map<string, Uint8Array>): GitVersionFile[] =>
  [...files]
    .filter(([path]) => !isGitRuntimePath(path))
    .map(([path, content]) => ({ path, content }));
const cloneData = (data: GitWorkspaceData): GitWorkspaceData => ({
  files: new Map(data.files),
  directories: data.directories && new Set(data.directories),
  trash: new Map(
    [...data.trash].map(([id, entry]) => [id, { files: new Map(entry.files) }]),
  ),
  source: data.source,
});

/** Runtime navigation and idle recovery checkpoints do not invalidate Git actions. */
export async function gitWorkspaceToken(
  files: Map<string, Uint8Array>,
): Promise<string> {
  const rows: string[] = [];
  for (const [path, bytes] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (isGitRuntimePath(path) && !path.startsWith('.git/')) continue;
    rows.push(`${path}\0${(await git.hashBlob({ object: bytes })).oid}`);
  }
  return (await git.hashBlob({ object: rows.join('\n') })).oid;
}

interface SavedPlan {
  plan: GitOperationPlan;
  createPaths?: string[];
  message?: string;
  writes?: GitVersionFile[];
  deletes?: string[];
  analysis?: GitPurgeAnalysis;
  fileIds?: string[];
  explicitPaths?: string[];
  trashEntryIds?: string[];
  snapshotToken?: string;
  localDeletePaths?: string[];
}

async function recoveryToken(data: GitWorkspaceData) {
  const rows: string[] = [];
  for (const [path, bytes] of [...data.files].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    rows.push(`${path}\0${(await git.hashBlob({ object: bytes })).oid}`);
  for (const [id, entry] of [...data.trash].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    for (const [path, bytes] of [...entry.files].sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      rows.push(
        `trash:${id}:${path}\0${(await git.hashBlob({ object: bytes })).oid}`,
      );
  return (await git.hashBlob({ object: rows.join('\n') })).oid;
}

export function createWorkspaceGitEngine(storage: GitWorkspaceStorage) {
  const plans = new Map<string, SavedPlan>();
  let lane: Promise<unknown> = Promise.resolve();
  const now = storage.now ?? Date.now;
  const operate = async (
    request: WorkspaceGitRequest,
  ): Promise<WorkspaceGitResult> => {
    const before = await storage.load(),
      next = cloneData(before);
    const fs = new GitMemoryFs(
      [...next.files].map(
        ([path, bytes]) => [`${ROOT}/${path}`, bytes] as const,
      ),
    );
    const location = { fs, dir: ROOT };
    const initialized = () => fs.files.has(`${ROOT}/.git/HEAD`);
    const head = async (): Promise<string | null> => {
      try {
        return await git.resolveRef({ ...location, ref: 'HEAD' });
      } catch {
        return null;
      }
    };
    const changes = async () => {
      if (!initialized()) return [];
      return (
        await git.statusMatrix({
          ...location,
          refresh: false,
          filter: (path) => !isGitRuntimePath(path),
        })
      )
        .filter(([, h, w, s]) => h !== w || h !== s)
        .map(([path, h, w, s]) => ({
          path,
          status: (!h && !s
            ? 'untracked'
            : !w
              ? 'deleted'
              : !h
                ? 'added'
                : 'modified') as 'untracked' | 'deleted' | 'added' | 'modified',
          staged: h !== s,
        }));
    };
    const status = async (): Promise<WorkspaceGitStatus> => {
      const present = initialized();
      let branch: string | null = null;
      let author: WorkspaceGitStatus['author'];
      let remote: WorkspaceGitStatus['remote'];
      if (present) {
        branch = (await git.currentBranch({ ...location, test: true })) ?? null;
        const name = await git.getConfig({ ...location, path: 'user.name' });
        const email = await git.getConfig({ ...location, path: 'user.email' });
        if (typeof name === 'string' && typeof email === 'string')
          author = { name, email };
        const configured = (await git.listRemotes(location))[0];
        if (configured)
          remote = { name: configured.remote, url: configured.url };
      }
      return {
        available: true,
        initialized: present,
        branch,
        head: await head(),
        token: await gitWorkspaceToken(fs.exportFiles(ROOT)),
        changes: await changes(),
        canSync: false,
        author,
        remote,
      };
    };
    const requireRepo = () => {
      if (!initialized())
        throw new Error('Initialize Git before using version history');
    };
    const requireToken = async (token: string) => {
      if (token !== (await gitWorkspaceToken(fs.exportFiles(ROOT))))
        throw new Error('Git state changed; refresh and retry');
    };
    const save = async (): Promise<WorkspaceGitStatus> => {
      next.files = fs.exportFiles(ROOT);
      await storage.publish(before, next);
      return status();
    };
    const guard = () => {
      if (fs.files.has(`${ROOT}/.git/index.lock`))
        throw new Error('Git index is locked by another operation');
      for (const [path, bytes] of fs.files) {
        if (path.startsWith(`${ROOT}/.git/hooks/`) && !path.endsWith('.sample'))
          throw new Error(
            'Browser Git cannot execute repository hooks; use Desktop for this repository',
          );
        if (
          (path.endsWith('/.gitattributes') ||
            path === `${ROOT}/.git/info/attributes`) &&
          /(?:^|\s)(?:filter|working-tree-encoding|eol|ident|text)(?:=|\s|$)/m.test(
            text(bytes),
          )
        )
          throw new Error(
            'Browser Git does not support configured content filters or conversions; use Desktop',
          );
      }
      if (/^\s*hooksPath\s*=/im.test(text(fs.files.get(`${ROOT}/.git/config`))))
        throw new Error(
          'Browser Git cannot execute a custom hooks path; use Desktop',
        );
      for (const name of [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'rebase-merge',
        'rebase-apply',
        'sequencer',
      ])
        if (
          fs.files.has(`${ROOT}/.git/${name}`) ||
          fs.directories.has(`${ROOT}/.git/${name}`)
        )
          throw new Error(`Git operation in progress: ${name}`);
    };
    let executedCreate: string | undefined;
    if (request.type === 'create') {
      requireRepo();
      guard();
      await requireToken(request.expectedToken);
      const saved = plans.get(request.planId);
      if (
        !saved ||
        saved.plan.kind !== 'create' ||
        saved.plan.token !== request.expectedToken
      )
        throw new Error('Create plan expired; preview again');
      for (const f of saved.writes ?? []) {
        fs.put(`${ROOT}/${f.path}`, f.content);
        next.files.set(f.path, f.content);
      }
      executedCreate = request.planId;
      request = {
        type: 'commit',
        paths: saved.createPaths,
        message: saved.message!,
        expectedToken: await gitWorkspaceToken(fs.exportFiles(ROOT)),
      };
    }
    switch (request.type) {
      case 'status':
        return { status: await status() };
      case 'init': {
        if (!initialized())
          await git.init({ ...location, defaultBranch: 'main' });
        if (request.author) {
          await git.setConfig({
            ...location,
            path: 'user.name',
            value: request.author.name,
          });
          await git.setConfig({
            ...location,
            path: 'user.email',
            value: request.author.email,
          });
        }
        return { status: await save() };
      }
      case 'configure': {
        requireRepo();
        if (request.remoteUrl || request.executable)
          throw new Error(
            'Browser Git supports local history; remote synchronization requires Desktop',
          );
        if (request.author) {
          await git.setConfig({
            ...location,
            path: 'user.name',
            value: request.author.name,
          });
          await git.setConfig({
            ...location,
            path: 'user.email',
            value: request.author.email,
          });
        }
        return { status: await save() };
      }
      case 'sync':
        throw new Error('Remote synchronization is available in Desktop');
      case 'cleanup-retry':
      case 'cleanup-confirm':
        throw new Error('Browser history has no remote cleanup pending');
      case 'create-plan': {
        requireRepo();
        guard();
        const state = await status();
        const base = state.head ? await readGitTree(location, state.head) : [];
        const current = contentFiles(next.files);
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
          directoryId(current, request.directoryPath, request.folderId);
          const dirs: string[] = [];
          for (const dir of next.directories ?? [])
            if (
              dir === request.directoryPath ||
              inDirectory(dir, request.directoryPath)
            ) {
              if (!(await git.isIgnored({ ...location, filepath: dir + '/' })))
                dirs.push(dir);
            }
          if (
            await git.isIgnored({
              ...location,
              filepath: request.directoryPath + '/',
            })
          )
            throw new Error('Selected directory is ignored');
          const result = directoryCreation(
            current,
            base,
            request.directoryPath,
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
        const plan: GitOperationPlan = {
          id: crypto.randomUUID(),
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
        };
        plans.set(plan.id, {
          plan,
          writes: metadata,
          createPaths: expanded,
          message: request.message,
        });
        return { status: state, plan };
      }
      case 'commit': {
        requireRepo();
        guard();
        await requireToken(request.expectedToken);
        const message = request.message.trim() || '更新工作区';
        const previous = await head();
        const base = previous ? await readGitTree(location, previous) : [];
        const trackedRuntime = base.filter((file) =>
          isGitRuntimePath(file.path),
        );
        if (trackedRuntime.length)
          throw new Error(
            'Git already tracks runtime files; untrack them before committing: ' +
              trackedRuntime.map((file) => file.path).join(', '),
          );
        const working = contentFiles(next.files),
          workingByPath = new Map(working.map((file) => [file.path, file]));
        const changed = await changes();
        const known = new Set(await git.listFiles(location));
        const selected = new Set(
          request.paths?.map(assertGitContentPath) ??
            changed.map((change) => change.path),
        );
        if (!selected.size) throw new Error('There are no files to commit');
        selected.forEach(assertGitContentPath);
        for (const path of selected) {
          if (
            !known.has(path) &&
            (await git.isIgnored({ ...location, filepath: path }))
          )
            throw new Error('Git ignores the selected file: ' + path);
          if (
            !workingByPath.has(path) &&
            !base.some((file) => file.path === path)
          )
            throw new Error('Selected file is missing: ' + path);
        }
        const ids = new Set(
          [...selected]
            .map((path) => workingByPath.get(path)?.content)
            .filter((bytes): bytes is Uint8Array => !!bytes)
            .map(nativeFileIdentity)
            .filter(Boolean),
        );
        for (const file of base)
          if (
            ids.has(nativeFileIdentity(file.content)) &&
            !workingByPath.has(file.path)
          )
            selected.add(file.path);
        // A single native file's owned attachments are part of that file's portable version.
        for (const path of [...selected])
          for (const asset of gitAssetReferences(
            workingByPath.get(path)?.content ?? new Uint8Array(),
          ))
            selected.add(asset);
        for (const path of selected)
          if (
            !known.has(path) &&
            (await git.isIgnored({ ...location, filepath: path }))
          )
            throw new Error('A required file is ignored by Git: ' + path);
        const candidate = new Map(base.map((file) => [file.path, file]));
        for (const path of selected) {
          const file = workingByPath.get(path);
          if (file)
            candidate.set(path, {
              ...file,
              mode: candidate.get(path)?.mode ?? '100644',
            });
          else candidate.delete(path);
        }
        const files = [...candidate.values()];
        validateGitVersionFiles(files, undefined, base);
        const tree = await writeGitTree(location, files);
        if (
          previous &&
          tree ===
            (await git.readCommit({ ...location, oid: previous })).commit.tree
        )
          throw new Error('The selected files have no changes');
        const configured = request.author ?? (await status()).author;
        if (!configured?.name.trim() || !configured.email.trim())
          throw new Error('Configure the commit author name and email first');
        // Explicit tree avoids consuming unrelated entries already staged by external Git tools.
        const oid = await git.commit({
          ...location,
          tree,
          parent: previous ? [previous] : [],
          message,
          author: {
            ...configured,
            timestamp: Math.floor(now() / 1000),
            timezoneOffset: new Date(now()).getTimezoneOffset(),
          },
        });
        for (const path of selected) {
          if (workingByPath.has(path))
            await git.add({ ...location, filepath: path });
          else {
            try {
              await git.remove({ ...location, filepath: path });
            } catch {
              /* Absent in both index and tree. */
            }
          }
        }
        const result = { status: await save(), oid };
        if (executedCreate) plans.delete(executedCreate);
        return result;
      }
      case 'read': {
        requireRepo();
        const files = (await readGitTree(location, request.oid)).filter(
          (file) => !isGitRuntimePath(file.path),
        );
        return {
          status: await status(),
          files: request.paths
            ? files.filter((file) => request.paths!.includes(file.path))
            : files,
        };
      }
      case 'log': {
        requireRepo();
        const current = await head();
        if (!current) return { status: await status(), commits: [] };
        const all = await allGitCommits(location, { HEAD: current });
        const plain =
          request.path && !request.fileId
            ? await traceGitPaths(location, all, [request.path])
            : undefined;
        if (plain?.blocked.length) throw new Error(plain.blocked.join('; '));
        const commits: GitCommit[] = [];
        const directoryIdentity = request.directoryPath
          ? directoryId(
              contentFiles(next.files),
              request.directoryPath,
              request.folderId,
            )
          : undefined;
        if (request.directoryPath && !directoryIdentity)
          return { status: await status(), commits: [] };
        const signature = async (oid: string) => {
          const files = await readGitTree(location, oid);
          const root = directoryIdentity
            ? directoryRoot(files, directoryIdentity)
            : undefined;
          return files
            .filter((file) =>
              request.directoryPath
                ? !!root && inDirectory(file.path, root)
                : request.fileId
                  ? nativeFileIdentity(file.content) === request.fileId
                  : plain?.pathsByCommit[oid]?.includes(file.path),
            )
            .map((file) => `${file.path}\0${text(file.content)}`)
            .sort()
            .join('\n');
        };
        for (const oid of all.reverse()) {
          const commit = (await git.readCommit({ ...location, oid })).commit;
          if (request.fileId || request.path || request.directoryPath) {
            const currentSignature = await signature(oid);
            const parentSignatures = await Promise.all(
              commit.parent.map(signature),
            );
            if (
              parentSignatures.length
                ? parentSignatures.every((old) => old === currentSignature)
                : !currentSignature
            )
              continue;
          }
          commits.push({
            oid,
            message: commit.message,
            author: commit.author.name,
            email: commit.author.email,
            at: commit.author.timestamp * 1000,
            parents: commit.parent,
            path:
              request.directoryPath && directoryIdentity
                ? directoryRoot(
                    await readGitTree(location, oid),
                    directoryIdentity,
                  )
                : request.fileId || request.path
                  ? (await readGitTree(location, oid)).find((file) =>
                      request.fileId
                        ? nativeFileIdentity(file.content) === request.fileId
                        : plain?.pathsByCommit[oid]?.includes(file.path),
                    )?.path
                  : undefined,
          });
        }
        const start = request.cursor
          ? commits.findIndex((commit) => commit.oid === request.cursor) + 1
          : 0;
        return {
          status: await status(),
          commits: commits.slice(
            start,
            start + Math.max(1, Math.min(request.limit ?? 50, 500)),
          ),
        };
      }
      case 'restore-plan': {
        requireRepo();
        guard();
        const version = await readGitTree(location, request.oid);
        const current = contentFiles(next.files),
          currentByPath = new Map(current.map((file) => [file.path, file]));
        const currentHead = await head();
        const tracked = currentHead
          ? await readGitTree(location, currentHead)
          : [];
        const trackedPaths = new Set(tracked.map((file) => file.path));
        let writes: GitVersionFile[],
          deletes: string[] = [];
        const single = !!(
          request.fileId ||
          request.path ||
          request.directoryPath
        );
        if (single) {
          let directoryWrites: GitVersionFile[] | undefined;
          if (request.directoryPath) {
            const scoped = directoryRestore(
              version,
              current,
              tracked,
              request.directoryPath,
              request.folderId,
            );
            directoryWrites = scoped.writes;
            deletes = scoped.deletes;
          }
          let historicalPaths = request.path ? [request.path] : [];
          if (request.path && !request.fileId && currentHead) {
            const commits = await allGitCommits(location, {
              HEAD: currentHead,
            });
            const traced = await traceGitPaths(location, commits, [
              request.path,
            ]);
            if (traced.blocked.length)
              throw new Error(traced.blocked.join('; '));
            historicalPaths = traced.pathsByCommit[request.oid] ?? [];
          }
          const file = version.find((entry) =>
            request.fileId
              ? nativeFileIdentity(entry.content) === request.fileId
              : historicalPaths.includes(entry.path),
          );
          if (!file && !directoryWrites)
            throw new Error('The file does not exist in this version');
          const currentPath = request.fileId
            ? current.find(
                (entry) => nativeFileIdentity(entry.content) === request.fileId,
              )?.path
            : request.path;
          writes = directoryWrites ?? [
            { ...file!, path: currentPath ?? file!.path },
          ];
          const present = new Set(
            current
              .map((entry) => nativeFileIdentity(entry.content))
              .filter(Boolean),
          );
          for (const path of deletes) {
            const id = nativeFileIdentity(
              currentByPath.get(path)?.content ?? new Uint8Array(),
            );
            if (id) present.delete(id);
          }
          for (const file of writes) {
            const id = nativeFileIdentity(file.content);
            if (id) present.add(id);
          }
          if (request.fileId) present.add(request.fileId);
          for (let index = 0; index < writes.length; index++) {
            const entry = writes[index]!;
            let parsed: unknown;
            try {
              parsed = JSON.parse(text(entry.content));
            } catch {
              parsed = null;
            }
            if (isWorkspaceFile(parsed))
              for (const dependency of workspaceReferences(parsed)) {
                if (present.has(dependency.targetId)) continue;
                const target = version.find(
                  (candidate) =>
                    nativeFileIdentity(candidate.content) ===
                    dependency.targetId,
                );
                if (!target)
                  throw new Error(
                    'The version is missing a referenced file: ' +
                      dependency.targetId,
                  );
                if (currentByPath.has(target.path))
                  throw new Error(
                    'A missing dependency path is occupied: ' + target.path,
                  );
                writes.push(target);
                present.add(dependency.targetId);
              }
            for (const asset of gitAssetReferences(entry.content)) {
              if (writes.some((candidate) => candidate.path === asset))
                continue;
              const assetFile = version.find(
                (candidate) => candidate.path === asset,
              );
              if (!assetFile)
                throw new Error(
                  'The version is missing an attachment: ' + asset,
                );
              writes.push(assetFile);
            }
          }
        } else {
          const config = version.find(
            (entry) => entry.path === '.verdscrolls/config.json',
          );
          let parsed: { version?: unknown; value?: unknown } | undefined;
          try {
            parsed = config && JSON.parse(text(config.content));
          } catch {
            /* Refuse malformed versions below. */
          }
          if (
            typeof parsed?.version !== 'number' ||
            !parsed.value ||
            typeof parsed.value !== 'object'
          )
            throw new Error(
              'This version has no valid portable workspace configuration',
            );
          writes = version.filter((file) => !isGitRuntimePath(file.path));
          const target = new Set(writes.map((file) => file.path));
          deletes = tracked
            .filter(
              (file) => !isGitRuntimePath(file.path) && !target.has(file.path),
            )
            .map((file) => file.path);
        }
        writes.forEach((file) => assertGitContentPath(file.path));
        if (writes.some((file) => file.mode === '120000'))
          throw new Error('Browser Git cannot restore symbolic links');
        for (const file of writes)
          if (next.directories?.has(file.path))
            throw new Error(
              'A directory occupies a restore target: ' + file.path,
            );
        for (const file of writes)
          if (currentByPath.has(file.path) && !trackedPaths.has(file.path))
            throw new Error(
              'An untracked or ignored file occupies a restore target: ' +
                file.path,
            );
        const affected = new Set([
          ...writes.map((file) => file.path),
          ...deletes,
        ]);
        const dirty = (await changes()).filter(
          (change) => !single || affected.has(change.path),
        );
        if (dirty.length)
          throw new Error(
            'Commit or discard changes before restoring: ' +
              dirty.map((change) => change.path).join(', '),
          );
        const candidate = new Map(currentByPath);
        deletes.forEach((path) => candidate.delete(path));
        writes.forEach((file) => candidate.set(file.path, file));
        validateGitVersionFiles([...candidate.values()]);
        const token = await gitWorkspaceToken(fs.exportFiles(ROOT));
        const plan: GitOperationPlan = {
          id: crypto.randomUUID(),
          kind: 'restore',
          token,
          oid: request.oid,
          scope: request.directoryPath
            ? 'directory'
            : single
              ? 'file'
              : 'workspace',
          paths: [
            ...writes.map((file) => ({
              path: file.path,
              action: 'write' as const,
            })),
            ...deletes.map((path) => ({ path, action: 'delete' as const })),
          ],
          warnings: [],
        };
        plans.set(plan.id, { plan, writes, deletes });
        return { status: await status(), plan };
      }
      case 'restore': {
        requireRepo();
        guard();
        await requireToken(request.expectedToken);
        const saved = plans.get(request.planId);
        if (
          !saved ||
          saved.plan.kind !== 'restore' ||
          saved.plan.token !== request.expectedToken
        )
          throw new Error('Restore plan expired; preview again');
        for (const path of saved.deletes ?? [])
          fs.files.delete(`${ROOT}/${path}`);
        for (const file of saved.writes ?? [])
          fs.put(`${ROOT}/${file.path}`, file.content);
        validateGitVersionFiles(contentFiles(fs.exportFiles(ROOT)));
        plans.delete(request.planId);
        return { status: await save() };
      }
      case 'purge-plan': {
        requireRepo();
        guard();
        if ((await git.listRemotes(location)).length)
          throw new Error(
            'Use Desktop to permanently clean a repository with configured remotes',
          );
        const fileIds = new Set(request.fileIds),
          explicitPaths = new Set(request.paths ?? []);
        const plainSeeds: { path: string; content: Uint8Array }[] = [];
        for (const id of request.trashEntryIds ?? []) {
          const entry = next.trash.get(id);
          if (!entry)
            throw new Error('A selected trash entry no longer exists: ' + id);
          for (const [path, bytes] of entry.files) {
            const identity = nativeFileIdentity(bytes);
            if (identity) fileIds.add(identity);
            else {
              explicitPaths.add(path);
              plainSeeds.push({ path, content: bytes });
            }
          }
        }
        if (!fileIds.size && !explicitPaths.size)
          throw new Error(
            'Select files or trash entries to permanently remove',
          );
        const ids = [...fileIds],
          paths = [...explicitPaths];
        const analysis = await planGitPurge({
          ...location,
          fileIds: ids,
          paths,
          plainSeeds,
        });
        if (analysis.blocked.length)
          throw new Error(analysis.blocked.join('; '));
        const currentHead = await head();
        const headPlainPaths = new Set(
          analysis.plainVersions[currentHead ?? ''] ?? [],
        );
        const seededPaths = new Set(plainSeeds.map((seed) => seed.path));
        for (const path of seededPaths)
          if (next.files.has(path) && headPlainPaths.has(path))
            throw new Error(
              'A live file occupies a deleted plain file path; its identity is ambiguous: ' +
                path,
            );
        const localMatch = (
          path: string,
          bytes: Uint8Array,
          inTrash = false,
        ) => {
          const id = nativeFileIdentity(bytes);
          if (id) return ids.includes(id);
          if (seededPaths.has(path)) return false; // Selected trash entries are handled explicitly below; preserve later incarnations.
          return paths.includes(path) && !inTrash;
        };
        // Idle checkpoints and trash can own attachments that never entered Git.
        const candidates = new Set(analysis.exclusiveAssets),
          survivors = new Set(analysis.survivingAssets);
        const inspect = (
          path: string,
          bytes: Uint8Array,
          forcedRemoval = false,
          inTrash = false,
        ) => {
          const remove = forcedRemoval || localMatch(path, bytes, inTrash);
          for (const asset of gitAssetReferences(bytes))
            (remove ? candidates : survivors).add(asset);
          if (remove && !analysis.paths.includes(path))
            analysis.paths.push(path);
        };
        for (const [path, bytes] of next.files)
          if (!path.startsWith('.git/')) inspect(path, bytes);
        for (const [id, entry] of next.trash)
          for (const [path, bytes] of entry.files)
            inspect(path, bytes, request.trashEntryIds?.includes(id), true);
        analysis.exclusiveAssets = [...candidates].filter(
          (path) => !survivors.has(path),
        );
        analysis.survivingAssets = [...survivors];
        for (const path of analysis.exclusiveAssets)
          if (!analysis.paths.includes(path)) analysis.paths.push(path);
        const headFiles = new Map(
          (currentHead ? await readGitTree(location, currentHead) : []).map(
            (file) => [file.path, file.content],
          ),
        );
        const staged = new Map<string, Uint8Array>();
        await git.walk({
          ...location,
          trees: [git.STAGE()],
          map: async (path, [entry]) => {
            if (entry && (await entry.type()) === 'blob')
              staged.set(
                path,
                (await git.readBlob({ ...location, oid: await entry.oid() }))
                  .blob,
              );
          },
        });
        const dirty = (await changes()).filter((change) => {
          if (analysis.exclusiveAssets.includes(change.path)) return false;
          const current =
            next.files.get(change.path) ?? headFiles.get(change.path);
          if (
            !current ||
            !(nativeFileIdentity(current)
              ? ids.includes(nativeFileIdentity(current)!)
              : seededPaths.has(change.path)
                ? !next.files.has(change.path) &&
                  headPlainPaths.has(change.path)
                : paths.includes(change.path))
          )
            return true;
          const index = staged.get(change.path);
          return (
            !!index &&
            !(nativeFileIdentity(index)
              ? ids.includes(nativeFileIdentity(index)!)
              : seededPaths.has(change.path)
                ? headPlainPaths.has(change.path)
                : paths.includes(change.path))
          );
        });
        if (dirty.length)
          throw new Error(
            'Commit or discard unrelated changes before history cleanup: ' +
              dirty.map((change) => change.path).join(', '),
          );
        const token = await gitWorkspaceToken(fs.exportFiles(ROOT));
        const plan: GitOperationPlan = {
          id: crypto.randomUUID(),
          kind: 'purge',
          token,
          scope: 'workspace',
          fileIds: ids,
          refs: Object.keys(analysis.refs),
          paths: analysis.paths.map((path) => ({ path, action: 'delete' })),
          warnings: [
            'This rewrites commit and tag identities and removes local recovery data.',
            ...analysis.warnings,
          ],
        };
        plans.set(plan.id, {
          plan,
          analysis,
          fileIds: ids,
          explicitPaths: paths,
          trashEntryIds: request.trashEntryIds ?? [],
          snapshotToken: await recoveryToken(before),
          localDeletePaths: [...next.files]
            .filter(
              ([path, bytes]) =>
                !path.startsWith('.git/') &&
                (localMatch(path, bytes) ||
                  analysis.exclusiveAssets.includes(path)),
            )
            .map(([path]) => path),
        });
        return { status: await status(), plan };
      }
      case 'purge': {
        requireRepo();
        guard();
        await requireToken(request.expectedToken);
        const saved = plans.get(request.planId);
        if (
          !saved?.analysis ||
          saved.plan.kind !== 'purge' ||
          saved.plan.token !== request.expectedToken
        )
          throw new Error('Cleanup plan expired; preview again');
        if (saved.snapshotToken !== (await recoveryToken(before)))
          throw new Error('Recovery data changed; preview cleanup again');
        const rebuilt = await rewriteGitPurge({
          ...location,
          analysis: saved.analysis,
        });
        for (const path of [...fs.files.keys()]) {
          if (path.startsWith(`${ROOT}/.git/`)) fs.files.delete(path);
          else {
            const relative = path.slice(ROOT.length + 1),
              bytes = fs.files.get(path)!;
            if (saved.localDeletePaths?.includes(relative))
              fs.files.delete(path);
            else
              fs.put(
                path,
                filterHistoryManifest(relative, bytes, saved.fileIds!),
              );
          }
        }
        for (const [path, bytes] of rebuilt.files)
          fs.put(`${ROOT}/.git/${path}`, bytes);
        for (const [id, entry] of next.trash) {
          if (saved.trashEntryIds?.includes(id)) {
            next.trash.delete(id);
            continue;
          }
          for (const [path, bytes] of entry.files)
            if (
              saved.fileIds!.includes(nativeFileIdentity(bytes) ?? '') ||
              saved.analysis.exclusiveAssets.includes(path)
            )
              entry.files.delete(path);
          if (!entry.files.size) next.trash.delete(id);
        }
        for (const file of contentFiles(fs.exportFiles(ROOT)))
          await git.add({ ...location, filepath: file.path });
        validateGitVersionFiles(contentFiles(fs.exportFiles(ROOT)));
        plans.delete(request.planId);
        const cleanup = {
          phase: 'local-cleared' as const,
          message: 'Local Git objects and recovery copies have been cleared.',
          pending: [],
        };
        return { status: { ...(await save()), cleanup }, cleanup };
      }
    }
  };
  return (request: WorkspaceGitRequest): Promise<WorkspaceGitResult> => {
    const result = lane.then(() => operate(request));
    lane = result.catch(() => {});
    return result;
  };
}
