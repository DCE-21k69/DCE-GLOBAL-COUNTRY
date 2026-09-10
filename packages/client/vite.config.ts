import { defineConfig } from 'vite';

// El cliente es servido por Vite; las peticiones /api se redirigen al
// backend Fastify en el puerto 8080 (monorepo: ambos en dev simultáneamente).
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // El preview de Arena sirve bajo un host dinámico (*.e2b.app).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
