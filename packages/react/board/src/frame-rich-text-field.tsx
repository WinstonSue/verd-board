import { useState, useMemo } from 'react';
import {
  isBoardTextDocument,
  sameBoardText,
  type BoardTextDocument,
  type Alignment,
  textWithDefaultAlignment,
  textWithoutDefaultAlignment,
} from '@sue/board-common';
import { LineText } from '@sue/board-react-text';

export function existingTextDocument(
  text: unknown,
  _label = '',
): BoardTextDocument | undefined {
  return isBoardTextDocument(text) ? text : undefined;
}

/** Edits an existing document through the shared inline editor. */
export function FrameRichTextField({
  text,
  readonly,
  label,
  testId,
  defaultAlign,
  onChange,
}: {
  text: BoardTextDocument;
  readonly?: boolean;
  label: string;
  testId?: string;
  defaultAlign?: Alignment;
  onChange(
    text: BoardTextDocument,
  ): void | Promise<{ status: string } | undefined>;
}) {
  const [epoch, setEpoch] = useState(0);
  const effectiveText = useMemo(
    () => (defaultAlign ? textWithDefaultAlignment(text, defaultAlign) : text),
    [text, defaultAlign],
  );
  return (
    <LineText
      key={epoch}
      text={effectiveText}
      // Property fields must not take focus when the selection changes.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={false}
      readonly={readonly}
      attributes={{
        'aria-label': label,
        ...(testId ? { 'data-testid': testId } : {}),
      }}
      onChange={({ newText }) => {
        if (defaultAlign)
          newText = textWithoutDefaultAlignment(newText, text, defaultAlign);
        if (sameBoardText(text, newText)) return;
        void Promise.resolve(onChange(newText)).then((result) => {
          if (result?.status === 'rejected') setEpoch((value) => value + 1);
        });
      }}
    />
  );
}
