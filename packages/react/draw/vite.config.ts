import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'react-draw',
  entry: 'src/index.ts',
  styleEntry: 'src/style.ts',
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/react-draw',
});
