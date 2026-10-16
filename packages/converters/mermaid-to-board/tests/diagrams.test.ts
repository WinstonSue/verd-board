import { validateCellStore } from '@sue/board-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  graphToFrameSnapshot,
  parseMermaid,
  parseMermaidToFrameSnapshot,
} from '../src/index';
import { CLASS_DIAGRAM_TESTCASES } from './fixtures/class';
import { FLOWCHART_DIAGRAM_TESTCASES } from './fixtures/flowchart';
import { SEQUENCE_DIAGRAM_TESTCASES } from './fixtures/sequence';
import { UNSUPPORTED_DIAGRAM_TESTCASES } from './fixtures/unsupported';

const removeLeftoverMermaidDom = () => {
  document.getElementById('mermaid-diagram')?.remove();
  document.getElementById('mermaid-to-verd-board')?.remove();
  document.getElementById('dmermaid-to-verd-board')?.remove();
};

afterEach(() => {
  removeLeftoverMermaidDom();
});

describe.sequential('parseMermaid fixtures', () => {
  it.each(FLOWCHART_DIAGRAM_TESTCASES)(
    'flowchart: $name',
    async ({ definition }) => {
      const graph = await parseMermaid(definition);
      expect(graph.type).toBe('flowchart');
      const snapshot = graphToFrameSnapshot(graph);
      expect(Object.keys(snapshot.store.cells).length).toBeGreaterThan(1);
      expect(validateCellStore(snapshot.store)).toEqual([]);
    },
  );

  it.each(SEQUENCE_DIAGRAM_TESTCASES)(
    'sequence: $name',
    async ({ definition }) => {
      const graph = await parseMermaid(definition);
      expect(graph.type).toBe('sequence');
      const snapshot = graphToFrameSnapshot(graph);
      expect(Object.keys(snapshot.store.cells).length).toBeGreaterThan(1);
      expect(validateCellStore(snapshot.store)).toEqual([]);
    },
  );

  it.each(CLASS_DIAGRAM_TESTCASES)('class: $name', async ({ definition }) => {
    const graph = await parseMermaid(definition);
    expect(graph.type).toBe('class');
    const snapshot = graphToFrameSnapshot(graph);
    expect(Object.keys(snapshot.store.cells).length).toBeGreaterThan(1);
    expect(validateCellStore(snapshot.store)).toEqual([]);
  });

  it.each(UNSUPPORTED_DIAGRAM_TESTCASES)(
    'unsupported: $name',
    async ({ definition }) => {
      const graph = await parseMermaid(definition);
      expect(graph.type).toBe('graphImage');
      const snapshot = graphToFrameSnapshot(graph);
      expect(Object.keys(snapshot.store.cells).length).toBeGreaterThan(1);
      expect(validateCellStore(snapshot.store)).toEqual([]);
    },
  );
});

describe('native Mermaid imports', () => {
  it('keeps concurrent diagram imports independent', async () => {
    const snapshots = await Promise.all([
      parseMermaidToFrameSnapshot('flowchart LR\nA[Alpha] --> B[Beta]'),
      parseMermaidToFrameSnapshot('flowchart LR\nC[Gamma] --> D[Delta]'),
    ]);
    const labels = snapshots.map((snapshot) =>
      Object.values(snapshot.store.cells).flatMap((cell) =>
        'content' in cell && cell.content?.label ? [cell.content.label] : [],
      ),
    );
    expect(labels[0]).toEqual(['Alpha', 'Beta']);
    expect(labels[1]).toEqual(['Gamma', 'Delta']);
    expect(document.querySelectorAll('[id^="verd-mermaid-"]')).toHaveLength(0);
  });
  it('recovers from a rejected import and cleans rendering DOM', async () => {
    await expect(
      parseMermaidToFrameSnapshot('flowchart LR\nA[Broken'),
    ).rejects.toThrow();
    const snapshot = await parseMermaidToFrameSnapshot(
      'flowchart LR\nA[Valid] --> B[Next]',
      { scene: 'workflow' },
    );
    expect(
      Object.values(snapshot.store.cells).filter(
        (cell) => cell.kind === 'workflow-task',
      ),
    ).toHaveLength(2);
    expect(validateCellStore(snapshot.store)).toEqual([]);
    expect(document.querySelectorAll('[id^="verd-mermaid-"]')).toHaveLength(0);
  });
});
