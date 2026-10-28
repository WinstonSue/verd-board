import { umlActions } from './actions';
import { type FrameUIPlugin } from '@sue/board-react';
import {
  addUmlCell,
  createUmlClassCell,
  createUmlClassFrameSnapshot,
  createUmlParticipantCell,
  createUmlPlugin,
  createUmlSequenceFrameSnapshot,
  umlRoot,
} from '@sue/board-uml';
import { createUmlFrameExtensions } from './frame-extension';
import { UmlPalette, UmlProperties } from './frame-uml';
export const createUmlUIPlugin = (): FrameUIPlugin => ({
  id: 'uml',
  engine: createUmlPlugin(),
  extensions: createUmlFrameExtensions,
  cells: {
    'uml-class': { edgeKind: 'uml-relation' },
    'uml-relation': {
      edgeKind: 'uml-relation',
      edgeData: {
        relation: 'association',
        sourceMarker: 'none',
        targetMarker: 'none',
      },
      editEdgeLabel: false,
      editableMarker: true,
    },
    'uml-message': { editEdge: false },
  },
  pasteText(c) {
    const root = umlRoot(c.store, c.frameId);
    if (!root) return undefined;
    const cell =
      root.kind === 'uml-sequence-root'
        ? createUmlParticipantCell(c.allocateId())
        : createUmlClassCell(c.allocateId());
    return addUmlCell(c.store, c.frameId, {
      ...cell,
      content: { ...cell.content, label: c.text },
    });
  },
  actions: [
    ...umlActions,
    ...(['class', 'sequence'] as const).map((type) => ({
      id: `uml.${type}`,
      label:
        type === 'class'
          ? { zh: 'UML 类图', en: 'UML class' }
          : { zh: 'UML 时序图', en: 'UML sequence' },
      category: 'uml',
      effect: 'content' as const,
      getState: (c: import('@sue/board-react').FrameActionContext) => ({
        enabled: !c.disabled,
      }),
      execute: (c: import('@sue/board-react').FrameActionContext) => {
        const snapshot = (
          type === 'class'
            ? createUmlClassFrameSnapshot
            : createUmlSequenceFrameSnapshot
        )(c.frameId, c.allocateId());
        const frame = snapshot.store.cells[c.frameId];
        return c.runOperations(
          frame.cellType === 'frame' && 'children' in frame
            ? frame.children.map((id) => ({
                type: 'insert_cell' as const,
                parentId: c.frameId,
                cell: snapshot.store.cells[id],
              }))
            : [],
        );
      },
    })),
    {
      id: 'uml.add',
      label: { zh: '添加元素', en: 'Add element' },
      category: 'uml',
      effect: 'content',
      getState: (c) => ({
        enabled: !c.disabled && !!umlRoot(c.store, c.frameId),
      }),
      execute: (c) => {
        const cell =
          umlRoot(c.store, c.frameId)?.kind === 'uml-sequence-root'
            ? createUmlParticipantCell(c.allocateId())
            : createUmlClassCell(c.allocateId());
        return c.runOperations(addUmlCell(c.store, c.frameId, cell), {
          selectionIds: [cell.id],
        });
      },
    },
  ],
  tools: ['class', 'sequence', 'add'].map((id) => ({
    id: `uml.${id}`,
    actionId: `uml.${id}`,
  })),
  Properties: (c) =>
    umlRoot(c.store, c.frameId) ? (
      <>
        <UmlPalette
          {...c}
          zh={c.language === 'zh'}
          dispatch={(operations) =>
            c.executeAction('uml.update-properties', { operations })
          }
        />
        <UmlProperties
          getStore={() => c.controller?.runtime.store ?? c.store}
          {...c}
          zh={c.language === 'zh'}
          dispatch={(operations) =>
            c.executeAction('uml.update-properties', { operations })
          }
        />
      </>
    ) : null,
});
