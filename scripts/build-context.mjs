import fs from 'node:fs/promises';
import { releaseInputs, artifactFiles } from './release-proof.mjs';
import { hash } from './release-review.mjs';
import { writeRecord } from './gate-runner.mjs';

/** Build reuse is restricted to an explicit context owned by this invocation. */
export async function buildInContext({
  marker,
  directory,
  build,
  inputs = releaseInputs,
}) {
  const before = await inputs();
  if (marker) {
    const previous = await fs
      .readFile(marker, 'utf8')
      .then(JSON.parse, () => null);
    if (previous?.inputDigest === hash(before)) {
      const files = await artifactFiles(directory).catch(() => null);
      if (files && hash(files) === hash(previous.files))
        return { reused: true };
    }
  }
  await build();
  if (hash(await inputs()) !== hash(before))
    throw new Error('Source changed during build');
  if (marker)
    await writeRecord(marker, {
      inputDigest: hash(before),
      files: await artifactFiles(directory),
    });
  return { reused: false };
}
