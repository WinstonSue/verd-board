import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import type { ControlProps } from '@sue/schema-settings-react';
import { useId } from 'react';
import { SettingsPageShell } from './settings-page-shell';
import { useI18n } from './i18n';
import { useMindMaxWidth, setMindMaxWidth } from './mind-preferences';
import { FrameMindWidthInput } from './frame-mind-width-input';
import { DEFAULT_MIND_MAX_WIDTH } from '@sue/board-mind';
import {
  useAppearancePreference,
  setAppearancePreference,
  type AppearancePreference,
} from './appearance-preferences';
import {
  readInteractionPreferences,
  defaultInteractionPreferences,
  setInteractionPreferences,
  useInteractionPreferences,
} from './interaction-preferences';

type ApplicationValues = {
  appearance: AppearancePreference;
  language: 'zh' | 'en';
  mindWidth: number;
  zoomSensitivity: number;
  dragPanSpeed: number;
  smartGuides: boolean;
};
type ApplicationControls = ControlProps & { mindWidth: { testId: string } };
const applicationComponents = {
  mindWidth: ({
    value,
    label,
    props,
    onCommit,
  }: SettingEditorProps<unknown, { testId: string }>) => (
    <FrameMindWidthInput
      value={value as number}
      label={label}
      testId={props.testId}
      onChange={onCommit}
    />
  ),
};

export function FrameSettingsContent({
  headingLevel = 2,
}: { headingLevel?: 2 | 3 } = {}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const id = useId();
  const { t, language, setLanguage } = useI18n();
  const preferences = useInteractionPreferences();
  const mindWidth = useMindMaxWidth();
  const { preference } = useAppearancePreference();
  const values: ApplicationValues = {
    ...preferences,
    appearance: preference,
    language,
    mindWidth,
  };
  const definition = defineSettings<
    ApplicationValues,
    void,
    ApplicationControls
  >({
    groups: [
      { id: 'general', label: t('settings.general') },
      { id: 'mind', label: t('settings.mind') },
      { id: 'interaction', label: t('settings.interaction') },
    ],
    fields: [
      {
        key: 'appearance',
        editor: 'select',
        group: 'general',
        label: t('settings.appearance'),
        description: t('settings.appearance.description'),
        props: { attributes: { 'data-testid': 'settings-appearance' } },
        options: (['system', 'light', 'dark'] as const).map((value) => ({
          value: value as AppearancePreference,
          label: t(`settings.appearance.${value}`),
        })),
      },
      {
        key: 'language',
        editor: 'select',
        group: 'general',
        label: t('language.switcher'),
        props: { attributes: { 'data-testid': 'settings-language' } },
        options: [
          { value: 'zh', label: t('language.chinese') },
          { value: 'en', label: t('language.english') },
        ],
      },
      {
        key: 'mindWidth',
        editor: 'mindWidth',
        group: 'mind',
        label: t('settings.mindMaxWidth'),
        description: t('settings.mindMaxWidthDescription'),
        commit: 'change',
        props: { testId: 'settings-mind-max-width' },
      },
      ...(['zoomSensitivity', 'dragPanSpeed'] as const).map((key) => ({
        key,
        editor: 'range' as const,
        group: 'interaction',
        label: t(`settings.${key}`),
        description: t(`settings.${key}Description`),
        props: {
          min: 0.25,
          max: 3,
          step: 0.05,
          attributes: {
            id: `${id}-${key}`,
            'data-testid': `settings-${key}`,
            'aria-valuetext': `${Number(values[key].toFixed(2))}×`,
          },
        },
      })),
      {
        key: 'smartGuides',
        editor: 'checkbox',
        group: 'interaction',
        label: t('settings.smartGuides'),
        description: t('settings.smartGuidesDescription'),
        props: { attributes: { 'data-testid': 'settings-smart-guides' } },
      },
    ],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={values}
      identity="application-settings"
      components={applicationComponents}
      onCommit={({ changes }) => {
        for (const change of changes) {
          if (change.kind !== 'set') continue;
          if (change.key === 'appearance')
            setAppearancePreference(change.value);
          else if (change.key === 'language') setLanguage(change.value);
          else if (change.key === 'mindWidth') setMindMaxWidth(change.value);
          else
            setInteractionPreferences({
              ...readInteractionPreferences(),
              [change.key]: change.value,
            });
        }
      }}
      renderField={({ key, label, description, editor }) =>
        key === 'zoomSensitivity' || key === 'dragPanSpeed' ? (
          <div className="frame-settings-control">
            <label htmlFor={`${id}-${key}`}>
              {label}
              <output htmlFor={`${id}-${key}`}>
                {Number(values[key].toFixed(2))}×
              </output>
            </label>
            <p>{description}</p>
            {editor}
            <div className="frame-settings-range" aria-hidden>
              <span>0.25×</span>
              <span>3×</span>
            </div>
          </div>
        ) : (
          <>
            <label className="frame-settings-row">
              <span>{label}</span>
              {editor}
            </label>
            {description && <p>{description}</p>}
          </>
        )
      }
      renderGroup={({ id: group, label, children }) => (
        <section aria-labelledby={`${id}-${group}`}>
          <Heading id={`${id}-${group}`}>{label}</Heading>
          {group === 'interaction' && (
            <p>{t('settings.interactionDescription')}</p>
          )}
          {children}
          {group === 'mind' && (
            <button
              type="button"
              onClick={() => setMindMaxWidth(DEFAULT_MIND_MAX_WIDTH)}
            >
              {t('settings.resetMindWidth')}
            </button>
          )}
          {group === 'interaction' && (
            <button
              type="button"
              onClick={() =>
                setInteractionPreferences({
                  ...readInteractionPreferences(),
                  zoomSensitivity:
                    defaultInteractionPreferences.zoomSensitivity,
                  dragPanSpeed: defaultInteractionPreferences.dragPanSpeed,
                })
              }
            >
              {t('settings.resetInteraction')}
            </button>
          )}
        </section>
      )}
    />
  );
}

export function FrameSettingsPage({
  onBack,
  backLabel,
}: {
  onBack(): void;
  backLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <SettingsPageShell
      title={t('settings.title')}
      backLabel={backLabel ?? t('settings.back')}
      onBack={onBack}
      testId="settings-page"
      backTestId="settings-back"
    >
      <FrameSettingsContent />
    </SettingsPageShell>
  );
}
