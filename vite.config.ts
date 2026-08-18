/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the rarely-changing runtime out of the app bundle so a repeat
        // visitor can serve it from cache and open the app offline.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('gsap')) return 'motion';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router)/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    restoreMocks: true,
  },
});
