import { BoardTextDocument, isBoardTextDocument } from './editor-types';
import { DEFAULT_FONT_FAMILY } from '../constants/default';
interface ElementSize {
  width: number;
  height: number;
}

export function measureText(
  text: BoardTextDocument | string | unknown,
  options?: { fontSize?: number; fontFamily?: string },
): ElementSize {
  const plain =
    typeof text === 'string'
      ? text
      : isBoardTextDocument(text)
        ? text.plainText || ''
        : '';
  const fontSize = options?.fontSize || 14;
  const fontFamily = options?.fontFamily || DEFAULT_FONT_FAMILY;
  if (typeof document === 'undefined') {
    return {
      width: Math.max(plain.length * fontSize * 0.6, fontSize),
      height: fontSize * 1.5,
    };
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      width: Math.max(plain.length * fontSize * 0.6, fontSize),
      height: fontSize * 1.5,
    };
  }
  ctx.font = `${fontSize}px ${fontFamily}`;
  return {
    width: Math.max(ctx.measureText(plain || ' ').width, fontSize),
    height: fontSize * 1.5,
  };
}
