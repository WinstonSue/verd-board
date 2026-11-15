import {
  ConfigPanel,
  defineSettings,
  type SettingEditorProps,
} from '@sue/board-react';
import { useEffect, useState } from 'react';
import {
  MIN_MIND_MAX_WIDTH,
  MAX_MIND_MAX_WIDTH,
  validMindMaxWidth,
} from '@sue/board-mind';
/** Keep incomplete number input local; only valid integer widths reach settings/transactions. */
function MindWidthDraft({
  value,
  onChange,
  label,
  testId,
  placeholder,
  onClear,
}: {
  value: number | undefined;
  onChange(value: number): void;
  placeholder?: string;
  onClear?(): void;
  label: string;
  testId: string;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  return (
    <input
      type="number"
      min={MIN_MIND_MAX_WIDTH}
      max={MAX_MIND_MAX_WIDTH}
      step={1}
      aria-label={label}
      data-testid={testId}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        if (!event.target.value && onClear) {
          onClear();
          return;
        }
        const next = Number(event.target.value);
        if (validMindMaxWidth(next) && next !== value) onChange(next);
      }}
      onBlur={() => setDraft(value === undefined ? '' : String(value))}
    />
  );
}

export function FrameMindWidthInput(
  props: Parameters<typeof MindWidthDraft>[0],
) {
  const definition = defineSettings<
    { width: number | undefined },
    void,
    { mindWidth: typeof props }
  >({
    fields: [{ key: 'width', editor: 'mindWidth', props, commit: 'manual' }],
  });
  return (
    <ConfigPanel
      definition={definition}
      values={{ width: props.value }}
      identity={props.testId}
      components={{ mindWidth: MindWidthEditor }}
      renderField={({ editor }) => editor}
      onCommit={({ changes }) => {
        for (const change of changes)
          if (change.kind === 'reset') props.onClear?.();
          else if (change.value !== undefined) props.onChange(change.value);
      }}
    />
  );
}
function MindWidthEditor({
  props,
  onCommit,
  onReset,
}: SettingEditorProps<unknown, Parameters<typeof MindWidthDraft>[0]>) {
  return (
    <MindWidthDraft
      {...props}
      onChange={onCommit}
      onClear={props.onClear ? onReset : undefined}
    />
  );
}
