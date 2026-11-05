import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'react-draw',
  entry: 'src/index.ts',
  styleEntry: 'src/style.ts',
  react: true,
  externals: ['lucide-react'],
  cacheDir: '../../../node_modules/.vite/packages/react-draw',
});
