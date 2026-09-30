import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: fileURLToPath(new URL('../../node_modules/react/index.js', import.meta.url)) },
      { find: /^react-dom\/client$/, replacement: fileURLToPath(new URL('../../node_modules/react-dom/client.js', import.meta.url)) },
      { find: /^react-dom\/test-utils$/, replacement: fileURLToPath(new URL('../../node_modules/react-dom/test-utils.js', import.meta.url)) },
      { find: /^react-dom$/, replacement: fileURLToPath(new URL('../../node_modules/react-dom/index.js', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.tsx'],
    setupFiles: ['./tests/setup.ts'],
  },
  esbuild: {
    jsx: 'automatic',
  },
});
