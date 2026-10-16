import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'react-workflow',
  entry: 'src/index.ts',
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/react-workflow',
});
