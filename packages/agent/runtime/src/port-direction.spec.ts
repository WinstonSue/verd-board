import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { patternWorkspaceUrl } from '@sue/verd-board-agent-patterns/agent';
import { isEdgeCell, isNodeCell } from '@sue/board-core';
import {
  validateNativeWorkspace,
  type FrameFileV2,
} from '@sue/verd-board-workspace';
import { prepareAuthoringBatch } from './authoring';
import { applyPreparedBatch } from './apply';
import { readNativeSnapshot } from './node/workspace-lock';
import { runCli } from './cli';

async function fixture(pattern = 'workflow-dag'): Promise<FrameFileV2> {
  return JSON.parse(
    await fs.readFile(
      new URL(`${pattern}/模板.verd.json`, patternWorkspaceUrl),
      'utf8',
    ),
  );
}

it.each([
  ['right', 'left'],
  ['bottom', 'top'],
] as const)(
  'accepts %s output and %s input, including custom port IDs',
  async (sourceSide, targetSide) => {
    const file = await fixture();
    for (const edge of Object.values(file.cells)) {
      if (!isEdgeCell(edge)) continue;
      for (const end of ['source', 'target'] as const) {
        const terminal = edge[end];
        if (!('cellId' in terminal)) continue;
        const node = file.cells[terminal.cellId];
        if (!isNodeCell(node)) continue;
        node.ports = [
          { id: 'custom-out', side: sourceSide, direction: 'output' },
          { id: 'custom-in', side: targetSide, direction: 'input' },
        ];
        terminal.portId = end === 'source' ? 'custom-out' : 'custom-in';
      }
    }
    expect(validateNativeWorkspace([{ path: 'flow.verd.json', file }])).toEqual(
      [],
    );
  },
);

it('reports each reversed endpoint with its pointer, without changing the file or runtime validation', async () => {
  const file = await fixture('workflow-process');
  const entries = [{ path: 'flow.verd.json', file }];
  const before = JSON.stringify(file);
  const issues = validateNativeWorkspace(entries);
  expect(issues).toHaveLength(3);
  expect(
    issues.every(
      (issue) =>
        issue.code === 'workflow.port-direction' &&
        issue.severity === 'warning',
    ),
  ).toBe(true);
  expect(issues.map((issue) => issue.pointer)).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/\/source\/portId$/),
      expect.stringMatching(/\/target\/portId$/),
    ]),
  );
  expect(
    issues.every(
      (issue) =>
        issue.cellId &&
        issue.fileId &&
        issue.path === 'flow.verd.json' &&
        issue.suggestion?.includes('Loops'),
    ),
  ).toBe(true);
  expect(validateNativeWorkspace(entries, { profile: 'runtime' })).toEqual([]);
  expect(JSON.stringify(file)).toBe(before);
  const edge = Object.values(file.cells).find(isEdgeCell)!;
  edge.source = { cellId: 'missing-node', portId: 'unknown' };
  expect(
    validateNativeWorkspace(entries).some(
      (issue) => issue.severity === 'error',
    ),
  ).toBe(true);
});

it('keeps direction warnings non-blocking through plan, CLI validate and apply', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-port-direction-'));
  try {
    const file = await fixture('workflow-process');
    const plan = await prepareAuthoringBatch(await readNativeSnapshot(root), [
      { type: 'file.import', file, path: 'flow.verd.json' },
    ]);
    expect(plan.diagnostics).toHaveLength(3);
    expect(
      plan.diagnostics.every((issue) => issue.severity === 'warning'),
    ).toBe(true);
    const planPath = path.join(root, 'plan.json');
    await fs.writeFile(planPath, JSON.stringify(plan));
    expect(
      await runCli([
        'validate',
        '--workspace',
        root,
        '--plan',
        planPath,
        '--json',
      ]),
    ).toMatchObject({
      exitCode: 0,
      result: {
        valid: true,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'workflow.port-direction',
            severity: 'warning',
          }),
        ]),
      },
    });
    await applyPreparedBatch(root, plan);
    expect((await readNativeSnapshot(root)).entries).toHaveLength(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
