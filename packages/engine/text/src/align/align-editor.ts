import { Alignment, BoardTextController } from '@sue/board-common';

export const AlignEditor = {
  isActive(editor: BoardTextController, alignment: Alignment) {
    return editor.document.align === alignment;
  },
  setAlign(editor: BoardTextController, alignment: Alignment) {
    editor.setAlign(alignment);
  },
};
