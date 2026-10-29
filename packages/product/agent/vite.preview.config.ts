import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  root: path.resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  resolve: { conditions: ['development', 'module', 'browser'] },
  build: {
    outDir: '../dist/preview',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, 'src/preview.html') },
    chunkSizeWarningLimit: 3000,
  },
});
