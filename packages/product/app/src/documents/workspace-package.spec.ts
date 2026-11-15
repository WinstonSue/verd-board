import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetLink } from '@sue/board-common';
import { createFrameCell } from '@sue/board-core';
import { createDocumentFile, isWorkspaceFile } from '@sue/verd-board-workspace';
import {
  createWorkspacePackage,
  parseWorkspacePackage,
  workspaceAssetPath,
  type WorkspaceExportBundleV2,
} from '@sue/verd-board-workspace';
import { parseWorkspaceExport } from '@sue/verd-board-workspace';
import { createMemoryWorkspaceHost } from '@sue/verd-board-workspace';
import { createWebWorkspaceHost } from '../host/web-workspace-host';
import {
  openWorkspaceSession,
  type WorkspaceSession,
} from '@sue/verd-board-workspace';
import type { CommitRequest, WorkspaceHost } from '@sue/verd-board-workspace';

const sessions: WorkspaceSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});
async function fixture() {
  const content = new TextEncoder().encode('%PDF-1.4 original bytes');
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const assetId = hash + '.pdf';
  const file = createDocumentFile('with-attachment', 'With attachment');
  file.text.content = {
    type: 'doc',
    content: [
      {
        type: 'attachment',
        attrs: {
          src: 'verd-asset:' + workspaceAssetPath(assetId),
          name: 'source.pdf',
          mime: 'application/pdf',
          size: content.length,
        },
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Page two',
            marks: [
              {
                type: 'link',
                attrs: { href: createAssetLink({ assetId, page: 2 }) },
              },
            ],
          },
        ],
      },
    ],
  };
  return { file, assetId, content };
}
describe('self-contained native packages', () => {
  it('exports only the bytes of a Node Buffer view, independent of its backing allocation', async () => {
    const { file, assetId, content } = await fixture();
    const backing = Buffer.alloc(content.length + 8, 7);
    const view = backing.subarray(4, content.length + 4);
    view.set(content);
    const value = await createWorkspacePackage(
      [file],
      file.id,
      async () => view,
    );
    const parsed = await parseWorkspacePackage(value);
    expect(
      parsed!.resources.map((resource) => ({
        assetId: resource.assetId,
        bytes: Array.from(resource.content),
      })),
    ).toEqual([{ assetId, bytes: Array.from(content) }]);
  });
  it('decodes an 8 MiB attachment without a size-dependent regular-expression stack overflow', async () => {
    const content = new Uint8Array(8 * 1024 * 1024).fill(65);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', content)),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const assetId = hash + '.bin';
    const file = createDocumentFile('large-attachment');
    file.text.content = {
      type: 'doc',
      content: [
        {
          type: 'attachment',
          attrs: {
            src: 'verd-asset:' + workspaceAssetPath(assetId),
            name: 'large.bin',
            mime: 'application/octet-stream',
            size: content.length,
          },
        },
      ],
    };
    const prepared = await parseWorkspacePackage({
      format: 'verd-canvas-bundle',
      version: 2,
      rootFileId: file.id,
      files: [file],
      resources: [
        {
          assetId,
          encoding: 'base64',
          byteLength: content.length,
          data: btoa('A'.repeat(content.length)),
        },
      ],
    });
    const decoded = prepared!.resources[0].content;
    expect(decoded.length).toBe(content.length);
    expect(decoded.every((byte, index) => byte === content[index])).toBe(true);
  });

  it('preserves native attachment addresses and page links in a self-validating v2 exchange', async () => {
    const { file, content, assetId } = await fixture();
    const value = (await createWorkspacePackage(
      [file],
      file.id,
      async () => content,
    )) as WorkspaceExportBundleV2;
    expect(value.version).toBe(2);
    expect(isWorkspaceFile(value.files[0])).toBe(true);
    expect(parseWorkspaceExport(value)).toBeNull();
    const prepared = await parseWorkspacePackage(
      JSON.parse(JSON.stringify(value)),
    );
    expect(prepared?.files).toEqual([file]);
    expect(prepared?.resources[0].assetId).toBe(assetId);
    expect(Array.from(prepared!.resources[0].content)).toEqual(
      Array.from(content),
    );
    expect(file.text.content.content?.[0].attrs?.['src']).toBe(
      'verd-asset:' + workspaceAssetPath(assetId),
    );
  });
  it('includes an asset referenced only by a PDF page link and deduplicates repeated references', async () => {
    const { file, content } = await fixture();
    file.text.content.content!.shift();
    file.text.content.content!.push(
      structuredClone(file.text.content.content![0]),
    );
    const read = vi.fn(async () => content);
    const value = (await createWorkspacePackage(
      [file],
      file.id,
      read,
    )) as WorkspaceExportBundleV2;
    expect(value.resources).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
  });
  it('rejects noncanonical base64 pad bits even when the decoded length and digest match', async () => {
    const { file } = await fixture();
    const content = new Uint8Array([0]);
    const assetId =
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('') + '.pdf';
    const attachment = file.text.content.content![0];
    attachment.attrs = {
      ...attachment.attrs,
      src: 'verd-asset:' + workspaceAssetPath(assetId),
      size: 1,
    };
    file.text.content.content = [attachment];
    const value = (await createWorkspacePackage(
      [file],
      file.id,
      async () => content,
    )) as WorkspaceExportBundleV2;
    expect(value.resources[0].data).toBe('AA==');
    expect((await parseWorkspacePackage(value))?.resources[0].content[0]).toBe(
      0,
    );
    value.resources[0].data = 'AB==';
    await expect(parseWorkspacePackage(value)).rejects.toThrow();
  });
  it('retains legacy native and v1 import semantics', async () => {
    const file = createDocumentFile('legacy');
    expect(
      await createWorkspacePackage([file], file.id, async () => {
        throw new Error('unused');
      }),
    ).toEqual(file);
    expect((await parseWorkspacePackage(file))?.files).toEqual([file]);
    expect(
      (
        await parseWorkspacePackage({
          format: 'verd-canvas-bundle',
          version: 1,
          files: [file],
          rootFileId: file.id,
        })
      )?.files,
    ).toEqual([file]);
  });
  it('keeps a resource-free canvas in its existing v1 dependency-export envelope', async () => {
    const frame = createFrameCell('legacy-canvas');
    const file = {
      format: 'verd-frame' as const,
      version: 2 as const,
      frame,
      cells: {},
    };
    expect(
      await createWorkspacePackage([file], frame.id, async () => {
        throw new Error('No resource should be read');
      }),
    ).toEqual({
      format: 'verd-canvas-bundle',
      version: 1,
      rootFileId: frame.id,
      files: [file],
    });
  });
  it('does not interpret prose describing the resource scheme as an attachment', async () => {
    const file = createDocumentFile('scheme-prose');
    file.text.content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'verd-asset: is a local resource scheme' },
          ],
        },
      ],
    };
    expect(
      await createWorkspacePackage([file], file.id, async () => {
        throw new Error('Prose is not a resource');
      }),
    ).toEqual(file);
  });
  it.each([
    'missing',
    'duplicate',
    'base64',
    'length',
    'digest',
    'path',
    'identity',
  ])(
    'rejects a corrupt %s package without falling back to a legacy parser',
    async (fault) => {
      const { file, content } = await fixture();
      const value = (await createWorkspacePackage(
        [file],
        file.id,
        async () => content,
      )) as WorkspaceExportBundleV2;
      if (fault === 'missing') value.resources = [];
      if (fault === 'duplicate') value.resources.push(value.resources[0]);
      if (fault === 'base64')
        value.resources[0].data = '!'.repeat(value.resources[0].data.length);
      if (fault === 'length') value.resources[0].byteLength++;
      if (fault === 'digest')
        value.resources[0].data = btoa('X'.repeat(content.length));
      if (fault === 'path') value.resources[0].assetId = '../escape.pdf';
      if (fault === 'identity') value.rootFileId = 'missing';
      await expect(parseWorkspacePackage(value)).rejects.toThrow();
    },
  );
});
for (const kind of ['memory', 'web'] as const)
  describe(`${kind} atomic native import`, () => {
    async function setup() {
      const host: WorkspaceHost =
        kind === 'memory'
          ? createMemoryWorkspaceHost()
          : createWebWorkspaceHost({
              indexedDB: new IDBFactory(),
              dbName: crypto.randomUUID(),
            });
      const handle = (await host.openWorkspace())!;
      const session = await openWorkspaceSession(host, handle, {
        delayMs: 60000,
      });
      sessions.push(session);
      const data = await fixture();
      return {
        host,
        handle,
        session,
        ...data,
        command: {
          type: 'import-files' as const,
          files: [data.file],
          resources: [{ assetId: data.assetId, content: data.content }],
        },
      };
    }
    it('commits both kinds once, reopens, and keeps shared resources across undo and redo', async () => {
      const { host, handle, session, command, assetId, content } =
        await setup();
      const commit = vi.spyOn(host, 'commit');
      expect((await session.apply(command)).ok).toBe(true);
      expect(commit).toHaveBeenCalledOnce();
      expect(commit.mock.calls[0][1].writes).toHaveLength(1);
      expect(commit.mock.calls[0][1].resourceWrites).toHaveLength(1);
      expect(session.getState().dirty).toBe(false);
      const reopened = await openWorkspaceSession(host, handle);
      sessions.push(reopened);
      expect(reopened.getState().documents.has('with-attachment')).toBe(true);
      expect(
        Array.from(
          (await reopened.readRawFile(workspaceAssetPath(assetId))).content,
        ),
      ).toEqual(Array.from(content));
      expect((await session.undo()).ok).toBe(true);
      await session.flush();
      expect(session.getState().documents.size).toBe(0);
      expect(
        Array.from(
          (await session.readRawFile(workspaceAssetPath(assetId))).content,
        ),
      ).toEqual(Array.from(content));
      expect((await session.redo()).ok).toBe(true);
      await session.flush();
      expect(session.getState().documents.size).toBe(1);
    });
    it('does not publish native content when any resource write is rejected', async () => {
      const { host, handle, session, command } = await setup();
      vi.spyOn(host, 'commit').mockImplementationOnce(
        async (_handle, request) => ({
          transactionId: request.transactionId,
          outcome: 'rejected',
          reason: 'version-conflict',
          path: request.writes!.at(-1)!.path,
        }),
      );
      expect((await session.apply(command)).ok).toBe(false);
      expect(session.getState().documents.size).toBe(0);
      expect((await host.readSnapshot(handle)).documents).toHaveLength(0);
      expect(await session.flush()).toBe(true);
      expect((await host.readSnapshot(handle)).documents).toHaveLength(0);
    });
    it('retains a full unknown transaction, blocks edits, and retries the same id without duplicate history', async () => {
      const { host, session, command } = await setup();
      const originalContent = command.resources[0].content.slice();
      const callerContent = Buffer.from(originalContent);
      command.resources[0].content = callerContent;
      const original = host.commit.bind(host);
      const calls: CommitRequest[] = [];
      vi.spyOn(host, 'commit').mockImplementation(async (handle, request) => {
        calls.push(request);
        const receipt = await original(handle, request);
        if (calls.length === 1) {
          callerContent.fill(0);
          throw new Error('Lost applied receipt');
        }
        return receipt;
      });
      expect((await session.apply(command)).ok).toBe(false);
      expect(session.getState().documents.size).toBe(0);
      expect(session.getState().mutationsPaused).toBe(true);
      expect(
        Array.from(calls[0].resourceWrites![0].content as Uint8Array),
      ).toEqual(Array.from(originalContent));
      expect(
        (
          await session.apply({
            type: 'import-files',
            files: [createDocumentFile('blocked')],
          })
        ).ok,
      ).toBe(false);
      expect(await session.flush()).toBe(true);
      expect(calls[0]).toBe(calls[1]);
      expect(session.getState().documents.size).toBe(1);
      await session.undo();
      expect(session.getState().canUndo).toBe(false);
    });
    it('rejects a corrupt existing asset', async () => {
      const { host, handle, session, command, assetId } = await setup();
      await host.commit(handle, {
        transactionId: 'existing',
        resourceWrites: [
          {
            path: workspaceAssetPath(assetId).replace('.verd-resources/', ''),
            content: 'corrupt',
            expectedVersion: null,
          },
        ],
      });
      await session.syncFromHost();
      expect((await session.apply(command)).ok).toBe(false);
      expect(session.getState().documents.size).toBe(0);
    });
    it('conditionally reuses shared assets while remapping colliding file identities', async () => {
      const { host, session, command, assetId } = await setup();
      expect((await session.apply(command)).ok).toBe(true);
      const raw = await session.readRawFile(workspaceAssetPath(assetId));
      const commit = vi.spyOn(host, 'commit');
      expect((await session.apply(command)).ok).toBe(true);
      expect(session.getState().documents.size).toBe(2);
      expect(
        commit.mock.calls[0][1].resourceWrites?.find(
          (write) => write.path === raw.path.replace('.verd-resources/', ''),
        )?.expectedVersion,
      ).toBe(raw.version);
      for (const entry of session.getState().documents.values())
        expect(JSON.stringify(entry.file)).toContain('verd-asset:' + raw.path);
    });
    it('rejects the entire import if a shared asset changes after its preflight read', async () => {
      const { host, handle, session, command, assetId, content } =
        await setup();
      const path = workspaceAssetPath(assetId);
      await host.commit(handle, {
        transactionId: 'seed-asset',
        resourceWrites: [
          {
            path: path.replace('.verd-resources/', ''),
            content,
            expectedVersion: null,
          },
        ],
      });
      await session.syncFromHost();
      const raw = await session.readRawFile(path);
      const original = host.commit.bind(host);
      vi.spyOn(host, 'commit').mockImplementationOnce(
        async (target, request) => {
          await original(target, {
            transactionId: 'racing-asset',
            resourceWrites: [
              {
                path: path.replace('.verd-resources/', ''),
                content: 'external change',
                expectedVersion: raw.version,
              },
            ],
          });
          return original(target, request);
        },
      );
      expect((await session.apply(command)).ok).toBe(false);
      expect(session.getState().documents.size).toBe(0);
      expect((await host.readSnapshot(handle)).documents).toHaveLength(0);
    });
  });
