import {
  parseWorkspacePackage,
  collectWorkspaceAssetIds,
  workspaceAssetPath,
  type WorkspaceResource,
} from '@sue/verd-board-workspace';
import { unzip, zip, zipSync, strToU8, strFromU8 } from 'fflate';
import {
  parseMarkdownToTextDocument,
  serializeTextDocumentToMarkdown,
} from '@sue/board-markdown-to-text';
import { createDocumentHeadingSlugger } from '@sue/board-react-text';
import { createWorkspaceLink, type BoardTextNode } from '@sue/board-common';
import { normalizeWorkspacePath } from '@sue/verd-board-workspace';
import { isSkillDocumentPath } from '@sue/verd-board-workspace';
import type { DocumentFileV1, WorkspaceFile } from '@sue/verd-board-workspace';
import { workspaceFileId, isWorkspaceFile } from '@sue/verd-board-workspace';
const MAX = 256 * 1024 * 1024;
const decodePath = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const safePath = (path: string) => {
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').includes('..')
  )
    throw new Error('Unsafe archive path: ' + path);
  return normalizeWorkspacePath(path);
};
function resolvePath(source: string, target: string) {
  const parts = source.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part) parts.push(part);
  }
  return parts.join('/');
}
const mimeFor = (path: string) =>
  ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  })[path.split('.').pop()?.toLowerCase() ?? ''];
