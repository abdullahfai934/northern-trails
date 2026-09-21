import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root feeds both the API and the SPA, so there is a
  // single place to put credentials rather than two that can drift apart.
  envDir: '..',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
