import { createInlineText } from '@sue/board-common';
import {
  createDefaultShapeGeometryRegistry,
  frameScene,
} from '@sue/board-core';
import { createDrawPlugin, DrawKind } from '@sue/board-draw';
import { type FrameActionContext, type FrameUIPlugin } from '@sue/board-react';
import { useState } from 'react';
import { frameDrawExtensions } from './frame-draw-extension';
import { createFrameDrawingTool } from './frame-drawing-tool';
const acceptsPaste = (
  c: Pick<
    Parameters<NonNullable<FrameUIPlugin['pasteText']>>[0],
    'store' | 'frameId' | 'registry' | 'hit'
  >,
) =>
  !frameScene(c.store, c.frameId, c.registry) &&
  (!c.hit ||
    c.hit.cellType === 'frame' ||
    ['frame-reference', 'document-reference', 'document-frame'].includes(
      c.hit.kind,
    ) ||
    Object.values(DrawKind).includes(c.hit.kind as never));
const drawTools = [
  {
    id: 'text',
    pointer: 'text',
    label: { zh: '文本', en: 'Text' },
    shortcut: 't',
  },
  {
    id: 'shape',
    pointer: 'shape',
    label: { zh: '形状', en: 'Shape' },
    shortcut: 'r',
  },
  {
    id: 'ellipse',
    pointer: 'shape',
    label: { zh: '椭圆', en: 'Ellipse' },
    shortcut: 'o',
  },
  {
    id: 'arrow',
    pointer: 'arrow',
    label: { zh: '箭头', en: 'Arrow' },
    shortcut: 'a',
  },
  {
    id: 'pen',
    pointer: 'pen',
    label: { zh: '画笔', en: 'Pen' },
    shortcut: 'p',
  },
  {
    id: 'erase',
    pointer: 'erase',
    label: { zh: '橡皮擦', en: 'Eraser' },
    shortcut: 'e',
  },
  { id: 'frame', pointer: 'frame', label: { zh: '容器', en: 'Frame' } },
  { id: 'line', pointer: 'line', label: { zh: '直线', en: 'Line' } },
  { id: 'curve', pointer: 'curve', label: { zh: '曲线', en: 'Curve' } },
  {
    id: 'bidirectional',
    pointer: 'bidirectional',
    label: { zh: '双向箭头', en: 'Bidirectional arrow' },
  },
  { id: 'table', pointer: 'table', label: { zh: '表格', en: 'Table' } },
  {
    id: 'swimlane',
    pointer: 'swimlane',
    label: { zh: '泳道', en: 'Swimlane' },
  },
  {
    id: 'vector-line',
    pointer: 'vector-line',
    label: { zh: '折线', en: 'Polyline' },
  },
] as const;
export const createDrawUIPlugin = (): FrameUIPlugin => ({
  id: 'draw',
  engine: createDrawPlugin(),
  extensions: () => frameDrawExtensions,
  cells: {
    geometry: { edgeKind: 'arrow' },
    image: { edgeKind: 'arrow' },
    'vector-line': { resizeHandles: false },
  },
  pasteImage: (c) =>
    !acceptsPaste(c)
      ? undefined
      : [
          {
            type: 'insert_cell',
            parentId: c.frameId,
            cell: {
              id: c.allocateId(),
              kind: 'image',
              cellType: 'node',
              geometry: {
                x: c.at[0] - c.image.width / 2,
                y: c.at[1] - c.image.height / 2,
                width: c.image.width,
                height: c.image.height,
              },
              data: { url: c.image.url },
            },
          },
        ],
  pasteText: (c) =>
    !acceptsPaste(c)
      ? undefined
      : [
          {
            type: 'insert_cell',
            parentId: c.frameId,
            cell: {
              id: c.allocateId(),
              kind: 'geometry',
              cellType: 'node',
              geometry: {
                x: c.at[0],
                y: c.at[1],
                width: 160,
                height: 48,
                outline: 'text',
              },
              content: { label: c.text, text: createInlineText(c.text) },
            },
          },
        ],
  Toolbar: DrawToolbar,
  actions: [
    ...drawTools.map((definition) => {
      const { id, label, pointer } = definition;
      const shortcut =
        'shortcut' in definition ? definition.shortcut : undefined;
      return {
        id: `draw.${id}`,
        label,
        category: 'draw',
        effect: 'view' as const,
        shortcuts: shortcut ? [{ key: shortcut }] : [],
        shortcutWhen: (c: FrameActionContext) =>
          id !== 'arrow' || !c.selectionIds.length,
        validateArgs: (
          args: unknown,
        ): args is {
          shape?: string;
          pen?: Parameters<typeof createFrameDrawingTool>[0]['pen'];
        } =>
          args === undefined ||
          (!!args &&
            typeof args === 'object' &&
            ((args as { shape?: unknown }).shape === undefined ||
              typeof (args as { shape?: unknown }).shape === 'string') &&
            ((args as { pen?: unknown }).pen === undefined ||
              [
                'nibPen',
                'feltTipPen',
                'artisticBrush',
                'markerHighlight',
              ].includes(String((args as { pen?: unknown }).pen)))),
        getState: (c: FrameActionContext) => ({
          visible: !frameScene(c.store, c.frameId, c.registry),
          enabled: !c.disabled && !!c.setTool,
          checked: (c.tool?.key?.split(':')[0] ?? c.tool?.mode) === pointer,
        }),
        execute: (
          c: FrameActionContext,
          args?: {
            shape?: string;
            pen?: Parameters<typeof createFrameDrawingTool>[0]['pen'];
          },
        ) => {
          c.setTool?.(
            createFrameDrawingTool({
              pointer,
              shape:
                args?.shape ?? (id === 'ellipse' ? 'ellipse' : 'rectangle'),
              pen: args?.pen ?? 'nibPen',
              onComplete: () => c.setTool?.({ mode: 'select' }),
            }),
          );
          return { status: 'completed' as const };
        },
      };
    }),
  ],
  tools: drawTools
    .filter(({ id }) => id !== 'ellipse')
    .map(({ id }) => ({
      id: `draw.${id}`,
      actionId: `draw.${id}`,
    })),
});

function DrawToolbar(context: import('@sue/board-react').FramePluginContext) {
  const [shape, setShape] = useState('rectangle');
  const shapes = createDefaultShapeGeometryRegistry().kinds();
  return (
    <label>
      {context.language === 'zh' ? '图形' : 'Shape'}
      <select
        aria-label="Shape"
        value={shape}
        disabled={!context.getActionState('draw.shape', { shape }).enabled}
        onChange={(event) => {
          setShape(event.target.value);
          void context.executeAction('draw.shape', {
            shape: event.target.value,
          });
        }}
      >
        {shapes.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
    </label>
  );
}
