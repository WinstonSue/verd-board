import { Select, type SelectProps } from '@sue/design-web-react';
import type {
  ControlProps,
  SettingEditorProps,
} from '@sue/schema-settings-react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

const SettingsSelectContext = createContext({ active: true, identity: '' });

/** Hidden workspace panes stay mounted; their portaled controls must close. */
export function SettingsSelectScope({
  active,
  identity,
  children,
}: {
  active: boolean;
  identity: string;
  children: ReactNode;
}) {
  return (
    <SettingsSelectContext.Provider value={{ active, identity }}>
      {children}
    </SettingsSelectContext.Provider>
  );
}

/** Encode option identities without coercing the values submitted to the host. */
export function SettingsSelect<V>({
  value,
  options,
  onChange,
  active = true,
  ...props
}: Omit<SelectProps<string>, 'value' | 'options' | 'onChange'> & {
  active?: boolean;
  value: V;
  options: readonly { value: V; label: string; disabled?: boolean }[];
  onChange(value: V): void;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const selected = options.findIndex((option) =>
    Object.is(option.value, value),
  );
  return (
    <Select<string>
      {...props}
      open={active && !props.disabled && (props.open ?? open)}
      data-setting-value={
        selected < 0 ? undefined : String(options[selected].value)
      }
      virtual={props.virtual ?? false}
      value={selected < 0 ? undefined : String(selected)}
      options={options.map((option, index) => ({
        ...option,
        value: String(index),
      }))}
      optionRender={
        props.optionRender ??
        ((option) => (
          <span
            data-setting-option-value={String(
              options[Number(option.value)]?.value,
            )}
          >
            {option.label}
          </span>
        ))
      }
      onChange={(index) => {
        const option = options[Number(index)];
        if (active && !props.disabled && option && !option.disabled)
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

export function SettingsSelectEditor({
  value,
  options,
  props,
  disabled,
  state,
  label,
  onCommit,
  identity,
}: SettingEditorProps<unknown, ControlProps['select']>) {
  const scope = useContext(SettingsSelectContext);
  return (
    <SettingsSelect
      key={`${scope.identity}:${identity}`}
      active={scope.active}
      {...props.attributes}
      className="settings-select"
      getPopupContainer={(trigger: HTMLElement) =>
        trigger.closest<HTMLElement>('dialog') ??
        (trigger.ownerDocument.fullscreenElement as HTMLElement | null) ??
        trigger.ownerDocument.body
      }
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
