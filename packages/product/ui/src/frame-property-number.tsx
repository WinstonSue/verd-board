import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react';
import { FramePropertyContext } from './frame-property-panel';
import { useI18n } from './i18n';

type NumberProps = Omit<
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
  return (
    <NumberDraft
      key={`${context.identity}:${props.identity ?? ''}:${!!disabled}`}
      {...props}
      disabled={disabled}
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
