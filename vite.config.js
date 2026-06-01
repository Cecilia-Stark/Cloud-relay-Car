import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const relayProxy = {
  '/api': {
    target: 'http://127.0.0.1:18080',
    changeOrigin: true,
  },
  '/live': {
    target: 'http://127.0.0.1:8088',
    changeOrigin: true,
  },
  '/g29-status': {
    target: 'http://127.0.0.1:8083',
    changeOrigin: true,
    rewrite: () => '/status',
  },
  '/g29': {
    target: 'http://127.0.0.1:8083',
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: relayProxy,
  },
  preview: {
    proxy: relayProxy,
  },
})
