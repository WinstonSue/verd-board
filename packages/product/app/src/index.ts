export type { StorageAdapter, SaveStatus } from './storage-adapter';
export * from '@sue/verd-board-workspace';
export * from './frames/workspace-storage';
export { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
export { createWebWorkspaceHost } from './host/web-workspace-host';
export { createDesktopWorkspaceHost } from './host/desktop-workspace-host';
export * from './session/workspace-actions';
export * from './canvas/canvas-session';
export { createWebStorageAdapter } from './web-adapter';
export {
  migrateLegacyCellWorkspace,
  parseLegacyFrameDocument,
} from './migration/cell-workspace';
export { WorkspaceApp, type WorkspaceAppProps } from './workspace-app';
export {
  ExternalFileApp,
  type ExternalFileBinding,
  type ExternalFileActions,
} from './external-file-app';

export * from './documents/knowledge-index';

export {
  createGitVersionProvider,
  withGitVersioning,
} from '@sue/verd-board-workspace';

export * from './host/service-workspace-host';
export * from './host/browser-backup';
export * from './host/service-protocol';
