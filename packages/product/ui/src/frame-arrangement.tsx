import { useState } from 'react';
import {
  Scan,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Group,
  Ungroup,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  frameScene,
  isFrameCell,
  type CellStore,
  type CellSelection,
  type CellLayoutStyle,
} from '@sue/board-core';
import type {
  FrameCanvasController,
  FrameSelectionCommand,
} from '@sue/board-react';
import { useI18n } from './i18n';

/** The inspector and context menu share controller commands and availability. */
export function FrameArrangement({
  store,
  selection,
  controller,
}: {
  store: CellStore;
  selection: CellSelection;
  controller?: FrameCanvasController | null;
}) {
  const { t, language } = useI18n();
  const [style, setStyle] = useState<{
    frameId: string;
    value: CellLayoutStyle;
  } | null>(null);
  const frameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    store.rootId;
  const scene = frameScene(store, frameId);
  if (scene === 'mind-root') return null;
  const commands = [
    {
      command: { type: 'fit-content' } as FrameSelectionCommand,
      label: t('arrange.fitContent'),
    },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(
      (axis) => ({
        command: { type: 'align', axis } as FrameSelectionCommand,
        label: t(`arrange.${axis}`),
      }),
    ),
    {
      command: {
        type: 'distribute',
        axis: 'horizontal',
      } as FrameSelectionCommand,
      label: t('arrange.distributeHorizontal'),
    },
    {
      command: {
        type: 'distribute',
        axis: 'vertical',
      } as FrameSelectionCommand,
      label: t('arrange.distributeVertical'),
    },
    ...(['group', 'ungroup', 'lock', 'unlock'] as const).map((type) => ({
      command: { type } as FrameSelectionCommand,
      label: t(`arrange.${type}`),
    })),
  ];
  const styles: CellLayoutStyle[] = [
    'grid',
    'horizontal',
    'vertical',
    ...(scene === 'workflow-start'
      ? ['flow' as const]
      : scene === 'architecture-layer'
        ? ['layers' as const]
        : []),
  ];
  const defaultStyle =
    scene === 'workflow-start'
      ? 'flow'
      : scene === 'architecture-layer'
        ? 'layers'
        : 'grid';
  const selectedStyle =
    style?.frameId === frameId && styles.includes(style.value)
      ? style.value
      : defaultStyle;
  const layout: FrameSelectionCommand = {
    type: 'layout',
    style: selectedStyle,
  };
  const reason = (message?: string) =>
    message?.includes('cyclic')
      ? t('arrange.cycle')
      : message?.includes('crosses architecture')
        ? t('arrange.crossLayer')
        : undefined;
  const run = (command: FrameSelectionCommand) => {
    void controller?.executeSelectionCommand(command);
  };
  return (
    <section
      className="frame-arrangement"
      aria-label={t('arrange.title')}
      data-testid="frame-arrangement"
    >
      <h4>{t('arrange.title')}</h4>
      <div className="frame-arrangement-buttons">
        {commands.map(({ command, label }, index) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            disabled={!controller?.selectionCommandState(command).enabled}
            onClick={() => run(command)}
          >
            {(() => {
              const Icon = [
                Scan,
                AlignStartVertical,
                AlignCenterVertical,
                AlignEndVertical,
                AlignStartHorizontal,
                AlignCenterHorizontal,
                AlignEndHorizontal,
                AlignHorizontalSpaceAround,
                AlignVerticalSpaceAround,
                Group,
                Ungroup,
                Lock,
                Unlock,
              ][index];
              return <Icon size={16} aria-hidden="true" />;
            })()}
          </button>
        ))}
      </div>
      <label>
        {t('arrange.layout')}
        <select
          aria-label={t('arrange.layout')}
          value={selectedStyle}
          onChange={(event) =>
            setStyle({ frameId, value: event.target.value as CellLayoutStyle })
          }
        >
          {styles.map((option) => {
            const state = controller?.selectionCommandState({
              type: 'layout',
              style: option,
            });
            const explanation = reason(state?.reason);
            return (
              <option key={option} value={option} disabled={!!explanation}>
                {t(`arrange.${option}`)}
                {explanation ? ` — ${explanation}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <button
        type="button"
        data-testid="frame-auto-layout"
        disabled={!controller?.selectionCommandState(layout).enabled}
        onClick={() => run(layout)}
      >
        {t('arrange.apply')}
      </button>
      <p className="frame-arrangement-hint">
        {reason(controller?.selectionCommandState(layout).reason) ??
          (selection.ids.length
            ? t('arrange.currentScope')
            : language === 'zh'
              ? '自动排列作用于当前画布。'
              : 'Auto layout applies to the current canvas.')}
      </p>
    </section>
  );
}
