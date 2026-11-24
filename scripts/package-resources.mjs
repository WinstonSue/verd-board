import fs from 'node:fs/promises';
import path from 'node:path';
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
  const builtin = context.artifacts.builtin.path;
  // The release context already verifies this directory's exact contents.
  if (path.resolve(builtin) !== path.resolve(builtinDestination))
    await copyBuiltin(builtin, builtinDestination);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(context.artifacts.agent.path, destination, { recursive: true });
  if (
    hash(await artifactFiles(destination)) !==
    hash(context.artifacts.agent.files)
  )
    throw new Error('Copied Agent resources differ from validated resources');
}
