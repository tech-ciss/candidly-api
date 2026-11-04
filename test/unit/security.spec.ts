import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  newRequestId,
  requestContext,
} from '../../src/common/observability/request-context.js';
import {
  logRecord,
  StructuredLogger,
} from '../../src/common/observability/structured-logger.js';
import type { LogInput } from '../../src/common/observability/structured-logger.js';
import {
  auditData,
  AUDIT_EVENTS,
  recordLoginFailure,
} from '../../src/modules/audit/audit-log.js';
import type {
  AuditEvent,
  AuditClient,
} from '../../src/modules/audit/audit-log.js';
import {
  RATE_LIMIT_WINDOW_SECONDS,
  rateLimitFor,
} from '../../src/modules/auth/auth-rate-limit.policy.js';
import {
  expiredCutoff,
  assertLocalMaintenance,
} from '../../src/maintenance/technical-cleanup.js';
import { proxyTrust } from '../../src/config/proxy-trust.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { environment } from '../support/environment.js';
void test('request IDs serveur UUID cryptographiques et corrélation asynchrone isolée', async () => {
  const ids = Array.from({ length: 100 }, newRequestId);
  assert.equal(new Set(ids).size, 100);
  assert.ok(ids.every((id) => /^[a-f0-9-]{36}$/i.test(id)));
  const values = await Promise.all(
    ids.slice(0, 5).map((id) =>
      requestContext.run({ requestId: id }, async () => {
        await Promise.resolve();
        return logRecord({
          level: 'info',
          module: 'Http',
          event: 'http.completed',
        }).requestId;
      }),
    ),
  );
  assert.deepEqual(values, ids.slice(0, 5));
  assert.equal(
    logRecord({ level: 'info', module: 'Http', event: 'http.completed' })
      .requestId,
    undefined,
  );
});
void test('logs en liste blanche : bodies, erreurs, headers, cookies, URL/query et secrets ignorés', () => {
  const input = {
    level: 'info',
    module: 'Http',
    event: 'http.completed',
    statusCode: 401,
    durationMs: 12.456,
    method: 'POST',
    route: '/api/v1/auth/login',
    body: { password: 'private_password' },
    cookie: 'private_cookie',
    authorization: 'private_jwt',
    error: new Error('private_driver'),
    url: '/?token=private_token',
    databaseUrl: 'private_database',
  };
  const record = logRecord(input as LogInput);
  assert.equal(record.durationMs, 12.46);
  assert.ok(!JSON.stringify(record).includes('private_'));
  assert.ok(!JSON.stringify(record).includes('stack'));
  assert.equal(record.service, 'candidly-api');
  assert.equal(
    logRecord({ ...input, route: '/?token=private_token' } as LogInput).route,
    undefined,
  );
});
void test('LoggerService ne sérialise jamais les messages/arbitrary Error ni arguments', () => {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    const logger = new StructuredLogger();
    logger.error(new Error('private_stack'), 'private_password', 'Bootstrap');
    logger.log({ token: 'private_token' }, 'NestFactory');
  } finally {
    process.stdout.write = original;
  }
  assert.equal(writes.length, 2);
  assert.ok(!writes.join('').includes('private_'));
  assert.ok(
    writes.every(
      (line) =>
        typeof (JSON.parse(line) as { timestamp: string }).timestamp ===
        'string',
    ),
  );
});
void test('audit : classification, corrélation, cibles UUID et métadonnées strictement autorisées', () => {
  for (const eventType of AUDIT_EVENTS) {
    const record = auditData({ eventType });
    assert.equal(
      record.outcome,
      ['LOGIN_FAILURE', 'REFRESH_REUSE'].includes(eventType)
        ? 'FAILURE'
        : 'SUCCESS',
    );
  }
  for (const metadata of [
    { password: 'private' },
    { email: 'awa@example.com' },
    { token: 'private' },
    { reason: 'private_reason' },
    { sessionsCount: -1 },
  ])
    assert.throws(() =>
      auditData({ eventType: 'LOGIN', metadata } as AuditEvent),
    );
  assert.throws(() =>
    auditData({ eventType: 'UNKNOWN' } as unknown as AuditEvent),
  );
  assert.throws(() =>
    auditData({ eventType: 'LOGIN', actorUserId: 'private' }),
  );
  const id = randomUUID();
  requestContext.run({ requestId: id }, () =>
    assert.equal(auditData({ eventType: 'LOGIN_FAILURE' }).requestId, id),
  );
  assert.deepEqual(
    auditData({
      eventType: 'LOGIN_FAILURE',
      metadata: { reason: 'invalid_credentials' },
    }).metadata,
    { reason: 'invalid_credentials' },
  );
});
void test('échec audit secondaire : refus de login conservé et alerte sans erreur brute', async () => {
  await assert.doesNotReject(
    recordLoginFailure({
      auditLog: {
        create: () => Promise.reject(new Error('private_database_url')),
      },
    } as unknown as AuditClient),
  );
});
void test('limites réelles : 5 ou 30 / 900 secondes, proxy exact et configuration refusant trust global', () => {
  for (const route of [
    'register',
    'login',
    'resend',
    'forgot',
    'reset',
    'change',
  ])
    assert.equal(rateLimitFor(route), 5);
  for (const route of ['verify', 'refresh', 'logout'])
    assert.equal(rateLimitFor(route), 30);
  assert.equal(RATE_LIMIT_WINDOW_SECONDS, 900);
  assert.equal(proxyTrust('')('127.0.0.1'), false);
  assert.equal(proxyTrust('127.0.0.1')('::ffff:127.0.0.1'), true);
  assert.equal(proxyTrust('127.0.0.1')('127.0.0.2'), false);
  for (const patch of [
    { TRUSTED_PROXY_IP: 'true' },
    { TRUSTED_PROXY_IP: '127.0.0.0/8' },
    { HTTP_BODY_LIMIT_BYTES: '1048577' },
  ])
    assert.throws(() => validateEnvironment({ ...environment, ...patch }));
});
void test('nettoyage : échéance + 7 jours, dry-run par défaut, cible distante/prod et flags ambigus refusés', () => {
  assert.equal(
    expiredCutoff(new Date('2026-11-04T12:00:00Z')).toISOString(),
    '2026-10-28T12:00:00.000Z',
  );
  const local = {
    nodeEnv: 'test',
    databaseUrl: 'postgresql://example:example@127.0.0.1:55440/candidly_test',
  };
  assert.equal(assertLocalMaintenance(local, []), false);
  assert.equal(assertLocalMaintenance(local, ['--apply']), true);
  for (const input of [
    { ...local, nodeEnv: 'production' },
    {
      ...local,
      databaseUrl: 'postgresql://example:example@remote.example/base',
    },
  ])
    assert.throws(() => assertLocalMaintenance(input, ['--apply']));
  assert.throws(() => assertLocalMaintenance(local, ['--apply', '--dry-run']));
  assert.throws(() => assertLocalMaintenance(local, ['--force']));
});
