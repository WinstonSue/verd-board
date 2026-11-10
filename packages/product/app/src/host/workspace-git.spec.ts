import { describe, expect, it } from 'vitest';
import { assertGitContentPath, isGitRuntimePath } from './workspace-git';

describe('Git content boundary', () => {
  it('allows portable content, project configuration, assets and user skills', () => {
    for (const path of [
      '文档/需求.verd-doc.json',
      'notes.txt',
      '.agents/skills/custom/SKILL.md',
      '.verdscrolls/config.json',
      '.verdscrolls/.gitignore',
      '.verdscrolls/resources/assets/test.png',
    ])
      expect(assertGitContentPath(path)).toBe(path);
  });
  it('rejects path escapes, Git internals and local recovery data', () => {
    for (const path of [
      '/tmp/file',
      'C:/outside',
      '../file',
      'folder/../file',
      'folder//file',
      'folder/.git/config',
      '.GiT/HEAD',
      'file\0name',
      '.git/config',
      '.verdscrolls/session.json',
      '.verdscrolls/transactions/write.json',
      '.verdscrolls/resources/history/index.json',
      '.verd-resources/history/old.snapshot.json',
    ])
      expect(() => assertGitContentPath(path), path).toThrow();
    expect(isGitRuntimePath('.verdscrolls/trash/deleted')).toBe(true);
  });
});
