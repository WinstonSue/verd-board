import { useMemo, useEffect, useState } from 'react';
import {
  WorkspaceApp,
  ExternalFileApp,
  type ExternalFileBinding,
  type WorkspaceHost,
  createDesktopWorkspaceHost,
  migrateLegacyCellWorkspace,
  type StorageAdapter,
} from '@sue/verd-board-app';
import { storage } from '../storage';

export function App() {
  const [binding, setBinding] = useState<
    ExternalFileBinding | null | undefined
  >();
  const [error, setError] = useState('');
  useEffect(() => {
    void window.electronAPI.files
      .binding()
      .then(setBinding, (cause) => setError(String(cause)));
  }, []);
  const externalHost = useMemo<WorkspaceHost>(
    () => ({
      ...window.electronAPI.files.host,
      storageKind: 'filesystem',
      capabilities: {
        pickWorkspace: false,
        openBuiltinWorkspace: false,
        openPatternWorkspace: false,
      },
      readGlobalConfig: async () => ({ version: 0, value: {} }),
      writeGlobalConfig: async () => {
        throw new Error('独立文件不提供全局设置');
      },
      openWorkspace: async () => binding?.handle ?? null,
      onShutdown: window.electronAPI.onShutdown,
    }),
    [binding],
  );
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
  if (error) return <div role="alert">{error}</div>;
  if (binding === undefined) return null;
  if (binding)
    return (
      <ExternalFileApp
        host={externalHost}
        binding={binding}
        actions={window.electronAPI.files}
      />
    );
  return (
    <WorkspaceApp
      host={host}
      localAgent={window.electronAPI.localAgent}
      onSetDefaultFileApplications={window.electronAPI.files.setDefaults}
      subscribeOpenFile={window.electronAPI.files.onOpenWorkspaceFile}
      productNavigation={window.electronAPI.files.product}
      allowWorkspaceSwitching
      importLegacy={async () => {
        if (!(await legacyAdapter.listKeys()).length) return null;
        return migrateLegacyCellWorkspace(legacyAdapter);
      }}
    />
  );
}

export default App;
