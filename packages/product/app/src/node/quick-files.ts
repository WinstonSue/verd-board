import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFrameCell, type FrameSnapshot } from '@sue/board-core';
import { createMindFrameSnapshot } from '@sue/board-mind';
import { createWorkflowFrameSnapshot } from '@sue/board-workflow';
import { createArchitectureFrameSnapshot } from '@sue/board-architecture';
import {
  createUmlClassFrameSnapshot,
  createUmlSequenceFrameSnapshot,
} from '@sue/board-uml';
import {
  createFrameFile,
  frameFileFor,
  isCanvasPath,
  quickDiagramKinds,
  type QuickFileEntry,
  type QuickFileKind,
} from '@sue/verd-board-workspace';

const markdownPath = (filename: string) => /\.(md|markdown)$/i.test(filename);
const internalFile = (name: string) =>
  name === '.DS_Store' || /^\.[\da-f-]{36}\.tmp$/i.test(name);

export function defaultQuickEditDirectory(repository?: string) {
  if (repository) return path.join(repository, 'tmp/verdboard/quick-edit');
  const home = os.homedir();
  const appData =
    process.platform === 'darwin'
      ? path.join(home, 'Library/Application Support')
      : process.platform === 'win32'
        ? process.env['APPDATA'] || path.join(home, 'AppData/Roaming')
        : process.env['XDG_CONFIG_HOME'] || path.join(home, '.config');
  return path.join(appData, 'VerdBoard', 'quick-edit');
}

export function containsQuickPath(root: string, source: string) {
  const relative = path.relative(root, source);
  return (
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}

export async function resolveQuickPath(root: string, relative: string) {
  if (
    typeof relative !== 'string' ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    (relative &&
      relative
        .split('/')
        .some(
          (part) =>
            !part ||
            part === '.' ||
            part === '..' ||
            part.includes(':') ||
            internalFile(part),
        ))
  )
    throw new Error('无效的快速创建路径');
  const base = await fs.realpath(root);
  const target = path.join(base, relative);
  const location = await fs.realpath(target);
  if (!containsQuickPath(base, location) || location !== target)
    throw new Error('文件不在快速创建目录内');
  return location;
}

export async function listQuickFiles(
  root: string,
  directory = '',
): Promise<QuickFileEntry[]> {
  let location: string;
  try {
    location = await resolveQuickPath(root, directory);
  } catch (error) {
    if (!directory && (error as NodeJS.ErrnoException).code === 'ENOENT')
      return [];
    throw error;
  }
  const children = await fs.readdir(location, { withFileTypes: true });
  const entries = await Promise.all(
    children.flatMap((child) => {
      if (internalFile(child.name) || (!child.isFile() && !child.isDirectory()))
        return [];
      return [
        fs.lstat(path.join(location, child.name)).then(
          (entry): QuickFileEntry | null => {
            if (!entry.isFile() && !entry.isDirectory()) return null;
            return {
              name: child.name,
              path: directory ? `${directory}/${child.name}` : child.name,
              kind: entry.isDirectory()
                ? 'directory'
                : markdownPath(child.name)
                  ? 'document'
                  : isCanvasPath(child.name)
                    ? 'canvas'
                    : 'other',
              modifiedAt: entry.mtimeMs,
            };
          },
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          },
        ),
      ];
    }),
  );
  return entries
    .filter((entry): entry is QuickFileEntry => entry !== null)
    .sort(
      (left, right) =>
        Number(right.kind === 'directory') -
          Number(left.kind === 'directory') ||
        right.modifiedAt - left.modifiedAt ||
        left.name.localeCompare(right.name),
    );
}

async function publishQuickFile(
  directory: string,
  stem: string,
  suffix: string,
  content: (name: string) => string | Uint8Array,
) {
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  for (let number = 1; ; number++) {
    const name = number === 1 ? stem : `${stem} ${number}`;
    const filename = path.join(directory, name + suffix);
    const bytes = content(name);
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes).finally(() => handle.close());
      await fs.link(temporary, filename);
      return filename;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

export async function createQuickEditFile(
  directory: string,
  kind: QuickFileKind,
) {
  const diagram = quickDiagramKinds.find((entry) => entry.kind === kind);
  if (kind !== 'document' && !diagram) throw new Error('不支持的新建文件类型');
  await fs.mkdir(directory, { recursive: true });
  if (kind === 'document')
    return publishQuickFile(directory, '未命名文档', '.md', () => '\n');
  const id = randomUUID();
  const factories: Partial<
    Record<QuickFileKind, (frame: string, anchor: string) => FrameSnapshot>
  > = {
    mind: createMindFrameSnapshot,
    workflow: createWorkflowFrameSnapshot,
    architecture: createArchitectureFrameSnapshot,
    'uml-class': createUmlClassFrameSnapshot,
    'uml-sequence': createUmlSequenceFrameSnapshot,
  };
  const snapshot = factories[kind]?.(id, randomUUID());
  const frame = snapshot
    ? frameFileFor(snapshot.store, id)
    : createFrameFile(createFrameCell(id));
  return publishQuickFile(
    directory,
    `未命名${kind === 'canvas' ? '画布' : diagram!.zh}`,
    '.verd',
    (name) =>
      JSON.stringify({ ...frame, frame: { ...frame.frame, name } }, null, 2) +
      '\n',
  );
}
