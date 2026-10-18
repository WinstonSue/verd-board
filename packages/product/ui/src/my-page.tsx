import './settings-sections.scss';
import { Settings } from 'lucide-react';
import { SettingsPageShell } from './settings-page-shell';
import { FrameSettingsContent } from './frame-settings-page';
import { useI18n } from './i18n';

export interface MyPageProps {
  onBack(): void;
  backLabel?: string;
}

export function MyPage({ onBack, backLabel }: MyPageProps) {
  const { language, t } = useI18n();
  return (
    <SettingsPageShell
      title={language === 'zh' ? '我的' : 'My'}
      backLabel={
        backLabel ?? (language === 'zh' ? '返回画布' : 'Back to canvas')
      }
      onBack={onBack}
      testId="my-page"
      backTestId="my-back"
      className="my-page settings-sections"
      contentClassName="settings-sections-layout"
    >
      <nav
        className="settings-sections-nav"
        aria-label={language === 'zh' ? '我的菜单' : 'My menu'}
      >
        <button type="button" data-testid="my-nav-settings" aria-current="page">
          <Settings size={18} aria-hidden />
          <span>{t('settings.title')}</span>
        </button>
      </nav>
      <main className="my-page-main settings-sections-main">
        <div className="frame-settings-content settings-sections-panel">
          <div className="settings-sections-panel-heading">
            <h2>{t('settings.title')}</h2>
          </div>
          <FrameSettingsContent headingLevel={3} />
        </div>
      </main>
    </SettingsPageShell>
  );
}
