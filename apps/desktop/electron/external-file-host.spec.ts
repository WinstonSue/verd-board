import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createExternalFileHost } from './external-file-host';
import {
  openWorkspaceSession,
  type FrameFileV2,
} from '@sue/verd-board-app/headless';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
const frame = (id: string): FrameFileV2 => ({
  format: 'verd-frame',
  version: 2,
  frame: {
    id,
    kind: 'frame',
    cellType: 'frame',
    name: id,
    geometry: { x: 0, y: 0, width: 960, height: 640 },
    children: [],
    groups: [],
  },
  cells: {},
});
async function fixture(name: string, content: string | Uint8Array) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-external-'));
  directories.push(directory);
  const source = path.join(directory, name);
  await fs.writeFile(source, content);
  const external = await createExternalFileHost(
    source,
    path.join(directory, 'private'),
  );
  return Object.assign(external, { directory });
}

describe('external file persistence', () => {
  it('opening and flushing Markdown keeps the original bytes and source folder clean', async () => {
    const original = '\ufeff# 中文标题\r\n\r\n原始 **格式**';
    const external = await fixture('有 空格.markdown', original);
    const session = await openWorkspaceSession(
      external.host,
      external.binding.handle,
    );
    try {
      expect(session.getState().documents.size).toBe(1);
      expect(await session.flush()).toBe(true);
      expect(await fs.readFile(external.source, 'utf8')).toBe(original);
      expect(await fs.readdir(external.directory)).toEqual([
        '有 空格.markdown',
      ]);
    } finally {
      session.dispose();
    }
  });

  it('writes edited Markdown through WorkspaceSession and supports undo', async () => {
    const external = await fixture('note.md', '# Before\n');
    const session = await openWorkspaceSession(
      external.host,
      external.binding.handle,
      { delayMs: 60_000 },
    );
    try {
      const file = session
        .getState()
        .documents.get(external.binding.rootFileId)!.file;
      const text = structuredClone(file.text);
      text.content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
        ],
      };
      text.plainText = 'After';
      expect(
        (await session.apply({ type: 'file', file: { ...file, text } })).ok,
      ).toBe(true);
      expect(await session.flush()).toBe(true);
      expect(await fs.readFile(external.source, 'utf8')).toBe('After\n');
      expect((await session.undo()).ok).toBe(true);
      expect(await session.flush()).toBe(true);
      expect(await fs.readFile(external.source, 'utf8')).toBe('# Before\n');
    } finally {
      session.dispose();
    }
  });

  it.each(['board.verd', 'old.verd.json'])(
    'saves a bare canvas at its original path: %s',
    async (name) => {
      const external = await fixture(name, JSON.stringify(frame('root')));
      const session = await openWorkspaceSession(
        external.host,
        external.binding.handle,
      );
      try {
        const file = session.getState().files.get('root')!.file;
        expect(
          (
            await session.apply({
              type: 'file',
              file: { ...file, frame: { ...file.frame, name: 'Edited' } },
            })
          ).ok,
        ).toBe(true);
        expect(await session.flush()).toBe(true);
        const value = JSON.parse(await fs.readFile(external.source, 'utf8'));
        expect(value.format).toBe('verd-frame');
        expect(value.frame.name).toBe('Edited');
      } finally {
        session.dispose();
      }
    },
  );

  it('renames an open file in place, retains receipts and rejects an old path reused with identical bytes', async () => {
    const text = '# Before\n';
    const external = await fixture('before.md', text);
    const oldPath = external.source;
    const root = path.join(external.directory, 'private');
    const stale = await createExternalFileHost(
      oldPath,
      path.join(external.directory, 'other-host'),
    );
    const before = (await stale.host.readSnapshot(stale.binding.handle))
      .documents![0];
    const receiptId = 'save-config-before-rename';
    const handle = external.binding.handle;
    await external.host.commit(handle, {
      transactionId: receiptId,
      config: { expectedVersion: 0, value: { persisted: true } },
    });
    await expect(external.rename('After')).resolves.toBe('After.md');
    expect(external.binding.handle).toBe(handle);
    expect(external.binding.displayName).toBe('After.md');
    expect(await fs.readFile(external.source, 'utf8')).toBe(text);
    await fs.writeFile(oldPath, text);
    expect(
      await stale.host.commit(stale.binding.handle, {
        transactionId: 'stale-save',
        writes: [
          {
            path: before.path,
            expectedVersion: before.version,
            content: new TextEncoder().encode(JSON.stringify(before.file)),
          },
        ],
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'version-conflict' });
    const reopened = await createExternalFileHost(external.source, root);
    expect(reopened.binding.rootFileId).toBe(external.binding.rootFileId);
    expect(
      (await reopened.host.readSnapshot(reopened.binding.handle)).config.value,
    ).toEqual({ persisted: true });
    expect(
      await reopened.host.commit(reopened.binding.handle, {
        transactionId: receiptId,
      }),
    ).toMatchObject({ outcome: 'applied' });
    expect(await fs.readFile(oldPath, 'utf8')).toBe(text);
    const live = (await external.host.readSnapshot(handle)).documents![0];
    expect(
      await external.host.commit(handle, {
        transactionId: 'save-after-rename',
        writes: [
          {
            path: live.path,
            expectedVersion: live.version,
            content: new TextEncoder().encode(
              JSON.stringify(live.file).replaceAll('Before', 'Edited'),
            ),
          },
        ],
      }),
    ).toMatchObject({ outcome: 'applied' });
    expect(await fs.readFile(external.source, 'utf8')).toBe('# Edited\n');
  });

  it('preserves the legacy suffix and refuses a collision during rename', async () => {
    const bytes = JSON.stringify(frame('unchanged'));
    const external = await fixture('example.verd.json', bytes);
    await fs.writeFile(
      path.join(external.directory, 'occupied.verd.json'),
      'other contents',
    );
    await expect(external.rename('occupied')).rejects.toThrow('同名文件已存在');
    await expect(external.rename('EXAMPLE')).resolves.toBe('EXAMPLE.verd.json');
    expect(await fs.readFile(external.source, 'utf8')).toBe(bytes);
    expect(
      await fs.readFile(
        path.join(external.directory, 'occupied.verd.json'),
        'utf8',
      ),
    ).toBe('other contents');
    expect(await fs.readdir(external.directory)).toContain('EXAMPLE.verd.json');
  });

  it('retains relative image and link addresses after a visual edit and reports conversion warnings', async () => {
    const original =
      '---\ntitle: Note\n---\n\n[邻页](../other.markdown)\n\n![pic](images/pic.png)\n';
    const external = await fixture('note.md', original);
    expect(external.warnings()).toContain(
      '文件开头的 Markdown 分隔块会作为正文解析，保存时可能改变写法',
    );
    expect(await fs.readFile(external.source, 'utf8')).toBe(original);
    const session = await openWorkspaceSession(
      external.host,
      external.binding.handle,
      { delayMs: 60_000 },
    );
    try {
      const file = session
        .getState()
        .documents.get(external.binding.rootFileId)!.file;
      const text = structuredClone(file.text);
      text.content.content!.push({
        type: 'paragraph',
        content: [{ type: 'text', text: 'After' }],
      });
      text.plainText += '\nAfter';
      expect(
        (await session.apply({ type: 'file', file: { ...file, text } })).ok,
      ).toBe(true);
      expect(await session.flush()).toBe(true);
      const saved = await fs.readFile(external.source, 'utf8');
      expect(saved).toContain('(../other.markdown)');
      expect(saved).toContain('(images/pic.png)');
      expect(saved).toContain('After');
    } finally {
      session.dispose();
    }
  });

  it('does not conflict with itself when saving different bundle members and retains unreferenced assets', async () => {
    const content = Buffer.from('unreferenced');
    const assetId = createHash('sha256').update(content).digest('hex') + '.png';
    const external = await fixture(
      'bundle.verd',
      JSON.stringify({
        format: 'verd-canvas-bundle',
        version: 2,
        rootFileId: 'a',
        files: [frame('a'), frame('b')],
        resources: [
          {
            assetId,
            encoding: 'base64',
            byteLength: content.length,
            data: content.toString('base64'),
          },
        ],
      }),
    );
    const snapshot = await external.host.readSnapshot(external.binding.handle);
    for (const item of snapshot.canvases) {
      const file = item.file!;
      const receipt = await external.host.commit(external.binding.handle, {
        transactionId: file.frame.id,
        writes: [
          {
            path: item.path,
            expectedVersion: item.version,
            content: JSON.stringify({
              ...file,
              frame: { ...file.frame, name: 'Edited ' + file.frame.id },
            }),
          },
        ],
      });
      expect(receipt.outcome).toBe('applied');
    }
    const saved = JSON.parse(await fs.readFile(external.source, 'utf8'));
    expect(saved.files.map((file: FrameFileV2) => file.frame.name)).toEqual([
      'Edited a',
      'Edited b',
    ]);
    expect(saved.resources).toHaveLength(1);
    expect(saved.resources[0].data).toBe(content.toString('base64'));
    const reopened = await createExternalFileHost(
      external.source,
      path.join(external.directory, 'private'),
    );
    const versions = (
      snapshot: Awaited<ReturnType<typeof external.host.readSnapshot>>,
    ) => snapshot.canvases.map(({ path, version }) => ({ path, version }));
    expect(
      versions(await reopened.host.readSnapshot(reopened.binding.handle)),
    ).toEqual(
      versions(await external.host.readSnapshot(external.binding.handle)),
    );
    expect(
      Buffer.from(
        (
          await reopened.host.readResource(
            reopened.binding.handle,
            `assets/${assetId}`,
          )
        ).content,
      ),
    ).toEqual(content);
    expect(await fs.readdir(external.directory)).not.toContain('.verdscrolls');
  });

  it('keeps a read-only file and its pending edits intact, then saves after permissions are restored', async () => {
    const original = '# Original\n';
    const external = await fixture('read-only.md', original);
    const session = await openWorkspaceSession(
      external.host,
      external.binding.handle,
      { delayMs: 60_000 },
    );
    try {
      await fs.chmod(external.source, 0o444);
      const file = session
        .getState()
        .documents.get(external.binding.rootFileId)!.file;
      const text = structuredClone(file.text);
      text.content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Pending edit' }],
          },
        ],
      };
      text.plainText = 'Pending edit';
      expect(
        (await session.apply({ type: 'file', file: { ...file, text } })).ok,
      ).toBe(true);
      expect(await session.flush()).toBe(false);
      expect(await fs.readFile(external.source, 'utf8')).toBe(original);
      expect(
        session.getState().documents.get(external.binding.rootFileId)!.file.text
          .plainText,
      ).toBe('Pending edit');
      await fs.chmod(external.source, 0o644);
      expect(await session.flush()).toBe(true);
      expect(await fs.readFile(external.source, 'utf8')).toBe('Pending edit\n');
    } finally {
      await fs.chmod(external.source, 0o644);
      session.dispose();
    }
  });

  it('rejects an external edit without overwriting the disk or losing local content', async () => {
    const external = await fixture('board.verd', JSON.stringify(frame('root')));
    const session = await openWorkspaceSession(
      external.host,
      external.binding.handle,
      { delayMs: 60_000 },
    );
    try {
      const file = session.getState().files.get('root')!.file;
      await session.apply({
        type: 'file',
        file: { ...file, frame: { ...file.frame, name: 'Local' } },
      });
      await fs.writeFile(
        external.source,
        JSON.stringify({ ...file, frame: { ...file.frame, name: 'External' } }),
      );
      expect(await session.flush()).toBe(false);
      expect(session.getState().files.get('root')!.file.frame.name).toBe(
        'Local',
      );
      expect(
        JSON.parse(await fs.readFile(external.source, 'utf8')).frame.name,
      ).toBe('External');
    } finally {
      session.dispose();
    }
  });

  it('explicitly keeps the complete local bundle after an external change', async () => {
    const external = await fixture(
      'bundle.verd',
      JSON.stringify({
        format: 'verd-canvas-bundle',
        version: 1,
        rootFileId: 'a',
        files: [frame('a'), frame('b')],
      }),
    );
    const before = await external.host.readSnapshot(external.binding.handle);
    const local = before.canvases.map((item) => ({
      path: item.path,
      file: {
        ...item.file!,
        frame: { ...item.file!.frame, name: 'Local ' + item.file!.frame.id },
      },
    }));
    await fs.writeFile(
      external.source,
      JSON.stringify({
        format: 'verd-canvas-bundle',
        version: 1,
        rootFileId: 'a',
        files: [frame('a'), frame('b'), frame('external')],
      }),
    );
    expect((await external.overwrite(local)).outcome).toBe('applied');
    const saved = JSON.parse(await fs.readFile(external.source, 'utf8'));
    expect(saved.files.map((file: FrameFileV2) => file.frame.name)).toEqual([
      'Local a',
      'Local b',
    ]);
  });

  it('rejects non-native writes and attempts to move or trash the source', async () => {
    const external = await fixture('board.verd', JSON.stringify(frame('root')));
    expect(
      (
        await external.host.commit(external.binding.handle, {
          transactionId: 'constructor',
          writes: [
            { path: 'other.txt', content: 'bad', expectedVersion: null },
          ],
        })
      ).outcome,
    ).toBe('rejected');
    expect(
      (
        await external.host.commit(external.binding.handle, {
          transactionId: 'trash',
          trash: [{ path: 'board.verd' }],
        })
      ).outcome,
    ).toBe('rejected');
    await expect(
      Promise.resolve().then(() =>
        external.host.readSnapshot({ key: 'another-window', name: '' }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a bundle whose root is missing', async () => {
    await expect(
      fixture(
        'invalid.verd',
        JSON.stringify({
          format: 'verd-canvas-bundle',
          version: 1,
          rootFileId: 'missing',
          files: [frame('a')],
        }),
      ),
    ).rejects.toThrow('根画布');
  });

  it('resolves local images relative to a file containing spaces', async () => {
    const external = await fixture('中文 note.md', '![pic](images/pic.png)');
    await fs.mkdir(path.join(external.directory, 'images'));
    await fs.writeFile(
      path.join(external.directory, 'images/pic.png'),
      'image',
    );
    expect(
      Buffer.from(await external.readImage('images/pic.png')).toString(),
    ).toBe('image');
    await expect(external.readImage('note.md')).rejects.toThrow();
  });
});
