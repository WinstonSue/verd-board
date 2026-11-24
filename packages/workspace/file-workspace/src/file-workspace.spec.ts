import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileWorkspaceConflict, openFileWorkspace } from './file-workspace.js';
import { withWorkspaceLock } from './file-lock.js';

describe('plain file workspace', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'verd-file-workspace-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('can read an existing wiki without creating or repairing any files', async () => {
    const file = path.join(root, 'Home.md');
    const contents = '---\r\nid: home\r\n---\r\nHello\r\n';
    await writeFile(file, contents);

    const workspace = await openFileWorkspace(root);
    expect((await workspace.list()).map((entry) => entry.name)).toEqual([
      'Home.md',
    ]);
    expect((await workspace.stat('Home.md')).size).toBe(
      Buffer.byteLength(contents),
    );
    expect((await workspace.read('Home.md')).bytes.toString()).toBe(contents);
    expect(await readdir(root)).toEqual(['Home.md']);
  });

  it('serializes writes with the same lock as the native workspace', async () => {
    const workspace = await openFileWorkspace(root);
    const order: string[] = [];
    let hold!: () => void;
    let ready!: () => void;
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const release = new Promise<void>((resolve) => {
      hold = resolve;
    });
    const native = withWorkspaceLock(root, async () => {
      order.push('native open');
      ready();
      await release;
      order.push('native close');
    });
    await held;
    const wiki = workspace.transact(async (transaction) => {
      order.push('wiki write');
      await transaction.write('Home.md', 'wiki', null);
    });
    hold();
    await Promise.all([native, wiki]);
    expect(order).toEqual(['native open', 'native close', 'wiki write']);
  });

  it('refuses a stale write and retains bytes when admission is revoked', async () => {
    const file = path.join(root, 'Home.md');
    const workspace = await openFileWorkspace(root);
    await writeFile(file, 'initial');
    const initial = await workspace.read('Home.md');
    await writeFile(file, 'external');
    await expect(
      workspace.transact((transaction) =>
        transaction.write('Home.md', 'stale', initial.version),
      ),
    ).rejects.toBeInstanceOf(FileWorkspaceConflict);

    const external = await workspace.read('Home.md');
    await expect(
      workspace.transact(
        (transaction) =>
          transaction.write('Home.md', 'revoked', external.version),
        {
          beforePublish: () => {
            throw new Error('revoked');
          },
        },
      ),
    ).rejects.toThrow('revoked');

    const reopened = await openFileWorkspace(root);
    expect((await reopened.read('Home.md')).bytes.toString()).toBe('external');
    const receipts = path.join(root, '.verdscrolls/file-recovery');
    const [receipt] = await readdir(receipts);
    expect(
      await readFile(path.join(receipts, receipt, 'previous'), 'utf8'),
    ).toBe('external');
    expect(
      await readFile(path.join(receipts, receipt, 'incoming'), 'utf8'),
    ).toBe('revoked');
  });

  it('retains prior bytes from an interrupted batch without replaying unpublished writes', async () => {
    const workspace = await openFileWorkspace(root);
    await writeFile(path.join(root, 'One.md'), 'original one');
    await writeFile(path.join(root, 'Two.md'), 'original two');
    const one = await workspace.read('One.md');
    const two = await workspace.read('Two.md');

    await expect(
      workspace.transact(
        async (transaction) => {
          await transaction.write('One.md', 'authorized', one.version);
          await transaction.write('Two.md', 'revoked', two.version);
        },
        {
          beforePublish: ([file]) => {
            if (path.basename(file) === 'Two.md') throw new Error('revoked');
          },
        },
      ),
    ).rejects.toThrow('revoked');

    const receipts = path.join(root, '.verdscrolls', 'file-recovery');
    const results = await Promise.all(
      (await readdir(receipts)).map(async (entry) => {
        const directory = path.join(receipts, entry);
        const record = JSON.parse(
          await readFile(path.join(directory, 'operation.json'), 'utf8'),
        );
        return {
          record,
          old: await readFile(path.join(directory, 'previous'), 'utf8'),
        };
      }),
    );
    expect(
      new Set(results.map(({ record }) => record.transactionId)).size,
    ).toBe(1);
    expect(results.map(({ old }) => old).sort()).toEqual([
      'original one',
      'original two',
    ]);

    const reopened = await openFileWorkspace(root);
    expect((await reopened.read('One.md')).bytes.toString()).toBe('authorized');
    expect((await reopened.read('Two.md')).bytes.toString()).toBe(
      'original two',
    );
  });

  it('checks the digest of descendants for a rename and supports case-only changes', async () => {
    const workspace = await openFileWorkspace(root);
    await workspace.transact(async (transaction) => {
      await transaction.mkdir('Section');
      await transaction.write('Section/Home.md', 'one', null);
    });
    const version = await workspace.version('Section');
    await writeFile(path.join(root, 'Section/Home.md'), 'two');
    await expect(
      workspace.transact((transaction) =>
        transaction.move('Section', 'Renamed', version),
      ),
    ).rejects.toBeInstanceOf(FileWorkspaceConflict);
    const current = await workspace.version('Section');
    await workspace.transact((transaction) =>
      transaction.move('Section', 'section', current),
    );
    expect((await workspace.list()).map((entry) => entry.name)).toContain(
      'section',
    );
    expect((await workspace.read('section/Home.md')).bytes.toString()).toBe(
      'two',
    );
  });

  it('allows authorized trash paths and refuses symlink traversal', async () => {
    const workspace = await openFileWorkspace(root);
    await workspace.transact(async (transaction) => {
      await transaction.mkdir('.trash');
      await transaction.write('.trash/Home.md', 'restore me', null);
    });
    expect((await workspace.read('.trash/Home.md')).bytes.toString()).toBe(
      'restore me',
    );
    await symlink(os.tmpdir(), path.join(root, 'outside'), 'junction');
    await expect(workspace.read('outside/anything')).rejects.toThrow(
      'refuses links',
    );
    await expect(workspace.read('../anything')).rejects.toThrow(
      'Invalid file workspace path',
    );
  });
});
