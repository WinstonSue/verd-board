import { actionLabel } from '@sue/board-common';
import {
  formatActionShortcut,
  useActionSource,
} from '@sue/board-react-actions';
import {
  frameScene,
  isFrameCell,
  type CellSelection,
  type CellStore,
} from '@sue/board-core';
import type { FrameCanvasController } from '@sue/board-react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowUp,
  BringToFront,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  Layers,
  Link,
  Lock,
  Maximize,
  Scan,
  Scissors,
  SendToBack,
  SquareDashed,
  Trash2,
  Ungroup,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  FrameCommandMenu,
  type FrameCommandMenuItem,
} from './frame-command-menu';
import { frameDisabledReason } from './frame-tooltip';
import { useI18n } from '../../i18n';

export function FrameActionsPopover({
  point,
  store,
  selection,
  controller,
  onClose,
  onFailure,
}: {
  point: [number, number];
  store: CellStore;
  selection: CellSelection;
  controller: FrameCanvasController;
  onClose(): void;
  onFailure(message: string): void;
}) {
  const { t, language } = useI18n();
  useActionSource(controller.actionSource);
  const selectionKey = JSON.stringify(selection);
  const captured = useMemo(
    () => ({
      selectionKey,
      actions: new Map(
        controller.actions().map((action) => [action.id, action.capture()]),
      ),
    }),
    [controller, selectionKey],
  );
  const valid = () =>
    JSON.stringify(controller.runtime.selection) === captured.selectionKey &&
    selection.ids.every((id) => !!controller.runtime.store.cells[id]);
  const command = (
    id: string,
    icon: LucideIcon,
    group: string,
    onlyEnabled = false,
  ): FrameCommandMenuItem[] => {
    const action = captured.actions.get(id);
    if (!action) return [];
    const state = action.getState();
    if (!state.visible || (onlyEnabled && !state.enabled)) return [];
    return [
      {
        id,
        label: actionLabel(action.label, language),
        icon,
        group,
        disabled: !state.enabled,
        reason: !state.enabled
          ? frameDisabledReason(state.reason, language)
          : undefined,
        shortcut: action.shortcuts?.[0]
          ? formatActionShortcut(action.shortcuts[0])
          : undefined,
        danger: id === 'canvas.selection.delete',
        onSelect() {
          if (!valid()) return;
          // Start transport in the click stack, before clipboard user activation expires.
          void action.execute(undefined, { source: 'menu' }).then(
            (result) => {
              if ('code' in result && result.status !== 'cancelled')
                onFailure(result.message ?? result.code);
            },
            (error: unknown) =>
              onFailure(error instanceof Error ? error.message : String(error)),
          );
        },
      },
    ];
  };
  const submenu = (
    id: string,
    label: string,
    icon: LucideIcon,
    children: FrameCommandMenuItem[],
  ): FrameCommandMenuItem[] =>
    children.length
      ? [{ id, label, icon, group: 'arrangement', children }]
      : [];
  const frameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    store.rootId;
  const items: FrameCommandMenuItem[] = selection.ids.length
    ? [
        ...command('canvas.clipboard.cut', Scissors, 'clipboard'),
        ...command('canvas.clipboard.copy', Copy, 'clipboard'),
        ...command('canvas.clipboard.paste', ClipboardPaste, 'clipboard'),
        ...command('canvas.selection.duplicate', CopyPlus, 'clipboard'),
        ...command('canvas.selection.group', Group, 'objects', true),
        ...command('canvas.selection.ungroup', Ungroup, 'objects', true),
        ...command('canvas.selection.lock', Lock, 'objects', true),
        ...command('canvas.selection.unlock', Unlock, 'objects', true),
        ...command('canvas.selection.fit-content', Scan, 'objects', true),
        ...submenu('align', t('contextMenu.arrange'), AlignStartVertical, [
          ...command('canvas.align.left', AlignStartVertical, 'align', true),
          ...command('canvas.align.center', AlignCenterVertical, 'align', true),
          ...command('canvas.align.right', AlignEndVertical, 'align', true),
          ...command('canvas.align.top', AlignStartHorizontal, 'align', true),
          ...command(
            'canvas.align.middle',
            AlignCenterHorizontal,
            'align',
            true,
          ),
          ...command('canvas.align.bottom', AlignEndHorizontal, 'align', true),
          ...command(
            'canvas.distribute.horizontal',
            AlignHorizontalSpaceAround,
            'distribute',
            true,
          ),
          ...command(
            'canvas.distribute.vertical',
            AlignVerticalSpaceAround,
            'distribute',
            true,
          ),
        ]),
        ...(!frameScene(store, frameId, controller.runtime.registry)
          ? submenu('order', t('contextMenu.layers'), Layers, [
              ...command('canvas.order.front', BringToFront, 'order', true),
              ...command('canvas.order.forward', ArrowUp, 'order', true),
              ...command('canvas.order.backward', ArrowDown, 'order', true),
              ...command('canvas.order.back', SendToBack, 'order', true),
            ])
          : []),
        ...command('canvas.link.copy', Link, 'links', true),
        ...command('product.reference.duplicate', CopyPlus, 'links', true),
        ...command('canvas.selection.delete', Trash2, 'delete'),
      ]
    : [
        ...command('canvas.clipboard.paste', ClipboardPaste, 'clipboard'),
        ...command('canvas.selection.all', SquareDashed, 'selection'),
        ...command('canvas.view.fit', Maximize, 'view'),
      ];
  return (
    <FrameCommandMenu
      key={JSON.stringify(point)}
      point={point}
      label={t('contextMenu.title')}
      items={items}
      onClose={onClose}
    />
  );
}
