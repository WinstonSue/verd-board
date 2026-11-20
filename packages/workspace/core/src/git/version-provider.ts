import type { WorkspaceHost } from '../host/workspace-host';
import type {
  WorkspaceGitHost,
  WorkspaceGitRequest,
  WorkspaceGitStatus,
} from '../host/workspace-git';
import {
  VersionError,
  type VersionScope,
  type VersionStatus,
  type WorkspaceVersionHost,
} from '../host/workspace-versions';

const target = (scope: VersionScope) =>
  scope.kind === 'workspace'
    ? {}
    : scope.kind === 'directory'
      ? { directoryPath: scope.path, folderId: scope.folderId }
      : { path: scope.path, fileId: scope.fileId };
const status = (value: WorkspaceGitStatus): VersionStatus => ({
  available: value.available,
  enabled: value.initialized,
  token: value.token,
  changes: value.changes
    .filter((c) => !c.path.endsWith('/.verd-folder.json'))
    .map(({ path, status }) => ({ path, status })),
  attention: !!(value.error || value.blocked?.length),
  capabilities: {
    create: value.available,
    restore: value.available,
    directory: true,
    cleanup: value.available && value.historyCleanupSupported !== false,
    sync: value.remoteSupported ?? false,
  },
});
/** All protocol-specific fields stop here. Other providers implement WorkspaceVersionHost directly. */
export function createGitVersionProvider(
  git: WorkspaceGitHost,
): WorkspaceVersionHost {
  return async (handle, request) => {
    try {
      let command: WorkspaceGitRequest;
      switch (request.type) {
        case 'list':
          command = {
            type: 'log',
            ...target(request.scope),
            cursor: request.cursor,
            limit: request.limit,
          };
          break;
        case 'read':
          command = { type: 'read', oid: request.versionId };
          break;
        case 'create-plan':
          command = {
            type: 'create-plan',
            ...target(request.scope),
            paths: request.paths,
            message: request.message,
          };
          break;
        case 'restore-plan':
          command = {
            type: 'restore-plan',
            ...target(request.scope),
            oid: request.versionId,
          };
          break;
        default:
          command = request;
      }
      const result = await git(handle, command);
      return {
        status: status(result.status),
        versionId: result.oid,
        versions: result.commits?.map((c) => ({
          id: c.oid,
          message: c.message,
          author: c.author,
          at: c.at,
          path: c.path,
        })),
        files: result.files?.map((f) => ({
          path: f.path,
          content: f.content,
          executable: f.mode === '100755',
        })),
        plan: result.plan && {
          id: result.plan.id,
          kind: result.plan.kind,
          token: result.plan.token,
          paths: result.plan.paths,
          fileIds: result.plan.fileIds,
          requiresReview: result.plan.requiresReview,
        },
      };
    } catch (error) {
      const diagnostic = String(error);
      const code = /expired|stale|changed|token/i.test(diagnostic)
        ? 'stale-plan'
        : /commit or discard|dirty|affected changes/i.test(diagnostic)
          ? 'dirty-target'
          : /occup|identity|ambig|collision/i.test(diagnostic)
            ? 'scope-collision'
            : /dependenc|referenced|attachment/i.test(diagnostic)
              ? 'missing-dependency'
              : /unavailable|author|configur|initializ/i.test(diagnostic)
                ? 'needs-settings'
                : 'unsupported';
      throw new VersionError(code, diagnostic);
    }
  };
}

export function withGitVersioning<T extends WorkspaceHost>(
  host: T,
): T & { versions: WorkspaceVersionHost } {
  return Object.assign(host, {
    versions: host.versions ?? createGitVersionProvider(host.git!.bind(host)),
    versionProvider: { id: 'git' },
  });
}
