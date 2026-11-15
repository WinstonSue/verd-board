import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
  createDocumentFile,
  type WorkspaceGitRequest,
} from '@sue/verd-board-workspace';
import { createNodeWorkspaceGit, recoverGitPurge } from './workspace-git';
import { publishGitRestore, recoverGitRestore } from './workspace-git-restore';

const command = promisify(execFile),
  roots: string[] = [];
vi.setConfig({ testTimeout: 20_000 });
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-git-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.verdscrolls'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.verdscrolls/.gitignore'),
    '*\n!.gitignore\n!config.json\n!resources/\nresources/*\n!resources/assets/\n!resources/assets/**\n',
  );
  await fs.writeFile(
    path.join(root, '.verdscrolls/config.json'),
    JSON.stringify({ version: 1, value: { identity: 'test', name: 'Test' } }),
  );
  const git = createNodeWorkspaceGit(root);
  const run = async (...args: string[]) =>
    (await command('git', ['-C', root, ...args])).stdout.trim();
  const write = async (relative: string, value: string) => {
    await fs.mkdir(path.dirname(path.join(root, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, relative), value);
  };
  const invoke = (request: WorkspaceGitRequest) => git(request);
  const save = async (message: string, paths?: string[]) =>
    invoke({
      type: 'commit',
      message,
      paths,
      expectedToken: (await invoke({ type: 'status' })).status.token,
    });
  await invoke({
    type: 'init',
    author: { name: 'Test Author', email: 'test@example.com' },
  });
  return { root, git: invoke, run, write, save };
}

describe('Directory versions', () => {
  it('keeps creation previews read-only, follows a rename and preserves unrelated staging during restore', async () => {
    const { root, git, run, write } = await fixture();
    await write('old/note.txt', 'First');
    await fs.mkdir(path.join(root, 'old/empty'));
    const create = async (directoryPath: string, message: string) => {
      const result = await git({ type: 'create-plan', directoryPath, message });
      return git({
        type: 'create',
        planId: result.plan!.id,
        expectedToken: result.plan!.token,
      });
    };
    const plan = await git({
      type: 'create-plan',
      directoryPath: 'old',
      message: 'Directory first',
    });
    await expect(
      fs.readFile(path.join(root, 'old/.verd-folder.json')),
    ).rejects.toThrow();
    const first = await git({
      type: 'create',
      planId: plan.plan!.id,
      expectedToken: plan.plan!.token,
    });
    expect(
      await fs.readFile(path.join(root, 'old/empty/.verd-folder.json'), 'utf8'),
    ).toContain('version');
    await fs.rename(path.join(root, 'old'), path.join(root, 'new'));
    await write('new/note.txt', 'Second');
    await write('other.txt', 'External staging');
    await run('add', '--', 'other.txt');
    const second = await create('new', 'Moved directory');
    expect(await run('diff', '--cached', '--name-only')).toBe('other.txt');
    const history = await git({ type: 'log', directoryPath: 'new' });
    expect(history.commits?.map((v) => v.oid)).toEqual([second.oid, first.oid]);
    expect(history.commits?.[1].path).toBe('old');
    const restore = await git({
      type: 'restore-plan',
      directoryPath: 'new',
      oid: first.oid!,
    });
    expect(restore.plan?.paths.every((p) => p.path.startsWith('new/'))).toBe(
      true,
    );
    await git({
      type: 'restore',
      planId: restore.plan!.id,
      expectedToken: restore.plan!.token,
    });
    expect(await fs.readFile(path.join(root, 'new/note.txt'), 'utf8')).toBe(
      'First',
    );
    expect(await run('rev-parse', 'HEAD')).toBe(second.oid);
    expect(await run('diff', '--cached', '--name-only')).toBe('other.txt');
  });
  it('rejects restoring a child whose identity exists outside the directory', async () => {
    const { root, git, write, save } = await fixture();
    await write(
      'folder/doc.verd-doc.json',
      JSON.stringify(createDocumentFile('child', 'Child')),
    );
    const result = await git({
      type: 'create-plan',
      directoryPath: 'folder',
      message: 'First',
    });
    const first = await git({
      type: 'create',
      planId: result.plan!.id,
      expectedToken: result.plan!.token,
    });
    await fs.rename(
      path.join(root, 'folder/doc.verd-doc.json'),
      path.join(root, 'outside.verd-doc.json'),
    );
    await save('Move out');
    await expect(
      git({ type: 'restore-plan', directoryPath: 'folder', oid: first.oid! }),
    ).rejects.toThrow('outside this directory');
  });
});

