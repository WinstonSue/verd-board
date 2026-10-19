import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'board-uml',
  entry: 'src/public-api.ts',
  cacheDir: '../../../node_modules/.vite/packages/engine-uml',
});
