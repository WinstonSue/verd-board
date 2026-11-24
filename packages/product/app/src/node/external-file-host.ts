import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createDocumentFile,
  openWorkspaceSession,
  isWorkspaceFile,
  isCanvasPath,
  isDocumentPath,
  normalizeResourceKey,
  normalizeWorkspacePath,
  parseWorkspacePackage,
  workspaceFileId,
  WORKSPACE_PACKAGE_MAX_JSON_BYTES,
  type CommitReceipt,
  type CommitRequest,
  type WorkspaceFile,
  type WorkspaceHost,
  type WorkspaceHostSnapshot,
  type WorkspaceSessionState,
  type ExternalFileBinding,
} from '@sue/verd-board-workspace';
import {
  canonicalRoot,
  withWorkspaceLock,
} from '@sue/verd-board-file-workspace';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import { containsQuickPath } from './quick-files';
import { splitIndependentFileName } from '../independent-file-name';

const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2);
const bytes = (value: string | Uint8Array) => Buffer.from(value);

const isMissing = (cause: unknown) =>
  (cause as NodeJS.ErrnoException).code === 'ENOENT';

export async function independentFileIdentity(filename: string) {
  const stat = await fs.lstat(filename, { bigint: true });
  if (!stat.isFile()) throw new Error('不是普通文件');
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

async function fileVersion(filename: string) {
  try {
    const identity = await independentFileIdentity(filename);
    const digest = hash(await fs.readFile(filename));
    if (identity !== (await independentFileIdentity(filename)))
      throw new Error('原文件已变化，请重试');
    return { identity, digest };
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw cause;
  }
}

/** Serialize final publication against saves and renames of the same path. */
async function replaceFile(
  filename: string,
  content: Uint8Array,
  expected: string | null,
  identity?: string,
  backup?: string,
) {
  return withWorkspaceLock(filename, async () => {
    const temporary = path.join(path.dirname(filename), `.${randomUUID()}.tmp`);
    const matches = (version: Awaited<ReturnType<typeof fileVersion>>) =>
      (version?.digest ?? null) === expected &&
      (!identity || version?.identity === identity);
    try {
      if (!matches(await fileVersion(filename))) return null;
      const mode = await fs.stat(filename).then(
        (stat) => stat.mode,
        () => 0o600,
      );
      await fs.writeFile(temporary, content, { flag: 'wx', mode });
      if (backup) await fs.copyFile(filename, backup);
      if (!matches(await fileVersion(filename))) return null;
      const next = await independentFileIdentity(temporary);
      await fs.rename(temporary, filename);
      return next;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
}

async function withFilePathsLocked<T>(
  source: string,
  destination: string,
  task: () => Promise<T>,
) {
  const keys = [
    ...new Set(
      await Promise.all([canonicalRoot(source), canonicalRoot(destination)]),
    ),
  ].sort();
  return withWorkspaceLock(keys[0], () =>
    keys.length === 2 ? withWorkspaceLock(keys[1], task) : task(),
  );
}

/** Link first so publishing a name can never replace another file. */
async function moveIndependentFile(
  source: string,
  destination: string,
  expected: { identity: string; digest: string },
) {
  const parent = path.dirname(source);
  const current = await independentFileIdentity(destination).catch((cause) => {
    if (isMissing(cause)) return null;
    throw cause;
  });
  const alias =
    current === expected.identity &&
    !(await fs.readdir(parent)).includes(path.basename(destination));
  if (current && !alias) throw new Error('同名文件已存在');
  const staging = alias
    ? path.join(parent, `.${randomUUID()}.tmp`)
    : destination;
  await fs.link(source, staging);
  try {
    const version = await fileVersion(source);
    if (
      version?.identity !== expected.identity ||
      version.digest !== expected.digest
    )
      throw new Error('原文件已变化，请重试');
    await fs.unlink(source);
  } catch (cause) {
    await fs.unlink(staging);
    throw cause;
  }
  if (!alias) return;
  try {
    await fs.link(staging, destination);
  } catch (cause) {
    // Retain the complete staging file if an outside process occupies the old name.
    await fs.link(staging, source);
    await fs.unlink(staging);
    throw cause;
  }
  await fs.unlink(staging);
}

interface PrivateState {
  documentId: string;
  sourceDigest?: string;
  sourceIdentity?: string;
  generation?: string;
  session: WorkspaceSessionState | null;
  config: { version: number; value: Record<string, unknown> };
  resources: Record<string, string>;
  receipts: Record<string, CommitReceipt>;
}

/** One physical file, with virtual native entries understood by WorkspaceSession. */
export async function createExternalFileHost(
  sourcePath: string,
  stateRoot: string,
  boundary?: string,
) {
  let source = await fs.realpath(sourcePath);
  const checkBoundary = async (filename: string) => {
    if (boundary && !containsQuickPath(boundary, await fs.realpath(filename)))
      throw new Error('文件不在快速创建目录内');
  };
  await checkBoundary(source);
  let sourceIdentity = await independentFileIdentity(source);
  const markdown = /\.(md|markdown)$/i.test(source);
  if (!markdown && !isCanvasPath(source)) throw new Error('不支持的文件类型');
  const stateDirectoryFor = (filename: string) =>
    path.join(stateRoot, hash(filename));
  let stateDirectory = stateDirectoryFor(source);
  const newState = (): PrivateState => ({
    documentId: `markdown-${hash(source)}-${hash(sourceIdentity)}`,
    session: null,
    config: { version: 0, value: {} },
    resources: {},
    receipts: {},
  });
  let state: PrivateState = await fs
    .readFile(path.join(stateDirectory, 'state.json'), 'utf8')
    .then(JSON.parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return newState();
    });
  if (state.sourceIdentity && state.sourceIdentity !== sourceIdentity)
    state = newState();
  const handle = {
    key: `external-${randomUUID()}`,
    name: path.basename(source),
  };
  let baseline = '';
  let generation = '';
  let format: 'markdown' | 'bare' | 'v1' | 'v2' = markdown
    ? 'markdown'
    : 'bare';
  let rootFileId = '';
  let files = new Map<string, WorkspaceFile>();
  let resources = new Map<string, Uint8Array>();
  let warnings: string[] = [];
  const knownResources = new Map<string, Uint8Array>();
  let resolvingContainer = false;
  let bom = '';
  let newline = '\n';
  let trailingNewline = true;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => {});
    return result;
  };
  const assertHandle = (h: { key: string }) => {
    if (h.key !== handle.key) throw new Error('Unknown external file handle');
  };
  const persist = async () => {
    state = { ...state, sourceDigest: baseline, sourceIdentity, generation };
    const statePath = path.join(stateDirectory, 'state.json');
    await fs.mkdir(stateDirectory, { recursive: true });
    const temporary = statePath + `.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, json(state), { mode: 0o600 });
      await fs.rename(temporary, statePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };
  const memberPath = (file: WorkspaceFile) =>
    markdown
      ? 'document.verd-doc.json'
      : `files/${hash(workspaceFileId(file))}${file.format === 'verd-document' ? '.verd-doc.json' : '.verd'}`;
  const memberVersion = (file: WorkspaceFile) => hash(generation + json(file));
  const resourceVersion = (content: Uint8Array) =>
    hash(generation + hash(content));
  async function refresh() {
    await checkBoundary(source);
    if ((await fs.stat(source)).size > WORKSPACE_PACKAGE_MAX_JSON_BYTES)
      throw new Error('文件超过 384 MiB 上限');
    const observedIdentity = await independentFileIdentity(source);
    const raw = await fs.readFile(source);
    if (observedIdentity !== (await independentFileIdentity(source)))
      throw new Error('原文件已变化，请重试');
    if (raw.length > WORKSPACE_PACKAGE_MAX_JSON_BYTES)
      throw new Error('文件超过 384 MiB 上限');
    const digest = hash(raw);
    if (digest === baseline) return;
    let incoming: WorkspaceFile[];
    const nextResources = new Map<string, Uint8Array>();
    if (markdown) {
      const text = new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(raw);
      bom = text.startsWith('\ufeff') ? '\ufeff' : '';
      newline = text.includes('\r\n') ? '\r\n' : '\n';
      trailingNewline = /\r?\n$/.test(text);
      const parsed = parseMarkdownToTextDocument(text.slice(bom.length), {
        id: state.documentId,
      });
      const file = createDocumentFile(
        state.documentId,
        path.basename(source).replace(/\.(md|markdown)$/i, ''),
      );
      incoming = [{ ...file, text: parsed.document }];
      warnings = parsed.warnings.map((w) => w.message);
      if (/^---\r?\n/.test(text.slice(bom.length)))
        warnings.unshift(
          '文件开头的 Markdown 分隔块会作为正文解析，保存时可能改变写法',
        );
      rootFileId = state.documentId;
    } else {
      const value = JSON.parse(raw.toString('utf8'));
      const prepared = await parseWorkspacePackage(value);
      if (
        !prepared ||
        !prepared.files.some(
          (f) =>
            f.format === 'verd-frame' && f.frame.id === prepared.rootFileId,
        )
      )
        throw new Error('文件缺少有效的根画布');
      incoming = prepared.files;
      rootFileId = prepared.rootFileId;
      for (const item of prepared.resources)
        nextResources.set(`assets/${item.assetId}`, item.content);
      format =
        value.format === 'verd-canvas-bundle'
          ? value.version === 2
            ? 'v2'
            : 'v1'
          : 'bare';
    }
    files = new Map(incoming.map((f) => [memberPath(f), f]));
    resources = nextResources;
    nextResources.forEach((value, key) => knownResources.set(key, value));
    generation =
      state.sourceDigest === digest ? (state.generation ?? digest) : digest;
    baseline = digest;
  }
  const serialize = (
    nextFiles: Map<string, WorkspaceFile>,
    nextResources: Map<string, Uint8Array>,
  ) => {
    const values = [...nextFiles.values()];
    if (markdown) {
      if (values.length !== 1 || values[0].format !== 'verd-document')
        throw new Error('Markdown 只能保存独立文档');
      const result = serializeTextDocumentToMarkdown(values[0].text);
      warnings = [
        ...new Set([...warnings, ...result.warnings.map((w) => w.message)]),
      ];
      const text = result.markdown
        .replace(/\r\n/g, '\n')
        .replace(/\n$/, trailingNewline ? '\n' : '')
        .replace(/\n/g, newline);
      return Buffer.from(bom + text);
    }
    const assets = [...nextResources].filter(([key]) =>
      key.startsWith('assets/'),
    );
    const value =
      format === 'bare' && values.length === 1 && !assets.length
        ? values[0]
        : format !== 'v2' && !assets.length
          ? {
              format: 'verd-canvas-bundle',
              version: 1,
              rootFileId,
              files: values,
            }
          : {
              format: 'verd-canvas-bundle',
              version: 2,
              rootFileId,
              files: values,
              resources: assets.map(([key, content]) => ({
                assetId: key.slice(7),
                encoding: 'base64',
                byteLength: content.byteLength,
                data: Buffer.from(content).toString('base64'),
              })),
            };
    return Buffer.from(json(value));
  };
  await refresh();
  const binding: ExternalFileBinding = {
    handle,
    kind: markdown ? 'markdown' : 'canvas',
    displayName: handle.name,
    rootFileId,
  };
  const snapshot = (): WorkspaceHostSnapshot => ({
    config: state.config,
    session: state.session ?? {
      tabs: [{ fileId: rootFileId }],
      activeTabId: rootFileId,
      activeView: 'file',
      expandedDirs: [],
    },
    entries: [...files].map(([p, f]) => ({
      path: p,
      kind: 'file',
      canvas: f.format === 'verd-frame',
      document: f.format === 'verd-document',
      version: memberVersion(f),
    })),
    canvases: [...files].flatMap(([p, f]) =>
      f.format === 'verd-frame'
        ? [{ path: p, file: f, version: memberVersion(f) }]
        : [],
    ),
    documents: [...files].flatMap(([p, f]) =>
      f.format === 'verd-document'
        ? [{ path: p, file: f, version: memberVersion(f) }]
        : [],
    ),
    resources: [...resources].map(([key, content]) => ({
      key,
      size: content.byteLength,
      version: resourceVersion(content),
    })),
    trash: [],
    diagnostics: [],
  });
  const commit = (request: CommitRequest): Promise<CommitReceipt> =>
    enqueue(async () => {
      if (Object.hasOwn(state.receipts, request.transactionId)) {
        if (
          (await independentFileIdentity(source).catch(() => null)) ===
          sourceIdentity
        )
          await persist();
        return state.receipts[request.transactionId];
      }
      const reject = (
        reason: CommitReceipt['reason'],
        p?: string,
      ): CommitReceipt => ({
        transactionId: request.transactionId,
        outcome: 'rejected',
        reason,
        path: p,
      });
      if (
        request.moves?.length ||
        request.mkdirs?.length ||
        (!resolvingContainer && request.trash?.length) ||
        request.restore?.length ||
        request.purge?.length
      )
        return reject('invalid');
      if (
        request.config &&
        request.config.expectedVersion !== state.config.version
      )
        return reject('version-conflict');
      const nextFiles = new Map(files);
      const nextResources = new Map(resources);
      const privateResources = { ...state.resources };
      for (const item of request.trash ?? []) {
        const previous = files.get(item.path);
        if (!previous || memberVersion(previous) !== item.expectedVersion)
          return reject('version-conflict', item.path);
        nextFiles.delete(item.path);
      }

      for (const write of request.writes ?? []) {
        const p = normalizeWorkspacePath(write.path);
        if (
          (!isCanvasPath(p) && !isDocumentPath(p)) ||
          (markdown && p !== 'document.verd-doc.json')
        )
          return reject('invalid', p);
        const previous = files.get(p);
        if (
          (previous ? memberVersion(previous) : null) !== write.expectedVersion
        )
          return reject('version-conflict', p);
        const value: unknown = JSON.parse(
          bytes(write.content).toString('utf8'),
        );
        if (!isWorkspaceFile(value)) return reject('invalid', p);
        if (previous && workspaceFileId(previous) !== workspaceFileId(value))
          return reject('invalid', p);
        if ((value.format === 'verd-frame') !== isCanvasPath(p))
          return reject('invalid', p);
        nextFiles.set(p, value);
      }
      const identities = [...nextFiles.values()].map(workspaceFileId);
      if (
        new Set(identities).size !== identities.length ||
        !identities.includes(rootFileId)
      )
        return reject('invalid');
      for (const write of request.resourceWrites ?? []) {
        const key = normalizeResourceKey(write.path);
        const prior = key.startsWith('history/')
          ? state.resources[key]
            ? Buffer.from(state.resources[key], 'base64')
            : undefined
          : resources.get(key);
        if ((prior ? resourceVersion(prior) : null) !== write.expectedVersion)
          return reject('version-conflict', key);
        if (key.startsWith('history/'))
          privateResources[key] = bytes(write.content).toString('base64');
        else if (markdown) return reject('invalid', key);
        else nextResources.set(key, bytes(write.content));
      }
      const current = await fileVersion(source);
      if (current?.identity !== sourceIdentity || current.digest !== baseline)
        return reject(
          'version-conflict',
          request.writes?.[0]?.path ?? memberPath(files.values().next().value!),
        );
      const contentChanged =
        !!request.writes?.length ||
        !!request.trash?.length ||
        (request.resourceWrites ?? []).some((w) =>
          w.path.startsWith('assets/'),
        );
      if (contentChanged) {
        const content = serialize(nextFiles, nextResources);
        if (
          !markdown &&
          !(await parseWorkspacePackage(JSON.parse(content.toString('utf8'))))
        )
          return reject('invalid');
        await fs.mkdir(stateDirectory, { recursive: true });
        await fs.access(source, constants.W_OK);
        const nextIdentity = await replaceFile(
          source,
          content,
          baseline,
          sourceIdentity,
          path.join(stateDirectory, 'before-save'),
        );
        if (!nextIdentity)
          return reject('version-conflict', request.writes?.[0]?.path);
        sourceIdentity = nextIdentity;
        baseline = hash(content);
        files = nextFiles;
        resources = nextResources;
        nextResources.forEach((value, key) => knownResources.set(key, value));
      }
      const receipt: CommitReceipt = {
        transactionId: request.transactionId,
        outcome: 'applied',
        versions: Object.fromEntries(
          (request.writes ?? []).map((w) => [
            w.path,
            memberVersion(files.get(w.path)!),
          ]),
        ),
        resourceVersions: Object.fromEntries(
          (request.resourceWrites ?? []).map((w) => [
            w.path,
            resourceVersion(bytes(w.content)),
          ]),
        ),
      };
      state = {
        ...state,
        resources: privateResources,
        session: request.session ?? state.session,
        config: request.config
          ? { value: request.config.value, version: state.config.version + 1 }
          : state.config,
        receipts: { ...state.receipts, [request.transactionId]: receipt },
      };
      await persist();
      listeners.forEach((fn) => fn());
      return receipt;
    });
  const host: WorkspaceHost = {
    storageKind: 'filesystem',
    capabilities: {
      pickWorkspace: false,
      openBuiltinWorkspace: false,
      openPatternWorkspace: false,
    },
    readGlobalConfig: async () => ({ version: 0, value: {} }),
    writeGlobalConfig: async () => {
      throw new Error('独立文件不提供全局设置');
    },
    openWorkspace: async () => handle,
    readSnapshot: (h) => {
      assertHandle(h);
      return enqueue(async () => {
        await refresh();
        return snapshot();
      });
    },
    readFile: (h, p) => {
      assertHandle(h);
      return enqueue(async () => {
        await refresh();
        const f = files.get(p);
        if (!f) throw new Error('Unknown virtual file');
        return {
          path: p,
          version: memberVersion(f),
          content: Buffer.from(json(f)),
        };
      });
    },
    readResource: async (h, input) => {
      assertHandle(h);
      const key = normalizeResourceKey(input);
      const content =
        key.startsWith('history/') && state.resources[key]
          ? Buffer.from(state.resources[key], 'base64')
          : resources.get(key);
      if (!content) throw new Error('Unknown resource');
      return { path: key, version: resourceVersion(content), content };
    },
    commit: (h, request) => {
      assertHandle(h);
      return commit(request);
    },
    resolveConflict: async (h, request) => {
      assertHandle(h);
      if (request.action !== 'load-disk')
        throw new Error('Resolve conflicts for the whole external file');
      await enqueue(refresh);
      return { transactionId: request.transactionId, outcome: 'applied' };
    },
    subscribe: (h, listener) => {
      assertHandle(h);
      const fn = () => listener({});
      listeners.add(fn);
      let observed: string | undefined;
      const timer = setInterval(() => {
        // Metadata is only a change hint. Snapshot/commit versions still hash the actual bytes.
        void fs.stat(source).then((stat) => {
          const hint = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
          if (hint !== observed) {
            observed = hint;
            fn();
          }
        }, fn);
      }, 1000);
      timer.unref();
      return () => {
        clearInterval(timer);
        listeners.delete(fn);
      };
    },
    closeWorkspace: async (h) => {
      assertHandle(h);
    },
  };
  return {
    get source() {
      return source;
    },
    binding,
    host,
    warnings: () => [...warnings],
    async rename(stem: string) {
      return enqueue(async () => {
        if (
          typeof stem !== 'string' ||
          !stem.trim() ||
          /^[. ]+$/.test(stem) ||
          /[<>:"/\\|?*]/u.test(stem) ||
          [...stem].some((char) => char.charCodeAt(0) < 32) ||
          /[. ]$/.test(stem) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
        )
          throw new Error('请输入有效的文件名');
        const oldName = path.basename(source);
        const name = stem + splitIndependentFileName(oldName).extension;
        if (oldName === name) return name;
        const destination = path.join(path.dirname(source), name);
        return withFilePathsLocked(source, destination, async () => {
          const current = await fileVersion(source);
          if (
            current?.identity !== sourceIdentity ||
            current.digest !== baseline
          )
            throw new Error('原文件已变化，请处理冲突后重试');
          await checkBoundary(source);
          await persist();
          const previous = stateDirectory;
          const target = stateDirectoryFor(destination);
          const staged = await fs.mkdtemp(path.join(stateRoot, '.rename-'));
          const previousTarget = path.join(staged, 'previous-target');
          const replacement = path.join(staged, 'replacement');
          let published = false;
          let moved = false;
          let recoverable = false;
          try {
            await fs.cp(previous, replacement, { recursive: true });
            await fs.rename(target, previousTarget).catch((cause) => {
              if (!isMissing(cause)) throw cause;
            });
            await fs.rename(replacement, target);
            published = true;
            await moveIndependentFile(source, destination, current);
            moved = true;
            source = destination;
            stateDirectory = target;
            binding.displayName = name;
            await fs
              .rm(previous, { recursive: true, force: true })
              .catch(() => {});
            return name;
          } catch (cause) {
            try {
              if (!moved) {
                if (published)
                  await fs.rm(target, { recursive: true, force: true });
                await fs.rename(previousTarget, target).catch((cause) => {
                  if (!isMissing(cause)) throw cause;
                });
              }
            } catch (rollbackError) {
              recoverable = true;
              throw rollbackError;
            }
            throw cause;
          } finally {
            if (!recoverable)
              await fs
                .rm(staged, { recursive: true, force: true })
                .catch(() => {});
          }
        });
      });
    },
    async loadDisk() {
      await enqueue(async () => {
        const next = await independentFileIdentity(source);
        await refresh();
        sourceIdentity = next;
      });
    },
    /** Explicit resolution retains a private copy, then rebases the entire local candidate. */
    async overwrite(local: { file: WorkspaceFile; path: string }[]) {
      await enqueue(async () => {
        const next = await independentFileIdentity(source);
        await refresh();
        sourceIdentity = next;
      });
      resolvingContainer = true;
      rootFileId = binding.rootFileId;
      let recovery:
        Awaited<ReturnType<typeof openWorkspaceSession>> | undefined;
      try {
        recovery = await openWorkspaceSession(host, handle);
        const localIds = new Set(
          local.map((item) => workspaceFileId(item.file)),
        );
        const result = await recovery.apply({
          type: 'batch',
          files: local,
          removeIds: [...files.values()]
            .map(workspaceFileId)
            .filter((id) => !localIds.has(id)),
          resources: markdown
            ? []
            : [...knownResources].map(([key, content]) => ({
                assetId: key.slice(7),
                content,
              })),
        });
        if (!result.ok || !(await recovery.flush()))
          throw new Error(
            result.diagnostics.map((item) => item.message).join('; ') ||
              '无法保存当前内容',
          );
        return { transactionId: randomUUID(), outcome: 'applied' as const };
      } finally {
        recovery?.dispose();
        resolvingContainer = false;
      }
    },
    async saveCopy(
      destination: string,
      local: { file: WorkspaceFile; path: string }[],
    ) {
      const content = serialize(
        new Map(local.map((item) => [item.path, item.file])),
        markdown ? resources : knownResources,
      );
      if (path.resolve(destination) === source)
        throw new Error('副本需要使用不同的文件名');
      const existing = await fs
        .readFile(destination)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
      if (
        !(await replaceFile(
          destination,
          content,
          existing === null ? null : hash(existing),
        ))
      )
        throw new Error('副本目标已发生变化');
    },
    async readImage(href: string) {
      const url = new URL(href, pathToFileURL(source));
      if (url.protocol !== 'file:') throw new Error('Only local images');
      const filename = await fs.realpath(fileURLToPath(url));
      await checkBoundary(filename);
      const referenced = (value: unknown): boolean => {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.some(referenced);
        const object = value as Record<string, unknown>;
        return object['src'] === href || Object.values(object).some(referenced);
      };
      if (![...files.values()].some(referenced))
        throw new Error('只能读取当前文件引用的图片');
      if (!/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(filename))
        throw new Error('Unsupported image');
      const content = await fs.readFile(filename);
      if (content.byteLength > 10 * 1024 * 1024)
        throw new Error('图片超过 10 MiB 上限');
      return new Uint8Array(content);
    },
  };
}
