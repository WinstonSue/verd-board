const path = require('node:path');
const fs = require('node:fs/promises');
module.exports = async (context) => {
  const platform = context.electronPlatformName;
  const arch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][context.arch];
  const os =
    platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  const output = path.join(__dirname, 'build/agent-resources', `${os}-${arch}`);
  const { prepareAgentResources } =
    await import('../../scripts/prepare-agent-resources.mjs');
  const { prepareBuiltinWorkspaces } =
    await import('../../scripts/prepare-builtin-workspaces.mjs');
  await prepareBuiltinWorkspaces();
  // Only generated resources, never an installed application or user workspace.
  await fs.rm(output, { recursive: true, force: true });
  await prepareAgentResources(output, { platform, arch });
};
