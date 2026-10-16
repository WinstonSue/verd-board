import { BoardTextDocument, BoardTextUtils } from '../editor-types';

export function extractPlainText(value: unknown): string {
  if (BoardTextUtils.plainText(value)) {
    return BoardTextUtils.plainText(value);
  }
  if (value && typeof value === 'object' && 'plainText' in value) {
    return String((value as { plainText?: string }).plainText || '');
  }
  return '';
}

export function isNoteVisuallyEmpty(
  document: BoardTextDocument | unknown,
): boolean {
  return extractPlainText(document).trim().length === 0;
}
