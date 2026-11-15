import { createFsWorkspaceHost } from './workspace-host-fs';
import { readWorkspaceProjectContext } from './workspace-project';

/** Explicitly mutating counterpart of context/doctor; Desktop uses the same host open path. */
export async function initializeWorkspaceProject(
  root: string,
  options: { name?: string; resources?: string } = {},
) {
  const host = createFsWorkspaceHost({
    defaultRoot: () => root,
    sharedResources: options.resources ? () => options.resources! : undefined,
  });
  const handle = await host.openWorkspace({
    path: root,
    create: true,
    name: options.name,
  });
  if (!handle) throw new Error('Workspace could not be initialized');
  try {
    const context = await readWorkspaceProjectContext(root);
    const snapshot = await host.readSnapshot(handle);
    return { ...context, agent: snapshot.agent ?? context.agent };
  } finally {
    await host.closeWorkspace(handle);
  }
}
