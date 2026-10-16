import { Alignment, type BoardTextDocument } from './editor-types';

/** A display default must not turn opening an editor into a document change. */
export function textWithDefaultAlignment(
  text: BoardTextDocument,
  alignment: Alignment,
): BoardTextDocument {
  return text.align === undefined ? { ...text, align: alignment } : text;
}

export function textWithoutDefaultAlignment(
  text: BoardTextDocument,
  original: BoardTextDocument,
  alignment: Alignment,
): BoardTextDocument {
  if (original.align !== undefined || text.align !== alignment) return text;
  const result = { ...text };
  delete result.align;
  return result;
}
