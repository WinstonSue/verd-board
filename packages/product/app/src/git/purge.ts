import './buffer-shim';
import * as git from 'isomorphic-git';
import { GitMemoryFs } from './memory-fs';
import { traceGitPaths } from './path-history';
import {
  decodeGitText,
  gitAssetReferences,
  nativeFileIdentity,
  readGitTree,
  writeGitTree,
  type GitLocation,
} from './tree';

export interface GitPurgeAnalysis {
  refs: Record<string, string>;
  paths: string[];
  removedBlobOids: string[];
  exclusiveAssets: string[];
  survivingAssets: string[];
  blocked: string[];
  fileIds: string[];
  explicitPaths: string[];
  plainVersions: Record<string, string[]>;
  plainSeeds: { path: string; blobOid: string }[];
  warnings: string[];
}
type PromiseFs = {
  readFile(path: string, options?: unknown): Promise<Uint8Array | string>;
  stat(path: string): Promise<unknown>;
  readdir(path: string): Promise<string[]>;
};
const promises = (location: GitLocation) =>
  (location.fs as unknown as { promises: PromiseFs }).promises;
const gitdirOf = (location: GitLocation) =>
  location.gitdir ?? `${location.dir}/.git`;
async function exists(location: GitLocation, path: string) {
  try {
    await promises(location).stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function gitAllRefs(
  location: GitLocation,
): Promise<Record<string, string>> {
  const refs: Record<string, string> = {};
  for (const name of await git.listRefs({ ...location, filepath: 'refs' })) {
    const ref = name.startsWith('refs/') ? name : `refs/${name}`;
    refs[ref] = await git.resolveRef({ ...location, ref });
  }
  return refs;
}

async function peelCommit(location: GitLocation, oid: string): Promise<string> {
  const object = await git.readObject({ ...location, oid, format: 'content' });
  if (object.type === 'commit') return oid;
  if (object.type === 'tag')
    return peelCommit(
      location,
      (await git.readTag({ ...location, oid })).tag.object,
    );
  throw new Error(`Reference does not point to a commit: ${oid}`);
}

export async function allGitCommits(
  location: GitLocation,
  refs: Record<string, string>,
) {
  const seen = new Set<string>();
  const result: string[] = [];
  const visit = async (oid: string) => {
    const commitOid = await peelCommit(location, oid);
    if (seen.has(commitOid)) return;
    seen.add(commitOid);
    for (const parent of (await git.readCommit({ ...location, oid: commitOid }))
      .commit.parent)
      await visit(parent);
    result.push(commitOid);
  };
  for (const oid of Object.values(refs)) await visit(oid);
  return result;
}

export function purgeMatches(
  path: string,
  content: Uint8Array,
  fileIds: readonly string[],
  paths: readonly string[],
) {
  const identity = nativeFileIdentity(content);
  // A renamed path may subsequently belong to a different native document.
  return identity ? fileIds.includes(identity) : paths.includes(path);
}

export function filterHistoryManifest(
  path: string,
  bytes: Uint8Array,
  fileIds: readonly string[],
): Uint8Array {
  if (
    !fileIds.length ||
    !/(?:\.verd-resources|\.verdscrolls\/resources)\/history\/index\.json$/.test(
      path,
    )
  )
    return bytes;
  try {
    const value = JSON.parse(decodeGitText(bytes));
    if (!Array.isArray(value.revisions)) return bytes;
    const revisions = value.revisions.filter(
      (revision: { fileId?: string }) =>
        !fileIds.includes(revision.fileId ?? ''),
    );
    let changed = revisions.length !== value.revisions.length;
    value.revisions = revisions;
    if (value.trashed && typeof value.trashed === 'object')
      for (const [key, ids] of Object.entries(value.trashed)) {
        if (!Array.isArray(ids))
          throw new Error('Invalid trashed history identity list');
        const filtered = ids.filter((id) => !fileIds.includes(String(id)));
        if (filtered.length !== ids.length) changed = true;
        value.trashed[key] = filtered;
      }
    if (!changed) return bytes;
    return new TextEncoder().encode(JSON.stringify(value));
  } catch {
    throw new Error(`Cannot safely clean corrupt history index: ${path}`);
  }
}

export async function planGitPurge(
  options: GitLocation & {
    fileIds: string[];
    paths?: string[];
    preserveHooks?: boolean;
    plainSeeds?: { path: string; content: Uint8Array }[];
  },
): Promise<GitPurgeAnalysis> {
  const { fileIds, paths: explicitPaths = [] } = options;
  const gitdir = gitdirOf(options),
    blocked: string[] = [];
  const refs = await gitAllRefs(options);
  for (const ref of Object.keys(refs))
    if (!/^refs\/(heads|tags|remotes)\//.test(ref))
      blocked.push(`Unsupported history reference: ${ref}`);
  for (const path of [
    'worktrees',
    'objects/info/alternates',
    'shallow',
    'info/grafts',
  ])
    if (await exists(options, `${gitdir}/${path}`))
      blocked.push(`History cleanup does not support ${path}`);
  for (const path of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
    'sequencer',
  ])
    if (await exists(options, `${gitdir}/${path}`))
      blocked.push(`Git operation in progress: ${path}`);
  if (
    !options.preserveHooks &&
    (await git.getConfig({ ...options, path: 'core.hooksPath' }))
  )
    blocked.push('History cleanup does not support a custom hooks path');
  if (!options.preserveHooks && (await exists(options, `${gitdir}/hooks`))) {
    const hooks = await promises(options).readdir(`${gitdir}/hooks`);
    if (hooks.some((name) => !name.endsWith('.sample')))
      blocked.push('History cleanup requires inactive repository hooks');
  }
  const paths = new Set<string>(),
    blobs = new Set<string>(),
    candidateAssets = new Set<string>(),
    survivingAssets = new Set<string>();
  let commits: string[] = [];
  try {
    commits = await allGitCommits(options, refs);
  } catch (error) {
    blocked.push(String(error));
  }
  const plainSeeds = await Promise.all(
    (options.plainSeeds ?? []).map(async (seed) => ({
      path: seed.path,
      blobOid: (await git.hashBlob({ object: seed.content })).oid,
    })),
  );
  const plain = explicitPaths.length
    ? await traceGitPaths(options, commits, explicitPaths, plainSeeds)
    : { pathsByCommit: {}, blocked: [], warnings: [] };
  blocked.push(...plain.blocked);
  for (const oid of commits) {
    for (const file of await readGitTree(options, oid)) {
      if (file.mode === '120000')
        blocked.push(
          `Symbolic links are not supported during history cleanup: ${file.path}`,
        );
      if (file.path === '.gitmodules')
        blocked.push('History cleanup does not support submodules');
      if (
        file.path.endsWith('.gitattributes') &&
        /filter\s*=\s*lfs\b/.test(decodeGitText(file.content))
      )
        blocked.push('Git LFS requires separate object cleanup');
      const removed = purgeMatches(
        file.path,
        file.content,
        fileIds,
        plain.pathsByCommit[oid] ?? [],
      );
      if (removed) {
        paths.add(file.path);
        blobs.add((await git.hashBlob({ object: file.content })).oid);
      }
      for (const asset of gitAssetReferences(file.content))
        (removed ? candidateAssets : survivingAssets).add(asset);
    }
  }
  const exclusiveAssets = [...candidateAssets].filter(
    (path) => !survivingAssets.has(path),
  );
  const survivorBlobs = new Set<string>();
  for (const oid of commits)
    for (const file of await readGitTree(options, oid)) {
      const removed =
        purgeMatches(
          file.path,
          file.content,
          fileIds,
          plain.pathsByCommit[oid] ?? [],
        ) || exclusiveAssets.includes(file.path);
      const cleaned = filterHistoryManifest(file.path, file.content, fileIds);
      const changedManifest =
        decodeGitText(cleaned) !== decodeGitText(file.content);
      const blob = (await git.hashBlob({ object: file.content })).oid;
      if (removed || changedManifest) {
        paths.add(file.path);
        blobs.add(blob);
      } else survivorBlobs.add(blob);
    }
  if ([...blobs].some((oid) => survivorBlobs.has(oid)))
    blocked.push(
      'Identical content remains in another unselected history file; include that copy before permanent cleanup',
    );
  return {
    refs,
    paths: [...paths].sort(),
    removedBlobOids: [...blobs],
    exclusiveAssets,
    survivingAssets: [...survivingAssets],
    blocked: [...new Set(blocked)],
    fileIds: [...fileIds],
    explicitPaths: [...explicitPaths],
    plainVersions: plain.pathsByCommit,
    plainSeeds,
    warnings: plain.warnings,
  };
}

/** Rebuild only rewritten reachable objects; old packs, reflogs and dangling blobs never enter the result. */
export async function rewriteGitPurge(
  options: GitLocation & { analysis: GitPurgeAnalysis },
) {
  const { analysis } = options;
  if (analysis.blocked.length) throw new Error(analysis.blocked.join('; '));
  const actual = await gitAllRefs(options);
  if (JSON.stringify(actual) !== JSON.stringify(analysis.refs))
    throw new Error('Git references changed while preparing cleanup');
  const output = new GitMemoryFs();
  const target = { fs: output, dir: '/repository', gitdir: '/repository/.git' };
  await git.init({ ...target, defaultBranch: 'main' });
  const mapping = new Map<string, string>();
  const rewrite = async (oid: string): Promise<string> => {
    const cached = mapping.get(oid);
    if (cached) return cached;
    const object = await git.readObject({ ...options, oid, format: 'content' });
    let next: string;
    if (object.type === 'tag') {
      const tag = (await git.readTag({ ...options, oid })).tag;
      const targetObject = await rewrite(tag.object);
      next =
        targetObject === tag.object
          ? await git.writeObject({
              ...target,
              type: 'tag',
              format: 'content',
              object: object.object,
            })
          : await git.writeTag({
              ...target,
              tag: { ...tag, object: targetObject, gpgsig: undefined },
            });
    } else if (object.type === 'commit') {
      const commit = (await git.readCommit({ ...options, oid })).commit;
      const files = (await readGitTree(options, oid))
        .filter(
          (file) =>
            !purgeMatches(
              file.path,
              file.content,
              analysis.fileIds,
              analysis.plainVersions[oid] ?? [],
            ) && !analysis.exclusiveAssets.includes(file.path),
        )
        .map((file) => ({
          ...file,
          content: filterHistoryManifest(
            file.path,
            file.content,
            analysis.fileIds,
          ),
        }));
      const parent: string[] = [];
      for (const previous of commit.parent)
        parent.push(await rewrite(previous));
      const tree = await writeGitTree(target, files);
      next =
        tree === commit.tree &&
        parent.every((oid, index) => oid === commit.parent[index])
          ? await git.writeObject({
              ...target,
              type: 'commit',
              format: 'content',
              object: object.object,
            })
          : await git.writeCommit({
              ...target,
              commit: { ...commit, parent, tree, gpgsig: undefined },
            });
    } else throw new Error(`Unsupported reference object: ${object.type}`);
    mapping.set(oid, next);
    return next;
  };
  const refs: Record<string, string> = {};
  for (const [ref, oid] of Object.entries(analysis.refs)) {
    refs[ref] = await rewrite(oid);
    await git.writeRef({ ...target, ref, value: refs[ref]!, force: true });
  }
  const source = promises(options),
    gitdir = gitdirOf(options);
  for (const ref of Object.keys(analysis.refs)) {
    try {
      const bytes = await source.readFile(`${gitdir}/${ref}`);
      const value = typeof bytes === 'string' ? bytes : decodeGitText(bytes);
      if (value.startsWith('ref: refs/'))
        await git.writeRef({
          ...target,
          ref,
          value: value.slice(5).trim(),
          symbolic: true,
          force: true,
        });
    } catch {
      /* Packed and direct refs have already been rebuilt above. */
    }
  }
  for (const path of [
    'config',
    'description',
    'info/exclude',
    'info/attributes',
  ]) {
    try {
      const value = await source.readFile(`${gitdir}/${path}`);
      output.put(
        `${target.gitdir}/${path}`,
        typeof value === 'string' ? new TextEncoder().encode(value) : value,
      );
    } catch {
      /* Optional metadata. */
    }
  }
  const head = await source.readFile(`${gitdir}/HEAD`);
  const text = typeof head === 'string' ? head : decodeGitText(head);
  if (text.startsWith('ref: '))
    output.put(`${target.gitdir}/HEAD`, new TextEncoder().encode(text));
  else throw new Error('History cleanup requires an attached branch');
  return {
    files: output.exportFiles(target.gitdir),
    refs,
    removedBlobOids: analysis.removedBlobOids,
  };
}