describe('Node root Git workspace', () => {
  it('does not initialize during status and creates an independent root repository', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-git-'));
    roots.push(root);
    const git = createNodeWorkspaceGit(root);
    expect((await git({ type: 'status' })).status).toMatchObject({
      available: true,
      initialized: false,
    });
    expect(await fs.stat(path.join(root, '.git')).catch(() => null)).toBeNull();
    expect((await git({ type: 'init' })).status.initialized).toBe(true);
  });
  it('commits selected worktree bytes and preserves unrelated staged content', async () => {
    const f = await fixture();
    await f.write('a.txt', 'a1');
    await f.write('b.txt', 'b1');
    await f.save('Initial');
    await f.write('a.txt', 'a2');
    await f.write('b.txt', 'staged');
    await f.run('add', 'b.txt');
    await f.write('b.txt', 'worktree');
    await f.save('Only A', ['a.txt']);
    expect(await f.run('show', 'HEAD:a.txt')).toBe('a2');
    expect(await f.run('show', 'HEAD:b.txt')).toBe('b1');
    expect(await f.run('show', ':b.txt')).toBe('staged');
    expect(await fs.readFile(path.join(f.root, 'b.txt'), 'utf8')).toBe(
      'worktree',
    );
    expect(
      (await f.git({ type: 'status' })).status.changes.map(
        (change) => change.path,
      ),
    ).toContain('b.txt');
  });
  it('rejects stale content tokens and does not commit runtime or ignored files', async () => {
    const f = await fixture();
    await f.write('a.txt', 'one');
    await f.save('Initial');
    const token = (await f.git({ type: 'status' })).status.token;
    await f.write('a.txt', 'two');
    await expect(
      f.git({ type: 'commit', message: 'Stale', expectedToken: token }),
    ).rejects.toThrow('Git state changed');
    await f.write('.verdscrolls/session.json', '{}');
    await f.save('Current');
    expect(await f.run('ls-tree', '-r', '--name-only', 'HEAD')).not.toContain(
      'session.json',
    );
  });
  it('lists a stable native identity across renames and reads old bytes', async () => {
    const f = await fixture();
    const doc = createDocumentFile('doc-id', 'Document');
    await f.write('before.verd-doc.json', JSON.stringify(doc));
    const first = (await f.save('Created')).oid!;
    await fs.rename(
      path.join(f.root, 'before.verd-doc.json'),
      path.join(f.root, 'after.verd-doc.json'),
    );
    await f.save('Renamed', ['after.verd-doc.json']);
    const log = await f.git({ type: 'log', fileId: 'doc-id' });
    expect(log.commits?.map((commit) => commit.message)).toEqual([
      'Renamed',
      'Created',
    ]);
    const old = await f.git({
      type: 'read',
      oid: first,
      paths: ['before.verd-doc.json'],
    });
    expect(
      JSON.parse(new TextDecoder().decode(old.files![0]!.content)).id,
    ).toBe('doc-id');
  });
  it('restores an entire tracked tree without changing HEAD or index and rejects dirty workspaces', async () => {
    const f = await fixture();
    await f.write('plain.txt', 'before');
    await f.write('.agents/skills/custom/SKILL.md', 'before');
    const first = (await f.save('Initial')).oid!;
    await f.write('plain.txt', 'after');
    await f.write('added.txt', 'later');
    await f.write('.agents/skills/custom/SKILL.md', 'after');
    await f.save('Changed');
    const head = await f.run('rev-parse', 'HEAD'),
      index = await fs.readFile(path.join(f.root, '.git/index'));
    const result = await f.git({ type: 'restore-plan', oid: first });
    await f.git({
      type: 'restore',
      planId: result.plan!.id,
      expectedToken: result.status.token,
    });
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    expect(await fs.readFile(path.join(f.root, '.git/index'))).toEqual(index);
    expect(await fs.readFile(path.join(f.root, 'plain.txt'), 'utf8')).toBe(
      'before',
    );
    expect(
      await fs.stat(path.join(f.root, 'added.txt')).catch(() => null),
    ).toBeNull();
    expect(
      await fs.readFile(
        path.join(f.root, '.agents/skills/custom/SKILL.md'),
        'utf8',
      ),
    ).toBe('before');
    await expect(f.git({ type: 'restore-plan', oid: first })).rejects.toThrow(
      'affected changes',
    );
  });
  it('restores one file while preserving unrelated staged and working changes', async () => {
    const f = await fixture();
    await f.write('a', 'old');
    await f.write('b', 'old');
    const first = (await f.save('Initial')).oid!;
    await f.write('a', 'new');
    await f.save('A changed');
    await f.write('b', 'staged');
    await f.run('add', 'b');
    await f.write('b', 'unstaged');
    const result = await f.git({ type: 'restore-plan', oid: first, path: 'a' });
    await f.git({
      type: 'restore',
      planId: result.plan!.id,
      expectedToken: result.status.token,
    });
    expect(await fs.readFile(path.join(f.root, 'a'), 'utf8')).toBe('old');
    expect(await f.run('show', ':b')).toBe('staged');
    expect(await fs.readFile(path.join(f.root, 'b'), 'utf8')).toBe('unstaged');
  });
  it('supports tracked file-directory transitions and preserves ignored collisions', async () => {
    const f = await fixture();
    await f.write('entry/child', 'child');
    const first = (await f.save('Directory')).oid!;
    await fs.rm(path.join(f.root, 'entry'), { recursive: true });
    await f.write('entry', 'file');
    const second = (await f.save('File')).oid!;
    const plan = await f.git({ type: 'restore-plan', oid: first });
    await f.git({
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(await fs.readFile(path.join(f.root, 'entry/child'), 'utf8')).toBe(
      'child',
    );
    await f.save('Restored');
    const reverse = await f.git({ type: 'restore-plan', oid: second });
    await f.git({
      type: 'restore',
      planId: reverse.plan!.id,
      expectedToken: reverse.status.token,
    });
    expect(await fs.readFile(path.join(f.root, 'entry'), 'utf8')).toBe('file');
  });
  it('runs native hooks and uses the default commit message', async () => {
    const f = await fixture();
    await f.write('a', 'old');
    await f.save('');
    expect(await f.run('log', '-1', '--format=%s')).toBe('更新工作区');
    const head = await f.run('rev-parse', 'HEAD');
    await f.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 1\n');
    await fs.chmod(path.join(f.root, '.git/hooks/pre-commit'), 0o755);
    await f.write('a', 'new');
    await expect(f.save('Rejected')).rejects.toThrow('review HEAD and index');
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
  });
  it('keeps the current filename when restoring a native document body', async () => {
    const f = await fixture();
    const original = createDocumentFile('rename-doc', 'Before');
    await f.write('old.verd-doc.json', JSON.stringify(original));
    const first = (await f.save('Created')).oid!;
    await fs.rename(
      path.join(f.root, 'old.verd-doc.json'),
      path.join(f.root, 'current.verd-doc.json'),
    );
    await f.write(
      'current.verd-doc.json',
      JSON.stringify({ ...original, title: 'After' }),
    );
    await f.save('Changed');
    const plan = await f.git({
      type: 'restore-plan',
      oid: first,
      fileId: 'rename-doc',
    });
    expect(plan.plan!.paths).toEqual([
      { path: 'current.verd-doc.json', action: 'write' },
    ]);
    await f.git({
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'current.verd-doc.json'), 'utf8'),
      ).title,
    ).toBe('Before');
    expect(
      await fs.stat(path.join(f.root, 'old.verd-doc.json')).catch(() => null),
    ).toBeNull();
  });
  it('keeps existing dependency bodies and recreates only missing historical dependencies', async () => {
    const f = await fixture(),
      source = createDocumentFile('source', 'Source'),
      dependency = createDocumentFile('target', 'Before');
    source.text.content = {
      type: 'doc',
      content: [
        { type: 'documentExcerpt', attrs: { targetDocumentId: 'target' } },
      ],
    };
    await f.write('source.verd-doc.json', JSON.stringify(source));
    await f.write('target.verd-doc.json', JSON.stringify(dependency));
    const first = (await f.save('Initial')).oid!;
    const changed = createDocumentFile('source', 'Changed');
    await f.write('source.verd-doc.json', JSON.stringify(changed));
    await f.write(
      'target.verd-doc.json',
      JSON.stringify({ ...dependency, title: 'Current' }),
    );
    await f.save('Changed');
    const existing = await f.git({
      type: 'restore-plan',
      oid: first,
      fileId: 'source',
    });
    expect(existing.plan!.paths.map((item) => item.path)).toEqual([
      'source.verd-doc.json',
    ]);
    await f.git({
      type: 'restore',
      planId: existing.plan!.id,
      expectedToken: existing.status.token,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'target.verd-doc.json'), 'utf8'),
      ).title,
    ).toBe('Current');
    await f.save('Restored source');
    await fs.unlink(path.join(f.root, 'target.verd-doc.json'));
    await f.save('Delete referenced target');
    const missing = await f.git({
      type: 'restore-plan',
      oid: first,
      fileId: 'source',
    });
    expect(missing.plan!.paths.map((item) => item.path)).toEqual([
      'target.verd-doc.json',
    ]);
    await f.git({
      type: 'restore',
      planId: missing.plan!.id,
      expectedToken: missing.status.token,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'target.verd-doc.json'), 'utf8'),
      ).title,
    ).toBe('Before');
  });
  it('preserves an ignored existing dependency when restoring a versioned source', async () => {
    const f = await fixture(),
      source = createDocumentFile('source', 'Source'),
      dependency = createDocumentFile('target', 'Before');
    source.text.content = {
      type: 'doc',
      content: [
        { type: 'documentExcerpt', attrs: { targetDocumentId: 'target' } },
      ],
    };
    await f.write('source.verd-doc.json', JSON.stringify(source));
    await f.write('target.verd-doc.json', JSON.stringify(dependency));
    const first = (await f.save('Initial')).oid!;
    await f.write(
      'source.verd-doc.json',
      JSON.stringify(createDocumentFile('source', 'Changed')),
    );
    await f.write(
      'target.verd-doc.json',
      JSON.stringify({ ...dependency, title: 'Private current body' }),
    );
    await f.save('Changed');
    await f.run('rm', '--cached', 'target.verd-doc.json');
    await f.write('.gitignore', 'target.verd-doc.json\n');
    await f.run('add', '.gitignore');
    await f.run('commit', '-m', 'Keep target private');
    const plan = await f.git({
      type: 'restore-plan',
      oid: first,
      fileId: 'source',
    });
    expect(plan.plan!.paths.map((item) => item.path)).toEqual([
      'source.verd-doc.json',
    ]);
    await f.git({
      type: 'restore',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'target.verd-doc.json'), 'utf8'),
      ).title,
    ).toBe('Private current body');
  });
  it('fast-forwards from a real local remote and leaves an accurate clean index', async () => {
    const f = await fixture();
    await f.run('config', 'core.autocrlf', 'true');
    await f.write('a', 'one\r\n');
    await f.save('Initial');
    const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-remote-'));
    roots.push(remote);
    await command('git', ['init', '--bare', '--initial-branch=main', remote]);
    await f.git({ type: 'configure', remoteUrl: remote });
    await f.git({
      type: 'sync',
      expectedToken: (await f.git({ type: 'status' })).status.token,
    });
    const clone = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-clone-'));
    roots.push(clone);
    await command('git', ['clone', remote, clone]);
    await command('git', ['-C', clone, 'config', 'core.autocrlf', 'true']);
    await command('git', ['-C', clone, 'config', 'user.name', 'Other']);
    await command('git', [
      '-C',
      clone,
      'config',
      'user.email',
      'other@example.com',
    ]);
    await fs.writeFile(path.join(clone, 'a'), 'remote\r\n');
    await command('git', ['-C', clone, 'add', 'a']);
    await command('git', ['-C', clone, 'commit', '-m', 'Remote']);
    await command('git', ['-C', clone, 'push']);
    const result = await f.git({
      type: 'sync',
      expectedToken: (await f.git({ type: 'status' })).status.token,
    });
    expect(await fs.readFile(path.join(f.root, 'a'), 'utf8')).toBe('remote\n');
    expect(result.status.changes).toEqual([]);
    expect(await f.run('log', '-1', '--format=%s')).toBe('Remote');
  });
  it('retains a different native identity that reused a historical sensitive path', async () => {
    const f = await fixture();
    await f.write(
      'same.verd-doc.json',
      JSON.stringify(createDocumentFile('secret-a', 'Secret')),
    );
    await f.save('Secret');
    await fs.rename(
      path.join(f.root, 'same.verd-doc.json'),
      path.join(f.root, 'moved.verd-doc.json'),
    );
    await f.write(
      'same.verd-doc.json',
      JSON.stringify(createDocumentFile('survivor-b', 'Keep')),
    );
    await f.save('Reused path');
    const result = await f.git({ type: 'purge-plan', fileIds: ['secret-a'] });
    await f.git({
      type: 'purge',
      planId: result.plan!.id,
      expectedToken: result.status.token,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'same.verd-doc.json'), 'utf8'),
      ).id,
    ).toBe('survivor-b');
    expect(JSON.parse(await f.run('show', 'HEAD:same.verd-doc.json')).id).toBe(
      'survivor-b',
    );
  });
  it('resumes a partially published restore and refuses an external third version', async () => {
    const f = await fixture();
    await f.write('a', 'old');
    await f.write('blocked', 'obstruction');
    await expect(
      publishGitRestore(
        f.root,
        'fault',
        [
          { path: 'a', content: new TextEncoder().encode('new') },
          { path: 'blocked/child', content: new TextEncoder().encode('child') },
        ],
        [],
      ),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(f.root, 'a'), 'utf8')).toBe('new');
    await f.write('a', 'external');
    await fs.unlink(path.join(f.root, 'blocked'));
    await expect(recoverGitRestore(f.root)).rejects.toThrow('changed content');
    expect(await fs.readFile(path.join(f.root, 'a'), 'utf8')).toBe('external');
    await f.write('a', 'new');
    const abandoned = 'a.verd-00000000-0000-0000-0000-000000000001.tmp';
    const oldFsCopy = 'a.12345.00000000-0000-0000-0000-000000000002.tmp';
    await f.write(abandoned, 'old publisher copy');
    await f.write(oldFsCopy, 'old publisher copy');
    await f.write('a.user.tmp', 'user content');
    await recoverGitRestore(f.root);
    expect(await fs.readFile(path.join(f.root, 'blocked/child'), 'utf8')).toBe(
      'child',
    );
    expect(
      await fs
        .stat(path.join(f.root, '.verdscrolls/git-restore/journal.json'))
        .catch(() => null),
    ).toBeNull();
    expect(
      await fs.stat(path.join(f.root, abandoned)).catch(() => null),
    ).toBeNull();
    expect(
      await fs.stat(path.join(f.root, oldFsCopy)).catch(() => null),
    ).toBeNull();
    expect(await fs.readFile(path.join(f.root, 'a.user.tmp'), 'utf8')).toBe(
      'user content',
    );
  });
  it('cleans only matching application publication copies during sensitive history removal', async () => {
    const f = await fixture(),
      secret = JSON.stringify(createDocumentFile('secret-copy', 'Sensitive'));
    await f.write('secret.verd-doc.json', secret);
    await f.write('ordinary.txt', 'sensitive ordinary bytes');
    await f.write('.gitignore', '*.tmp\n!ordinary.txt.*.tmp\n');
    await f.save('Initial');
    const rawCopy =
      'secret.verd-doc.json.verd-00000000-0000-0000-0000-000000000001.tmp';
    const fsCopy =
      'secret.verd-doc.json.12345.00000000-0000-0000-0000-000000000002.tmp';
    const ordinaryCopy =
      'ordinary.txt.12345.00000000-0000-0000-0000-000000000003.tmp';
    const unrelatedCopy =
      'other.verd-doc.json.verd-00000000-0000-0000-0000-000000000004.tmp';
    await f.write(rawCopy, secret);
    await f.write(fsCopy, secret);
    await f.write(ordinaryCopy, 'sensitive ordinary bytes');
    await f.write('user-notes.tmp', secret);
    await f.write('secret.verd-doc.json.verd-not-a-uuid.tmp', secret);
    await f.write(
      unrelatedCopy,
      JSON.stringify(createDocumentFile('keep', 'Keep')),
    );
    const plan = await f.git({
      type: 'purge-plan',
      fileIds: ['secret-copy'],
      paths: ['ordinary.txt'],
    });
    expect(plan.plan!.paths.map((item) => item.path)).toEqual(
      expect.arrayContaining([rawCopy, fsCopy, ordinaryCopy]),
    );
    await f.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    for (const relative of [rawCopy, fsCopy, ordinaryCopy])
      expect(
        await fs.stat(path.join(f.root, relative)).catch(() => null),
      ).toBeNull();
    for (const relative of [
      'user-notes.tmp',
      'secret.verd-doc.json.verd-not-a-uuid.tmp',
      unrelatedCopy,
    ])
      expect(await fs.stat(path.join(f.root, relative))).toBeTruthy();
  });
  it('completes fast-forward recovery after HEAD advanced and before index publication', async () => {
    const f = await fixture();
    await f.write('a', 'old');
    const old = (await f.save('Old')).oid!,
      oldIndex = await fs.readFile(path.join(f.root, '.git/index'));
    await f.write('a', 'new');
    const next = (await f.save('New')).oid!,
      newIndex = await fs.readFile(path.join(f.root, '.git/index'));
    await fs.writeFile(path.join(f.root, '.git/index'), oldIndex);
    const area = path.join(f.root, '.verdscrolls/git-restore');
    await fs.mkdir(area, { recursive: true });
    const hash = (bytes: Uint8Array | string) =>
      createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(area, 'fault-0.bin'), 'new');
    await fs.writeFile(path.join(area, 'fault-index.bin'), newIndex);
    await fs.writeFile(
      path.join(area, 'journal.json'),
      JSON.stringify({
        id: 'fault',
        phase: 'applying',
        operations: [
          {
            path: 'a',
            before: hash('old'),
            after: hash('new'),
            staged: 'fault-0.bin',
            mode: '100644',
          },
        ],
        gitUpdate: {
          old,
          next,
          branch: 'refs/heads/main',
          staged: 'fault-index.bin',
          beforeIndex: hash(oldIndex),
          afterIndex: hash(newIndex),
        },
      }),
    );
    await recoverGitRestore(f.root);
    expect(await f.run('rev-parse', 'HEAD')).toBe(next);
    expect(await f.run('status', '--porcelain')).toBe('');
    expect(await f.run('rev-list', '--count', 'HEAD')).toBe('2');
  });
  it('recovers the Git-directory publication gap without creating an empty conflicting repository', async () => {
    const f = await fixture();
    await f.write('keep', 'content');
    const head = (await f.save('Initial')).oid!;
    const stage = path.join(
      f.root,
      '.verdscrolls/git-purge-00000000-0000-0000-0000-000000000001',
    );
    await fs.mkdir(stage);
    await fs.rename(path.join(f.root, '.git'), path.join(stage, 'old.git'));
    await fs.cp(path.join(stage, 'old.git'), path.join(stage, 'new.git'), {
      recursive: true,
    });
    await f.write(
      '.verdscrolls/git-purge.json',
      JSON.stringify({
        stage,
        worktree: [],
        assets: [],
        local: {
          files: [],
          versions: {},
          live: [],
          directories: [],
          manifests: [],
          assets: [],
          fingerprint: '',
        },
        cleanup: {
          state: {
            phase: 'acknowledged',
            message: 'Recovered explicit operation',
            pending: [],
          },
        },
        beforeRefs: { 'refs/heads/main': head },
      }),
    );
    await recoverGitPurge(f.root);
    expect(await f.run('rev-parse', 'HEAD')).toBe(head);
    await f.run('fsck', '--strict');
    expect(await fs.stat(stage).catch(() => null)).toBeNull();
  });
  it('keeps assets referenced by an ignored live native document', async () => {
    const f = await fixture(),
      assetId = createHash('sha256').update('image').digest('hex') + '.png',
      asset = '.verdscrolls/resources/assets/' + assetId;
    const withImage = (id: string) => {
      const doc = createDocumentFile(id, id);
      doc.text.content = {
        type: 'doc',
        content: [
          {
            type: 'image',
            attrs: { src: 'verd-asset:.verd-resources/assets/' + assetId },
          },
        ],
      };
      return doc;
    };
    await f.write(asset, 'image');
    await f.write('secret.verd-doc.json', JSON.stringify(withImage('secret')));
    await f.write('.gitignore', 'private.verd-doc.json\n');
    await f.save('Secret image');
    await f.write(
      'private.verd-doc.json',
      JSON.stringify(withImage('survivor')),
    );
    const plan = await f.git({ type: 'purge-plan', fileIds: ['secret'] });
    await f.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(await fs.readFile(path.join(f.root, asset), 'utf8')).toBe('image');
    expect(
      JSON.parse(
        await fs.readFile(path.join(f.root, 'private.verd-doc.json'), 'utf8'),
      ).id,
    ).toBe('survivor');
  });
  it('follows ordinary renames when listing and restoring old content', async () => {
    const f = await fixture();
    await f.write('a.txt', 'old');
    const first = (await f.save('Created')).oid!;
    await fs.rename(path.join(f.root, 'a.txt'), path.join(f.root, 'b.txt'));
    await f.save('Renamed');
    const history = await f.git({ type: 'log', path: 'b.txt' });
    expect(
      history.commits?.map((commit) => [commit.message, commit.path]),
    ).toEqual([
      ['Renamed', 'b.txt'],
      ['Created', 'a.txt'],
    ]);
    const plan = await f.git({
      type: 'restore-plan',
      oid: first,
      path: 'b.txt',
    });
    expect(plan.plan!.paths).toEqual([]); // The old bytes are already present under the current name.
  });
  it('purges an ordinary renamed file from its complete historical path chain', async () => {
    const f = await fixture();
    await f.write('a.txt', 'ordinary secret');
    await f.save('Created');
    const secret = await f.run('rev-parse', 'HEAD:a.txt');
    await fs.rename(path.join(f.root, 'a.txt'), path.join(f.root, 'b.txt'));
    await f.save('Renamed');
    const plan = await f.git({
      type: 'purge-plan',
      fileIds: [],
      paths: ['b.txt'],
    });
    expect(plan.plan!.paths.map((item) => item.path)).toEqual(
      expect.arrayContaining(['a.txt', 'b.txt']),
    );
    await f.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    await expect(f.run('cat-file', '-e', secret)).rejects.toThrow();
    expect(
      await fs.stat(path.join(f.root, 'b.txt')).catch(() => null),
    ).toBeNull();
  });
  it('anchors ordinary trash cleanup to old bytes and retains a later path incarnation', async () => {
    const f = await fixture();
    await f.write('reused.txt', 'old secret');
    await f.save('Original');
    const secret = await f.run('rev-parse', 'HEAD:reused.txt');
    await f.write(
      '.verdscrolls/trash/trash-old/entry.json',
      JSON.stringify({
        entryId: 'trash-old',
        originalPath: 'reused.txt',
        trashedAt: 1,
      }),
    );
    await fs.rename(
      path.join(f.root, 'reused.txt'),
      path.join(f.root, '.verdscrolls/trash/trash-old/reused.txt'),
    );
    await f.save('Deleted');
    await f.write('reused.txt', 'new unrelated file');
    await f.save('Recreated');
    const plan = await f.git({
      type: 'purge-plan',
      fileIds: [],
      trashEntryIds: ['trash-old'],
    });
    await f.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(await fs.readFile(path.join(f.root, 'reused.txt'), 'utf8')).toBe(
      'new unrelated file',
    );
    expect(await f.run('show', 'HEAD:reused.txt')).toBe('new unrelated file');
    await expect(f.run('cat-file', '-e', secret)).rejects.toThrow();
    expect(
      await fs
        .stat(path.join(f.root, '.verdscrolls/trash/trash-old'))
        .catch(() => null),
    ).toBeNull();
  });
  it('refuses an ambiguous ordinary path reuse without a recorded deletion boundary', async () => {
    const f = await fixture();
    await f.write('reused.txt', 'old secret');
    await f.save('Original');
    await f.write(
      '.verdscrolls/trash/trash-old/entry.json',
      JSON.stringify({
        entryId: 'trash-old',
        originalPath: 'reused.txt',
        trashedAt: 1,
      }),
    );
    await fs.rename(
      path.join(f.root, 'reused.txt'),
      path.join(f.root, '.verdscrolls/trash/trash-old/reused.txt'),
    );
    await f.write('reused.txt', 'new unrelated file');
    await f.save('Reused without deletion boundary');
    await expect(
      f.git({ type: 'purge-plan', fileIds: [], trashEntryIds: ['trash-old'] }),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(f.root, 'reused.txt'), 'utf8')).toBe(
      'new unrelated file',
    );
  });
  it('updates only refs already present on every remote and preserves Git hooks and exclusions', async () => {
    const f = await fixture();
    await f.write(
      'secret.verd-doc.json',
      JSON.stringify(createDocumentFile('secret', 'Secret')),
    );
    await f.save('Secret');
    const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-remote-'));
    roots.push(remote);
    await command('git', ['init', '--bare', '--initial-branch=main', remote]);
    await f.git({ type: 'configure', remoteUrl: remote });
    await f.run('push', 'origin', 'main');
    await f.run('remote', 'add', 'mirror', remote);
    await f.run('branch', 'private-only');
    await f.write('.git/hooks/pre-commit', '#!/bin/sh\nexit 0\n');
    await fs.chmod(path.join(f.root, '.git/hooks/pre-commit'), 0o755);
    await f.write('.git/info/exclude', 'local-secret.txt\n');
    await f.write('local-secret.txt', 'untracked ignored');
    const plan = await f.git({ type: 'purge-plan', fileIds: ['secret'] });
    const result = await f.git({
      type: 'purge',
      planId: plan.plan!.id,
      expectedToken: plan.status.token,
    });
    expect(result.cleanup?.phase).toBe('platform-pending');
    expect(result.status.canSync).toBe(false);
    const refs = (
      await command('git', [
        '--git-dir',
        remote,
        'for-each-ref',
        '--format=%(refname)',
      ])
    ).stdout;
    expect(refs).toContain('refs/heads/main');
    expect(refs).not.toContain('private-only');
    expect(
      await fs.readFile(path.join(f.root, '.git/hooks/pre-commit'), 'utf8'),
    ).toContain('exit 0');
    expect(
      (await fs.stat(path.join(f.root, '.git/hooks/pre-commit'))).mode & 0o111,
    ).toBeTruthy();
    expect(
      await fs.readFile(path.join(f.root, '.git/info/exclude'), 'utf8'),
    ).toContain('local-secret.txt');
    const confirmation = await f.git({
      type: 'cleanup-confirm',
      expectedToken: result.status.token,
    });
    expect(confirmation.cleanup?.phase).toBe('acknowledged');
  });
  it('rewrites every reachable ref and drops sensitive unreachable blobs', async () => {
    const f = await fixture();
    const secret = JSON.stringify(createDocumentFile('sensitive', 'Secret'));
    await f.write('secret.verd-doc.json', secret);
    const first = (await f.save('Initial secret')).oid!;
    const secretBlob = await f.run('rev-parse', 'HEAD:secret.verd-doc.json');
    await f.run('tag', 'old-secret', first);
    await fs.rename(
      path.join(f.root, 'secret.verd-doc.json'),
      path.join(f.root, 'renamed.verd-doc.json'),
    );
    await f.save('Renamed secret');
    const result = await f.git({ type: 'purge-plan', fileIds: ['sensitive'] });
    await f.git({
      type: 'purge',
      planId: result.plan!.id,
      expectedToken: result.status.token,
    });
    await expect(f.run('cat-file', '-e', secretBlob)).rejects.toThrow();
    expect(
      await fs
        .stat(path.join(f.root, 'renamed.verd-doc.json'))
        .catch(() => null),
    ).toBeNull();
    expect(
      await f.run('ls-tree', '-r', '--name-only', 'old-secret'),
    ).not.toContain('secret.verd-doc.json');
    expect((await f.git({ type: 'status' })).status.changes).toEqual([]);
  });
});
