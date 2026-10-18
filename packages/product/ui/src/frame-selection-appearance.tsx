import {
  appearanceCells,
  isFrameCell,
  isFrameReferenceCell,
  isDocumentCell,
  isNodeCell,
  updateCellAppearance,
  type CellStore,
  type CellOperation,
  type NodeAppearance,
} from '@sue/board-core';
import { useI18n } from './i18n';
import { FramePropertyNumber } from './frame-property-number';

export function FrameSelectionAppearance({
  store,
  ids,
  dispatch,
  single,
  getStore,
  disabled = false,
}: {
  store: CellStore;
  ids: readonly string[];
  dispatch(operations: CellOperation[]): void;
  single: boolean;
  getStore?(): CellStore | undefined;
  disabled?: boolean;
}) {
  const { language } = useI18n();
  const noFill = language === 'zh' ? '无填充' : 'No fill';
  const noStroke = language === 'zh' ? '无描边' : 'No stroke';
  const cells = appearanceCells(store, ids);
  if (!cells.length) return null;
  const frameLike = (cell: (typeof cells)[number]) =>
    isFrameCell(cell) || isFrameReferenceCell(cell) || isDocumentCell(cell);
  const defaultStroke = cells.every(frameLike) ? '#cbd5e1' : '#64748b';
  const common = <K extends keyof NodeAppearance>(
    key: K,
    fallback: NodeAppearance[K],
  ) => {
    const resolved = (cell: (typeof cells)[number]) =>
      (cell.appearance as NodeAppearance | undefined)?.[key] ??
      ((frameLike(cell) && key === 'strokeWidth'
        ? 1
        : frameLike(cell) && key === 'strokeColor'
          ? '#cbd5e1'
          : fallback) as NodeAppearance[K]);
    const first = resolved(cells[0]);
    return cells.every((cell) => resolved(cell) === first) ? first : undefined;
  };
  const change = (patch: Partial<NodeAppearance>) => {
    const latest = getStore ? getStore() : store;
    if (!disabled && latest) dispatch(updateCellAppearance(latest, ids, patch));
  };
  const mixed = (
    <option value="" disabled>
      {language === 'zh' ? '混合值' : 'Mixed values'}
    </option>
  );
  return (
    <>
      {
        <>
          {cells.some(isNodeCell) && (
            <label>
              {language === 'zh' ? '填充' : 'Fill'}
              <input
                aria-label={single && language === 'zh' ? '填充' : 'Fill color'}
                type="color"
                data-mixed={
                  common('fill', '#ffffff') === undefined || undefined
                }
                title={
                  common('fill', '#ffffff') === undefined
                    ? language === 'zh'
                      ? '混合值'
                      : 'Mixed values'
                    : undefined
                }
                aria-description={
                  common('fill', '#ffffff') === undefined
                    ? language === 'zh'
                      ? '混合值'
                      : 'Mixed values'
                    : undefined
                }
                value={
                  /^#[0-9a-f]{6}$/i.test(common('fill', '#ffffff') ?? '')
                    ? common('fill', '#ffffff')
                    : '#ffffff'
                }
                onChange={(event) => change({ fill: event.target.value })}
              />
              <button
                aria-label={noFill}
                onClick={() => change({ fill: 'none' })}
              >
                {noFill}
              </button>
            </label>
          )}
          <label>
            {language === 'zh' ? '描边' : 'Stroke'}
            <input
              aria-label={single && language === 'zh' ? '描边' : 'Stroke color'}
              type="color"
              data-mixed={
                common('strokeColor', defaultStroke) === undefined || undefined
              }
              title={
                common('strokeColor', defaultStroke) === undefined
                  ? language === 'zh'
                    ? '混合值'
                    : 'Mixed values'
                  : undefined
              }
              aria-description={
                common('strokeColor', defaultStroke) === undefined
                  ? language === 'zh'
                    ? '混合值'
                    : 'Mixed values'
                  : undefined
              }
              value={
                /^#[0-9a-f]{6}$/i.test(
                  common('strokeColor', defaultStroke) ?? '',
                )
                  ? common('strokeColor', defaultStroke)
                  : defaultStroke
              }
              onChange={(event) => change({ strokeColor: event.target.value })}
            />
            <button
              aria-label={noStroke}
              onClick={() => change({ strokeColor: 'none' })}
            >
              {noStroke}
            </button>
          </label>
        </>
      }
      <label>
        {language === 'zh' ? '线宽' : 'Stroke width'}
        <FramePropertyNumber
          aria-label="Stroke width"
          min={0}
          step={0.5}
          identity={JSON.stringify(ids)}
          disabled={disabled}
          mixed={common('strokeWidth', 2) === undefined}
          value={common('strokeWidth', 2)}
          onCommit={(strokeWidth) => change({ strokeWidth })}
        />
      </label>
      <label>
        {language === 'zh' ? '线型' : 'Stroke style'}
        <select
          aria-label="Stroke style"
          value={common('strokeStyle', 'solid') ?? ''}
          onChange={(event) =>
            change({
              strokeStyle: event.target.value as NodeAppearance['strokeStyle'],
            })
          }
        >
          {mixed}
          <option value="solid">{language === 'zh' ? '实线' : 'Solid'}</option>
          <option value="dashed">
            {language === 'zh' ? '虚线' : 'Dashed'}
          </option>
          <option value="dotted">
            {language === 'zh' ? '点线' : 'Dotted'}
          </option>
        </select>
      </label>
      <label>
        {language === 'zh' ? '不透明度' : 'Opacity'}
        <FramePropertyNumber
          aria-label="Opacity"
          min={0}
          max={1}
          step={0.05}
          identity={JSON.stringify(ids)}
          disabled={disabled}
          mixed={common('opacity', 1) === undefined}
          value={common('opacity', 1)}
          onCommit={(opacity) => change({ opacity })}
        />
      </label>
      <label>
        {language === 'zh' ? '阴影' : 'Shadow'}
        <select
          aria-label="Shadow"
          value={common('shadow', 'none') ?? ''}
          onChange={(event) => change({ shadow: event.target.value })}
        >
          {mixed}
          <option value="none">{language === 'zh' ? '无' : 'None'}</option>
          <option value="sm">{language === 'zh' ? '小' : 'Small'}</option>
          <option value="md">{language === 'zh' ? '中' : 'Medium'}</option>
          <option value="lg">{language === 'zh' ? '大' : 'Large'}</option>
        </select>
      </label>
    </>
  );
}
