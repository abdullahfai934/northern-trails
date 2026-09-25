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
    // The dev server forwards API calls, so the browser sees one origin and
    // CORS never applies. Point it at the hosted API with
    //   API_PROXY=https://northern-trails-api.onrender.com npm run dev
    proxy: {
      '/api': { target: process.env.API_PROXY || 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: (process.env.API_PROXY || 'http://127.0.0.1:8000').replace(/^http/, 'ws'), ws: true, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
