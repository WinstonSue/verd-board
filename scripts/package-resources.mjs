import fs from 'node:fs/promises';
import { assertReleaseContext, artifactFiles } from './release-proof.mjs';
import { hash } from './release-review.mjs';
import { copyBuiltinWorkspaces } from './prepare-builtin-workspaces.mjs';

export async function stageReleaseResources(
  context,
  { platform, arch, destination, builtinDestination },
  { validate = assertReleaseContext, copyBuiltin = copyBuiltinWorkspaces } = {},
) {
  await validate(context);
  if (
    context.proof.identity.platform !== platform ||
    context.proof.identity.arch !== arch
  )
    throw new Error('Packaging target differs from validated resources');
  await copyBuiltin(context.artifacts.builtin.path, builtinDestination);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(context.artifacts.agent.path, destination, { recursive: true });
  if (
    hash(await artifactFiles(destination)) !==
    hash(context.artifacts.agent.files)
  )
    throw new Error('Copied Agent resources differ from validated resources');
}
