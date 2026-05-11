/**
 * Structured logger. dev → pino-pretty, test → silent, prod → NDJSON.
 * The audit_log table is the durable record; stdout is for humans.
 */

import { pino, type Logger as PinoLogger } from 'pino';
import type { Logger as DrizzleLogger } from 'drizzle-orm';

// Read env directly so the logger is importable from tests that don't
// touch the database (env.ts validates DATABASE_URL on import).
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const RAW_LOG_LEVEL = process.env.LOG_LEVEL;

const LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LEVELS)[number];

const isLevel = (v: string | undefined): v is LogLevel =>
  !!v && (LEVELS as readonly string[]).includes(v);

const isDev = NODE_ENV === 'development';
const isTest = NODE_ENV === 'test';
const isProd = NODE_ENV === 'production';

const level: LogLevel = isLevel(RAW_LOG_LEVEL)
  ? RAW_LOG_LEVEL
  : isTest
    ? 'silent'
    : isProd
      ? 'info'
      : 'debug';

export const logger: PinoLogger = pino({
  level,
  base: { service: 'bnr-backend' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Tripwire: these keys must never reach the logger. Producers should filter
  // upstream; redaction catches the day they don't.
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'access_token',
      '*.access_token',
      'refresh_token',
      '*.refresh_token',
      'id_token',
      '*.id_token',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

// Drizzle's logger contract. debug-level so prod stays quiet unless asked.
export const drizzleLogger: DrizzleLogger = {
  logQuery(query, params) {
    logger.debug({ query, params }, 'drizzle query');
  },
};

export type Logger = PinoLogger;
