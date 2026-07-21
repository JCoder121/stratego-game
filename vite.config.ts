import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
  server: {
    // src/web imports types/modules from src/server and src/engine, which live outside the
    // `root` above (src/web) — allow the whole repo tree so Vite's dev server doesn't 403 them.
    fs: { allow: ['..'] },
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
