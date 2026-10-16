import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'board-architecture',
  entry: 'src/public-api.ts',
  cacheDir: '../../../node_modules/.vite/packages/engine-architecture',
});
