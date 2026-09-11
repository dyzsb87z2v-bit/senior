/**
 * Configuration from the environment, validated once at start-up. A missing
 * or malformed value stops the process with a readable message instead of
 * failing on the first telephone call.
 */
import 'dotenv/config';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  /** Base URL the public reaches the app on (https://…). Used for cookies, CSRF origin checks and Twilio webhook URLs. */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_PHONE_NUMBER: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  LUNCH_AI_MODEL: z.string().default('claude-fable-5-1'),
  LUNCH_AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(14000).default(9000),
  LUNCH_HANDOFF_NUMBER: z.string().default(''),
  LUNCH_TTS_VOICE: z.string().default('Polly.Vicki'),
  LUNCH_PUBLIC_VOICE_URL: z.string().default(''),
  LUNCH_PUBLIC_STATUS_URL: z.string().default(''),
  /** Development only: accept unsigned Twilio requests (e.g. from a local simulator). Never in production. */
  LUNCH_ALLOW_UNSIGNED_WEBHOOKS: z.enum(['true', 'false']).default('false'),
  /** Login attempts per minute per IP. */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(3).max(1000).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(10).optional(),
});

export type Config = z.infer<typeof Env> & { isProduction: boolean; allowUnsignedWebhooks: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  if (isProduction && c.LUNCH_ALLOW_UNSIGNED_WEBHOOKS === 'true') throw new Error('LUNCH_ALLOW_UNSIGNED_WEBHOOKS must not be true in production');
  if (isProduction && !c.PUBLIC_URL.startsWith('https://')) throw new Error('PUBLIC_URL must be https:// in production');
  return { ...c, isProduction, allowUnsignedWebhooks: c.LUNCH_ALLOW_UNSIGNED_WEBHOOKS === 'true' };
}