function dataURL(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}
export async function importMarkdownCollection(input: readonly File[]) {
  const entries = new Map<string, Uint8Array>();
  let total = 0;
  for (const file of input) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX) throw new Error('Import exceeds 100 MiB');
    if (/\.zip$/i.test(file.name)) {
      let count = 0;
      const archive = await new Promise<Record<string, Uint8Array>>(
        (resolve, reject) =>
          unzip(
            bytes,
            {
              filter: (item) => {
                total += item.originalSize;
                if (++count > 10000 || total > MAX)
                  throw new Error('Archive exceeds limits');
                safePath(item.name);
                return !item.name.endsWith('/');
              },
            },
            (error, result) => (error ? reject(error) : resolve(result)),
          ),
      );
      if (
        Object.values(archive).reduce(
          (sum, value) => sum + value.byteLength,
          0,
        ) > MAX
      )
        throw new Error('Archive exceeds limits');
      for (const [path, data] of Object.entries(archive))
        entries.set(safePath(path), data);
    } else {
      total += bytes.length;
      if (total > MAX) throw new Error('Import exceeds 100 MiB');
      entries.set(safePath(file.webkitRelativePath || file.name), bytes);
    }
  }
  const warnings: string[] = [];
  const nativeManifest = entries.get('verd-workspace.json');
  if (nativeManifest) {
    const manifest = JSON.parse(strFromU8(nativeManifest)) as {
      format: string;
      version: number;
      files: { path: string; workspacePath: string }[];
    };
    if (
      manifest.format !== 'verd-portable-workspace' ||
      ![1, 2].includes(manifest.version) ||
      !Array.isArray(manifest.files)
    )
      throw new Error('Unsupported portable archive manifest');
    const files = manifest.files.map((item) => {
      const bytes = entries.get(safePath(item.path));
      if (!bytes) throw new Error('Missing native file: ' + item.path);
      const file: unknown = JSON.parse(strFromU8(bytes));
      if (!isWorkspaceFile(file)) throw new Error('Invalid native file');
      return { file, path: safePath(item.workspacePath) };
    });
    if (!files.length) throw new Error('Empty portable workspace');
    const resources = [...entries]
      .filter(([name]) => name.startsWith('assets/'))
      .map(([name, content]) => ({
        path: '.verd-resources/' + safePath(name),
        content,
        expectedVersion: null,
      }));
    for (const resource of resources) {
      const name = resource.path.split('/').pop()!;
      if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(name))
        throw new Error('Invalid asset identity');
      const digest = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            resource.content as Uint8Array<ArrayBuffer>,
          ),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      if (digest !== name.split('.')[0])
        throw new Error('Attachment digest mismatch');
    }
    if (manifest.version === 2) {
      const paths = new Set(resources.map((resource) => resource.path));
      for (const assetId of collectWorkspaceAssetIds(
        files.map((item) => item.file),
      ))
        if (!paths.has(workspaceAssetPath(assetId)))
          throw new Error('Missing package resource: ' + assetId);
    }
    return { files, warnings, resources };
  }

  const nativeFiles: { file: WorkspaceFile; path: string }[] = [];
  const nativeResources = new Map<string, WorkspaceResource>();
  for (const [path, bytes] of entries) {
    if (/\.csv$/i.test(path)) warnings.push(`CSV 数据库暂不转换：${path}`);
    if (!/\.json$/i.test(path)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(strFromU8(bytes));
    } catch {
      continue;
    }
    {
      const prepared = await parseWorkspacePackage(parsed);
      for (const resource of prepared?.resources ?? [])
        nativeResources.set(resource.assetId, resource);
      const native = prepared?.files;
      if (native)
        native.forEach((file, index) => {
          const stem = path.replace(/\.verd(?:(?:-doc)?\.json)?$|\.json$/i, '');
          const suffix =
            file.format === 'verd-document' ? '.verd-doc.json' : '.verd';
          nativeFiles.push({
            file,
            path: safePath(
              stem + (native.length > 1 ? '-' + index : '') + suffix,
            ),
          });
        });
    }
  }
  const markdown = [...entries.keys()].filter(
    (path) => /\.(md|markdown)$/i.test(path) && !isSkillDocumentPath(path),
  );
  const ids = new Map(markdown.map((path) => [path, crypto.randomUUID()]));
  const resolveNote = (source: string, target: string) => {
    const [path, heading] = target.split('#');
    const decoded = decodePath(path ?? '');
    const relative = resolvePath(source, decoded);
    const candidates = markdown.filter(
      (item) =>
        item === relative ||
        item === relative + '.md' ||
        item === relative + '.markdown',
    );
    const fallback = candidates.length
      ? candidates
      : markdown.filter(
          (item) =>
            item
              .split('/')
              .pop()
              ?.replace(/\.(md|markdown)$/i, '') === decoded,
        );
    if (!decoded)
      return createWorkspaceLink(
        heading
          ? {
              kind: 'heading',
              fileId: ids.get(source)!,
              slug: createDocumentHeadingSlugger()(decodePath(heading)),
            }
          : { kind: 'file', fileId: ids.get(source)! },
      );
    if (fallback.length !== 1) {
      warnings.push(`无法唯一定位链接：${source} → ${target}`);
      return target;
    }
    return createWorkspaceLink(
      heading
        ? {
            kind: 'heading',
            fileId: ids.get(fallback[0])!,
            slug: createDocumentHeadingSlugger()(decodePath(heading)),
          }
        : { kind: 'file', fileId: ids.get(fallback[0])! },
    );
  };
  const files = markdown.map((path) => {
    let markdownText = strFromU8(entries.get(path)!);
    markdownText = markdownText.replace(
      /(!?)\[\[([^\]]+)\]\]/g,
      (_all, prefix: string, value: string) => {
        const [target, alias] = value.split('|');
        return prefix && mimeFor(target)
          ? `![${alias ?? target}](${target})`
          : `${prefix}[${alias ?? target}](${resolveNote(path, target)})`;
      },
    );
    markdownText = markdownText.replace(
      /(!?)\[([^\]]*)\]\(([^)]+)\)/g,
      (all, prefix: string, label: string, href: string) => {
        if (/^(https?:|mailto:|data:|verd:)/i.test(href)) return all;
        if (prefix) {
          const original = resolvePath(path, href);
          const target = entries.has(original)
            ? original
            : resolvePath(path, decodePath(href));
          const image = entries.get(target),
            mime = mimeFor(target);
          if (image && mime) return `![${label}](${dataURL(image, mime)})`;
          warnings.push(`缺失或不支持的附件：${target}`);
          return all;
        }
        return `[${label}](${resolveNote(path, href)})`;
      },
    );
    const id = ids.get(path)!;
    const parsed = parseMarkdownToTextDocument(markdownText, { id });
    warnings.push(...parsed.warnings.map((item) => `${path}: ${item.message}`));
    const file: DocumentFileV1 = {
      format: 'verd-document',
      version: 1,
      id,
      title: path
        .split('/')
        .pop()!
        .replace(/\.(md|markdown)$/i, ''),
      text: parsed.document,
    };
    return { file, path: path.replace(/\.(md|markdown)$/i, '.verd-doc.json') };
  });
  if (!files.length && !nativeFiles.length)
    throw new Error('No supported documents found');
  return {
    files: [...files, ...nativeFiles],
    warnings,
    resources: [...nativeResources.values()].map((resource) => ({
      path: workspaceAssetPath(resource.assetId),
      content: resource.content,
      expectedVersion: null,
    })),
  };
}
function preparePortableEntries(
  files: readonly WorkspaceFile[],
  paths: ReadonlyMap<string, string>,
  assets: ReadonlyMap<string, Uint8Array> = new Map(),
) {
  const entries: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  for (const [src, bytes] of assets)
    entries[safePath('assets/' + src.split('/').pop())] = bytes;
  const pathMap = new Map(
    files.map((file) => [
      workspaceFileId(file),
      (
        paths.get(workspaceFileId(file)) ?? workspaceFileId(file) + '.verd'
      ).replace(/\.verd-doc\.json$/, '.md'),
    ]),
  );
  const relative = (source: string, target: string) => {
    const left = source.split('/').slice(0, -1),
      right = target.split('/');
    while (left.length && right.length && left[0] === right[0]) {
      left.shift();
      right.shift();
    }
    return [...left.map(() => '..'), ...right].join('/');
  };
  for (const [fileIndex, file] of files.entries()) {
    const original =
      paths.get(workspaceFileId(file)) ??
      workspaceFileId(file) +
        (file.format === 'verd-document' ? '.verd-doc.json' : '.verd');
    entries[safePath('native/' + original)] = strToU8(
      JSON.stringify(file, null, 2),
    );
    if (file.format === 'verd-document') {
      const copy = structuredClone(file.text);
      let imageIndex = 0;
      const visit = (node: BoardTextNode) => {
        if (
          ['image', 'attachment'].includes(node.type) &&
          typeof node.attrs?.['src'] === 'string'
        ) {
          if (assets.has(node.attrs['src']))
            node.attrs['src'] = relative(
              pathMap.get(file.id)!,
              'assets/' + node.attrs['src'].split('/').pop(),
            );
          const match = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/i.exec(
            String(node.attrs['src']),
          );
          if (match) {
            const name = `attachments/${fileIndex}-${imageIndex++}.${match[1].split('/')[1]}`;
            entries[name] = Uint8Array.from(atob(match[2]), (c) =>
              c.charCodeAt(0),
            );
            node.attrs['src'] = relative(pathMap.get(file.id)!, name);
          }
        }
        for (const mark of node.marks ?? [])
          if (
            mark.type === 'link' &&
            typeof mark.attrs?.['href'] === 'string'
          ) {
            const match = /^verd:\/\/file\/([^#]+)(?:#(.*))?$/.exec(
              mark.attrs['href'],
            );
            const target = match && pathMap.get(decodeURIComponent(match[1]));
            if (target)
              mark.attrs['href'] =
                relative(pathMap.get(file.id)!, target) +
                (match?.[2] ? '#' + match[2] : '');
          }
        node.content?.forEach(visit);
      };
      visit(copy.content);
      const result = serializeTextDocumentToMarkdown(copy);
      warnings.push(...result.warnings.map((item) => item.message));
      entries[safePath(pathMap.get(file.id)!)] = strToU8(result.markdown);
    }
  }
  entries['verd-workspace.json'] = strToU8(
    JSON.stringify({
      format: 'verd-portable-workspace',
      version: assets.size ? 2 : 1,
      files: files.map((file) => {
        const path =
          paths.get(workspaceFileId(file)) ??
          workspaceFileId(file) +
            (file.format === 'verd-document' ? '.verd-doc.json' : '.verd');
        return { path: 'native/' + path, workspacePath: path };
      }),
    }),
  );
  entries['import-report.json'] = strToU8(
    JSON.stringify({ warnings }, null, 2),
  );
  return { entries, warnings };
}
export function portableArchive(
  files: readonly WorkspaceFile[],
  paths: ReadonlyMap<string, string>,
) {
  const { entries, warnings } = preparePortableEntries(files, paths);
  return { bytes: zipSync(entries, { level: 6 }), warnings };
}
export async function portableArchiveWithAssets(
  files: readonly WorkspaceFile[],
  paths: ReadonlyMap<string, string>,
  read: (path: string) => Promise<Uint8Array>,
) {
  const sources = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (typeof value === 'object')
      for (const child of Object.values(value)) {
        if (
          typeof child === 'string' &&
          /^verd-asset:\.verd-resources\/assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(
            child,
          )
        )
          sources.add(child);
        else if (
          typeof child === 'string' &&
          /^verd:\/\/asset\/[a-f0-9]{64}\.[a-z0-9]+(?:#page=\d+)?$/.test(child)
        )
          sources.add(
            'verd-asset:.verd-resources/assets/' +
              child.slice(13).split('#')[0],
          );
        else visit(child);
      }
  };
  files.forEach(visit);
  let total = 0;
  const assets = new Map<string, Uint8Array>();
  for (const source of sources) {
    const bytes = await read(source.slice(11));
    total += bytes.byteLength;
    if (total > MAX) throw new Error('资料包超过 256 MiB，请分批导出');
    assets.set(source, bytes);
  }
  const { entries, warnings } = preparePortableEntries(files, paths, assets);
  if (
    Object.keys(entries).length > 10000 ||
    Object.values(entries).reduce((sum, data) => sum + data.byteLength, 0) > MAX
  )
    throw new Error('资料包超过大小或文件数量限制');
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 0 }, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
  return { bytes, warnings };
}
