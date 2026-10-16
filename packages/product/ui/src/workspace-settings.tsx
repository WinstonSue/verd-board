import { SettingsPageShell } from './settings-page-shell';
import { FrameMindWidthInput } from './frame-mind-width-input';
import { useMindMaxWidth } from './mind-preferences';

export interface WorkspaceSettingsProps {
  locale?: 'zh' | 'en';
  config: { name?: string; mindDefaultWidth?: number };
  /** Placeholder and sidebar title while the name is empty. */
  defaultName: string;
  onConfig(patch: { name?: string; mindDefaultWidth?: number }): void;
  onOpenGlobalSettings?(): void;
  onBack(): void;
}

export function WorkspaceSettings({
  locale = 'zh',
  config,
  defaultName,
  onConfig,
  onOpenGlobalSettings,
  onBack,
}: WorkspaceSettingsProps) {
  const globalWidth = useMindMaxWidth();
  const zh = locale === 'zh';
  return (
    <SettingsPageShell
      title={zh ? '工作区设置' : 'Workspace settings'}
      backLabel={zh ? '返回工作区' : 'Back to workspace'}
      onBack={onBack}
      testId="workspace-settings-page"
      backTestId="workspace-settings-back"
    >
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
              onChange={(mindDefaultWidth) => onConfig({ mindDefaultWidth })}
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
      <section>
        <h2>{zh ? '全局偏好' : 'Global preferences'}</h2>
        <p className="frame-settings-hint">
          {zh
            ? '语言、触控板缩放灵敏度、拖动画布速度、智能参考线对本设备所有工作区生效，也可以在画布左上角「更多 → 设置」打开。'
            : 'Language, trackpad zoom sensitivity, drag pan speed and smart guides apply to all workspaces on this device. You can also open them from More → Settings on the canvas.'}
        </p>
        <button
          type="button"
          data-testid="workspace-settings-open-global"
          onClick={onOpenGlobalSettings}
        >
          {zh ? '打开全局设置' : 'Open global settings'}
        </button>
      </section>
    </SettingsPageShell>
  );
}
