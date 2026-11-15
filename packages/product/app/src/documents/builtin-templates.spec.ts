import { describe, it, expect } from 'vitest';
import { builtinTemplates, instantiateTemplate } from './builtin-templates';
import { validateWorkspaceReferences } from '@sue/verd-board-workspace';
import { workspaceFileId } from '@sue/verd-board-workspace';
describe('native template library', () => {
  it('includes the four writing workflows and instantiates independent identities', async () => {
    for (const id of [
      'technical-proposal',
      'adr',
      'system-design',
      'requirements',
    ]) {
      expect(builtinTemplates.some((pattern) => pattern.id === id)).toBe(true);
      const a = await instantiateTemplate(id, 'My proposal'),
        b = await instantiateTemplate(id);
      expect(a.rootId).not.toBe(b.rootId);
      expect(a.files[0].format === 'verd-document' && a.files[0].title).toBe(
        'My proposal',
      );
      expect(validateWorkspaceReferences(a.files, true)).toEqual([]);
    }
  });
  it('remaps every file and internal link in a multi-file pattern as a closure', async () => {
    const pattern = builtinTemplates.find(
      (pattern) => pattern.id === 'multi-system',
    )!;
    const result = await instantiateTemplate(pattern.id);
    expect(result.files.length).toBe(pattern.templatePaths.length);
    expect(result.files.map(workspaceFileId)).toContain(result.rootId);
    expect(validateWorkspaceReferences(result.files, true)).toEqual([]);
    expect(
      result.files.some((file) => workspaceFileId(file) === pattern.rootFileId),
    ).toBe(false);
  });
});
