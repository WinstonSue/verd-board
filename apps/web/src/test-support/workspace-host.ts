/** Additional entry only for explicitly instrumented E2E builds. */
import { createServiceWorkspaceHost as createHost } from '@sue/verd-board-app';
export function createServiceWorkspaceHost() {
  const settings = window as unknown as {
    __verdTestParent: string;
    __verdTestWorkspace: string;
  };
  const host = createHost({
    pickDirectory: async () => settings.__verdTestParent,
  });
  const open = host.openWorkspace;
  host.openWorkspace = (request) =>
    open(request?.default ? { path: settings.__verdTestWorkspace } : request);
  return host;
}
export {
  createWebWorkspaceHost as createBrowserWorkspaceHost,
  exportBrowserBackup,
  encodeServiceValue,
} from '@sue/verd-board-app';
