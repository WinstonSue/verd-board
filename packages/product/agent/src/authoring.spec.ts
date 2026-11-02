import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  patterns,
  patternWorkspaceUrl,
  patternRules,
} from '@sue/verd-board-agent-patterns';
import {
  createDocumentFile,
  validateNativeWorkspace,
  WORKSPACE_RULES,
  type DocumentFileV1,
} from '@sue/verd-board-app/headless';
import { readNativeSnapshot } from './node/workspace-lock';
import { initializePatternWorkspace } from './node/pattern-workspace';
import { prepareAuthoringBatch, describeAuthoring } from './authoring';
import { applyPreparedBatch } from './apply';
import { runOperations } from './operations';
import type { AuthoringOperation } from './types';
import { parseOperations } from './schema';

const temporary: string[] = [];
async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-agent-test-'));
  temporary.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((p) => fs.rm(p, { recursive: true, force: true })),
  );
});
describe('agent patterns and real authoring contracts', () => {
  it('uses its published operation schema for nested input checks', () => {
    expect(() =>
      parseOperations([
        {
          type: 'file.create',
          kind: 'invented',
          title: 'X',
          path: 'x.verd.json',
        },
      ]),
    ).toThrow();
    expect(() =>
      parseOperations([{ type: 'element.remove', fileId: 'x', ids: [null] }]),
    ).toThrow();
    expect(() =>
      parseOperations([
        {
          type: 'table.track',
          fileId: 'x',
          id: 'table',
          axis: 'diagonal',
          action: 'insert',
          index: 0,
        },
      ]),
    ).toThrow();
  });
  it('uses semantic builders for whiteboard, mind, architecture, and UML updates', () => {
    const ops: AuthoringOperation[] = [
      {
        type: 'file.create',
        kind: 'whiteboard',
        id: 'board',
        title: 'Board',
        path: 'board.verd.json',
      },
      {
        type: 'node.upsert',
        fileId: 'board',
        id: 'text',
        kind: 'text',
        label: 'Text',
      },
      { type: 'node.upsert', fileId: 'board', id: 'table', kind: 'table' },
      {
        type: 'table.track',
        fileId: 'board',
        id: 'table',
        axis: 'row',
        action: 'insert',
        index: 1,
      },
      {
        type: 'table.merge',
        fileId: 'board',
        id: 'table',
        range: { top: 0, left: 0, bottom: 0, right: 1 },
      },
      {
        type: 'file.create',
        kind: 'mind',
        id: 'mind',
        title: 'Mind',
        path: 'mind.verd.json',
      },
      { type: 'node.upsert', fileId: 'mind', id: 'topic', kind: 'mind-child' },
      { type: 'node.upsert', fileId: 'mind', id: 'topic2', kind: 'mind-child' },
      {
        type: 'relation.move',
        fileId: 'mind',
        id: 'topic2',
        parentId: 'topic',
      },
      {
        type: 'file.create',
        kind: 'architecture',
        id: 'arch',
        title: 'Architecture',
        path: 'arch.verd.json',
      },
      {
        type: 'node.upsert',
        fileId: 'arch',
        id: 'layer',
        kind: 'architecture-layer',
      },
      {
        type: 'node.upsert',
        fileId: 'arch',
        id: 'module',
        kind: 'architecture-module',
      },
      {
        type: 'relation.move',
        fileId: 'arch',
        id: 'module',
        parentId: 'layer',
      },
      {
        type: 'architecture.reorder',
        fileId: 'arch',
        ids: ['layer', 'arch:root'],
      },
      {
        type: 'file.create',
        kind: 'uml-class',
        id: 'class',
        title: 'Classes',
        path: 'class.verd.json',
      },
      { type: 'node.upsert', fileId: 'class', id: 'one', kind: 'uml-class' },
      {
        type: 'node.upsert',
        fileId: 'class',
        id: 'two',
        kind: 'uml-class',
        data: { classifier: 'interface' },
      },
      {
        type: 'edge.upsert',
        fileId: 'class',
        id: 'relation',
        sourceId: 'one',
        targetId: 'two',
        relation: 'realization',
      },
      {
        type: 'file.create',
        kind: 'uml-sequence',
        id: 'sequence',
        title: 'Sequence',
        path: 'sequence.verd.json',
      },
      {
        type: 'node.upsert',
        fileId: 'sequence',
        id: 'user',
        kind: 'uml-participant',
      },
      {
        type: 'node.upsert',
        fileId: 'sequence',
        id: 'service',
        kind: 'uml-participant',
      },
      {
        type: 'edge.upsert',
        fileId: 'sequence',
        id: 'request',
        sourceId: 'user',
        targetId: 'service',
      },
      {
        type: 'edge.upsert',
        fileId: 'sequence',
        id: 'response',
        sourceId: 'service',
        targetId: 'user',
        messageKind: 'return',
      },
      {
        type: 'sequence.activation',
        fileId: 'sequence',
        participantId: 'service',
        startId: 'request',
        endId: 'response',
      },
    ];
    const created = runOperations([], ops).entries;
    expect(validateNativeWorkspace(created)).toEqual([]);
    const edited = runOperations(created, [
      {
        type: 'edge.upsert',
        fileId: 'sequence',
        id: 'request',
        sourceId: 'user',
        targetId: 'service',
        messageKind: 'async',
      },
      {
        type: 'edge.upsert',
        fileId: 'class',
        id: 'relation',
        sourceId: 'one',
        targetId: 'two',
        sourcePort: 'bottom',
        targetPort: 'top',
      },
    ]).entries;
    const sequence = edited.find(
      (e) => e.file.format === 'verd-frame' && e.file.frame.id === 'sequence',
    )!.file;
    if (sequence.format !== 'verd-frame') throw new Error('Expected sequence');
    expect(
      (sequence.cells.request as { data: { messageKind: string } }).data
        .messageKind,
    ).toBe('async');
    const diagram = edited.find(
      (e) => e.file.format === 'verd-frame' && e.file.frame.id === 'class',
    )!.file;
    if (diagram.format !== 'verd-frame') throw new Error('Expected class');
    expect(
      (diagram.cells.relation as { source: { portId: string } }).source.portId,
    ).toBe('bottom');
    expect(validateNativeWorkspace(edited)).toEqual([]);
  });
  it('imports Markdown and Mermaid using the canonical converters', async () => {
    const root = await workspace();
    const plan = await prepareAuthoringBatch(await readNativeSnapshot(root), [
      {
        type: 'file.create',
        kind: 'document',
        id: 'doc',
        title: 'Doc',
        path: 'doc.verd-doc.json',
      },
      {
        type: 'document.set',
        fileId: 'doc',
        markdown: '# Title\n\n**Important** text.',
      },
      {
        type: 'mermaid.import',
        scene: 'workflow',
        source: 'flowchart TD\n A[Start] --> B[Task]',
        path: 'flow.verd.json',
      },
      {
        type: 'mermaid.import',
        scene: 'architecture',
        source: 'flowchart LR\n A[Client] --> B[Service]',
        path: 'arch.verd.json',
      },
      {
        type: 'mermaid.import',
        scene: 'uml-class',
        source:
          'classDiagram\n class Order\n class Repository\n Order --> Repository',
        path: 'class.verd.json',
      },
      {
        type: 'mermaid.import',
        scene: 'uml-sequence',
        source:
          'sequenceDiagram\n participant User\n participant Service\n User->>Service: request()',
        path: 'sequence.verd.json',
      },
    ]);
    expect(plan.diagnostics).toEqual([]);
  });
  it('repairs an isolated invalid runtime file while preserving its old bytes in trash', async () => {
    const root = await workspace();
    const original = runOperations(
      [],
      [
        {
          type: 'file.create',
          kind: 'workflow',
          id: 'flow',
          title: 'Flow',
          path: 'flow.verd.json',
        },
        {
          type: 'node.upsert',
          fileId: 'flow',
          id: 'task',
          kind: 'workflow-task',
        },
      ],
    ).entries[0];
    const broken = structuredClone(original.file);
    if (broken.format !== 'verd-frame') throw new Error('Expected frame');
    (
      broken.cells['flow:root'] as { data: { memberIds: string[] } }
    ).data.memberIds = [];
    const bytes = JSON.stringify(broken);
    await fs.writeFile(path.join(root, original.path), bytes);
    const plan = await prepareAuthoringBatch(await readNativeSnapshot(root), [
      { type: 'file.replace', fileId: 'flow', file: original.file },
    ]);
    expect(plan.diagnostics).toEqual([]);
    expect((await applyPreparedBatch(root, plan)).outcome).toBe('applied');
    expect(
      validateNativeWorkspace((await readNativeSnapshot(root)).entries),
    ).toEqual([]);
    const trash = await fs.readdir(path.join(root, '.verdscrolls/trash'));
    expect(trash.length).toBeGreaterThan(0);
  });
  it('ships a complete native workspace and explanations for actual rule IDs', async () => {
    const snapshot = await readNativeSnapshot(
      fileURLToPath(patternWorkspaceUrl),
    );
    expect(validateNativeWorkspace(snapshot.entries)).toEqual([]);
    expect(patterns).toHaveLength(13);
    expect(patterns.map((pattern) => pattern.id)).toEqual(
      expect.arrayContaining([
        'technical-proposal',
        'adr',
        'system-design',
        'requirements',
      ]),
    );
    for (const rule of patternRules)
      expect(Object.keys(WORKSPACE_RULES)).toContain(rule.id);
    for (const pattern of patterns) {
      expect(pattern.ruleIds.every((id) => id in WORKSPACE_RULES)).toBe(true);
      const plan = await prepareAuthoringBatch(
        await readNativeSnapshot(await workspace()),
        [
          {
            type: 'pattern.instantiate',
            patternId: pattern.id,
            parameters: { title: 'Custom title' },
          },
        ],
      );
      expect(plan.diagnostics).toEqual([]);
      expect(plan.files.length).toBe(pattern.templatePaths.length);
      expect(validateNativeWorkspace(plan.files)).toEqual([]);
      expect(
        plan.files.some((e) =>
          e.file.format === 'verd-document'
            ? e.file.title === 'Custom title'
            : e.file.frame.name === 'Custom title',
        ),
      ).toBe(true);
    }
  });
  it('seeds once, preserves edited copies and refuses explicit replacement', async () => {
    const root = await workspace(),
      target = path.join(root, 'patterns');
    expect((await initializePatternWorkspace(target)).created).toBe(true);
    const file = path.join(target, '范式导航.verd-doc.json');
    await fs.writeFile(file, 'user edit');
    expect(
      (await initializePatternWorkspace(target, { preserveExisting: true }))
        .created,
    ).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe('user edit');
    await expect(initializePatternWorkspace(target)).rejects.toThrow(
      'TARGET_EXISTS',
    );
    const failed = path.join(root, 'failed');
    await expect(
      initializePatternWorkspace(failed, {
        source: path.join(root, 'missing'),
      }),
    ).rejects.toThrow();
    expect(await fs.readdir(root)).not.toContain('failed');
    expect((await fs.readdir(root)).some((p) => p.includes('.seed-'))).toBe(
      false,
    );
  });
  it('preserves rich marks while editing selected document blocks, deriving the cache', async () => {
    const doc = createDocumentFile('doc', 'Doc');
    doc.text.content.content = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Keep', marks: [{ type: 'bold' }] }],
      },
    ];
    doc.text.plainText = 'Keep';
    const { entries } = runOperations(
      [{ path: 'doc.verd-doc.json', file: doc }],
      [
        {
          type: 'document.splice',
          fileId: 'doc',
          index: 1,
          blocks: [
            { type: 'paragraph', content: [{ type: 'text', text: 'New' }] },
          ],
        },
      ],
    );
    const edited = entries[0].file as DocumentFileV1;
    expect(edited.text.content.content![0]).toEqual(
      doc.text.content.content![0],
    );
    expect(edited.text.plainText).toBe('Keep\nNew');
    expect(validateNativeWorkspace(entries)).toEqual([]);
  });
  it('creates and saves every content type together, then confirms the same transaction', async () => {
    const root = await workspace();
    const operations: AuthoringOperation[] = [
      'document',
      'whiteboard',
      'mind',
      'workflow',
      'architecture',
      'uml-class',
      'uml-sequence',
    ].map((kind, i) => ({
      type: 'file.create',
      kind: kind as never,
      id: 'file-' + i,
      title: kind,
      path: `${kind}${kind === 'document' ? '.verd-doc.json' : '.verd.json'}`,
    }));
    const plan = await prepareAuthoringBatch(
      await readNativeSnapshot(root),
      operations,
    );
    expect(plan.diagnostics).toEqual([]);
    expect((await applyPreparedBatch(root, plan)).outcome).toBe('applied');
    expect((await applyPreparedBatch(root, plan)).transactionId).toBe(
      plan.transactionId,
    );
    const saved = await readNativeSnapshot(root);
    expect(saved.entries).toHaveLength(7);
    expect(validateNativeWorkspace(saved.entries)).toEqual([]);
  });
  it('rejects a stale cross-file snapshot and edited prepared contents', async () => {
    const root = await workspace(),
      snapshot = await readNativeSnapshot(root);
    const a = await prepareAuthoringBatch(snapshot, [
      {
        type: 'file.create',
        kind: 'document',
        title: 'A',
        path: 'A.verd-doc.json',
      },
    ]);
    const b = await prepareAuthoringBatch(snapshot, [
      {
        type: 'file.create',
        kind: 'document',
        title: 'B',
        path: 'B.verd-doc.json',
      },
    ]);
    await applyPreparedBatch(root, a);
    await expect(applyPreparedBatch(root, b)).rejects.toThrow(
      'VERSION_CONFLICT',
    );
    const edited = structuredClone(a);
    edited.files[0].path = 'different.verd-doc.json';
    await expect(applyPreparedBatch(root, edited)).rejects.toThrow(
      'INVALID_PLAN',
    );
    expect((await readNativeSnapshot(root)).entries).toHaveLength(1);
  });
  it('builds workflow ownership and ports and rejects edges into the start', async () => {
    const create: AuthoringOperation[] = [
      {
        type: 'file.create',
        kind: 'workflow',
        id: 'flow',
        title: 'Flow',
        path: 'flow.verd.json',
      },
      {
        type: 'node.upsert',
        fileId: 'flow',
        id: 'task',
        kind: 'workflow-task',
        label: 'Task',
      },
    ];
    const initial = runOperations([], create).entries;
    const file = initial[0].file;
    if (file.format !== 'verd-frame') throw new Error('Expected frame');
    const start = Object.values(file.cells).find(
      (c) => c.kind === 'workflow-start',
    )!;
    expect(() =>
      runOperations(initial, [
        {
          type: 'edge.upsert',
          fileId: 'flow',
          sourceId: 'task',
          targetId: start.id,
        },
      ]),
    ).toThrow();
    const linked = runOperations(initial, [
      {
        type: 'edge.upsert',
        fileId: 'flow',
        sourceId: start.id,
        targetId: 'task',
      },
    ]);
    expect(validateNativeWorkspace(linked.entries)).toEqual([]);
    const bad = structuredClone(linked.entries);
    const f = bad[0].file;
    if (f.format !== 'verd-frame') return;
    (f.cells[start.id] as { data: { memberIds: string[] } }).data.memberIds =
      [];
    expect(
      validateNativeWorkspace(bad).some(
        (d) => d.code === 'frame.invalid' && d.cellId === 'task',
      ),
    ).toBe(true);
  });
  it('supports supported missing-reference placeholders in the runtime profile only', () => {
    const { entries } = runOperations(
      [],
      [
        {
          type: 'file.create',
          kind: 'whiteboard',
          id: 'canvas',
          title: 'Canvas',
          path: 'canvas.verd.json',
        },
        {
          type: 'reference.upsert',
          fileId: 'canvas',
          targetId: 'missing',
          targetKind: 'document',
        },
      ],
    );
    expect(validateNativeWorkspace(entries, { profile: 'runtime' })).toEqual(
      [],
    );
    expect(
      validateNativeWorkspace(entries).some(
        (d) => d.code === 'reference.invalid',
      ),
    ).toBe(true);
    expect(describeAuthoring().cellKinds).toContain('workflow-start');
  });
});
