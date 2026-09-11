import pino from 'pino';

/**
 * Structured JSON logs. Lines carry ids (callSid, callId, orderId) and
 * outcomes, never what a caller said. Pretty-printed in development only.
 */
export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.passwordHash', '*.token'], censor: '[redacted]' },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
