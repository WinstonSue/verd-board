import type { WorkspaceFile } from '../documents/document-files';
import type { DiagramKind } from '../frames/frame-organization';
import type { WorkspaceHandle, WorkspaceHost } from './workspace-host';

export type QuickFileKind = 'document' | DiagramKind;
export const quickDiagramKinds = [
  { kind: 'canvas', zh: '白板', en: 'Whiteboard' },
  { kind: 'mind', zh: '思维导图', en: 'Mind map' },
  { kind: 'workflow', zh: '流程图', en: 'Flowchart' },
  { kind: 'architecture', zh: '架构图', en: 'Architecture' },
  { kind: 'uml-class', zh: 'UML 类图', en: 'UML class diagram' },
  { kind: 'uml-sequence', zh: 'UML 时序图', en: 'UML sequence diagram' },
] as const satisfies readonly { kind: DiagramKind; zh: string; en: string }[];

export interface QuickFileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'document' | 'canvas' | 'other';
  modifiedAt: number;
}

export interface ExternalFileBinding {
  handle: WorkspaceHandle;
  kind: 'markdown' | 'canvas';
  displayName: string;
  rootFileId: string;
}

export type ExternalFileResolution = 'load-disk' | 'keep-local' | 'save-copy';
export type ExternalFileCandidate = { file: WorkspaceFile; path: string }[];

/** Every container is tagged so document objects cannot collide with byte tags. */
export type ServiceValue =
  | null
  | boolean
  | number
  | string
  | { type: 'undefined' }
  | { type: 'bytes'; value: string }
  | { type: 'array'; value: ServiceValue[] }
  | { type: 'object'; value: [string, ServiceValue][] };

export function encodeServiceValue(value: unknown): ServiceValue {
  if (value === undefined) return { type: 'undefined' };
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  )
    return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes =
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { type: 'bytes', value: btoa(binary) };
  }
  if (Array.isArray(value))
    return { type: 'array', value: value.map(encodeServiceValue) };
  if (typeof value === 'object')
    return {
      type: 'object',
      value: Object.entries(value).map(([key, item]) => [
        key,
        encodeServiceValue(item),
      ]),
    };
  throw new Error('Unsupported service value');
}

export function decodeServiceValue(value: ServiceValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  switch (value.type) {
    case 'undefined':
      return undefined;
    case 'bytes':
      return Uint8Array.from(atob(value.value), (c) => c.charCodeAt(0));
    case 'array':
      return value.value.map(decodeServiceValue);
    case 'object':
      return Object.fromEntries(
        value.value.map(([key, item]) => [key, decodeServiceValue(item)]),
      );
    default:
      throw new Error('Invalid service value');
  }
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: string[];
}

export type ServiceHostApi = Pick<
  Required<WorkspaceHost>,
  | 'readGlobalConfig'
  | 'writeGlobalConfig'
  | 'openWorkspace'
  | 'activateWorkspace'
  | 'listWorkspaceHistory'
  | 'updateWorkspaceHistory'
  | 'readWorkspaceLocation'
  | 'revealWorkspaceLocation'
  | 'readBuiltinUpdate'
  | 'revealBuiltinBackups'
  | 'readSnapshot'
  | 'initializeAgent'
  | 'readFile'
  | 'readResource'
  | 'openResourceExternal'
  | 'commit'
  | 'resolveConflict'
  | 'closeWorkspace'
  | 'git'
  | 'versions'
> & {
  createWorkspace(request: {
    name: string;
    parentPath: string;
  }): ReturnType<NonNullable<WorkspaceHost['createWorkspace']>>;
  updateBuiltinWorkspace(
    handle: Parameters<NonNullable<WorkspaceHost['updateBuiltinWorkspace']>>[0],
    releaseId: string,
    options?: { backup: boolean; backupParent?: string },
  ): ReturnType<NonNullable<WorkspaceHost['updateBuiltinWorkspace']>>;
  browseDirectories(path?: string): Promise<DirectoryListing>;
  makeDirectory(parent: string, name: string): Promise<DirectoryListing>;
  importBrowserBackup(
    backup: BrowserBackup,
    parent: string,
  ): Promise<{ path: string; count: number }>;
};

export interface BrowserBackup {
  format: 'verd-browser-backup';
  version: 1;
  createdAt: number;
  origin: string;
  databases: {
    name: string;
    stores: { name: string; records: { key: unknown; value: unknown }[] }[];
  }[];
  files: { workspace: string; path: string; size: number; digest: string }[];
}

export type ServiceMethod = keyof ServiceHostApi;
export interface ServiceError {
  message: string;
  code?: string;
  diagnostic?: string;
}
