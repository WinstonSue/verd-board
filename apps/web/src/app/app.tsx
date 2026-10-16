import { useMemo } from 'react';
import {
  WorkspaceApp,
  createWebStorageAdapter,
  createWebWorkspaceHost,
  migrateLegacyCellWorkspace,
} from '@sue/verd-board-app';
import { ProviderHarness } from './harness';

export function App() {
  const host = useMemo(() => createWebWorkspaceHost(), []);
  const params = new URLSearchParams(window.location.search);
  const harness = params.get('harness');
  if (harness) {
    return <ProviderHarness kind={harness} />;
  }
  return (
    <WorkspaceApp
      host={host}
      readonly={params.get('readonly') === '1'}
      importLegacy={async () => {
        const adapter = createWebStorageAdapter();
        if (!(await adapter.listKeys()).length) return null;
        return migrateLegacyCellWorkspace(adapter);
      }}
    />
  );
}

export default App;
