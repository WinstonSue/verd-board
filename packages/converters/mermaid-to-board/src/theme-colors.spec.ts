import { describe, expect, it } from 'vitest';
import {
  isEdgeCell,
  isFrameCell,
  isNodeCell,
  resolveBoardTheme,
  resolveCellAppearance,
} from '@sue/board-core';
import { parseMermaidToFrameSnapshot } from './index';

describe('Mermaid authored color sources', () => {
  it.each(['whiteboard', 'uml-class'] as const)(
    'preserves authored class colors in %s imports',
    async (scene) => {
      const value = await parseMermaidToFrameSnapshot(
        `classDiagram
class A
style A fill:#ffffff,stroke:#123456,color:#ff0000
`,
        { scene },
      );
      const nodes = Object.values(value.store.cells).filter(isNodeCell);
      const styled = nodes.find(
        (cell) => cell.appearance?.colorSources?.fill === 'custom',
      )!;
      expect(styled).toBeDefined();
      expect(
        resolveCellAppearance(styled, resolveBoardTheme(undefined, 'dark')),
      ).toMatchObject({ fill: '#ffffff', strokeColor: '#123456' });
      expect(JSON.stringify(nodes.map((cell) => cell.content?.text))).toContain(
        '#ff0000',
      );
    },
  );
  it('lets renderer defaults follow themes, while preserving explicit style, multiple classes and linkStyle', async () => {
    const value = await parseMermaidToFrameSnapshot(`flowchart LR
A[Default] --> B[Styled]
B -->|Edge label| C[Classes]
style B fill:#ffffff,color:#ff0000
classDef fillClass fill:#ffcc00
classDef lineClass stroke:#008800
class C fillClass,lineClass
linkStyle 1 stroke:#123456,color:#884422
`);
    const cells = Object.values(value.store.cells);
    const nodes = cells.filter(isNodeCell).filter((cell) => !isFrameCell(cell));
    const get = (label: string) =>
      nodes.find((node) => node.content?.label === label)!;
    const theme = resolveBoardTheme(undefined, 'dark');
    expect(resolveCellAppearance(get('Default'), theme)).toMatchObject({
      fill: theme.surface,
      strokeColor: theme.stroke,
    });
    expect(get('Styled').appearance?.colorSources).toEqual({
      fill: 'custom',
      strokeColor: 'theme',
    });
    expect(resolveCellAppearance(get('Styled'), theme).fill).toBe('#ffffff');
    expect(JSON.stringify(get('Styled').content?.text)).toContain('#ff0000');
    expect(JSON.stringify(get('Styled').content?.text)).toContain(
      '\"colorSource\":\"custom\"',
    );
    expect(get('Classes').appearance?.colorSources).toEqual({
      fill: 'custom',
      strokeColor: 'custom',
    });
    expect(resolveCellAppearance(get('Classes'), theme)).toMatchObject({
      fill: '#ffcc00',
      strokeColor: '#008800',
    });
    const edges = cells.filter(isEdgeCell);
    expect(edges[0].appearance?.colorSources?.strokeColor).toBe('theme');
    expect(edges[1].appearance?.colorSources?.strokeColor).toBe('custom');
    expect(resolveCellAppearance(edges[1], theme).strokeColor).toBe('#123456');
    expect(JSON.stringify(edges[1].labels)).toContain('#884422');
    expect(JSON.stringify(edges[1].labels)).toContain(
      '\"colorSource\":\"custom\"',
    );
  });

  it.each(['whiteboard', 'workflow', 'architecture'] as const)(
    'keeps authored defaults and per-edge styles in %s imports',
    async (scene) => {
      const value = await parseMermaidToFrameSnapshot(
        `flowchart LR
A[First] --> B[Second]
B --> C[Third]
classDef default fill:#ffffff
linkStyle default stroke:#009900
linkStyle 1 stroke:#123456
`,
        { scene },
      );
      const nodes = Object.values(value.store.cells)
        .filter(isNodeCell)
        .filter((cell) =>
          ['First', 'Second', 'Third'].includes(cell.content?.label ?? ''),
        );
      const theme = resolveBoardTheme(undefined, 'dark');
      for (const node of nodes)
        expect(resolveCellAppearance(node, theme).fill).toBe('#ffffff');
      const edges = Object.values(value.store.cells).filter(isEdgeCell);
      expect(
        edges.map((edge) => resolveCellAppearance(edge, theme).strokeColor),
      ).toEqual(['#009900', '#123456']);
    },
  );
});
