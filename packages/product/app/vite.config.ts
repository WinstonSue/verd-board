import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board-app',
  entry: 'src/index.ts',
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/product-app',
  externals: ['localforage', 'lucide-react'],
});
