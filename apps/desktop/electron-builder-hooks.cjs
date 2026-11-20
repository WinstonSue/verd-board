const path = require('node:path');
const fs = require('node:fs/promises');
module.exports = async (context) => {
  if (!process.env.VERD_RELEASE_CONTEXT)
    throw new Error("Packaging requires this run's validated release context");
  const release = JSON.parse(
    await fs.readFile(process.env.VERD_RELEASE_CONTEXT, 'utf8'),
  );
  const platform = context.electronPlatformName;
  const arch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  if (platform === 'darwin') {
    const { execFileSync } = require('node:child_process');
    const output = path.join(__dirname, 'build/default-file-handler');
    const architectures =
      arch === 'universal'
        ? ['arm64', 'x86_64']
        : [arch === 'x64' ? 'x86_64' : arch];
    for (const target of architectures) {
      execFileSync(
        'xcrun',
        [
          'swiftc',
          '-O',
          '-target',
          `${target}-apple-macosx12.0`,
          path.join(__dirname, 'electron/native/default-file-handler.swift'),
          '-o',
          `${output}-${target}`,
        ],
        { stdio: 'inherit' },
      );
    }
    if (architectures.length === 1)
      await fs.rename(`${output}-${architectures[0]}`, output);
    else
      execFileSync(
        'xcrun',
        [
          'lipo',
          '-create',
          ...architectures.map((target) => `${output}-${target}`),
          '-output',
          output,
        ],
        { stdio: 'inherit' },
      );
  }
  const os =
    platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  const { stageReleaseResources } =
    await import('../../scripts/package-resources.mjs');
  await stageReleaseResources(release, {
    platform,
    arch,
    destination: path.join(__dirname, 'build/agent-resources', `${os}-${arch}`),
    builtinDestination: path.join(__dirname, 'build/builtin-workspaces'),
  });
};
