import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'board-text',
  entry: 'src/public-api.ts',
  cacheDir: '../../../node_modules/.vite/packages/engine-text',
  externals: ['tslib'],
});
