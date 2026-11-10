import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  workspaceSkillDefinitions,
  parseWorkspaceSkill,
  type WorkspaceSkillDocument,
} from '@sue/verd-board-app/headless';

/** Never follow a Skill or one of its parent directories outside the workspace. */
export async function assertSkillFile(root: string, relative: string) {
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index++) {
    const stat = await fs.lstat(path.join(root, ...parts.slice(0, index + 1)));
    if (
      stat.isSymbolicLink() ||
      (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
    )
      throw new Error(
        'Skill path must contain ordinary directories and files: ' + relative,
      );
  }
}

export async function readWorkspaceSkillsUnlocked(root: string) {
  const documents: WorkspaceSkillDocument[] = [];
  const manifest: [string, string][] = [];
  const diagnostics: {
    code: string;
    severity: 'error' | 'warning';
    path: string;
    message: string;
  }[] = [];
  const candidates = new Set(
    workspaceSkillDefinitions.map((definition) => definition.path),
  );
  try {
    for (const part of ['.agents', '.agents/skills']) {
      const stat = await fs.lstat(path.join(root, part));
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Skill directories must be ordinary directories');
    }
    for (const entry of await fs.readdir(path.join(root, '.agents/skills'), {
      withFileTypes: true,
    }))
      if (entry.isDirectory() || entry.isSymbolicLink())
        candidates.add(`.agents/skills/${entry.name}/SKILL.md`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      diagnostics.push({
        code: 'workspace.skill-invalid',
        severity: 'warning',
        path: '.agents/skills',
        message: String(error),
      });
  }
  for (const relative of candidates) {
    try {
      await assertSkillFile(root, relative);
      const bytes = await fs.readFile(path.join(root, relative));
      const version =
        'sha256-' + createHash('sha256').update(bytes).digest('hex');
      manifest.push([relative, version]);
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      documents.push(parseWorkspaceSkill(relative, source, version));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (!manifest.some(([file]) => file === relative))
        manifest.push([relative, 'invalid']);
      diagnostics.push({
        code: 'workspace.skill-invalid',
        severity: workspaceSkillDefinitions.some(
          (definition) => definition.path === relative,
        )
          ? 'error'
          : 'warning',
        path: relative,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  manifest.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { documents, manifest, diagnostics };
}

/** Preserve user-owned Skills and their relative resources during a bundled content update. */
export async function preserveWorkspaceSkills(root: string, staging: string) {
  const source = path.join(root, '.agents/skills');
  try {
    const agents = await fs.lstat(path.join(root, '.agents'));
    if (!agents.isDirectory() || agents.isSymbolicLink())
      throw new Error('Invalid workspace .agents directory');
    const skills = await fs.lstat(source);
    if (!skills.isDirectory() || skills.isSymbolicLink())
      throw new Error('Invalid workspace skills directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await fs.mkdir(path.join(staging, '.agents'), { recursive: true });
  await fs.cp(source, path.join(staging, '.agents/skills'), {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    force: false,
    errorOnExist: true,
  });
}
