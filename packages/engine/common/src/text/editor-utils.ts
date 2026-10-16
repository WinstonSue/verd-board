import {
  BoardTextController,
  BoardTextDocument,
  BoardTextUtils,
} from './editor-types';

export const NodeUtils = {
  string(
    node: BoardTextDocument | BoardTextController | { text?: string },
  ): string {
    if ('plainText' in node && typeof node.plainText === 'string') {
      return node.plainText;
    }
    if ('document' in node) {
      return node.document.plainText;
    }
    if ('text' in node && typeof node.text === 'string') {
      return node.text;
    }
    return BoardTextUtils.plainText(node);
  },
};
