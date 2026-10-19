import { defineConfig, type ProxyOptions } from 'vite';

const api = `http://127.0.0.1:${process.env.SHAKY_PORT ?? 8787}`;

// The API only accepts its own origin. In dev the browser talks to Vite on
// another port, so the proxy presents requests as coming from the API origin.
const toApi: ProxyOptions = {
  target: api,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on('proxyReq', (req) => {
      if (req.getHeader('origin')) req.setHeader('origin', api);
    });
  },
};

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
    proxy: { '/api': toApi, '/mcp': toApi },
  },
});
