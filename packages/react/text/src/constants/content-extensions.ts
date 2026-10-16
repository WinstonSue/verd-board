import { Mark, Node, mergeAttributes } from '@tiptap/react';

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
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes)],
});
