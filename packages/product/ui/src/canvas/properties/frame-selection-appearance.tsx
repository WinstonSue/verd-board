import {
  FrameAppearanceSettings,
  type FrameCanvasController,
} from '@sue/board-react';
import {
  resolveBoardTheme,
  BoardStyleColors,
  resolveThemeSeries,
  type BoardStyleColor,
  type ThemeColorMode,
  resolveCellAppearance,
  type BoardAppearance,
  appearanceCells,
  isDocumentCell,
  isFrameCell,
  isFrameReferenceCell,
  isNodeCell,
  updateCellAppearance,
  type CellOperation,
  type CellStore,
  type NodeAppearance,
} from '@sue/board-core';
import { useI18n } from '../../i18n';
import { mindFrameColorScheme } from '@sue/board-mind';

export function FrameSelectionAppearance({
  store,
  ids,
  dispatch,
  single,
  getStore,
  disabled = false,
  appearance,
  frameId,
  controller,
}: {
  store: CellStore;
  ids: readonly string[];
  dispatch(operations: CellOperation[]): void;
  single: boolean;
  getStore?(): CellStore | undefined;
  disabled?: boolean;
  appearance?: BoardAppearance;
  frameId?: string;
  controller?: FrameCanvasController | null;
}) {
  const { language, t } = useI18n();
  const frame = store.cells[frameId ?? store.rootId];
  const theme = resolveBoardTheme(
    isFrameCell(frame) ? frame.view?.theme : undefined,
    appearance,
  );
  const cells = appearanceCells(store, ids);
  if (!cells.length) return null;
  const styleTheme =
    isFrameCell(frame) && cells.every((cell) => cell.kind.startsWith('mind-'))
      ? resolveBoardTheme(
          {
            themeColorMode: mindFrameColorScheme(frame) as ThemeColorMode,
            backgroundMode: 'custom',
            boardBackground: theme.canvas,
          },
          appearance,
        )
      : theme;
  const frameLike = (cell: (typeof cells)[number]) =>
    isFrameCell(cell) || isFrameReferenceCell(cell) || isDocumentCell(cell);
  const defaultStroke = cells.every(frameLike) ? '#cbd5e1' : '#64748b';
  const common = <K extends keyof NodeAppearance>(
    key: K,
    fallback: NodeAppearance[K],
  ) => {
    const resolved = (cell: (typeof cells)[number]) => {
      const visual =
        controller?.resolveAppearance?.(cell.id) ??
        resolveCellAppearance(cell, theme);
      if (
        key === 'fill' &&
        'exportFill' in visual &&
        typeof visual.exportFill === 'string'
      )
        return visual.exportFill as NodeAppearance[K];
      return (
        visual[key] ??
        ((frameLike(cell) && key === 'strokeWidth'
          ? 1
          : frameLike(cell) && key === 'strokeColor'
            ? '#cbd5e1'
            : fallback) as NodeAppearance[K])
      );
    };
    const first = resolved(cells[0]);
    return cells.every((cell) => resolved(cell) === first) ? first : undefined;
  };
  const change = (patch: Partial<NodeAppearance>) => {
    const latest = getStore ? getStore() : store;
    if (!disabled && latest) dispatch(updateCellAppearance(latest, ids, patch));
  };
  const styleCells = cells
    .filter(isNodeCell)
    .filter(
      (cell) =>
        controller?.resolveAppearance(cell.id)?.styleFamily !== undefined,
    );
  const firstStyle = styleCells[0]?.appearance?.styleColor;
  const mixedStyle = styleCells.some(
    (cell) => cell.appearance?.styleColor !== firstStyle,
  );
  const setStyle = (styleColor: BoardStyleColor | undefined) => {
    const latest = getStore ? getStore() : store;
    if (!disabled && latest)
      dispatch(
        updateCellAppearance(
          latest,
          styleCells.map((cell) => cell.id),
          { styleColor },
        ),
      );
  };
  const familyLabels = [
    t('appearance.styleColor.family1'),
    t('appearance.styleColor.family2'),
    t('appearance.styleColor.family3'),
    t('appearance.styleColor.family4'),
    t('appearance.styleColor.family5'),
    t('appearance.styleColor.family6'),
  ];
  return (
    <>
      {!!styleCells.length && (
        <div
          className="frame-style-colors"
          role="group"
          aria-label={t('appearance.styleColor')}
        >
          <span>{t('appearance.styleColor')}</span>
          <div className="frame-style-colors__choices">
            <button
              type="button"
              disabled={disabled}
              aria-pressed={!mixedStyle && firstStyle === undefined}
              onClick={() => setStyle(undefined)}
            >
              {t('appearance.styleColor.automatic')}
            </button>
            {BoardStyleColors.map((family, index) => (
              <button
                type="button"
                key={family}
                disabled={disabled}
                aria-label={familyLabels[index]}
                title={familyLabels[index]}
                aria-pressed={!mixedStyle && firstStyle === family}
                style={{
                  backgroundColor: resolveThemeSeries(
                    styleTheme,
                    index,
                    'node',
                    'opaque',
                  ).fill,
                }}
                onClick={() => setStyle(family)}
              />
            ))}
          </div>
          {mixedStyle && <small>{t('appearance.styleColor.mixed')}</small>}
          {styleCells.some(
            (cell) =>
              cell.appearance?.colorSources?.fill === 'custom' ||
              cell.appearance?.colorSources?.strokeColor === 'custom',
          ) && <small>{t('appearance.styleColor.customOverride')}</small>}
        </div>
      )}
      <FrameAppearanceSettings
        values={{
          fill: common('fill', '#ffffff'),
          strokeColor: common('strokeColor', defaultStroke),
          strokeWidth: common('strokeWidth', 2),
          opacity: common('opacity', 1),
          strokeStyle: common('strokeStyle', 'solid'),
          shadow: common('shadow', 'none'),
        }}
        identity={JSON.stringify(ids)}
        language={language}
        profile="product"
        includeFill={cells.some(isNodeCell)}
        includeStrokeStyle={
          !cells.some(
            (cell) =>
              cell.kind === 'architecture-edge' &&
              (cell.data as { relation?: string } | undefined)?.relation,
          )
        }
        single={single}
        disabled={disabled}
        strokeFallback={defaultStroke}
        onCommit={({ changes }) => {
          const patch: Partial<NodeAppearance> = {};
          for (const edit of changes)
            if (edit.kind === 'set')
              Object.assign(patch, { [edit.key]: edit.value });
          change(patch);
        }}
        onClear={(key) => change({ [key]: 'none' })}
        onSetColor={(key, value) => change({ [key]: value })}
        onResetColor={(key) =>
          change({ [key]: undefined, colorSources: { [key]: 'theme' } })
        }
      />
    </>
  );
}
