import { describe, expect, it } from 'vitest';
import {
  createDocumentReferenceCell,
  createFrameCell,
  createFrameReferenceCell,
} from '@sue/board-core';
import { createFrameFile } from '../frames/frame-files';
import {
  createDocumentFile,
  workspaceFileId,
  type WorkspaceFile,
} from './document-files';
import {
  buildWorkspaceReferenceGraph,
  workspaceDocumentDependents,
  workspaceFileClosure,
} from './workspace-references';

describe('workspace export document dependencies', () => {
  it('matches actual export closures through references and cycles while ignoring legacy ownership and missing targets', () => {
    const board = createFrameFile(createFrameCell('board'));
    const child = createFrameFile(createFrameCell('child'));
    child.organization = { kind: 'subgraph', ownerFrameId: 'board' };
    const linked = createFrameFile(createFrameCell('linked'));
    const empty = createFrameFile(createFrameCell('empty'));
    const missing = createFrameFile(createFrameCell('missing'));
    const doc = createDocumentFile('doc');
    const geometry = { x: 0, y: 0, width: 100, height: 100 };
    const add = (
      file: typeof board,
      cell:
        | ReturnType<typeof createDocumentReferenceCell>
        | ReturnType<typeof createFrameReferenceCell>,
    ) => {
      file.frame.children.push(cell.id);
      file.cells[cell.id] = cell;
    };
    add(child, createDocumentReferenceCell('doc-ref', 'doc', geometry));
    add(linked, createFrameReferenceCell('board-ref', 'board', geometry));
    add(child, createFrameReferenceCell('cycle-ref', 'linked', geometry));
    add(missing, createDocumentReferenceCell('missing-ref', 'gone', geometry));
    doc.text.content.content = [
      { type: 'frameReference', attrs: { targetFrameId: 'linked' } },
    ];
    const files: WorkspaceFile[] = [board, child, linked, empty, missing, doc];
    const roots = workspaceDocumentDependents(
      files,
      buildWorkspaceReferenceGraph(files),
    );
    expect([...roots].sort()).toEqual(['child', 'doc']);
    for (const file of files) {
      const id = workspaceFileId(file);
      expect(roots.has(id)).toBe(
        workspaceFileClosure(files, id).some(
          (dependency) => dependency.format === 'verd-document',
        ),
      );
    }
    // Removing a document must remove the native bundle export affordance.
    const withoutDoc = files.filter((file) => workspaceFileId(file) !== 'doc');
    expect(
      workspaceDocumentDependents(
        withoutDoc,
        buildWorkspaceReferenceGraph(withoutDoc),
      ).size,
    ).toBe(0);
  });
});
