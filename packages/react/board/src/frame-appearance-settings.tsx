import {
  ConfigPanel,
  defineSettings,
  type ControlProps,
  type SettingEditorProps,
  type SettingsRequest,
  type CommitResult,
} from '@sue/schema-settings-react';
import { useContext, useId } from 'react';
import { FramePropertyContext } from './frame-property-panel';
import { NumberEditor, type NumberProps } from './frame-property-number';

export interface AppearanceSettingsValues {
  fill: string | undefined;
  strokeColor: string | undefined;
  strokeWidth: number | undefined;
  opacity: number | undefined;
  strokeStyle: 'solid' | 'dashed' | 'dotted' | undefined;
  shadow: string | undefined;
}
interface AppearanceControls extends ControlProps {
  appearanceNumber: Omit<NumberProps, 'value' | 'onCommit'>;
  appearanceColor: { fallback: string; ariaLabel: string; mixedLabel: string };
}
function AppearanceColor({
  value,
  props,
  disabled,
  state,
  onCommit,
}: SettingEditorProps<unknown, AppearanceControls['appearanceColor']>) {
  const descriptionId = useId();
  return (
    <>
      <input
        type="color"
        aria-label={props.ariaLabel}
        disabled={disabled}
        data-mixed={state.mixed || undefined}
        title={state.mixed ? props.mixedLabel : undefined}
        aria-describedby={state.mixed ? descriptionId : undefined}
        value={
          /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : props.fallback
        }
        onChange={(event) => onCommit(event.target.value)}
      />
      {state.mixed && (
        <span id={descriptionId} hidden>
          {props.mixedLabel}
        </span>
      )}
    </>
  );
}
const components = {
  appearanceNumber: NumberEditor,
  appearanceColor: AppearanceColor,
};

/** One declaration serves singleton embedding and the product's aggregated selection. */
export function FrameAppearanceSettings({
  values,
  identity,
  language,
  profile,
  includeFill,
  single = false,
  disabled = false,
  strokeFallback = '#64748b',
  onCommit,
  onClear,
}: {
  values: AppearanceSettingsValues;
  identity: string;
  language: 'zh' | 'en';
  profile: 'editor' | 'product';
  includeFill: boolean;
  single?: boolean;
  disabled?: boolean;
  strokeFallback?: string;
  onCommit(
    request: SettingsRequest<AppearanceSettingsValues>,
  ): CommitResult | Promise<CommitResult>;
  onClear?(key: 'fill' | 'strokeColor'): void;
}) {
  const context = useContext(FramePropertyContext);
  const product = profile === 'product';
  const zh = language === 'zh';
  const mixedLabel = zh ? '混合值' : 'Mixed values';
  const label = (key: keyof AppearanceSettingsValues) =>
    !product
      ? key
      : {
          fill: zh ? '填充' : 'Fill',
          strokeColor: zh ? '描边' : 'Stroke',
          strokeWidth: zh ? '线宽' : 'Stroke width',
          opacity: zh ? '不透明度' : 'Opacity',
          strokeStyle: zh ? '线型' : 'Stroke style',
          shadow: zh ? '阴影' : 'Shadow',
        }[key];
  const color = (key: 'fill' | 'strokeColor') => ({
    key,
    label: label(key),
    ...(product
      ? {
          editor: 'appearanceColor' as const,
          props: {
            fallback: key === 'fill' ? '#ffffff' : strokeFallback,
            ariaLabel:
              single && zh
                ? key === 'fill'
                  ? '填充'
                  : '描边'
                : key === 'fill'
                  ? 'Fill color'
                  : 'Stroke color',
            mixedLabel,
          },
        }
      : {
          editor: 'text' as const,
          commit: 'blur' as const,
          props: { attributes: { 'aria-label': key } },
        }),
  });
  const definition = defineSettings<
    AppearanceSettingsValues,
    void,
    AppearanceControls
  >({
    fields: [
      ...(includeFill ? [color('fill')] : []),
      color('strokeColor'),
      {
        key: 'strokeWidth',
        label: label('strokeWidth'),
        editor: 'appearanceNumber',
        props: {
          min: 0,
          step: product ? 0.5 : 1,
          'aria-label': product ? 'Stroke width' : 'strokeWidth',
        },
      },
      ...(product
        ? [
            {
              key: 'strokeStyle' as const,
              label: label('strokeStyle'),
              editor: 'select' as const,
              props: {
                attributes: { 'aria-label': 'Stroke style' },
                mixedLabel,
              },
              options: [
                { value: 'solid' as const, label: zh ? '实线' : 'Solid' },
                { value: 'dashed' as const, label: zh ? '虚线' : 'Dashed' },
                { value: 'dotted' as const, label: zh ? '点线' : 'Dotted' },
              ],
            },
          ]
        : []),
      {
        key: 'opacity',
        label: label('opacity'),
        editor: 'appearanceNumber',
        props: {
          min: 0,
          max: 1,
          step: product ? 0.05 : 0.1,
          'aria-label': product ? 'Opacity' : 'opacity',
        },
      },
      ...(product
        ? [
            {
              key: 'shadow' as const,
              label: label('shadow'),
              editor: 'select' as const,
              props: { attributes: { 'aria-label': 'Shadow' }, mixedLabel },
              options: [
                { value: 'none', label: zh ? '无' : 'None' },
                { value: 'sm', label: zh ? '小' : 'Small' },
                { value: 'md', label: zh ? '中' : 'Medium' },
                { value: 'lg', label: zh ? '大' : 'Large' },
              ],
            },
          ]
        : []),
    ],
  });
  const states = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      { mixed: product && value === undefined },
    ]),
  );
  return (
    <ConfigPanel
      definition={definition}
      values={values}
      identity={`${context.identity}:${identity}`}
      disabled={disabled || context.disabled}
      fieldStates={states}
      components={components}
      onCommit={onCommit}
      renderField={({ key, label: title, editor }) => (
        <label>
          {title}
          {editor}
          {onClear && (key === 'fill' || key === 'strokeColor') && (
            <button
              aria-label={
                key === 'fill'
                  ? zh
                    ? '无填充'
                    : 'No fill'
                  : zh
                    ? '无描边'
                    : 'No stroke'
              }
              onClick={() => onClear(key)}
            >
              {key === 'fill'
                ? zh
                  ? '无填充'
                  : 'No fill'
                : zh
                  ? '无描边'
                  : 'No stroke'}
            </button>
          )}
        </label>
      )}
    />
  );
}
