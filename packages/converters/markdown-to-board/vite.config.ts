import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'markdown-to-board',
  entry: 'src/index.ts',
  cacheDir: '../../../node_modules/.vite/packages/markdown-to-board',
  externals: ['remark-parse', 'unified'],
});
