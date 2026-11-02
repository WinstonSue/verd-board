import { DocumentImageView } from '../components/document/asset-resolver';
import {
  Mark,
  Node,
  mergeAttributes,
  ReactNodeViewRenderer,
} from '@tiptap/react';

// These persisted formats also need a schema when there is no formatting button.
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.style.backgroundColor || null,
        renderHTML: ({ color }) =>
          color ? { style: `background-color: ${color}` } : {},
      },
    };
  },
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
});

export const Superscript = Mark.create({
  name: 'superscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});

export const Subscript = Mark.create({
  name: 'subscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});

export const Image = Node.create({
  name: 'image',
  addNodeView() {
    return ReactNodeViewRenderer(DocumentImageView);
  },
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      caption: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML: () => [
    { tag: 'img[src]' },
    {
      tag: 'figure[data-document-image]',
      getAttrs: (element) => ({
        src: element.querySelector('img')?.getAttribute('src'),
        alt: element.querySelector('img')?.getAttribute('alt'),
        caption: element.querySelector('figcaption')?.textContent,
        width: element.querySelector('img')?.getAttribute('width'),
      }),
    },
  ],
  renderHTML: ({ HTMLAttributes }) => {
    const { caption, ...attrs } = HTMLAttributes;
    return caption
      ? [
          'figure',
          { 'data-document-image': '' },
          ['img', mergeAttributes(attrs)],
          ['figcaption', String(caption)],
        ]
      : ['img', mergeAttributes(attrs)];
  },
});
