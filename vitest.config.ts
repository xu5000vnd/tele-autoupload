import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      LOG_DIR: '/tmp/tele-autoupload-test-logs',
      BOT_TOKEN: '123456:test-token',
      BOT_API_ROOT: 'http://127.0.0.1:8081',
      BOT_API_CACHE_DIR: '/tmp/tele-bot-cache',
      LEGACY_TELEGRAM_ENABLED: 'false',
      REDIS_URL: 'redis://127.0.0.1:6379',
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/tele_autoupload_test',
      STAGING_DIR: '/tmp/tele-autoupload-test-staging',
      UPLOAD_STRATEGY: 'drive_desktop',
      DRIVE_SYNC_FOLDER: '/tmp/tele-autoupload-test-drive',
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
});
