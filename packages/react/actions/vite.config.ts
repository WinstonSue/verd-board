import { createLibViteConfig } from '../../../scripts/lib-vite';
export default createLibViteConfig({
  dirname: __dirname,
  name: 'board-react-actions',
  entry: 'src/index.ts',
  react: true,
  styleEntry: 'src/style.ts',
  cacheDir: '../../../node_modules/.vite/packages/react-actions',
});
