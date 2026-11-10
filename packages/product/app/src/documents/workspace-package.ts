import { parseAssetLink } from '@sue/board-common';
import {
  isWorkspaceFile,
  workspaceFileId,
  type WorkspaceFile,
} from './document-files';
import {
  parseWorkspaceExport,
  workspaceExportBundle,
} from './workspace-references';

export const WORKSPACE_PACKAGE_MAX_BYTES = 256 * 1024 * 1024;
export const WORKSPACE_PACKAGE_MAX_JSON_BYTES = 384 * 1024 * 1024;
export const WORKSPACE_PACKAGE_MAX_ENTRIES = 10_000;
const ASSET_ID = /^[a-f0-9]{64}\.[a-z0-9]+$/;

export interface WorkspaceResource {
  assetId: string;
  content: Uint8Array;
}
export interface WorkspaceExportBundleV2 {
  format: 'verd-canvas-bundle';
  version: 2;
  rootFileId: string;
  files: WorkspaceFile[];
  resources: {
    assetId: string;
    encoding: 'base64';
    byteLength: number;
    data: string;
  }[];
}
export interface PreparedWorkspacePackage {
  files: WorkspaceFile[];
  rootFileId: string;
  resources: WorkspaceResource[];
}
export function workspaceAssetPath(assetId: string): string {
  if (!ASSET_ID.test(assetId)) throw new Error('Invalid asset identity');
  return '.verd-resources/assets/' + assetId;
}
export function collectWorkspaceAssetIds(
  files: readonly WorkspaceFile[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (key === 'src' && value.startsWith('verd-asset:')) {
        const assetId = value.slice(
          'verd-asset:.verd-resources/assets/'.length,
        );
        if (value !== 'verd-asset:' + workspaceAssetPath(assetId))
          throw new Error('Invalid asset reference');
        ids.add(assetId);
      } else {
        const link = ['href', 'link'].includes(key)
          ? parseAssetLink(value)
          : null;
        if (link) {
          workspaceAssetPath(link.assetId);
          ids.add(link.assetId);
        }
      }
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => visit(child, key));
    }
  };
  files.forEach((file) => visit(file));
  return ids;
}
export async function validateWorkspaceResources(
  resources: readonly WorkspaceResource[],
): Promise<void> {
  const ids = new Set<string>();
  let total = 0;
  if (resources.length > WORKSPACE_PACKAGE_MAX_ENTRIES)
    throw new Error('Package exceeds entry limit');
  for (const resource of resources) {
    workspaceAssetPath(resource.assetId);
    if (ids.has(resource.assetId)) throw new Error('Duplicate asset identity');
    ids.add(resource.assetId);
    total += resource.content.byteLength;
    if (total > WORKSPACE_PACKAGE_MAX_BYTES)
      throw new Error('Package exceeds 256 MiB');
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new Uint8Array(resource.content).buffer,
        ),
      ),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== resource.assetId.split('.')[0])
      throw new Error('Attachment digest mismatch');
  }
}
function validatePackageFiles(files: WorkspaceFile[], rootFileId: string) {
  if (!files.length || !files.every(isWorkspaceFile))
    throw new Error('Invalid package files');
  const ids = files.map(workspaceFileId);
  if (new Set(ids).size !== ids.length || !ids.includes(rootFileId))
    throw new Error('Invalid package file identity');
}
function validatePackageClosure(
  files: WorkspaceFile[],
  resources: WorkspaceResource[],
) {
  const available = new Set(resources.map((resource) => resource.assetId));
  for (const id of collectWorkspaceAssetIds(files))
    if (!available.has(id)) throw new Error('Missing package resource: ' + id);
  if (
    files.length + resources.length > WORKSPACE_PACKAGE_MAX_ENTRIES ||
    new TextEncoder().encode(JSON.stringify(files)).byteLength +
      resources.reduce(
        (sum, resource) => sum + resource.content.byteLength,
        0,
      ) >
      WORKSPACE_PACKAGE_MAX_BYTES
  )
    throw new Error('Package exceeds limits');
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
/** A v2 exchange package is never stored as a native workspace file. */
export async function createWorkspacePackage(
  files: WorkspaceFile[],
  rootFileId: string,
  read: (path: string) => Promise<Uint8Array>,
): Promise<
  | WorkspaceFile
  | ReturnType<typeof workspaceExportBundle>
  | WorkspaceExportBundleV2
> {
  validatePackageFiles(files, rootFileId);
  const resources: WorkspaceResource[] = [];
  for (const assetId of [...collectWorkspaceAssetIds(files)].sort())
    resources.push({
      assetId,
      content: new Uint8Array(await read(workspaceAssetPath(assetId))),
    });
  if (!resources.length)
    return files.length === 1 && files[0].format === 'verd-document'
      ? files[0]
      : workspaceExportBundle(files, rootFileId);
  await validateWorkspaceResources(resources);
  validatePackageClosure(files, resources);
  return {
    format: 'verd-canvas-bundle',
    version: 2,
    rootFileId,
    files,
    resources: resources.map(({ assetId, content }) => ({
      assetId,
      encoding: 'base64',
      byteLength: content.byteLength,
      data: encodeBase64(content),
    })),
  };
}
/** Recognized but corrupt v2 packages throw; callers must not try legacy readers. */
export async function parseWorkspacePackage(
  value: unknown,
): Promise<PreparedWorkspacePackage | null> {
  if (!value || typeof value !== 'object') return null;
  const bundle = value as Partial<WorkspaceExportBundleV2>;
  if (bundle.format !== 'verd-canvas-bundle' || bundle.version !== 2) {
    const files = parseWorkspaceExport(value);
    if (!files?.length) return null;
    const root = (value as { rootFileId?: unknown }).rootFileId;
    return {
      files,
      rootFileId: typeof root === 'string' ? root : workspaceFileId(files[0]),
      resources: [],
    };
  }
  if (
    !Array.isArray(bundle.files) ||
    typeof bundle.rootFileId !== 'string' ||
    !Array.isArray(bundle.resources)
  )
    throw new Error('Invalid v2 package');
  validatePackageFiles(bundle.files, bundle.rootFileId);
  if (
    bundle.files.length + bundle.resources.length >
    WORKSPACE_PACKAGE_MAX_ENTRIES
  )
    throw new Error('Package exceeds entry limit');
  const resources: WorkspaceResource[] = [];
  let total = 0;
  for (const resource of bundle.resources) {
    if (
      !resource ||
      resource.encoding !== 'base64' ||
      typeof resource.data !== 'string' ||
      !Number.isSafeInteger(resource.byteLength) ||
      resource.byteLength < 0 ||
      resource.byteLength > WORKSPACE_PACKAGE_MAX_BYTES ||
      resource.data.length !== 4 * Math.ceil(resource.byteLength / 3) ||
      /[^A-Za-z0-9+/=]/.test(resource.data)
    )
      throw new Error('Invalid resource encoding');
    workspaceAssetPath(resource.assetId);
    total += resource.byteLength;
    if (total > WORKSPACE_PACKAGE_MAX_BYTES)
      throw new Error('Package exceeds 256 MiB');
    // Scan the alphabet without a repeating-group regexp: V8 can exhaust its
    // regexp stack on valid multi-MiB input. atob and the canonical re-encode
    // still reject misplaced padding and nonzero unused pad bits.
    const binary = atob(resource.data);
    if (binary.length !== resource.byteLength || btoa(binary) !== resource.data)
      throw new Error('Attachment length mismatch');
    const content = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      content[index] = binary.charCodeAt(index);
    resources.push({ assetId: resource.assetId, content });
  }
  await validateWorkspaceResources(resources);
  validatePackageClosure(bundle.files, resources);
  return { files: bundle.files, rootFileId: bundle.rootFileId, resources };
}
