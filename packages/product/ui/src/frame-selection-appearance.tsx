import { FrameAppearanceSettings } from '@sue/board-react';
import {
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
import { useI18n } from './i18n';

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
  return (
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
    />
  );
}
