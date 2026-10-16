import { describe, expect, it } from 'vitest';
import { CellKind, isNodeCell, validateCellStore } from '@sue/board-core';
import { mindChildIds, registerMindCells } from '@sue/board-mind';
import { createCellRegistry } from '@sue/board-core';
import {
  parseMarkdownToFrameSnapshot,
  serializeFrameToMarkdown,
} from './index';
const registry = createCellRegistry();
registerMindCells(registry);
const labels = (
  snapshot: ReturnType<typeof parseMarkdownToFrameSnapshot>,
  parentId = 'markdown:root',
): unknown => {
  const node = snapshot.store.cells[parentId];
  return {
    label: isNodeCell(node) ? node.content?.label : '',
    children: mindChildIds(snapshot.store, parentId).map((id) =>
      labels(snapshot, id),
    ),
  };
};
describe('Markdown Frame conversion', () => {
  it('preserves a five-topic heading tree through native import and export', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# 中心主题\n\n## 研究\n### 资料\n\n## 计划\n## 复盘\n',
    );
    expect(
      Object.values(snapshot.store.cells).filter(
        (cell) => isNodeCell(cell) && cell.cellType === 'node',
      ),
    ).toHaveLength(5);
    expect(labels(snapshot)).toEqual({
      label: '中心主题',
      children: [
        { label: '研究', children: [{ label: '资料', children: [] }] },
        { label: '计划', children: [] },
        { label: '复盘', children: [] },
      ],
    });
    expect(validateCellStore(snapshot.store, registry)).toEqual([]);
    expect(
      labels(parseMarkdownToFrameSnapshot(serializeFrameToMarkdown(snapshot))),
    ).toEqual(labels(snapshot));
  });
  it('handles nested lists and clears obsolete heading parents', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Center\n## A\n### B\n## C\n#### D\n- One\n  - Two\n- Three\n',
    );
    expect(labels(snapshot)).toEqual({
      label: 'Center',
      children: [
        { label: 'A', children: [{ label: 'B', children: [] }] },
        {
          label: 'C',
          children: [
            {
              label: 'D',
              children: [
                { label: 'One', children: [{ label: 'Two', children: [] }] },
                { label: 'Three', children: [] },
              ],
            },
          ],
        },
      ],
    });
    expect(validateCellStore(snapshot.store, registry)).toEqual([]);
  });
  it('keeps the source heading beneath an explicitly supplied central topic', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# Source\n## Child',
      'Custom',
    );
    expect(labels(snapshot)).toEqual({
      label: 'Custom',
      children: [
        { label: 'Source', children: [{ label: 'Child', children: [] }] },
      ],
    });
    expect(snapshot.store.cells['markdown:root'].kind).toBe(CellKind.mindRoot);
  });
  it('retains independent central topics and includes visible notes in export', () => {
    const snapshot = parseMarkdownToFrameSnapshot(
      '# First\n## A\n# Second\n## B',
    );
    const roots = Object.values(snapshot.store.cells).filter(
      (cell) => cell.kind === CellKind.mindRoot,
    );
    expect(roots).toHaveLength(2);
    expect(roots.map((root) => labels(snapshot, root.id))).toEqual([
      { label: 'First', children: [{ label: 'A', children: [] }] },
      { label: 'Second', children: [{ label: 'B', children: [] }] },
    ]);
    const exported = serializeFrameToMarkdown(snapshot);
    const again = parseMarkdownToFrameSnapshot(exported);
    expect(
      Object.values(again.store.cells).filter(
        (cell) => cell.kind === CellKind.mindRoot,
      ),
    ).toHaveLength(2);
    if (!isNodeCell(roots[0])) throw new Error('Missing root');
    roots[0].data = { note: { plainText: 'Visible note' } };
    expect(serializeFrameToMarkdown(snapshot)).toContain('Visible note');
    // Collapsed notes still export; Markdown carries no collapse state.
    roots[0].data = {
      note: { plainText: 'Hidden note' },
      noteCollapsed: true,
    };
    expect(serializeFrameToMarkdown(snapshot)).toContain('Hidden note');
    expect(validateCellStore(snapshot.store, registry)).toEqual([]);
  });
  it('exports mounted content without viewport and styling', () => {
    const snapshot = parseMarkdownToFrameSnapshot('# Central Topic');
    const frame = snapshot.store.cells[snapshot.store.rootId];
    if (frame.cellType === 'frame')
      Object.assign(frame, {
        view: { viewport: { zoom: 2, origination: [1, 2] } },
      });
    expect(serializeFrameToMarkdown(snapshot)).toBe('# Central Topic\n');
  });
});
