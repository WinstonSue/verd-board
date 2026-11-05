import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface SearchHighlight {
  from: number;
  to: number;
  node: boolean;
}
export const documentSearchHighlightKey = new PluginKey<SearchHighlight | null>(
  'document-search-highlight',
);

/** View state only: no marks, serialized attributes, content updates or history. */
export const DocumentSearchHighlight = Extension.create({
  name: 'documentSearchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlight | null>({
        key: documentSearchHighlightKey,
        state: {
          init: () => null,
          apply: (transaction, previous) => {
            if (
              transaction.docChanged ||
              transaction.getMeta('document-clear-reveal')
            )
              return null;
            const next = transaction.getMeta(documentSearchHighlightKey) as
              SearchHighlight | null | undefined;
            return next === undefined ? previous : next;
          },
        },
        props: {
          decorations: (state) => {
            const match = documentSearchHighlightKey.getState(state);
            if (
              !match ||
              match.from < 0 ||
              match.to > state.doc.content.size ||
              match.from >= match.to
            )
              return DecorationSet.empty;
            const attrs = {
              class: 'document-search-match',
              'data-document-search-match': 'current',
            };
            return DecorationSet.create(state.doc, [
              match.node
                ? Decoration.node(match.from, match.to, attrs)
                : Decoration.inline(match.from, match.to, attrs),
            ]);
          },
        },
      }),
    ];
  },
});
