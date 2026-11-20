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
} from '@sue/verd-board-app/headless';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import type { ExternalFileBinding } from '../src/external-file-types';

const hash = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2);
const bytes = (value: string | Uint8Array) => Buffer.from(value);

/** Replace only after checking the source again, preserving its permissions. */
async function replaceFile(
  filename: string,
  content: Uint8Array,
  expected: string | null,
) {
  const temporary = path.join(
    path.dirname(filename),
    `.${path.basename(filename)}.${randomUUID()}.tmp`,
  );
  try {
    const before = await fs
      .readFile(filename)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if ((before === null ? null : hash(before)) !== expected) return false;
    const mode = await fs
      .stat(filename)
      .then((s) => s.mode)
      .catch(() => 0o600);
    await fs.writeFile(temporary, content, { flag: 'wx', mode });
    const current = await fs
      .readFile(filename)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if ((current === null ? null : hash(current)) !== expected) return false;
    await fs.rename(temporary, filename);
    return true;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

interface PrivateState {
  documentId: string;
  sourceDigest?: string;
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
) {
  const source = await fs.realpath(sourcePath);
  if (!(await fs.stat(source)).isFile()) throw new Error('不是普通文件');
  const markdown = /\.(md|markdown)$/i.test(source);
  if (!markdown && !isCanvasPath(source)) throw new Error('不支持的文件类型');
  const stateDirectory = path.join(stateRoot, hash(source));
  const statePath = path.join(stateDirectory, 'state.json');
  let state: PrivateState = await fs
    .readFile(statePath, 'utf8')
    .then(JSON.parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return {
        documentId: randomUUID(),
        session: null,
        config: { version: 0, value: {} },
        resources: {},
        receipts: {},
      };
    });
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
    state = { ...state, sourceDigest: baseline, generation };
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
    if ((await fs.stat(source)).size > WORKSPACE_PACKAGE_MAX_JSON_BYTES)
      throw new Error('文件超过 384 MiB 上限');
    const raw = await fs.readFile(source);
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
      if (hash(await fs.readFile(source)) !== baseline)
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
        await fs.copyFile(source, path.join(stateDirectory, 'before-save'));
        if (!(await replaceFile(source, content, baseline)))
          return reject('version-conflict', request.writes?.[0]?.path);
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
    source,
    binding,
    host,
    warnings: () => [...warnings],
    /** Explicit resolution retains a private copy, then rebases the entire local candidate. */
    async overwrite(local: { file: WorkspaceFile; path: string }[]) {
      await enqueue(refresh);
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
