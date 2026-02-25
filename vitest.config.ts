import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
});
