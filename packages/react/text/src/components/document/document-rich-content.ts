import { isBoardTextNode } from '@sue/board-common';
import type { DocumentFoldingAdapter } from './folding-store';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const key = new PluginKey<ReadonlySet<number>>('document-folding');
const lists = new Set(['bulletList', 'orderedList']);

/** Folding is a view transaction: never changes JSON, history or persistence. */
export const DocumentFolding = Extension.create({
  name: 'documentFolding',
  addOptions: () => ({
    folding: undefined as DocumentFoldingAdapter | undefined,
  }),
  addProseMirrorPlugins() {
    const folding = this.options.folding;
    let base = new Set<number>();
    let temporary: number | undefined;
    return [
      new Plugin<ReadonlySet<number>>({
        key,
        state: {
          init: (_, state) => {
            const closed = new Set<number>();
            state.doc.descendants((node, pos) => {
              if (
                node.type.name === 'listItem' &&
                folding?.getSnapshot().get(node.attrs['blockId'] || `@${pos}`)
              )
                closed.add(pos);
            });
            base = closed;
            return closed;
          },
          apply(tr) {
            const next = new Set<number>();
            for (const pos of base) {
              const mapped = tr.mapping.mapResult(pos);
              if (!mapped.deleted) next.add(mapped.pos);
            }
            if (temporary !== undefined) temporary = tr.mapping.map(temporary);
            if (tr.getMeta('document-clear-reveal')) temporary = undefined;
            const reveal = tr.getMeta('document-reveal') as number | undefined;
            if (reveal !== undefined) temporary = reveal;
            const toggle = tr.getMeta(key) as number | undefined;
            if (toggle !== undefined) {
              next.has(toggle) ? next.delete(toggle) : next.add(toggle);
              temporary = undefined;
            }
            base = next;
            if (tr.docChanged)
              for (const pos of base) {
                const id = tr.doc.nodeAt(pos)?.attrs['blockId'];
                if (id) folding?.setCollapsed(id, true);
              }
            if (temporary === undefined) return next;
            const visible = new Set(next);
            for (const pos of visible) {
              const node = tr.doc.nodeAt(pos);
              if (node && pos < temporary && pos + node.nodeSize > temporary)
                visible.delete(pos);
            }
            return visible;
          },
        },
        view(view) {
          let applying = false;
          const detailBase = new Map<string, boolean>();
          const restore = () => {
            for (const element of view.dom.querySelectorAll<HTMLElement>(
              '[data-type=details]',
            )) {
              const pos = Math.max(0, view.posAtDOM(element, 0) - 1);
              const id = element.dataset['blockId'] || `@${pos}`;
              if (!detailBase.has(id))
                detailBase.set(
                  id,
                  folding?.getSnapshot().get(id) ??
                    !element.classList.contains('is-open'),
                );
              let collapsed = detailBase.get(id)!;
              const node = view.state.doc.nodeAt(pos);
              if (
                temporary !== undefined &&
                node &&
                pos <= temporary &&
                pos + node.nodeSize > temporary
              )
                collapsed = false;
              const open = element.classList.contains('is-open');
              if (open === collapsed) {
                applying = true;
                element
                  .querySelector<HTMLButtonElement>(':scope > button')
                  ?.click();
                applying = false;
              }
            }
          };
          const click = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const button = target.closest('button');
            const element = button?.parentElement;
            if (!element?.matches('[data-type=details]') || applying) return;
            const pos = Math.max(0, view.posAtDOM(element, 0) - 1);
            const id = element.dataset['blockId'] || `@${pos}`;
            const collapsed = element.classList.contains('is-open');
            const node = view.state.doc.nodeAt(pos);
            if (
              collapsed &&
              node?.firstChild &&
              view.state.selection.from >= pos + 1 + node.firstChild.nodeSize &&
              view.state.selection.from < pos + node.nodeSize
            ) {
              view.dispatch(
                view.state.tr
                  .setSelection(
                    TextSelection.near(view.state.doc.resolve(pos + 2)),
                  )
                  .setMeta('addToHistory', false),
              );
            }
            detailBase.set(id, collapsed);
            folding?.setCollapsed(id, collapsed);
            button?.setAttribute('aria-expanded', String(!collapsed));
            button?.setAttribute(
              'aria-label',
              collapsed ? '展开内容' : '收起内容',
            );
          };
          view.dom.addEventListener('click', click, true);
          restore();
          return {
            update: restore,
            destroy() {
              view.dom.removeEventListener('click', click, true);
            },
          };
        },
        props: {
          decorations(state) {
            const closed = key.getState(state)!;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'listItem') return;
              let hasChildren = false;
              node.forEach((child, offset) => {
                if (!lists.has(child.type.name)) return;
                hasChildren = true;
                if (closed.has(pos))
                  decorations.push(
                    Decoration.node(
                      pos + 1 + offset,
                      pos + 1 + offset + child.nodeSize,
                      { style: 'display:none' },
                    ),
                  );
              });
              if (!hasChildren) return;
              decorations.push(
                Decoration.widget(
                  pos + 1,
                  (view) => {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'document-list-fold';
                    button.contentEditable = 'false';
                    button.textContent = closed.has(pos) ? '▸' : '▾';
                    button.setAttribute(
                      'aria-label',
                      closed.has(pos) ? '展开子列表' : '收起子列表',
                    );
                    button.setAttribute(
                      'aria-expanded',
                      String(!closed.has(pos)),
                    );
                    button.onmousedown = (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    };
                    button.onclick = (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      let tr = view.state.tr;
                      if (
                        !closed.has(pos) &&
                        tr.selection.from >
                          pos + 1 + node.firstChild!.nodeSize &&
                        tr.selection.from < pos + node.nodeSize
                      ) {
                        tr = tr.setSelection(
                          TextSelection.near(tr.doc.resolve(pos + 2)),
                        );
                      }
                      folding?.setCollapsed(
                        node.attrs['blockId'] || `@${pos}`,
                        !closed.has(pos),
                      );
                      view.dispatch(
                        tr.setMeta(key, pos).setMeta('addToHistory', false),
                      );
                    };
                    return button;
                  },
                  { side: -1, key: `fold-${pos}-${closed.has(pos)}` },
                ),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

/** Static previews use native controls; no Editor is mounted for reading. */
export function prepareListFolding(
  body: HTMLElement,
  folding?: DocumentFoldingAdapter,
) {
  for (const item of body.querySelectorAll('li')) {
    const children = Array.from(item.children).filter((child) =>
      child.matches('ul,ol'),
    ) as HTMLElement[];
    if (!children.length) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'document-list-fold';
    button.textContent = '▾';
    button.setAttribute('aria-label', '收起子列表');
    button.setAttribute('aria-expanded', 'true');
    button.onclick = (event) => {
      event.stopPropagation();
      const collapse = button.getAttribute('aria-expanded') === 'true';
      children.forEach((child) => {
        child.hidden = collapse;
      });
      button.setAttribute('aria-expanded', String(!collapse));
      button.textContent = collapse ? '▸' : '▾';
    };
    const id =
      item.getAttribute('data-block-id') ||
      `@preview-${Array.from(body.querySelectorAll('li')).indexOf(item)}`;
    const toggle = button.onclick;
    button.onclick = (event) => {
      toggle?.call(button, event);
      folding?.setCollapsed(id, children[0].hidden === true);
    };
    if (folding?.getSnapshot().get(id)) {
      children.forEach((child) => {
        child.hidden = true;
      });
      button.setAttribute('aria-expanded', 'false');
      button.textContent = '▸';
    }
    item.prepend(button);
  }
}

export function validateRichContent(node: {
  type: string;
  attrs?: Record<string, unknown>;
  content?: readonly unknown[];
}): void {
  if (!isBoardTextNode(node))
    throw new Error('Document node attributes are malformed');
  if (node.type === 'inlineMath' || node.type === 'blockMath') {
    if (typeof node.attrs?.['latex'] !== 'string')
      throw new Error('Formula latex must be a string');
  }
}

export function revealPreviewTarget(element: HTMLElement | undefined) {
  for (
    let parent = element?.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (parent.matches('ul,ol')) parent.hidden = false;
  }
}

export function nearestOperableDepth($from: {
  depth: number;
  node(depth: number): ProseMirrorNode;
}) {
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === 'detailsSummary') return Math.max(1, depth - 1);
    if (
      name === 'paragraph' &&
      depth > 1 &&
      $from.node(depth - 1).type.name === 'listItem'
    )
      return depth - 1;
    if (
      [
        'paragraph',
        'heading',
        'codeBlock',
        'blockMath',
        'attachment',
        'webEmbed',
        'table',
      ].includes(name)
    )
      return depth;
  }
  return 1;
}
