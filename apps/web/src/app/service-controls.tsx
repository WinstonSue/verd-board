import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  decodeServiceValue,
  encodeServiceValue,
  exportBrowserBackup,
  clearMigratedBrowserData,
  type BrowserBackup,
  type DirectoryListing,
  type createServiceWorkspaceHost,
} from '@sue/verd-board-app';

type ServiceHost = ReturnType<typeof createServiceWorkspaceHost>;
export type DirectoryRequest = {
  purpose: 'open' | 'create' | 'backup' | 'migration';
  resolve(path: string | null): void;
};

function ServiceDialog({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const opener = element.ownerDocument.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="web-service-dialog"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function DirectoryPicker({
  host,
  request,
  onClose,
}: {
  host: ServiceHost;
  request: DirectoryRequest;
  onClose(): void;
}) {
  const [listing, setListing] = useState<DirectoryListing>();
  const browseSequence = useRef(0);
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const browse = useCallback(
    async (input?: string) => {
      const sequence = ++browseSequence.current;
      setBusy(true);
      setError('');
      try {
        const next = await host.serviceCall('browseDirectories', [input]);
        if (sequence !== browseSequence.current) return;
        setListing(next);
        setLocation(next.path);
      } catch (cause) {
        if (sequence === browseSequence.current) setError(String(cause));
      } finally {
        if (sequence === browseSequence.current) setBusy(false);
      }
    },
    [host],
  );
  useEffect(() => {
    void browse();
    return () => {
      browseSequence.current++;
    };
  }, [browse]);
  const finish = (path: string | null) => {
    request.resolve(path);
    onClose();
  };
  const importLabel =
    document.documentElement.lang === 'en' ? 'Import workspace' : '导入工作区';
  return (
    <ServiceDialog
      label={request.purpose === 'open' ? importLabel : '选择本地文件夹'}
      onClose={() => finish(null)}
    >
      <h2>
        {request.purpose === 'create'
          ? '选择新工作区的父目录'
          : request.purpose === 'backup'
            ? '选择备份文件夹'
            : request.purpose === 'migration'
              ? '选择迁移目标的父文件夹'
              : importLabel}
      </h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void browse(location);
        }}
      >
        <label>
          文件夹路径
          <input
            disabled={busy}
            aria-label="文件夹路径"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <button disabled={busy}>前往</button>
      </form>
      <button
        disabled={busy || !listing?.parent}
        onClick={() => void browse(listing!.parent!)}
      >
        上一级
      </button>
      <div className="web-service-directory-list" aria-busy={busy}>
        {listing?.directories.map((name) => (
          <button
            key={name}
            disabled={busy}
            onClick={() =>
              void browse(listing.path.replace(/[\\/]$/, '') + '/' + name)
            }
          >
            📁 {name}
          </button>
        ))}
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!listing) return;
          setBusy(true);
          setError('');
          try {
            const next = await host.serviceCall('makeDirectory', [
              listing.path,
              name,
            ]);
            setListing(next);
            setLocation(next.path);
            setName('');
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="新文件夹名称"
          placeholder="新文件夹名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button disabled={busy || !name.trim()}>新建文件夹</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button onClick={() => finish(null)}>取消</button>
        <button
          disabled={busy || !listing || location !== listing.path}
          onClick={() => finish(listing!.path)}
        >
          选择此文件夹
        </button>
      </footer>
    </ServiceDialog>
  );
}

export function BrowserMigration({
  host,
  pickDirectory,
  onClose,
}: {
  host: ServiceHost;
  pickDirectory(): Promise<string | null>;
  onClose(): void;
}) {
  const [backup, setBackup] = useState<BrowserBackup>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [sourceBackup, setSourceBackup] = useState(false);
  const [imported, setImported] = useState<{ path: string; count: number }>();
  const [cleanupPending, setCleanupPending] = useState(false);
  const count =
    backup?.databases
      .find((db) => db.name === 'verdboard-host')
      ?.stores.find((store) => store.name === 'workspaces')?.records.length ??
    0;
  async function detect() {
    setBusy(true);
    setError('');
    try {
      setBackup(await exportBrowserBackup());
      setDownloaded(false);
      setSourceBackup(true);
      setImported(undefined);
      setCleanupPending(false);
      setResult('');
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void detect();
  }, []);
  async function cleanup(
    value: BrowserBackup,
    destination: { path: string; count: number },
  ) {
    await clearMigratedBrowserData(value);
    setCleanupPending(false);
    setResult(
      `已迁移 ${destination.count} 个工作区至 ${destination.path}，原 IndexedDB 数据已清理。请从工作区切换器打开。`,
    );
  }
  return (
    <ServiceDialog
      label="迁移浏览器数据"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <h2>迁移浏览器数据</h2>
      <p>
        完整备份、导入和校验成功后清理原 IndexedDB
        数据；失败时保留源数据和备份。只能检测当前访问地址的数据；从备份文件导入不会清理当前浏览器数据。
      </p>
      <p>
        {backup
          ? `检测到 ${count} 个工作区，${backup.files.length} 个文件。旧版数据也会保存在备份中。`
          : '正在读取原数据…'}
      </p>
      <button disabled={busy} onClick={() => void detect()}>
        重新检测
      </button>
      <label>
        导入备份文件
        <input
          type="file"
          accept=".json"
          disabled={busy}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              const parsed = decodeServiceValue(
                JSON.parse(await file.text()),
              ) as BrowserBackup;
              if (
                parsed.format !== 'verd-browser-backup' ||
                parsed.version !== 1
              )
                throw new Error('备份格式不支持');
              setBackup(parsed);
              setDownloaded(true);
              setSourceBackup(false);
              setImported(undefined);
              setCleanupPending(false);
              setResult('');
              setError('');
            } catch (cause) {
              setError(String(cause));
            }
          }}
        />
      </label>
      <button
        disabled={!backup || busy}
        onClick={() => {
          if (!backup) return;
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(encodeServiceValue(backup))], {
              type: 'application/json',
            }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = 'verd-browser-backup.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setDownloaded(true);
        }}
      >
        下载完整备份
      </button>
      <button
        disabled={!backup || busy || !downloaded || !!imported}
        onClick={async () => {
          const parent = await pickDirectory();
          if (!parent || !backup) return;
          setBusy(true);
          setError('');
          try {
            const imported = await host.serviceCall('importBrowserBackup', [
              backup,
              parent,
            ]);
            setResult(
              `已迁移 ${imported.count} 个工作区至 ${imported.path}。请从工作区切换器打开。`,
            );
            setImported(imported);
            if (sourceBackup) {
              setCleanupPending(true);
              await cleanup(backup, imported);
            }
          } catch (cause) {
            setError(String(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        {sourceBackup ? '选择目标、迁移并清理源数据' : '选择目标并迁移'}
      </button>
      {cleanupPending && imported && backup && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await cleanup(backup, imported);
            } catch (cause) {
              setError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          重试清理源数据
        </button>
      )}
      {!downloaded && <p>先下载完整备份，再选择迁移目标。</p>}
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      <footer>
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </footer>
    </ServiceDialog>
  );
}
