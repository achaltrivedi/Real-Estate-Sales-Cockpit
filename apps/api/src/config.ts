import { z } from 'zod';
import { parseDurations, parseQuietHours } from './scheduler/time';

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
  LLM_PROVIDER: opt(z.enum(['mock', 'openai'])),
  MESSAGING_CHANNEL: opt(z.enum(['mock', 'whatsapp'])),
  CRM_ADAPTER: opt(z.enum(['mock', 'webhook'])),
  WHATSAPP_VERIFY_TOKEN: opt(z.string()),
  /** Meta app secret: when set, inbound webhooks must carry a valid X-Hub-Signature-256. */
  WHATSAPP_APP_SECRET: opt(z.string()),
  /** Project that inbound WhatsApp leads belong to. */
  DEFAULT_PROJECT_ID: opt(z.string()),
  /** For local numbers like "050 123 4567". */
  DEFAULT_COUNTRY_CODE: opt(z.string().regex(/^[1-9]\d{0,3}$/, 'digits only, e.g. 971')),
  FOLLOW_UP_DELAYS: opt(z.string()),
  QUIET_HOURS: opt(z.string()),
  TIMEZONE: opt(z.string()),
  SCHEDULER_POLL_SECONDS: opt(z.coerce.number().int().min(1).max(3600)),
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
  whatsappAppSecret: string | undefined;
  defaultProjectId: string;
  defaultCountryCode: string;
  followUpDelaysMs: number[];
  quietHours: string;
  timeZone: string;
  schedulerPollMs: number;
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

  const quietHours = e.QUIET_HOURS ?? '22:00-08:00';
  const timeZone = e.TIMEZONE ?? 'Asia/Dubai';
  let followUpDelaysMs: number[];
  try {
    parseQuietHours(quietHours);
    new Intl.DateTimeFormat('en-GB', { timeZone }); // throws RangeError on an unknown zone
    followUpDelaysMs = parseDurations(e.FOLLOW_UP_DELAYS ?? '1h,24h,72h');
  } catch (err) {
    throw new ConfigError(`Invalid environment: ${(err as Error).message}`);
  }
  if (followUpDelaysMs.length > 3)
    throw new ConfigError('FOLLOW_UP_DELAYS: at most 3 reminders (follow_up_1..3 templates)');

  return {
    env: nodeEnv,
    port: e.API_PORT ?? 4000,
    host: e.API_HOST ?? '0.0.0.0',
    logLevel: e.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    corsOrigins,
    dataDriver,
    databaseUrl: e.DATABASE_URL,
    whatsappVerifyToken: e.WHATSAPP_VERIFY_TOKEN,
    whatsappAppSecret: e.WHATSAPP_APP_SECRET,
    defaultProjectId: e.DEFAULT_PROJECT_ID ?? 'prj_azure_crest',
    defaultCountryCode: e.DEFAULT_COUNTRY_CODE ?? '971',
    followUpDelaysMs,
    quietHours,
    timeZone,
    schedulerPollMs: (e.SCHEDULER_POLL_SECONDS ?? 15) * 1000,
  };
}
