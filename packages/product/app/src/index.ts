export type { StorageAdapter, SaveStatus } from './storage-adapter';
export * from './frames/frame-files';
export * from './documents/document-files';
export * from './documents/document-links';
export * from './documents/workspace-references';
export * from './frames/workspace-storage';
export * from './host/workspace-host';
export { createMemoryWorkspaceHost } from './host/memory-workspace-host';
export { createWebWorkspaceHost } from './host/web-workspace-host';
export { createDesktopWorkspaceHost } from './host/desktop-workspace-host';
export * from './session/workspace-session';
export * from './canvas/canvas-session';
export { createWebStorageAdapter } from './web-adapter';
export {
  migrateLegacyCellWorkspace,
  parseLegacyFrameDocument,
} from './migration/cell-workspace';
export { WorkspaceApp, type WorkspaceAppProps } from './workspace-app';
