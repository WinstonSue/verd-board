import { type TextComponentProps } from './types';
import React from 'react';
import { LineText } from './components/line/line-text';
import { ParagraphText } from './components/paragraph/paragraph-text';
import { type BoardTextDocument } from '@sue/board-common';

import './styles/index.scss';

export const Text: React.FC<TextComponentProps> = (
  props: TextComponentProps,
) => {
  const document = props.text;
  if (document.kind === 'block') {
    return <ParagraphText {...props} text={document} />;
  }
  return (
    <LineText
      {...props}
      text={document}
      element={document as BoardTextDocument}
    />
  );
};
