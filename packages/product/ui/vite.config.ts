import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board',
  entry: 'src/index.ts',
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/product-ui',
  externals: ['@floating-ui/react', 'lucide-react'],
});
