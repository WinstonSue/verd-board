import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, FontSize, FontFamily } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import { Highlight, Superscript, Subscript, Image } from './content-extensions';
import { DocumentFrameReference } from '../components/document/document-frame-reference';

const sharedMarks = [
  Underline,
  TextStyle,
  Color,
  FontSize,
  FontFamily,
  Highlight,
  Superscript,
  Subscript,
];

const linkOptions = {
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
  history?: boolean;
  placeholder?: string;
}

export const createDocumentExtensions = ({
  history = true,
  placeholder,
}: DocumentExtensionOptions = {}) => [
  StarterKit.configure({
    ...starterKitOptions,
    // Workspace links belong to standalone documents, never canvas labels.
    link: { ...linkOptions, protocols: ['verd'] },
    ...(history ? {} : { undoRedo: false as const }),
  }),
  ...blockContentExtensions,
  DocumentFrameReference,
  Placeholder.configure({
    placeholder: placeholder ?? DEFAULT_PLACEHOLDERS.document,
  }),
];

export const DEFAULT_PLACEHOLDERS = {
  paragraph: '输入内容...',
  line: '输入主题',
  document: '输入正文...',
} as const;
