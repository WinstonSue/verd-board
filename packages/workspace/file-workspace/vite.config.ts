import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board-file-workspace',
  entry: 'src/index.ts',
  cacheDir: '../../../node_modules/.vite/file-workspace',
  externals: [/^node:/],
});
