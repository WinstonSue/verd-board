import { useActionSource } from '@sue/board-react-actions';
import { frameSelectionActionId } from '@sue/board-react';
import {
  frameScene,
  isFrameCell,
  resolveCellArrangementScope,
  type CellLayoutStyle,
  type CellSelection,
  type CellStore,
} from '@sue/board-core';
import type {
  FrameCanvasController,
  FrameSelectionOperation,
} from '@sue/board-react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Group,
  Lock,
  Scan,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createVerdFramePluginSet } from './frame-plugins';
import { useI18n } from './i18n';
import { FrameTooltip, frameDisabledReason } from './frame-tooltip';
import { FrameRoutingButton } from './frame-routing-button';

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
  useActionSource(controller?.actionSource);
  const [style, setStyle] = useState<{
    frameId: string;
    value: CellLayoutStyle;
  } | null>(null);
  const frameId =
    [...selection.focus].reverse().find((id) => isFrameCell(store.cells[id])) ??
    store.rootId;
  const defaultPlugins = useMemo(() => createVerdFramePluginSet(), []);
  const scene = frameScene(
    store,
    frameId,
    controller?.runtime?.registry ?? defaultPlugins.registry,
  );

  const commands = [
    {
      command: { type: 'fit-content' } as FrameSelectionOperation,
      label: t('arrange.fitContent'),
    },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(
      (axis) => ({
        command: { type: 'align', axis } as FrameSelectionOperation,
        label: t(`arrange.${axis}`),
      }),
    ),
    {
      command: {
        type: 'distribute',
        axis: 'horizontal',
      } as FrameSelectionOperation,
      label: t('arrange.distributeHorizontal'),
    },
    {
      command: {
        type: 'distribute',
        axis: 'vertical',
      } as FrameSelectionOperation,
      label: t('arrange.distributeVertical'),
    },
    ...(['group', 'ungroup', 'lock', 'unlock'] as const).map((type) => ({
      command: { type } as FrameSelectionOperation,
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
        : ['relationships' as const]),
  ];
  const defaultStyle =
    scene === 'workflow-start'
      ? 'flow'
      : scene === 'architecture-layer'
        ? 'layers'
        : 'grid';
  const activeStyle = controller?.getAutoCalculation?.().layout?.style;
  const selectedStyle =
    activeStyle && styles.includes(activeStyle)
      ? activeStyle
      : style?.frameId === frameId && styles.includes(style.value)
        ? style.value
        : defaultStyle;
  useEffect(() => {
    controller?.setAutoLayoutStyle?.(selectedStyle);
  }, [controller, selectedStyle]);
  if (scene === 'mind-root' || scene === 'uml-sequence-root') return null;
  const layout: FrameSelectionOperation = {
    type: 'layout',
    style: selectedStyle,
  };
  const reason = (message?: string) =>
    message?.includes('cyclic')
      ? t('arrange.cycle')
      : message?.includes('crosses architecture')
        ? t('arrange.crossLayer')
        : message === 'layout-overlap'
          ? t('arrange.overlap')
          : message === 'no-routes-to-reset'
            ? t('arrange.noRoutes')
            : message &&
                ![
                  'pending',
                  'readonly',
                  'locked',
                  'scope-disposed',
                  'disabled',
                ].includes(message)
              ? message
              : undefined;
  let scopeKind: 'frame' | 'group' | 'selection' = 'frame';
  try {
    scopeKind = resolveCellArrangementScope(store, selection).kind;
  } catch {
    /* A removed target is disabled by the action source. */
  }
  const layoutState = controller?.getActionState(
    frameSelectionActionId(layout),
  );
  const run = (command: FrameSelectionOperation) => {
    void controller?.executeAction(frameSelectionActionId(command));
  };
  return (
    <section
      className="frame-arrangement"
      aria-label={t('arrange.title')}
      data-testid="frame-arrangement"
    >
      <h4>{t('arrange.title')}</h4>
      <div className="frame-arrangement-buttons">
        {commands.map(({ command, label }, index) => {
          const state = controller?.getActionState(
            frameSelectionActionId(command),
          );
          return (
            <FrameTooltip
              key={label}
              disabled={!state?.enabled}
              content={
                !state?.enabled
                  ? frameDisabledReason(state?.reason, language)
                  : label
              }
            >
              <button
                type="button"
                aria-label={label}
                disabled={
                  !controller?.getActionState(frameSelectionActionId(command))
                    .enabled
                }
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
            </FrameTooltip>
          );
        })}
      </div>
      <label>
        {t('arrange.layout')}
        <select
          aria-label={t('arrange.layout')}
          value={selectedStyle}
          onChange={(event) => {
            const value = event.target.value as CellLayoutStyle;
            controller?.setAutoLayoutStyle?.(value);
            setStyle({ frameId, value });
          }}
        >
          {styles.map((option) => {
            const state = controller?.getActionState(
              frameSelectionActionId({ type: 'layout', style: option }),
            );
            const explanation = reason(state?.reason);
            return (
              <option key={option} value={option} disabled={!!explanation}>
                {t(`arrange.${option}` as keyof import('./i18n').Translations)}
                {explanation ? ` — ${explanation}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <FrameTooltip
        disabled={!layoutState?.enabled}
        content={
          !layoutState?.enabled
            ? frameDisabledReason(
                reason(layoutState?.reason) ?? layoutState?.reason,
                language,
              )
            : undefined
        }
        className="frame-tooltip-block"
      >
        <button
          type="button"
          data-testid="frame-auto-layout"
          disabled={!layoutState?.enabled}
          onClick={() => run(layout)}
        >
          {t(scopeKind === 'group' ? 'arrange.groupContents' : 'arrange.apply')}
        </button>
      </FrameTooltip>
      {(['layout', 'edges'] as const).map((kind) => {
        const id =
          kind === 'layout'
            ? 'canvas.layout.auto.toggle'
            : 'canvas.edges.auto.toggle';
        const state = controller?.getActionState(id);
        const config = controller?.getAutoCalculation?.()[kind];
        return (
          <label key={kind} className="frame-arrangement-auto">
            <input
              type="checkbox"
              data-testid={`frame-auto-${kind}-toggle`}
              checked={!!state?.checked}
              disabled={!state?.enabled}
              onChange={() => {
                void controller?.executeAction(id);
              }}
            />
            {language === 'zh'
              ? kind === 'layout'
                ? '自动布局节点'
                : '自动优化连线'
              : kind === 'layout'
                ? 'Auto layout nodes'
                : 'Auto optimize edges'}
            {config && (
              <span>
                {language === 'zh'
                  ? `（${{ group: '组内', frame: '当前画布', selection: '固定选区' }[config.scope.kind]}）`
                  : ` (${config.scope.kind})`}
              </span>
            )}
          </label>
        );
      })}
      <FrameRoutingButton controller={controller} />
      <p
        className="frame-arrangement-hint"
        data-testid="frame-arrangement-scope"
      >
        {reason(layoutState?.reason) ??
          t(
            scopeKind === 'group'
              ? 'arrange.scopeGroup'
              : scopeKind === 'selection'
                ? 'arrange.scopeSelection'
                : 'arrange.scopeFrame',
          )}
      </p>
      <p className="frame-arrangement-hint">{t('arrange.rerouteHint')}</p>
    </section>
  );
}
