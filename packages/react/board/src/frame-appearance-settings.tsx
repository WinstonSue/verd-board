import {
  ConfigPanel,
  defineSettings,
  type ControlProps,
  type SettingEditorProps,
  type SettingsRequest,
  type CommitResult,
} from '@sue/schema-settings-react';
import { useContext, useId, useEffect, useRef, useState } from 'react';
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
  appearanceColor: {
    fallback: string;
    ariaLabel: string;
    mixedLabel: string;
    text?: boolean;
    onSelect?(value: string): void;
  };
}
function AppearanceColor({
  value,
  props,
  disabled,
  state,
  onCommit,
  identity,
}: SettingEditorProps<unknown, AppearanceControls['appearanceColor']>) {
  const descriptionId = useId();
  const [draft, setDraft] = useState(String(value ?? ''));
  const edited = useRef(false);
  const lastInput = useRef<string | undefined>(undefined);
  useEffect(() => {
    lastInput.current = undefined;
  }, [identity]);
  useEffect(() => {
    setDraft(String(value ?? ''));
    edited.current = false;
  }, [value, identity]);
  const select = (next: string) => {
    if (!disabled) (props.onSelect ?? onCommit)(next);
  };
  const commitDraft = () => {
    if (edited.current) {
      edited.current = false;
      select(draft);
    }
  };
  return (
    <>
      <input
        type={props.text ? 'text' : 'color'}
        aria-label={props.ariaLabel}
        disabled={disabled}
        data-mixed={state.mixed || undefined}
        title={state.mixed ? props.mixedLabel : undefined}
        aria-describedby={state.mixed ? descriptionId : undefined}
        value={
          props.text
            ? draft
            : /^#[0-9a-f]{6}$/i.test(String(value))
              ? String(value)
              : props.fallback
        }
        onChange={(event) => {
          if (props.text) {
            setDraft(event.target.value);
            edited.current = true;
          } else if (
            event.nativeEvent.type === 'change' &&
            lastInput.current !== event.target.value
          )
            select(event.target.value);
        }}
        onInput={
          props.text
            ? undefined
            : (event) => {
                lastInput.current = event.currentTarget.value;
                select(event.currentTarget.value);
              }
        }
        onBlur={props.text ? commitDraft : undefined}
        onKeyDown={
          props.text
            ? (event) => {
                if (event.key === 'Enter') commitDraft();
                if (event.key === 'Escape') {
                  edited.current = false;
                  setDraft(String(value ?? ''));
                }
              }
            : undefined
        }
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
  onResetColor,
  onSetColor,
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
  onResetColor?(key: 'fill' | 'strokeColor'): void;
  onSetColor?(key: 'fill' | 'strokeColor', value: string): void;
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
    editor: 'appearanceColor' as const,
    props: {
      fallback: key === 'fill' ? '#ffffff' : strokeFallback,
      ariaLabel: !product
        ? key
        : single && zh
          ? key === 'fill'
            ? '填充'
            : '描边'
          : key === 'fill'
            ? 'Fill color'
            : 'Stroke color',
      mixedLabel,
      text: !product,
      onSelect: onSetColor
        ? (value: string) => onSetColor(key, value)
        : undefined,
    },
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
          {onResetColor && (key === 'fill' || key === 'strokeColor') && (
            <button
              type="button"
              aria-label={
                key === 'fill' ? 'Reset fill to theme' : 'Reset stroke to theme'
              }
              disabled={disabled || context.disabled}
              onClick={() => onResetColor(key)}
            >
              {zh ? '主题颜色' : 'Theme color'}
            </button>
          )}
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
