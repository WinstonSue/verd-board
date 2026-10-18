import { useMemo } from 'react';
import {
  WorkspaceApp,
  createDesktopWorkspaceHost,
  migrateLegacyCellWorkspace,
  type StorageAdapter,
} from '@sue/verd-board-app';
import { storage } from '../storage';

export function App() {
  const host = useMemo(() => createDesktopWorkspaceHost(), []);
  const legacyAdapter = useMemo<StorageAdapter>(
    () => ({
      onShutdown: (flush) => storage.onShutdown(flush),
      listKeys: () => storage.listKeys(),
      getItem: (key) => storage.getItem(key),
      setItem: async (key, value) => {
        await storage.setItem(key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    }),
    [],
  );
  return (
    <WorkspaceApp
      host={host}
      allowWorkspaceSwitching
      importLegacy={async () => {
        if (!(await legacyAdapter.listKeys()).length) return null;
        return migrateLegacyCellWorkspace(legacyAdapter);
      }}
    />
  );
}

export default App;
