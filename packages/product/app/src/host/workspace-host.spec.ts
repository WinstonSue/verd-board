import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describeWorkspaceHostContract } from './workspace-host.contract';
import { createMemoryWorkspaceHost } from './memory-workspace-host';
import { createWebWorkspaceHost } from './web-workspace-host';

let counter = 0;
const unique = () => `ws-${++counter}-${Math.random().toString(36).slice(2)}`;

describeWorkspaceHostContract('memory host', async () => {
  const host = createMemoryWorkspaceHost({ now: () => 1_700_000_000_000 });
  return {
    host,
    open: async () =>
      (await host.openWorkspace({ path: unique() })) ?? Promise.reject(),
  };
});

describeWorkspaceHostContract('web host', async () => {
  const host = createWebWorkspaceHost({
    indexedDB: new IDBFactory(),
    dbName: `test-${unique()}`,
    now: () => 1_700_000_000_000,
  });
  return {
    host,
    open: async () =>
      (await host.openWorkspace({ path: unique() })) ?? Promise.reject(),
  };
});
