import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Empty base so all asset paths are relative (required for Chrome extensions)
  base: '',
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // HTML at project-root-relative paths: popup/index.html → dist/popup/index.html
        popup: resolve(__dirname, 'popup/index.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
        inject: resolve(__dirname, 'src/inject.ts'),
      },
      output: {
        // background.js and content.js at root of dist (manifest requires this)
        entryFileNames: (chunkInfo) => {
          if (['background', 'content', 'inject'].includes(chunkInfo.name)) {
            return '[name].js';
          }
          return 'popup/assets/[name].js';
        },
        chunkFileNames: 'popup/assets/[name].[hash].js',
        assetFileNames: 'popup/assets/[name].[hash].[ext]',
      },
    },
  },
});
