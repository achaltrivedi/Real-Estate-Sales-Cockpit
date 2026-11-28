import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults to the offline demo: memory store, port 4000, open CORS in development', () => {
    expect(loadConfig({})).toMatchObject({
      env: 'development',
      port: 4000,
      dataDriver: 'memory',
      corsOrigins: true,
      logLevel: 'info',
    });
  });

  it('treats blank values from .env as unset', () => {
    expect(
      loadConfig({ API_PORT: '', DATA_DRIVER: '', DATABASE_URL: ' ', CORS_ORIGINS: '' }),
    ).toMatchObject({ port: 4000, dataDriver: 'memory' });
  });

  it('is silent under test and closed by default in production', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).logLevel).toBe('silent');
    expect(loadConfig({ NODE_ENV: 'production' }).corsOrigins).toEqual([]);
  });

  it('parses a CORS allow-list (trailing slashes trimmed) and "*"', () => {
    expect(
      loadConfig({ CORS_ORIGINS: 'http://localhost:3000/, https://demo.example.test' }).corsOrigins,
    ).toEqual(['http://localhost:3000', 'https://demo.example.test']);
    expect(loadConfig({ NODE_ENV: 'production', CORS_ORIGINS: '*' }).corsOrigins).toBe(true);
  });

  it('fails fast with a readable message', () => {
    expect(() => loadConfig({ DATA_DRIVER: 'postgres' })).toThrow(ConfigError);
    expect(() => loadConfig({ DATA_DRIVER: 'postgres' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ DATA_DRIVER: 'mysql' })).toThrow(/DATA_DRIVER/);
  });

  it('accepts postgres with a URL', () => {
    expect(
      loadConfig({
        DATA_DRIVER: 'postgres',
        DATABASE_URL: 'postgres://gsc:gsc@localhost:5432/gsc',
      }),
    ).toMatchObject({
      dataDriver: 'postgres',
      databaseUrl: 'postgres://gsc:gsc@localhost:5432/gsc',
    });
  });

  it('has scheduler / WhatsApp defaults and validates them', () => {
    expect(loadConfig({})).toMatchObject({
      followUpDelaysMs: [3_600_000, 86_400_000, 259_200_000],
      quietHours: '22:00-08:00',
      timeZone: 'Asia/Dubai',
      schedulerPollMs: 15_000,
      defaultProjectId: 'prj_azure_crest',
      defaultCountryCode: '971',
    });
    expect(loadConfig({ FOLLOW_UP_DELAYS: '2m,10m' }).followUpDelaysMs).toEqual([120_000, 600_000]);
    expect(() => loadConfig({ FOLLOW_UP_DELAYS: '1h,soon' })).toThrow(/Invalid duration/);
    expect(() => loadConfig({ FOLLOW_UP_DELAYS: '1h,2h,3h,4h' })).toThrow(/at most 3/);
    expect(() => loadConfig({ QUIET_HOURS: '10pm-8am' })).toThrow(/HH:MM/);
    expect(() => loadConfig({ TIMEZONE: 'Mars/Olympus' })).toThrow(ConfigError);
    expect(() => loadConfig({ DEFAULT_COUNTRY_CODE: '+971' })).toThrow(/DEFAULT_COUNTRY_CODE/);
  });

  it('validates adapter names so a typo cannot silently fall back to a mock', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'openia' })).toThrow(/LLM_PROVIDER/);
    expect(() => loadConfig({ MESSAGING_CHANNEL: 'whatsap' })).toThrow(/MESSAGING_CHANNEL/);
    expect(loadConfig({ LLM_PROVIDER: 'openai' }).env).toBe('development');
  });
});
