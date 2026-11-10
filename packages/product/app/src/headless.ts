/** Workspace authoring without the product UI or stylesheet entry. */
export * from './documents/document-files';
export * from './documents/workspace-references';
export * from './frames/frame-files';
export * from './frames/frame-organization';
export * from './frames/plugins';
export * from './host/workspace-host';
export * from './host/workspace-git';
export { validateGitVersionFiles } from './session/workspace-git-validation';
export {
  planGitPurge,
  rewriteGitPurge,
  type GitPurgeAnalysis,
} from './git/purge';
export { gitAssetReferences, nativeFileIdentity } from './git/tree';
export { createMemoryWorkspaceHost } from './host/memory-workspace-host';
export * from './session/workspace-session';
export * from './workspace-validation';
export * from './workspace-skills';

export { storeAttachment } from './documents/workspace-resources';

export * from './host/folder-identity';
export { cellOwnerIndex } from './session/target-navigation';

export * from './documents/workspace-package';

export * from './host/workspace-versions';
export {
  createGitVersionProvider,
  withGitVersioning,
} from './git/version-provider';
export * from './git/directory-versions';
