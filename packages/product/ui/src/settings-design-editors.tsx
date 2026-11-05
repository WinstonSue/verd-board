import {
  Checkbox,
  Select,
  Slider,
  type SelectProps,
} from '@sue/design-web-react';
import type {
  ControlProps,
  SettingEditorProps,
  SettingsComponents,
} from '@sue/schema-settings-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  WorkspaceInput,
  WorkspaceNumberInput,
  WorkspaceTextArea,
} from './workspace-design';

/** Encode option identities without coercing the values submitted to the host. */
export function SettingsSelect<V>({
  value,
  options,
  onChange,
  ...props
}: Omit<SelectProps<string>, 'value' | 'options' | 'onChange'> & {
  value: V;
  options: readonly { value: V; label: string; disabled?: boolean }[];
  onChange(value: V): void;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const selected = options.findIndex((option) =>
    Object.is(option.value, value),
  );
  return (
    <Select<string>
      {...props}
      open={props.open ?? open}
      virtual={props.virtual ?? false}
      value={selected < 0 ? undefined : String(selected)}
      options={options.map((option, index) => ({
        ...option,
        value: String(index),
      }))}
      onChange={(index) => {
        const option = options[Number(index)];
        if (!props.disabled && option && !option.disabled)
          onChange(option.value);
      }}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChange?.(next);
      }}
      onInputKeyDown={(event) => {
        // stopPropagation alone does not cancel a native dialog's Escape action.
        if (event.key === 'Escape' && (props.open ?? open)) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          props.onOpenChange?.(false);
        }
        props.onInputKeyDown?.(event);
      }}
    />
  );
}

function SelectEditor({
  value,
  options,
  props,
  disabled,
  state,
  label,
  onCommit,
}: SettingEditorProps<unknown, ControlProps['select']>) {
  return (
    <SettingsSelect
      {...props.attributes}
      className="settings-select"
      aria-label={String(props.attributes?.['aria-label'] ?? label)}
      value={state.mixed ? Symbol.for('settings.mixed') : value}
      options={options}
      placeholder={
        state.mixed ? (props.mixedLabel ?? 'Mixed values') : undefined
      }
      disabled={disabled}
      onChange={onCommit}
    />
  );
}

function CheckboxEditor({
  value,
  props,
  disabled,
  state,
  label,
  onCommit,
}: SettingEditorProps<unknown, ControlProps['checkbox']>) {
  return (
    <Checkbox
      {...props.attributes}
      aria-label={String(props.attributes?.['aria-label'] ?? label)}
      checked={!!value}
      indeterminate={state.mixed}
      disabled={disabled}
      onChange={(event) => !disabled && onCommit(event.target.checked)}
    />
  );
}

function RangeEditor({
  value,
  props: { attributes, ...props },
  disabled,
  label,
  onCommit,
}: SettingEditorProps<unknown, ControlProps['range']>) {
  const valueText = attributes?.['aria-valuetext'];
  return (
    <div className="settings-slider" data-testid={attributes?.['data-testid']}>
      <Slider
        {...props}
        id={
          attributes?.['id'] === undefined
            ? undefined
            : String(attributes['id'])
        }
        ariaLabelForHandle={String(attributes?.['aria-label'] ?? label)}
        ariaValueTextFormatterForHandle={
          valueText === undefined ? undefined : () => String(valueText)
        }
        value={typeof value === 'number' ? value : (props.min ?? 0)}
        disabled={disabled}
        onChange={(next) => !disabled && onCommit(next)}
      />
    </div>
  );
}

function DraftEditor({
  numeric,
  value,
  props,
  disabled,
  state,
  label,
  commit,
  onCommit,
}: SettingEditorProps<
  unknown,
  ControlProps['text'] & ControlProps['number']
> & {
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(
    state.mixed || value === undefined ? '' : String(value),
  );
  const [invalid, setInvalid] = useState(false);
  const composing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    setDraft(state.mixed || value === undefined ? '' : String(value));
    setInvalid(false);
    dirty.current = false;
  }, [value, state.mixed]);
  const save = (next = draft) => {
    if (disabled || composing.current || !dirty.current) return;
    const number = Number(next);
    if (
      numeric &&
      (!next.trim() ||
        !Number.isFinite(number) ||
        (props.min !== undefined && number < props.min) ||
        (props.max !== undefined && number > props.max))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    dirty.current = false;
    onCommit(
      numeric && props.precision !== undefined
        ? Number(number.toFixed(props.precision))
        : numeric
          ? number
          : next,
    );
  };
  const change = (next: string) => {
    dirty.current = true;
    setDraft(next);
    if (commit === 'change') save(next);
  };
  const common = {
    ...props.attributes,
    'aria-label': String(props.attributes?.['aria-label'] ?? label),
    'aria-invalid': invalid,
    disabled,
    value: draft,
    status: invalid ? ('error' as const) : undefined,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onBlur: () => {
      if (commit === 'blur' || commit === 'enter-blur') save();
    },
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (numeric && event.key === 'Enter' && composing.current) {
        event.stopPropagation();
        return;
      }
      if (event.key === 'Escape' && (dirty.current || invalid)) {
        event.preventDefault();
        event.stopPropagation();
        setDraft(state.mixed || value === undefined ? '' : String(value));
        setInvalid(false);
        dirty.current = false;
      }
      if (
        event.key === 'Enter' &&
        !composing.current &&
        (!props.multiline || event.metaKey || event.ctrlKey)
      ) {
        // InputNumber otherwise flushes and clamps the value before validation.
        event.preventDefault();
        event.stopPropagation();
        if (commit === 'enter-blur') save();
      }
    },
  };
  return numeric ? (
    <WorkspaceNumberInput
      {...common}
      min={props.min}
      max={props.max}
      step={props.step}
      onValueChange={change}
    />
  ) : props.multiline ? (
    <WorkspaceTextArea
      {...common}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      onChange={(event) => change(event.target.value)}
    />
  ) : (
    <WorkspaceInput
      {...common}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      onChange={(event) => change(event.target.value)}
    />
  );
}

function NumberEditor(
  props: SettingEditorProps<unknown, ControlProps['number']>,
) {
  return <DraftEditor {...props} numeric />;
}

export const settingsDesignComponents = {
  select: SelectEditor,
  range: RangeEditor,
  checkbox: CheckboxEditor,
  text: DraftEditor,
  number: NumberEditor,
} satisfies SettingsComponents<ControlProps>;
