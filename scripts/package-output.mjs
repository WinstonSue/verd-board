import fs from 'node:fs/promises';
import path from 'node:path';

/** Stage and verify bytes before touching the previous successful release. */
export async function replaceReleaseDirectory(
  source,
  output,
  archive,
  validate,
) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const staging = await fs.mkdtemp(
    path.join(path.dirname(output), '.package-output-'),
  );
  let archived = false;
  try {
    await fs.cp(source, staging, { recursive: true });
    await validate(staging);
    if (await fs.stat(output).catch(() => null)) {
      await fs.mkdir(path.dirname(archive), { recursive: true });
      await fs.rename(output, archive);
      archived = true;
    }
    try {
      await fs.rename(staging, output);
    } catch (error) {
      if (archived) await fs.rename(archive, output);
      throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
