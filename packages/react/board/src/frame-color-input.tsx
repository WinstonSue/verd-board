import { useRef, type InputHTMLAttributes } from 'react';

/** Explicit picker input must commit even when its value equals the displayed theme color. */
export function FrameColorInput({
  onValue,
  onBlur,
  disabled,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'onInput'
> & {
  onValue(value: string): void;
}) {
  const lastInput = useRef<string | undefined>(undefined);
  return (
    <input
      {...props}
      type="color"
      disabled={disabled}
      onInput={(event) => {
        lastInput.current = event.currentTarget.value;
        if (!disabled) onValue(event.currentTarget.value);
      }}
      onChange={(event) => {
        if (
          !disabled &&
          event.nativeEvent.type === 'change' &&
          lastInput.current !== event.currentTarget.value
        )
          onValue(event.currentTarget.value);
      }}
      onBlur={(event) => {
        lastInput.current = undefined;
        onBlur?.(event);
      }}
    />
  );
}
