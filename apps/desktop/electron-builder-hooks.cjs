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
