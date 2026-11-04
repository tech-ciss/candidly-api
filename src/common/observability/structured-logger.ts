import type { LoggerService } from '@nestjs/common';
import { currentRequestId } from './request-context.js';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogEvent =
  | 'http.completed'
  | 'http.error'
  | 'audit.unavailable'
  | 'application.bootstrap_failed'
  | 'framework.message'
  | 'maintenance.failed';
export interface LogInput {
  level: LogLevel;
  module: string;
  event: LogEvent;
  requestId?: string;
  statusCode?: number;
  durationMs?: number;
  method?: string;
  route?: string;
}
const modules = new Set([
  'Http',
  'Audit',
  'Application',
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestApplication',
  'Bootstrap',
  'PrismaService',
  'VerificationDeliveryService',
  'PasswordResetDeliveryService',
  'HttpExceptionFilter',
]);
const levels = new Set(['info', 'warn', 'error', 'debug']);
const events = new Set([
  'http.completed',
  'http.error',
  'audit.unavailable',
  'application.bootstrap_failed',
  'framework.message',
  'maintenance.failed',
]);
export function logRecord(input: LogInput): Record<string, string | number> {
  const record: Record<string, string | number> = {
    timestamp: new Date().toISOString(),
    level: levels.has(input.level) ? input.level : 'error',
    service: 'candidly-api',
    module: modules.has(input.module) ? input.module : 'Application',
    event: events.has(input.event) ? input.event : 'framework.message',
  };
  const requestId = input.requestId ?? currentRequestId();
  if (requestId && /^[a-f0-9-]{36}$/i.test(requestId))
    record.requestId = requestId;
  if (
    Number.isInteger(input.statusCode) &&
    input.statusCode! >= 100 &&
    input.statusCode! <= 599
  )
    record.statusCode = input.statusCode!;
  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  )
    record.durationMs = Math.round(input.durationMs * 100) / 100;
  if (
    input.method &&
    ['GET', 'POST', 'PATCH', 'OPTIONS', 'DELETE', 'PUT', 'HEAD'].includes(
      input.method,
    )
  )
    record.method = input.method;
  if (
    input.route &&
    (input.route === 'unmatched' ||
      /^\/[A-Za-z0-9/:_.-]{0,160}$/.test(input.route))
  )
    record.route = input.route;
  return record;
}
export function structuredLog(input: LogInput): void {
  try {
    process.stdout.write(JSON.stringify(logRecord(input)) + '\n');
  } catch {
    /* Un log secondaire ne modifie pas une transaction métier. */
  }
}
export class StructuredLogger implements LoggerService {
  private emit(level: LogLevel, optional: unknown[]): void {
    const context = optional.at(-1);
    structuredLog({
      level,
      module:
        typeof context === 'string' && modules.has(context)
          ? context
          : 'Application',
      event: 'framework.message',
    });
  }
  // Aucun message arbitraire, Error, stack ou argument fourni par le framework n'est sérialisé.
  log(_message: unknown, ...optional: unknown[]): void {
    this.emit('info', optional);
  }
  error(_message: unknown, ...optional: unknown[]): void {
    this.emit('error', optional);
  }
  warn(_message: unknown, ...optional: unknown[]): void {
    this.emit('warn', optional);
  }
  debug(_message: unknown, ...optional: unknown[]): void {
    this.emit('debug', optional);
  }
  verbose(_message: unknown, ...optional: unknown[]): void {
    this.emit('debug', optional);
  }
  fatal(_message: unknown, ...optional: unknown[]): void {
    this.emit('error', optional);
  }
}
