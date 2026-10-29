import { createLibViteConfig } from '../../../scripts/lib-vite';

export default createLibViteConfig({
  dirname: __dirname,
  name: 'react-text',
  entry: 'src/index.ts',
  extraEntries: { schema: 'src/schema.ts' },
  react: true,
  cacheDir: '../../../node_modules/.vite/packages/react-text',
  externals: [/^@tiptap\//],
});
