import { createCellRegistry } from '@sue/board-core';
import {
  createUmlPlugin,
  createUmlSequenceFrameSnapshot,
} from '@sue/board-uml';
import { expect, it, vi } from 'vitest';
import { frameFileFor } from '../frames/frame-files';
import { createMemoryWorkspaceHost } from '../host/memory-workspace-host';
import { openWorkspaceSession } from '../session/workspace-session';
import { createCanvasSession } from './canvas-session';
it('refuses a missing domain with diagnostics and zero writes, then opens the same native bytes after installation', async () => {
  const host = createMemoryWorkspaceHost(),
    handle = (await host.openWorkspace({ path: 'plugin-open' }))!;
  const value = createUmlSequenceFrameSnapshot('uml-file', 'sequence-root');
  const source = JSON.stringify(frameFileFor(value.store, 'uml-file'));
  await host.commit(handle, {
    transactionId: 'seed',
    writes: [{ path: 'uml.verd.json', content: source, expectedVersion: null }],
  });
  const commits = vi.spyOn(host, 'commit');
  const registry = createCellRegistry({ plugins: [] });
  const session = await openWorkspaceSession(host, handle, { registry });
  const canvas = createCanvasSession({ session, registry });
  const result = canvas.openFile('uml-file');
  expect(result).toMatchObject({
    ok: false,
    code: 'UNREGISTERED_CELL_KINDS',
    kinds: ['uml-sequence-root'],
  });
  expect(canvas.active()).toBeUndefined();
  await session.flush();
  expect(commits).not.toHaveBeenCalled();
  expect(
    new TextDecoder().decode(
      (await host.readFile(handle, 'uml.verd.json')).content,
    ),
  ).toBe(source);
  canvas.dispose();
  session.dispose();
  const installed = createCellRegistry({ plugins: [createUmlPlugin()] });
  const reopened = await openWorkspaceSession(host, handle, {
    registry: installed,
  });
  const editor = createCanvasSession({
    session: reopened,
    registry: installed,
  });
  expect(editor.openFile('uml-file')).toMatchObject({ ok: true });
  expect(commits).not.toHaveBeenCalled();
  expect(
    new TextDecoder().decode(
      (await host.readFile(handle, 'uml.verd.json')).content,
    ),
  ).toBe(source);
  editor.dispose();
  reopened.dispose();
});
