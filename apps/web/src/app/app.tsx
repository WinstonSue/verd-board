import { useCallback, useEffect, useMemo, useState } from 'react';
import { WorkspaceApp, createServiceWorkspaceHost } from '@sue/verd-board-app';
import { ProviderHarness } from './harness';
import {
  BrowserMigration,
  DirectoryPicker,
  type DirectoryRequest,
} from './service-controls';
import './service-controls.scss';

export function App() {
  const [picker, setPicker] = useState<DirectoryRequest>();
  const [connected, setConnected] = useState(true);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [migration, setMigration] = useState(
    new URLSearchParams(location.search).get('migrate') === '1',
  );
  const host = useMemo(
    () =>
      createServiceWorkspaceHost({
        pickDirectory: (purpose) =>
          new Promise((resolve) => setPicker({ purpose, resolve })),
        onConnectionChange: (ok, detail) => {
          setConnected(ok);
          setMessage(detail ?? '');
        },
      }),
    [],
  );
  const params = new URLSearchParams(window.location.search);
  const harness = params.get('harness');
  const retry = useCallback(async () => {
    try {
      await host.serviceCall('readGlobalConfig', []);
      setReady(true);
    } catch (error) {
      setConnected(false);
      setMessage(String(error));
    }
  }, [host]);
  const lifecycle = useMemo(() => ({ generation: 0 }), []);
  useEffect(() => {
    const generation = ++lifecycle.generation;
    if (!harness) void retry();
    return () => {
      queueMicrotask(() => {
        if (lifecycle.generation === generation) host.dispose();
      });
    };
  }, [host, harness, retry, lifecycle]);
  if (harness) return <ProviderHarness kind={harness} />;
  return (
    <>
      {!connected && (
        <div className="web-service-bar" role="alert">
          <span>本地服务连接中断</span>
          <span>{message}</span>
          <button onClick={() => void retry()}>重新连接</button>
        </div>
      )}
      {ready ? (
        <WorkspaceApp
          host={host}
          allowWorkspaceSwitching
          onMigrateBrowserData={() => setMigration(true)}
          readonly={params.get('readonly') === '1'}
        />
      ) : (
        <div className="web-service-starting">
          {connected ? '正在连接本地服务…' : '请启动本地服务后重新连接。'}
        </div>
      )}
      {migration && (
        <BrowserMigration
          host={host}
          onClose={() => setMigration(false)}
          pickDirectory={() =>
            new Promise((resolve) =>
              setPicker({ purpose: 'migration', resolve }),
            )
          }
        />
      )}
      {picker && (
        <DirectoryPicker
          key={picker.purpose}
          host={host}
          request={picker}
          onClose={() => setPicker(undefined)}
        />
      )}
    </>
  );
}
export default App;
