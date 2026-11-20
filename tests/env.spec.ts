import { afterEach, describe, expect, it } from 'vitest';
import { parseEnv } from '@shared/config/env';

const requiredEnv = {
  NODE_ENV: 'test',
  BOT_TOKEN: '123:test-token',
  BOT_API_CACHE_DIR: '/tmp/tele-bot-cache',
  TG_API_ID: '123456',
  TG_API_HASH: 'test-api-hash',
  TG_SESSION_STRING: '1test-session',
  TG_NUMBER: '+10000000000',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/tele_autoupload',
  STAGING_DIR: '/tmp/tele-staging',
  UPLOAD_STRATEGY: 'drive_desktop',
  DRIVE_SYNC_FOLDER: '/tmp/drive-sync',
};
const managedEnvKeys = [...Object.keys(requiredEnv), 'TG_USE_WSS', 'LEGACY_TELEGRAM_ENABLED'];
const originalEnv = Object.fromEntries(managedEnvKeys.map((key) => [key, process.env[key]]));

function setRequiredEnv(): void {
  Object.assign(process.env, requiredEnv);
}

afterEach(() => {
  for (const key of managedEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('Telegram transport configuration', () => {
  it('uses port 443 transport by default', () => {
    setRequiredEnv();
    delete process.env.TG_USE_WSS;

    expect(parseEnv().telegram.useWss).toBe(true);
  });

  it('allows direct port 80 transport when explicitly requested', () => {
    setRequiredEnv();
    process.env.TG_USE_WSS = 'false';

    expect(parseEnv().telegram.useWss).toBe(false);
  });

  it('rejects an invalid Telegram transport setting', () => {
    setRequiredEnv();
    process.env.TG_USE_WSS = 'sometimes';

    expect(() => parseEnv()).toThrow('TG_USE_WSS must be one of: true/false/1/0/yes/no/on/off');
  });
  it('starts bot configuration without human credentials and disables legacy access by default', () => {
    setRequiredEnv();
    for (const key of ['TG_API_ID', 'TG_API_HASH', 'TG_SESSION_STRING', 'TG_NUMBER', 'LEGACY_TELEGRAM_ENABLED']) delete process.env[key];
    expect(parseEnv()).toMatchObject({ legacyTelegramEnabled: false, botApiRoot: 'http://127.0.0.1:8081' });
  });

  it('requires account credentials only when the legacy capability is explicitly enabled', () => {
    setRequiredEnv();
    process.env.LEGACY_TELEGRAM_ENABLED = 'true';
    delete process.env.TG_SESSION_STRING;
    expect(() => parseEnv()).toThrow('LEGACY_TELEGRAM_ENABLED requires');
  });

});
