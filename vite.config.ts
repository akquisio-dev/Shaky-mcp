import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.SHAKY_PORT ?? 8787}`;

export default defineConfig({
  root: 'src/web/client',
  build: {
    outDir: '../../../dist/client',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/mcp': { target: api, changeOrigin: true },
    },
  },
});
