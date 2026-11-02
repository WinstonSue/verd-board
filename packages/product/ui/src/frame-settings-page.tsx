import { SettingsSection } from './components/settings-layout';
import { SettingsDraftInput } from './settings-draft';
import { validMindMaxWidth } from '@sue/board-mind';
import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import type { ControlProps } from '@sue/schema-settings-react';
import { useId, useState } from 'react';
import { SettingsCenter } from './settings-center';
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
  linkActivation: import('@sue/board-react-text').RichTextLinkActivation;
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

export function useApplicationSettingsModel() {
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
        key: 'linkActivation',
        editor: 'select',
        group: 'interaction',
        label: language === 'zh' ? '链接打开方式' : 'Open links',
        description:
          language === 'zh'
            ? '适用于编辑中的富文本；只读与演示始终单击打开。'
            : 'Applies while editing. Readonly and presentation links always open with a click.',
        props: { attributes: { 'data-testid': 'settings-link-activation' } },
        options: [
          {
            value: 'modifier',
            label: language === 'zh' ? '⌘/Ctrl + 点击' : '⌘/Ctrl + click',
          },
          { value: 'click', label: language === 'zh' ? '单击' : 'Click' },
        ],
      },
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
  return { id, t, language, setLanguage, values, definition };
}

export function FrameSettingsContent({
  section,
}: { headingLevel?: 2 | 3; section?: string } = {}) {
  const { id, t, setLanguage, values, definition } =
    useApplicationSettingsModel();
  return (
    <ConfigPanel
      definition={{
        ...definition,
        groups: definition.groups?.filter(
          (group) =>
            !section ||
            (section === 'editor'
              ? group.id !== 'general'
              : group.id === section),
        ),
        fields: definition.fields.filter(
          (field) =>
            !section ||
            (section === 'editor'
              ? field.group !== 'general'
              : field.group === section),
        ),
      }}
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
        key === 'mindWidth' ? (
          <div className="settings-form-row" data-setting-key={key}>
            <span>{label}</span>
            <SettingsDraftInput
              numeric
              value={values.mindWidth}
              label={String(label)}
              testId="settings-mind-max-width"
              onSave={(value) => {
                if (!value || !validMindMaxWidth(Number(value)))
                  throw new Error('请输入有效宽度 / Enter a valid width');
                setMindMaxWidth(Number(value));
              }}
            />
          </div>
        ) : key === 'zoomSensitivity' || key === 'dragPanSpeed' ? (
          <div className="frame-settings-control" data-setting-key={key}>
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
            <label className="frame-settings-row" data-setting-key={key}>
              <span>{label}</span>
              {editor}
            </label>
            {description && <p>{description}</p>}
          </>
        )
      }
      renderGroup={({ id: group, label, children }) => (
        <SettingsSection title={label}>
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
        </SettingsSection>
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
  const [section, setSection] = useState('personal.general');
  return (
    <SettingsCenter
      section={section}
      onSection={setSection}
      onBack={onBack}
      backLabel={backLabel}
      testId="settings-page"
      backTestId="settings-back"
    />
  );
}
