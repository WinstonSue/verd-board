import { Extension } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
const types = [
  'listItem',
  'details',
  'blockMath',
  'attachment',
  'webEmbed',
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'table',
  'image',
  'frameReference',
  'documentExcerpt',
];
/** IDs belong to a document; splitting/pasting must never duplicate an address. */
export const StableBlocks = Extension.create({
  name: 'stableBlocks',
  addGlobalAttributes: () => [
    {
      types,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-block-id'),
          renderHTML: (attrs) =>
            attrs['blockId'] ? { 'data-block-id': attrs['blockId'] } : {},
        },
      },
    },
  ],
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = state.tr;
          const seen = new Set<string>();
          const previous = new Set<import('@tiptap/pm/model').Node>();
          old.doc.descendants((node) => {
            previous.add(node);
          });
          const surviving = new Map<number, string>();
          old.doc.descendants((node, pos) => {
            if (!types.includes(node.type.name) || !node.attrs['blockId'])
              return;
            let mapped = pos,
              deleted = false;
            for (const transaction of transactions) {
              const result = transaction.mapping.mapResult(mapped);
              mapped = result.pos;
              deleted ||= result.deletedAcross;
            }
            if (!deleted) surviving.set(mapped, node.attrs['blockId']);
          });
          const preferred = new Map<string, import('@tiptap/pm/model').Node>();
          state.doc.descendants((node) => {
            if (previous.has(node) && typeof node.attrs['blockId'] === 'string')
              preferred.set(node.attrs['blockId'], node);
          });
          state.doc.descendants((node, pos) => {
            if (!types.includes(node.type.name)) return;
            const id = node.attrs['blockId'];
            if (
              typeof id === 'string' &&
              id &&
              !seen.has(id) &&
              (!preferred.has(id) || preferred.get(id) === node)
            )
              seen.add(id);
            else {
              const inherited = surviving.get(pos);
              const next =
                !id && inherited && !seen.has(inherited)
                  ? inherited
                  : crypto.randomUUID();
              seen.add(next);
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                blockId: next,
              });
            }
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
