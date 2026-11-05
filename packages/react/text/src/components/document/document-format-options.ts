import type { Editor } from '@tiptap/react';
import type { Mark } from '@tiptap/pm/model';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Type,
} from 'lucide-react';

export const documentBlockFormats = [
  ['set-paragraph', '正文', 'Text', Type],
  ['heading-1', '一级标题', 'Heading 1', Heading1],
  ['heading-2', '二级标题', 'Heading 2', Heading2],
  ['heading-3', '三级标题', 'Heading 3', Heading3],
  ['heading-4', '四级标题', 'Heading 4', Heading4],
  ['heading-5', '五级标题', 'Heading 5', Heading5],
  ['heading-6', '六级标题', 'Heading 6', Heading6],
  ['toggle-bullet-list', '无序列表', 'Bulleted list', List],
  ['toggle-ordered-list', '有序列表', 'Numbered list', ListOrdered],
  ['toggle-blockquote', '引用', 'Quote', Quote],
  ['toggle-code-block', '代码块', 'Code block', SquareCode],
] as const;
export const documentAlignments = [
  ['align-left', '左对齐', 'Align left', AlignLeft],
  ['align-center', '居中', 'Align center', AlignCenter],
  ['align-right', '右对齐', 'Align right', AlignRight],
] as const;

// Literal colors use the existing schema and survive HTML export.
export const documentFormatColors = [
  ['红色', 'Red', '#d44c47', '#fbdedc'],
  ['橙色', 'Orange', '#d96c24', '#fbe5d1'],
  ['黄色', 'Yellow', '#b88a00', '#fef0b3'],
  ['绿色', 'Green', '#31875b', '#d9efdf'],
  ['青色', 'Teal', '#258a94', '#d4eff0'],
  ['蓝色', 'Blue', '#3b70c4', '#dce8fb'],
  ['紫色', 'Purple', '#8a55bd', '#eddef7'],
  ['灰色', 'Grey', '#787878', '#e6e6e6'],
] as const;

/** null follows the theme; mixed never selects an arbitrary palette entry. */
export function selectionColor(
  editor: Editor,
  background = false,
): string | null | 'mixed' {
  const { state } = editor;
  const values = new Set<string | null>();
  const read = (marks: readonly Mark[]) => {
    const mark = marks.find(
      (item) => item.type.name === (background ? 'highlight' : 'textStyle'),
    );
    values.add(
      mark && (background || mark.attrs['colorSource'] === 'custom')
        ? (mark.attrs['color'] ?? null)
        : null,
    );
  };
  if (state.selection.empty)
    read(state.storedMarks ?? state.selection.$from.marks());
  else
    state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
      if (node.isText) read(node.marks);
    });
  return values.size > 1 ? 'mixed' : (values.values().next().value ?? null);
}
