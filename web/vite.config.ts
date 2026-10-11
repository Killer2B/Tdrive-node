import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// الواجهة تُبنى إلى web/dist ويقدّمها خادم Fastify.
// في التطوير، نحوّل /api و /health إلى خادم Node على المنفذ 8080.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
      '/health': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
