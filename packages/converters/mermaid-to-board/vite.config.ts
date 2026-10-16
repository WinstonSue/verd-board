import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'mermaid-to-board',
  entry: 'src/index.ts',
  cacheDir: '../../../node_modules/.vite/packages/mermaid-to-board',
  externals: ['mermaid'],
});
