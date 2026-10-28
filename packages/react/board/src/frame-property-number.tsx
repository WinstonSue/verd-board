import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { useFrameI18n as useI18n } from './frame-i18n';
import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/schema-settings-react';
import { FramePropertyContext } from './frame-property-panel';

export type NumberProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'min' | 'max' | 'step'
> & {
  value: number | undefined;
  onCommit(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  mixed?: boolean;
  identity?: string;
  precision?: number;
  validate?(value: number): boolean;
};

/** A selection/permission change destroys the draft, including a pending blur. */
export function FramePropertyNumber(props: NumberProps) {
  const context = useContext(FramePropertyContext);
  const disabled = props.disabled || context.disabled;
  const definition = defineSettings<
    { value: number | undefined },
    void,
    { draftNumber: NumberProps }
  >({
    fields: [{ key: 'value', editor: 'draftNumber', commit: 'manual', props }],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{ value: props.value }}
      identity={`${context.identity}:${props.identity ?? ''}`}
      disabled={!!disabled}
      fieldStates={{ value: { mixed: props.mixed } }}
      components={{ draftNumber: NumberEditor }}
      renderField={({ editor }) => editor}
      onCommit={({ changes }) => {
        for (const change of changes)
          if (change.kind === 'set' && change.value !== undefined)
            props.onCommit(change.value);
      }}
    />
  );
}

export function NumberEditor({
  value,
  props,
  disabled,
  state,
  onCommit,
}: SettingEditorProps<unknown, Omit<NumberProps, 'value' | 'onCommit'>>) {
  return (
    <NumberDraft
      {...props}
      value={value as number | undefined}
      disabled={disabled}
      mixed={state.mixed ?? props.mixed}
      onCommit={onCommit}
    />
  );
}

function NumberDraft({
  value,
  onCommit,
  min,
  max,
  step = 1,
  mixed,
  precision,
  validate,
  identity: _identity,
  ...props
}: NumberProps) {
  const { language } = useI18n();
  const format = (value: number | undefined) =>
    value === undefined ? '' : String(value);
  const [draft, setDraft] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);
  const dirty = useRef(false);
  const alive = useRef(true);
  const errorId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty.current) setDraft(format(value));
  }, [value]);
  const reset = () => {
    dirty.current = false;
    setDraft(format(value));
    setInvalid(false);
  };
  const commit = (blur: boolean) => {
    if (!alive.current || props.disabled || !dirty.current) return;
    // Number('') is zero; an empty or incomplete draft is never a number edit.
    const parsed = draft.trim() === '' ? NaN : Number(draft);
    const valid =
      Number.isFinite(parsed) &&
      (min === undefined || parsed >= min) &&
      (max === undefined || parsed <= max) &&
      (!validate || validate(parsed));
    if (!valid) {
      if (blur) reset();
      else setInvalid(true);
      return;
    }
    const next =
      precision === undefined
        ? parsed
        : precision === 0
          ? Math.round(parsed)
          : Number(parsed.toFixed(precision));
    dirty.current = false;
    setInvalid(false);
    setDraft(format(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span className="frame-property-number">
      <input
        {...props}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        placeholder={
          mixed
            ? language === 'zh'
              ? '混合值'
              : 'Mixed values'
            : props.placeholder
        }
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : props['aria-describedby']}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={() => commit(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            commit(false);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            reset();
          }
        }}
      />
      {invalid && (
        <span id={errorId} role="alert" className="frame-property-error">
          {language === 'zh'
            ? '请输入范围内的有效数字'
            : 'Enter a valid number within range'}
        </span>
      )}
    </span>
  );
}
