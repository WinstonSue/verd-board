import { builtinModules } from 'node:module';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development', 'module', 'node'] },
  test: { environment: 'node', testTimeout: 30000 },
  ssr: {
    noExternal: true,
    resolve: { conditions: ['development', 'module', 'node'] },
  },
  build: {
    ssr: 'src/main.ts',
    target: 'node22',
    outDir: 'dist',
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
      output: { entryFileNames: 'main.mjs', inlineDynamicImports: true },
    },
  },
});
