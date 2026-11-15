import { createLibViteConfig } from '../../../scripts/lib-vite';
export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board-workspace',
  entry: 'src/index.ts',
  cacheDir: '../../../node_modules/.vite/workspace-core',
  testEnvironment: 'node',
});
