import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'react-mind',
  entry: 'src/index.ts',
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/react-mind',
});
