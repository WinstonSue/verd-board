import {
  Attachment,
  WebEmbed,
} from '../components/document/document-resources';
import {
  Details,
  DetailsSummary,
  DetailsContent,
} from '@tiptap/extension-details';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { DocumentFolding } from '../components/document/document-rich-content';
import { DocumentSearchHighlight } from '../components/document/document-search-highlight';
import { StableBlocks } from './stable-blocks';
import { DocumentTableSelection } from '../components/document/document-table';
import { StarterKit } from '@tiptap/starter-kit';
import { Heading } from '@tiptap/extension-heading';
import { BulletList } from '@tiptap/extension-bullet-list';
import { OrderedList } from '@tiptap/extension-ordered-list';
import { ListItem } from '@tiptap/extension-list-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Underline } from '@tiptap/extension-underline';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style';
import { ThemeColor } from './theme-color';
import { TextAlign } from '@tiptap/extension-text-align';
import { Highlight, Superscript, Subscript, Image } from './content-extensions';
import {
  DocumentFrameReference,
  DocumentExcerpt,
} from '../components/document/document-frame-reference';

const sharedMarks = [
  Underline,
  TextStyle,
  ThemeColor,
  FontSize,
  FontFamily,
  Highlight,
  Superscript,
  Subscript,
];

const linkOptions = {
  protocols: ['verd'],
  openOnClick: false,
  HTMLAttributes: {
    class: 'board-link',
  },
};

const starterKitOptions = {
  heading: false as const,
  bulletList: false as const,
  orderedList: false as const,
  listItem: false as const,
  underline: false as const,
  // Merely focusing a document ending in a table/image must not insert text.
  trailingNode: false as const,
  link: linkOptions,
};

/** Everything below the doc node shared by canvas text and documents. */
const blockContentExtensions = [
  Heading.configure({
    levels: [1, 2, 3, 4, 5, 6],
  }),
  ...sharedMarks,
  TextAlign.configure({
    types: ['heading', 'paragraph'],
  }),
  BulletList,
  OrderedList,
  ListItem,
  Table.configure({
    resizable: true,
    renderWrapper: true,
  }),
  TableRow,
  TableCell,
  TableHeader,
  Image,
];

export const contentExtensions = [
  StarterKit.configure(starterKitOptions),
  ...blockContentExtensions,
];

export const paragraphExtensions = [
  ...contentExtensions,
  Placeholder.configure({
    placeholder: '输入内容...',
  }),
];

export const lineExtensions = [
  // Inline input restricts keys and paste, not the persisted document schema.
  ...contentExtensions,
  Placeholder.configure({
    placeholder: '输入主题',
  }),
];

export interface DocumentExtensionOptions {
  /**
   * Local TipTap undo/redo. Workspaces pass a central history adapter and
   * turn this off; standalone consumers keep it on.
   */
  folding?: import('../components/document/folding-store').DocumentFoldingAdapter;
  history?: boolean;
  placeholder?: string;
  placeholderContext?(): {
    locale: 'zh' | 'en';
    references: boolean;
    paragraph?: string;
  };
  onMathEdit?(latex: string, pos: number, block: boolean): void;
}

export const createDocumentExtensions = ({
  history = true,
  placeholder,
  placeholderContext,
  onMathEdit,
  folding,
}: DocumentExtensionOptions = {}) => [
  StarterKit.configure({
    ...starterKitOptions,
    // Workspace links belong to standalone documents, never canvas labels.
    link: { ...linkOptions, protocols: ['verd'] },
    ...(history ? {} : { undoRedo: false as const }),
  }),
  ...blockContentExtensions.map((extension) =>
    extension.name === 'table'
      ? extension.configure({ cellMinWidth: 96 })
      : extension,
  ),
  DocumentTableSelection,
  Details.extend({
    addNodeView() {
      const render = this.parent?.();
      if (!render) return null;
      return (props) => {
        const view = render(props);
        const ignore = view.ignoreMutation;
        // The disclosure button belongs to the node view, never its content.
        // SVG updates must not trigger DOM parsing and recreate the node view.
        view.ignoreMutation = (mutation) => {
          const button = (view.dom as HTMLElement).querySelector(
            ':scope > button',
          );
          return (
            button?.contains(mutation.target) ||
            ignore?.call(view, mutation) ||
            false
          );
        };
        return view;
      };
    },
  }).configure({ persist: false }),
  DetailsSummary,
  DetailsContent,
  InlineMath.extend({ addInputRules: () => [] }).configure({
    katexOptions: { trust: false, throwOnError: false },
    onClick: (node, pos) => onMathEdit?.(node.attrs['latex'], pos, false),
  }),
  BlockMath.extend({ addInputRules: () => [] }).configure({
    katexOptions: { trust: false, throwOnError: false },
    onClick: (node, pos) => onMathEdit?.(node.attrs['latex'], pos, true),
  }),
  DocumentFolding.configure({ folding }),
  DocumentSearchHighlight,
  Attachment,
  WebEmbed,
  DocumentFrameReference,
  DocumentExcerpt,
  StableBlocks,
  Placeholder.configure({
    includeChildren: true,
    placeholder: ({ node, pos, editor }) => {
      const resolved = editor.state.doc.resolve(pos);
      for (let depth = resolved.depth; depth > 0; depth--)
        if (
          ['tableCell', 'tableHeader'].includes(resolved.node(depth).type.name)
        )
          return '';
      const context = placeholderContext?.();
      const english = context?.locale === 'en';
      if (node.type.name === 'heading')
        return `${english ? 'Heading' : '标题'} ${node.attrs['level']}`;
      if (node.type.name !== 'paragraph') return '';
      return (
        context?.paragraph ??
        placeholder ??
        (english
          ? context?.references
            ? 'Type / to insert content or @ to reference a document or canvas'
            : 'Type / to insert content'
          : context?.references
            ? '输入 / 插入内容，输入 @ 引用文档或画布'
            : DEFAULT_PLACEHOLDERS.document)
      );
    },
  }),
];

export const DEFAULT_PLACEHOLDERS = {
  paragraph: '输入内容...',
  line: '输入主题',
  document: '输入 / 插入内容',
} as const;
