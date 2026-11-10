import { createLibViteConfig } from '../../../scripts/lib-vite';

export default {
  ...createLibViteConfig({
    dirname: __dirname,
    name: 'verd-board-app',
    entry: 'src/index.ts',
    extraEntries: { headless: 'src/headless.ts' },
    react: true,
    cacheDir: '../../../node_modules/.vite/packages/product-app',
    externals: ['localforage', 'lucide-react'],
  }),
  // Consumers must resolve the emitted worker beside this package, not their public root.
  base: './',
};
