import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

// The web app is built into web/dist and served by the Fastify server. In
// development Vite serves it and proxies the API to the server on :3000.
export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(here, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false }, '/health': 'http://localhost:3000' },
  },
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true, sourcemap: false },
});
