import path from 'node:path';
import { mergeConfig } from 'vite';
import web from './vite.config';
import { workspaceE2EProbes } from '../../scripts/e2e-probes';

/** Optimized production regression build with the source suite's fault probes. */
export default mergeConfig(web, {
  plugins: [workspaceE2EProbes()],
  resolve: {
    alias: [
      {
        find: /^@sue\/verd-board-app$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/product/app/src/index.ts',
        ),
      },
      {
        find: /^@sue\/verd-board-ui$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/product/ui/src/index.ts',
        ),
      },
      {
        find: /^@sue\/board-react-text$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/react/text/src/index.ts',
        ),
      },
    ],
  },
  build: {
    outDir: './dist-e2e',
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        index: path.resolve(__dirname, 'index.html'),
        'workspace-host': path.resolve(
          __dirname,
          'src/test-support/workspace-host.ts',
        ),
      },
      output: {
        entryFileNames: (chunk: { name: string }) =>
          chunk.name === 'workspace-host'
            ? 'test-support/workspace-host.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
});
