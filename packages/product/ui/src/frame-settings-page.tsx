import { SettingsPageShell } from './settings-page-shell';
import { useI18n } from './i18n';
import { useMindMaxWidth, setMindMaxWidth } from './mind-preferences';
import { FrameMindWidthInput } from './frame-mind-width-input';
import { DEFAULT_MIND_MAX_WIDTH } from '@sue/board-mind';
import {
  defaultInteractionPreferences,
  setInteractionPreferences,
  useInteractionPreferences,
} from './interaction-preferences';

export function FrameSettingsPage({
  onBack,
  backLabel,
}: {
  onBack(): void;
  backLabel?: string;
}) {
  const { t, language, setLanguage } = useI18n();
  const preferences = useInteractionPreferences();
  const mindMaxWidth = useMindMaxWidth();
  return (
    <SettingsPageShell
      title={t('settings.title')}
      backLabel={backLabel ?? t('settings.back')}
      onBack={onBack}
      testId="settings-page"
      backTestId="settings-back"
    >
      <section aria-labelledby="frame-settings-general">
        <h2 id="frame-settings-general">{t('settings.general')}</h2>
        <label className="frame-settings-row">
          <span>{t('language.switcher')}</span>
          <select
            aria-label={t('language.switcher')}
            data-testid="settings-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as 'zh' | 'en')}
          >
            <option value="zh">{t('language.chinese')}</option>
            <option value="en">{t('language.english')}</option>
          </select>
        </label>
      </section>
      <section aria-labelledby="frame-settings-mind">
        <h2 id="frame-settings-mind">{t('settings.mind')}</h2>
        <label className="frame-settings-row">
          <span>{t('settings.mindMaxWidth')}</span>
          <FrameMindWidthInput
            value={mindMaxWidth}
            onChange={setMindMaxWidth}
            label={t('settings.mindMaxWidth')}
            testId="settings-mind-max-width"
          />
        </label>
        <p>{t('settings.mindMaxWidthDescription')}</p>
        <button
          type="button"
          onClick={() => setMindMaxWidth(DEFAULT_MIND_MAX_WIDTH)}
        >
          {t('settings.resetMindWidth')}
        </button>
      </section>
      <section aria-labelledby="frame-settings-interaction">
        <h2 id="frame-settings-interaction">{t('settings.interaction')}</h2>
        <p>{t('settings.interactionDescription')}</p>
        {(['zoomSensitivity', 'dragPanSpeed'] as const).map((key) => (
          <div className="frame-settings-control" key={key}>
            <label htmlFor={`settings-${key}`}>
              {t(`settings.${key}`)}
              <output htmlFor={`settings-${key}`}>
                {Number(preferences[key].toFixed(2))}×
              </output>
            </label>
            <p>{t(`settings.${key}Description`)}</p>
            <input
              id={`settings-${key}`}
              data-testid={`settings-${key}`}
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={preferences[key]}
              aria-valuetext={`${Number(preferences[key].toFixed(2))}×`}
              onChange={(event) =>
                setInteractionPreferences({
                  ...preferences,
                  [key]: Number(event.target.value),
                })
              }
            />
            <div className="frame-settings-range" aria-hidden>
              <span>0.25×</span>
              <span>3×</span>
            </div>
          </div>
        ))}
        <label className="frame-settings-row">
          <span>{t('settings.smartGuides')}</span>
          <input
            type="checkbox"
            data-testid="settings-smart-guides"
            checked={preferences.smartGuides}
            onChange={(event) =>
              setInteractionPreferences({
                ...preferences,
                smartGuides: event.target.checked,
              })
            }
          />
        </label>
        <p>{t('settings.smartGuidesDescription')}</p>
        <button
          type="button"
          onClick={() =>
            setInteractionPreferences({
              ...preferences,
              zoomSensitivity: defaultInteractionPreferences.zoomSensitivity,
              dragPanSpeed: defaultInteractionPreferences.dragPanSpeed,
            })
          }
        >
          {t('settings.resetInteraction')}
        </button>
      </section>
    </SettingsPageShell>
  );
}
