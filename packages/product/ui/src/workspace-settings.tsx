import './settings-sections.scss';
import { useState } from 'react';
import { Settings, Trash2 } from 'lucide-react';
import { WorkspaceTrash, type WorkspaceTrashProps } from './workspace-trash';
import { SettingsPageShell } from './settings-page-shell';
import { FrameMindWidthInput } from './frame-mind-width-input';
import { useMindMaxWidth } from './mind-preferences';

export interface WorkspaceSettingsProps {
  locale?: 'zh' | 'en';
  config: { name?: string; mindDefaultWidth?: number };
  /** Placeholder and sidebar title while the name is empty. */
  defaultName: string;
  onConfig(patch: { name?: string; mindDefaultWidth?: number }): void;
  trash?: Omit<WorkspaceTrashProps, 'locale' | 'onBusyChange'>;
  onBack(): void;
}

export function WorkspaceSettings({
  locale = 'zh',
  config,
  defaultName,
  onConfig,
  onBack,
  trash,
}: WorkspaceSettingsProps) {
  const globalWidth = useMindMaxWidth();
  const zh = locale === 'zh';
  const [section, setSection] = useState<'general' | 'trash'>('general');
  const [busy, setBusy] = useState(false);
  const selected = section === 'trash' && trash ? 'trash' : 'general';
  const generalLabel = zh ? '基本设置' : 'General';
  const trashLabel = zh ? '回收站' : 'Trash';
  return (
    <SettingsPageShell
      title={zh ? '工作区设置' : 'Workspace settings'}
      backLabel={zh ? '返回工作区' : 'Back to workspace'}
      onBack={onBack}
      backDisabled={busy}
      className="workspace-settings settings-sections"
      contentClassName="settings-sections-layout"
      testId="workspace-settings-page"
      backTestId="workspace-settings-back"
    >
      <nav
        className="settings-sections-nav"
        aria-label={zh ? '工作区设置菜单' : 'Workspace settings menu'}
      >
        <button
          type="button"
          data-testid="workspace-settings-nav-general"
          disabled={busy}
          aria-current={selected === 'general' ? 'page' : undefined}
          onClick={() => setSection('general')}
        >
          <Settings size={18} aria-hidden />
          <span>{generalLabel}</span>
        </button>
        {trash && (
          <button
            type="button"
            data-testid="workspace-settings-nav-trash"
            disabled={busy}
            aria-label={trashLabel}
            aria-current={selected === 'trash' ? 'page' : undefined}
            onClick={() => setSection('trash')}
          >
            <Trash2 size={18} aria-hidden />
            <span>{trashLabel}</span>
            <span className="settings-sections-nav-count" aria-hidden>
              {trash.entries.length}
            </span>
          </button>
        )}
      </nav>
      <main className="settings-sections-main">
        <div className="frame-settings-content settings-sections-panel">
          {selected === 'trash' && trash ? (
            <WorkspaceTrash {...trash} locale={locale} onBusyChange={setBusy} />
          ) : (
            <>
              <section>
                <h2>{zh ? '基本信息' : 'General'}</h2>
                <label className="frame-settings-row">
                  <span>{zh ? '名称' : 'Name'}</span>
                  <input
                    data-testid="workspace-settings-name"
                    maxLength={80}
                    placeholder={defaultName}
                    value={config.name ?? ''}
                    onChange={(event) => onConfig({ name: event.target.value })}
                  />
                </label>
                <p className="frame-settings-hint">
                  {zh ? '显示在侧栏顶部' : 'Shown at the top of the sidebar'}
                </p>
              </section>
              <section>
                <h2>{zh ? '思维导图' : 'Mind maps'}</h2>
                <div className="frame-settings-row">
                  <span>{zh ? '默认最大宽度' : 'Default maximum width'}</span>
                  <div className="frame-settings-actions">
                    <FrameMindWidthInput
                      value={config.mindDefaultWidth}
                      testId="workspace-settings-mind-width"
                      label={zh ? '默认最大宽度' : 'Default maximum width'}
                      placeholder={
                        zh
                          ? `跟随全局（${globalWidth}）`
                          : `Use global (${globalWidth})`
                      }
                      onChange={(mindDefaultWidth) =>
                        onConfig({ mindDefaultWidth })
                      }
                      onClear={() => onConfig({ mindDefaultWidth: undefined })}
                    />
                    <button
                      type="button"
                      data-testid="workspace-settings-mind-width-reset"
                      disabled={config.mindDefaultWidth === undefined}
                      onClick={() => onConfig({ mindDefaultWidth: undefined })}
                    >
                      {zh ? '跟随全局' : 'Use global'}
                    </button>
                  </div>
                </div>
                <p className="frame-settings-hint">
                  {zh
                    ? '只作用于没有单独设置宽度的主题，优先于全局默认值'
                    : 'Applies to topics without an explicit width and overrides the global default'}
                </p>
              </section>
            </>
          )}
        </div>
      </main>
    </SettingsPageShell>
  );
}
