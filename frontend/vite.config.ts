import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  // ML-KEM/ML-DSA use top-level WASM-adjacent typed array operations; no
  // special bundler config is needed since @noble/post-quantum is pure JS,
  // but we keep this explicit in case future PQC deps need it.
  optimizeDeps: {
    exclude: [],
  },
});
