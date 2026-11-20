import type { WorkspaceHandle } from './workspace-host';

export interface GitChange {
  path: string;
  status:
    'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  staged: boolean;
}
export interface GitCleanupState {
  phase:
    'local-cleared' | 'remote-updated' | 'platform-pending' | 'acknowledged';
  message: string;
  pending: string[];
}
export interface WorkspaceGitStatus {
  available: boolean;
  initialized: boolean;
  branch: string | null;
  head: string | null;
  /** Captures HEAD, index and working content; mutations reject stale tokens. */
  token: string;
  changes: GitChange[];
  remote?: { name: string; url: string; branch?: string };
  ahead?: number;
  behind?: number;
  canSync: boolean;
  /** Host transport capability, independent of whether a remote is configured or clean. */
  remoteSupported?: boolean;
  /** Actual repository and the workspace's path within it; paths returned by Git remain workspace-relative. */
  repository?: {
    root: string;
    workspacePath: string;
    ownership: 'workspace' | 'project';
  };
  /** Repository-wide settings and history rewriting may be owned by the enclosing project. */
  repositoryManaged?: boolean;
  historyCleanupSupported?: boolean;
  author?: { name: string; email: string };
  blocked?: string[];
  error?: string;
  cleanup?: GitCleanupState;
}
export interface GitCommit {
  oid: string;
  message: string;
  author: string;
  email: string;
  at: number;
  parents: string[];
  /** Resolved historical alias when listing the history of one path. */
  path?: string;
}
export interface GitVersionFile {
  path: string;
  content: Uint8Array;
  mode?: string;
}
export interface GitOperationPlan {
  id: string;
  kind: 'create' | 'restore' | 'purge';
  token: string;
  oid?: string;
  scope: 'file' | 'directory' | 'workspace';
  requiresReview?: boolean;
  paths: { path: string; action: 'write' | 'delete' }[];
  refs?: string[];
  /** Native identities covered by a reviewed purge, including identities read from trash. */
  fileIds?: string[];
  warnings: string[];
}
export type WorkspaceGitRequest =
  | { type: 'status' }
  | {
      type: 'create-plan';
      message: string;
      paths?: string[];
      path?: string;
      fileId?: string;
      directoryPath?: string;
      folderId?: string;
    }
  | { type: 'create'; planId: string; expectedToken: string }
  | { type: 'init'; author?: { name: string; email: string } }
  | {
      type: 'configure';
      remoteUrl?: string;
      remoteName?: string;
      author?: { name: string; email: string };
      executable?: string;
    }
  | {
      type: 'commit';
      paths?: string[];
      message: string;
      expectedToken: string;
      author?: { name: string; email: string };
    }
  | {
      type: 'log';
      directoryPath?: string;
      folderId?: string;
      fileId?: string;
      path?: string;
      limit?: number;
      cursor?: string;
    }
  | { type: 'read'; oid: string; paths?: string[] }
  | {
      type: 'restore-plan';
      oid: string;
      fileId?: string;
      path?: string;
      directoryPath?: string;
      folderId?: string;
    }
  | { type: 'restore'; planId: string; expectedToken: string }
  | { type: 'sync'; expectedToken: string }
  | { type: 'cleanup-retry'; expectedToken: string }
  | { type: 'cleanup-confirm'; expectedToken: string }
  | {
      type: 'purge-plan';
      fileIds: string[];
      paths?: string[];
      trashEntryIds?: string[];
    }
  | { type: 'purge'; planId: string; expectedToken: string };

export interface WorkspaceGitResult {
  status: WorkspaceGitStatus;
  oid?: string;
  commits?: GitCommit[];
  files?: GitVersionFile[];
  plan?: GitOperationPlan;
  cleanup?: GitCleanupState;
}
export type WorkspaceGitHost = (
  handle: WorkspaceHandle,
  request: WorkspaceGitRequest,
) => Promise<WorkspaceGitResult>;

/** Runtime files are never included in application-created commits. */
export const isGitRuntimePath = (path: string): boolean =>
  path === '.git' ||
  path.startsWith('.git/') ||
  path === '.verdboard' ||
  path.startsWith('.verdboard/') ||
  path === '.verd-resources/history' ||
  path.startsWith('.verd-resources/history/') ||
  (path.startsWith('.verdscrolls/') &&
    path !== '.verdscrolls/config.json' &&
    path !== '.verdscrolls/.gitignore' &&
    !path.startsWith('.verdscrolls/resources/assets/'));

export const assertGitContentPath = (path: string): string => {
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    path.split('/').some((part) => part.toLowerCase() === '.git') ||
    isGitRuntimePath(path)
  )
    throw new Error('Invalid Git content path: ' + path);
  return path;
};
