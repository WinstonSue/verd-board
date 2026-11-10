export type { StorageAdapter, SaveStatus } from './storage-adapter';
export * from './frames/frame-files';
export * from './documents/document-files';
export * from './documents/workspace-references';
export * from './session/target-navigation';
export * from './frames/workspace-storage';
export * from './host/workspace-host';
export * from './host/workspace-git';
export { createMemoryWorkspaceHost } from './host/memory-workspace-host';
export { createWebWorkspaceHost } from './host/web-workspace-host';
export { createDesktopWorkspaceHost } from './host/desktop-workspace-host';
export * from './session/workspace-session';
export * from './session/workspace-actions';
export * from './canvas/canvas-session';
export { createWebStorageAdapter } from './web-adapter';
export {
  migrateLegacyCellWorkspace,
  parseLegacyFrameDocument,
} from './migration/cell-workspace';
export { WorkspaceApp, type WorkspaceAppProps } from './workspace-app';

export * from './documents/knowledge-index';
export * from './workspace-skills';

export * from './documents/workspace-package';

export * from './host/workspace-versions';
export {
  createGitVersionProvider,
  withGitVersioning,
} from './git/version-provider';

export * from './host/service-workspace-host';
export * from './host/browser-backup';
export * from './host/service-protocol';
