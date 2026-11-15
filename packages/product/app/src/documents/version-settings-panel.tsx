import { useRef, useState } from 'react';
import { WorkspaceButton } from '@sue/verd-board-ui';
import { VersionHistoryPanel } from './version-history-panel';
import { GitHistoryPanel } from './git-history-panel';
import type { WorkspaceSession } from '@sue/verd-board-workspace';

export function VersionSettingsPanel({
  session,
  readonly,
  locale,
  onBusyChange,
  purgeEntryIds,
  gitAdmin,
}: {
  session: WorkspaceSession;
  readonly: boolean;
  locale: 'zh' | 'en';
  onBusyChange(busy: boolean): void;
  purgeEntryIds: string[];
  gitAdmin: boolean;
}) {
  const leave = useRef<() => Promise<boolean>>(async () => true);
  const [page, setPage] = useState<'history' | 'storage'>('history');
  const [busy, setBusy] = useState(false);
  const changeBusy = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  return (
    <>
      <nav
        aria-label={
          locale === 'zh' ? '版本设置栏目' : 'Version settings sections'
        }
      >
        <WorkspaceButton
          disabled={busy}
          onClick={() =>
            void leave.current().then((ok) => {
              if (ok) setPage('history');
            })
          }
        >
          {locale === 'zh' ? '工作区版本' : 'Workspace versions'}
        </WorkspaceButton>
        {gitAdmin && (
          <WorkspaceButton disabled={busy} onClick={() => setPage('storage')}>
            {locale === 'zh' ? '存储与同步' : 'Storage and sync'}
          </WorkspaceButton>
        )}
      </nav>
      {page === 'history' ? (
        <VersionHistoryPanel
          session={session}
          scope={{ kind: 'workspace' }}
          readonly={readonly}
          locale={locale}
          onBusyChange={changeBusy}
          purgeEntryIds={purgeEntryIds}
          onSettings={gitAdmin ? () => setPage('storage') : undefined}
        />
      ) : (
        <GitHistoryPanel
          registerLeave={(flush) => {
            leave.current = flush;
          }}
          session={session}
          adminOnly
          readonly={readonly}
          locale={locale}
          onBusyChange={changeBusy}
        />
      )}
    </>
  );
}
