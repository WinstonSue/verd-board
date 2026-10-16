import {
  BoardTextController,
  BoardTextDocument,
  BoardTextMarks,
} from '@sue/board-common';
import { FontSizes, MarkTypes } from './types';

const markMap: Record<MarkTypes, keyof BoardTextMarks> = {
  [MarkTypes.bold]: 'bold',
  [MarkTypes.italic]: 'italic',
  [MarkTypes.underline]: 'underline',
  [MarkTypes.strike]: 'strike',
  [MarkTypes.color]: 'color',
  [MarkTypes.fontSize]: 'fontSize',
};

function marksFromDocument(document: BoardTextDocument): BoardTextMarks {
  const marks: BoardTextMarks = {};
  const visit = (node: BoardTextDocument['content'] | undefined) => {
    if (!node) return;
    for (const mark of node.marks || []) {
      if (mark.type === 'bold') marks.bold = true;
      if (mark.type === 'italic') marks.italic = true;
      if (mark.type === 'underline') marks.underline = true;
      if (mark.type === 'strike') marks.strike = true;
      if (mark.type === 'textStyle') {
        if (typeof mark.attrs?.color === 'string')
          marks.color = mark.attrs.color;
        if (typeof mark.attrs?.fontSize === 'string') {
          marks.fontSize = mark.attrs.fontSize;
        }
      }
    }
    node.content?.forEach(visit);
  };
  visit(document.content);
  return marks;
}

export const MarkEditor = {
  getMarks(editor: BoardTextController): BoardTextMarks {
    return editor.getActiveMarks();
  },
  getMarksByElement(document: BoardTextDocument): BoardTextMarks {
    return marksFromDocument(document);
  },
  isMarkActive(editor: BoardTextController, format: MarkTypes) {
    const marks = editor.getActiveMarks();
    return Boolean(marks[markMap[format]]);
  },
  toggleMark(editor: BoardTextController, format: MarkTypes) {
    editor.toggleMark(markMap[format]);
  },
  setFontSizeMark(editor: BoardTextController, size: FontSizes) {
    editor.applyMark('fontSize', size);
  },
  setColorMark(editor: BoardTextController, color: string | null) {
    editor.applyMark('color', color || undefined);
  },
};
