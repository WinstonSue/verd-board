import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCellRegistry,
  isFrameCell,
  validateCellStore,
  type CellStore,
  type FrameSnapshot,
} from '@sue/board-core';
import { registerDrawCells } from '@sue/board-draw';
import { registerMindCells } from '@sue/board-mind';
import { registerWorkflowCells } from '@sue/board-workflow';
import { registerArchitectureCells } from '@sue/board-architecture';
import { parseMarkdownToFrameSnapshot } from '@sue/board-markdown-to-board';
import {
  parseMermaidToArchitectureFrame,
  parseMermaidToWorkflowFrame,
} from '@sue/board-mermaid-to-board';
import {
  assembleWorkspaceStore,
  isFrameFileV2,
  parseFrameExport,
  partitionCellStore,
  remapImportedFiles,
  validateFrameFiles,
  type FrameFileV2,
} from './frame-files';

/**
 * Contract between `doc/guides/ai-canvas-data-spec.md` and
 * `doc/examples/ai-canvas/`: every fenced block tagged with a file path must
 * match that file byte-for-byte (modulo trailing whitespace), and every
 * example must pass the real validators/parsers used at import time.
 */
const examplesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../doc/examples/ai-canvas',
);
const specPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../doc/guides/ai-canvas-data-spec.md',
);

const readExample = (name: string) =>
  readFileSync(path.join(examplesDir, name), 'utf8');
const readJson = (name: string) => JSON.parse(readExample(name)) as unknown;

const registry = () => {
  const next = createCellRegistry();
  registerDrawCells(next);
  registerMindCells(next);
  registerWorkflowCells(next);
  registerArchitectureCells(next);
  return next;
};

const isSnapshot = (value: unknown): value is FrameSnapshot => {
  const store = (value as FrameSnapshot | undefined)?.store;
  return (
    !!value &&
    typeof value === 'object' &&
    !!store &&
    typeof store.rootId === 'string' &&
    isFrameCell(store.cells?.[store.rootId])
  );
};

const frameFiles = [
  'whiteboard-basic.verd.json',
  'whiteboard-advanced.verd.json',
  'mind-map.verd.json',
  'workflow-dag.verd.json',
  'workflow-process.verd.json',
  'architecture.verd.json',
];
const bundleFile = 'bundle-multi-canvas.verd.json';
const snapshotFile = 'snapshot-nested-frames.frame.json';
const textFiles = ['mind-map.md', 'workflow-dag.mmd', 'architecture.mmd'];
const allFiles = [...frameFiles, bundleFile, snapshotFile, ...textFiles];

describe('ai-canvas-data-spec embedded blocks', () => {
  const spec = readFileSync(specPath, 'utf8');
  const blocks = new Map<string, string>();
  const fence = /^```(\w+)\s+(doc\/examples\/ai-canvas\/\S+)\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(spec))) {
    const start = spec.indexOf('\n', match.index) + 1;
    const end = spec.indexOf('\n```', start);
    blocks.set(match[2], spec.slice(start, end));
  }

  it('embeds every example file exactly', () => {
    expect([...blocks.keys()].sort()).toEqual(
      allFiles.map((name) => `doc/examples/ai-canvas/${name}`).sort(),
    );
    for (const [file, content] of blocks)
      expect(content.trimEnd()).toBe(
        readFileSync(
          path.resolve(examplesDir, '..', '..', '..', file),
          'utf8',
        ).trimEnd(),
      );
  });
});

describe('FrameFileV2 examples', () => {
  it.each(frameFiles)('%s validates as a file and round-trips', (name) => {
    const file = readJson(name);
    expect(isFrameFileV2(file)).toBe(true);
    const typed = file as FrameFileV2;
    expect(validateFrameFiles([typed], registry())).toEqual([]);
    const { store, diagnostics } = assembleWorkspaceStore([typed], registry());
    expect(diagnostics).toEqual([]);
    const partitioned = partitionCellStore(store).files;
    expect(partitioned).toHaveLength(1);
    expect(partitioned[0]).toEqual(typed);
  });
});

describe('bundle and snapshot examples', () => {
  it('bundle parses, validates and assembles both canvases', () => {
    const files = parseFrameExport(readJson(bundleFile));
    expect(files).not.toBeNull();
    expect(files).toHaveLength(2);
    expect(validateFrameFiles(files!, registry())).toEqual([]);
    const { store, diagnostics } = assembleWorkspaceStore(files!, registry());
    expect(diagnostics).toEqual([]);
    expect(isFrameCell(store.cells['canvas-overview'])).toBe(true);
    expect(isFrameCell(store.cells['canvas-detail'])).toBe(true);
  });

  it('remaps imported bundle ids on collision without breaking references', () => {
    const files = parseFrameExport(readJson(bundleFile))!;
    const existing = new Set(
      files.flatMap((file) => [file.frame.id, ...Object.keys(file.cells)]),
    );
    const remapped = remapImportedFiles(
      files,
      (id) => existing.has(id),
      (() => {
        let sequence = 0;
        return () => `imported-${++sequence}`;
      })(),
    );
    expect(remapped[0].frame.id).not.toBe('canvas-overview');
    expect(validateFrameFiles(remapped, registry())).toEqual([]);
    const reference = Object.values(remapped[0].cells).find(
      (cell) => cell.kind === 'frame-reference',
    );
    expect(
      reference &&
        'targetFrameId' in (reference.data as Record<string, unknown>) &&
        (reference.data as { targetFrameId: string }).targetFrameId ===
          remapped[1].frame.id,
    ).toBe(true);
  });

  it('snapshot validates and partitions nested frames into a bundle', () => {
    const snapshot = readJson(snapshotFile);
    expect(isSnapshot(snapshot)).toBe(true);
    const { store } = snapshot as FrameSnapshot;
    expect(validateCellStore(store as CellStore, registry())).toEqual([]);
    const files = partitionCellStore(store as CellStore).files;
    expect(files).toHaveLength(2);
    expect(validateFrameFiles(files, registry())).toEqual([]);
    expect(
      Object.values(files[0].cells).some(
        (cell) => cell.kind === 'frame-reference',
      ) ||
        Object.values(files[1].cells).some(
          (cell) => cell.kind === 'frame-reference',
        ),
    ).toBe(true);
  });
});

describe('text examples run through the real converters', () => {
  it('markdown becomes a valid mind frame', () => {
    const snapshot = parseMarkdownToFrameSnapshot(readExample('mind-map.md'));
    expect(validateCellStore(snapshot.store, registry())).toEqual([]);
    const kinds = Object.values(snapshot.store.cells).map((cell) => cell.kind);
    expect(kinds).toContain('mind-root');
    expect(kinds).toContain('mind-branch');
  });

  it('mermaid flowchart becomes a valid workflow frame', () => {
    const snapshot = parseMermaidToWorkflowFrame(
      readExample('workflow-dag.mmd'),
    );
    expect(validateCellStore(snapshot.store, registry())).toEqual([]);
    const kinds = Object.values(snapshot.store.cells).map((cell) => cell.kind);
    expect(kinds).toContain('workflow-start');
    expect(kinds).toContain('workflow-edge');
  });

  it('mermaid flowchart with subgraphs becomes a valid architecture frame', () => {
    const snapshot = parseMermaidToArchitectureFrame(
      readExample('architecture.mmd'),
    );
    expect(validateCellStore(snapshot.store, registry())).toEqual([]);
    const layers = Object.values(snapshot.store.cells).filter(
      (cell) => cell.kind === 'architecture-layer',
    );
    expect(layers).toHaveLength(3);
  });
});
