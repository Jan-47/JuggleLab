import { defineConfig } from 'vite';

export default defineConfig({
  base: '/JuggleLab/',
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
  build: {
    target: 'esnext',
  },
  publicDir: 'public',
});
