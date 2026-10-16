import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import ts from 'typescript';
import type { PluginOption } from 'vite';
import { defineConfig, type UserConfig } from 'vitest/config';

export interface LibViteOptions {
  dirname: string;
  name: string;
  entry: string;
  react?: boolean;
  cacheDir: string;
  externals?: (string | RegExp)[];
  styleEntry?: string;
  testEnvironment?: 'node' | 'jsdom';
}

const DEFAULT_EXTERNALS: (string | RegExp)[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  /^@sue\//,
];

export function createLibViteConfig(options: LibViteOptions): UserConfig {
  const plugins: PluginOption[] = [];
  if (options.react) {
    plugins.push(react());
  }

  const tsconfigPath = ['tsconfig.lib.json', 'tsconfig.json']
    .map((name) => path.join(options.dirname, name))
    .find((candidate) => fs.existsSync(candidate));

  plugins.push(
    dts({
      entryRoot: 'src',
      tsconfigPath,
      insertTypesEntry: true,
      afterDiagnostic(diagnostics) {
        const errors = diagnostics.filter(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
        );
        if (errors.length) {
          throw new Error(
            `Declaration generation failed with ${errors.length} type errors`,
          );
        }
      },
      exclude: [
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/style.ts',
      ],
    }),
  );

  const libEntry: Record<string, string> = {
    index: options.entry,
  };
  if (options.styleEntry) {
    libEntry.style = options.styleEntry;
  }

  return defineConfig({
    root: options.dirname,
    cacheDir: options.cacheDir,
    plugins,
    test: {
      globals: true,
      environment:
        options.testEnvironment ?? (options.react ? 'jsdom' : 'node'),
      passWithNoTests: true,
    },
    build: {
      outDir: './dist',
      emptyOutDir: true,
      cssCodeSplit: true,
      lib: {
        entry: libEntry,
        name: options.name,
        formats: ['es', 'cjs'],
        fileName: (format, entryName) => {
          if (entryName === 'style') {
            return format === 'es' ? 'style.js' : 'style.cjs';
          }
          return format === 'es' ? 'index.js' : 'index.cjs';
        },
      },
      rollupOptions: {
        external: [...DEFAULT_EXTERNALS, ...(options.externals ?? [])],
        output: {
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'style.css';
            }
            return assetInfo.name ?? 'asset';
          },
        },
      },
    },
  });
}
