import { builtinModules } from 'node:module';
import { createLibViteConfig } from '../../../scripts/lib-vite';
export default createLibViteConfig({
  dirname: __dirname,
  name: 'verd-board-agent',
  entry: 'src/index.ts',
  extraEntries: { node: 'src/node.ts', cli: 'src/cli.ts', 'mermaid-worker': 'src/mermaid-worker.mjs' },
  cacheDir: '../../../node_modules/.vite/agent',
  testEnvironment: 'node',
  externals: [...builtinModules, /^node:/, 'playwright', 'jsdom'],
});
