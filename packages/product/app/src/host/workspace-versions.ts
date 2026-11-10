import type { WorkspaceHandle } from './workspace-host';

export type VersionScope =
  | { kind: 'workspace' }
  | { kind: 'file'; path?: string; fileId?: string }
  | { kind: 'directory'; path: string; folderId?: string };
export interface VersionFile {
  path: string;
  content: Uint8Array;
  executable?: boolean;
}
export interface VersionChange {
  path: string;
  status:
    'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
}
export interface VersionStatus {
  available: boolean;
  enabled: boolean;
  token: string;
  changes: VersionChange[];
  capabilities: {
    create: boolean;
    restore: boolean;
    directory: boolean;
    cleanup: boolean;
    sync: boolean;
  };
  attention?: boolean;
}
export interface ContentVersion {
  id: string;
  message: string;
  author: string;
  at: number;
  path?: string;
}
export interface VersionPlan {
  id: string;
  kind: 'create' | 'restore' | 'purge';
  token: string;
  paths: { path: string; action: 'write' | 'delete' }[];
  fileIds?: string[];
  requiresReview?: boolean;
}
export type VersionRequest =
  | { type: 'status' }
  | { type: 'list'; scope: VersionScope; cursor?: string; limit?: number }
  | { type: 'read'; versionId: string }
  | {
      type: 'create-plan';
      scope: VersionScope;
      paths?: string[];
      message: string;
    }
  | { type: 'create'; planId: string; expectedToken: string }
  | { type: 'restore-plan'; scope: VersionScope; versionId: string }
  | { type: 'restore'; planId: string; expectedToken: string }
  | {
      type: 'purge-plan';
      fileIds: string[];
      paths?: string[];
      trashEntryIds?: string[];
    }
  | { type: 'purge'; planId: string; expectedToken: string };
export interface VersionResult {
  status: VersionStatus;
  versionId?: string;
  versions?: ContentVersion[];
  files?: VersionFile[];
  plan?: VersionPlan;
}
export type WorkspaceVersionHost = (
  handle: WorkspaceHandle,
  request: VersionRequest,
) => Promise<VersionResult>;
export class VersionError extends Error {
  constructor(
    public code:
      | 'stale-plan'
      | 'dirty-target'
      | 'scope-collision'
      | 'missing-dependency'
      | 'unsupported'
      | 'needs-settings',
    public diagnostic: string,
  ) {
    super(code);
    this.name = 'VersionError';
  }
}
