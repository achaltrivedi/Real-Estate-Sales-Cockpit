import { z } from 'zod';

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess(blankToUndefined, t.optional());

const Env = z.object({
  NODE_ENV: opt(z.enum(['development', 'test', 'production'])),
  API_PORT: opt(z.coerce.number().int().min(1).max(65535)),
  API_HOST: opt(z.string()),
  LOG_LEVEL: opt(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])),
  /** Comma-separated origins, or "*". Unset: any origin outside production, none in production. */
  CORS_ORIGINS: opt(z.string()),
  DATA_DRIVER: opt(z.enum(['memory', 'postgres'])),
  DATABASE_URL: opt(z.string().url()),
  WHATSAPP_VERIFY_TOKEN: opt(z.string()),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** `true` = reflect any origin; otherwise an allow-list (empty = no cross-origin access). */
  corsOrigins: true | string[];
  dataDriver: 'memory' | 'postgres';
  databaseUrl: string | undefined;
  whatsappVerifyToken: string | undefined;
}

export class ConfigError extends Error {}

/** Parses + validates env once at startup, so a typo fails fast with a readable message instead of at the first request. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment:\n${lines}`);
  }
  const e = r.data;
  const nodeEnv = e.NODE_ENV ?? 'development';
  const dataDriver = e.DATA_DRIVER ?? 'memory';
  if (dataDriver === 'postgres' && !e.DATABASE_URL)
    throw new ConfigError('DATA_DRIVER=postgres needs DATABASE_URL');

  let corsOrigins: Config['corsOrigins'];
  if (!e.CORS_ORIGINS) corsOrigins = nodeEnv === 'production' ? [] : true;
  else if (e.CORS_ORIGINS.trim() === '*') corsOrigins = true;
  else
    corsOrigins = e.CORS_ORIGINS.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);

  return {
    env: nodeEnv,
    port: e.API_PORT ?? 4000,
    host: e.API_HOST ?? '0.0.0.0',
    logLevel: e.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    corsOrigins,
    dataDriver,
    databaseUrl: e.DATABASE_URL,
    whatsappVerifyToken: e.WHATSAPP_VERIFY_TOKEN,
  };
}
