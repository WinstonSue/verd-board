/** Workspace authoring without the product UI or stylesheet entry. */
export * from './documents/document-files';
export * from './documents/workspace-references';
export * from './frames/frame-files';
export * from './frames/frame-organization';
export * from './frames/plugins';
export * from './host/workspace-host';
export { createMemoryWorkspaceHost } from './host/memory-workspace-host';
export * from './session/workspace-session';
export * from './workspace-validation';

export { storeAttachment } from './documents/workspace-resources';

export * from './host/folder-identity';
export { cellOwnerIndex } from './session/target-navigation';
