import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { SessionService } from '../../src/modules/auth/session.service.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { PasswordRecoveryRepository } from '../../src/modules/auth/password-recovery.repository.js';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { writeAudit } from '../../src/modules/audit/audit-log.js';
import { requestContext } from '../../src/common/observability/request-context.js';
import {
  createVerificationToken,
  hashToken,
} from '../../src/modules/auth/verification-token.js';
import { cleanupTechnicalData } from '../../src/maintenance/technical-cleanup.js';
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Base de test locale explicite obligatoire.');
const url = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')
)
  throw new Error('Base locale dédiée obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const passwords = new PasswordService();
const auth = new AuthRepository(prisma, config);
const repository = new SessionRepository(prisma);
const tokens = new AccessTokenService(config);
const sessions = new SessionService(repository, passwords, tokens, config);
const recovery = new PasswordRecoveryService(
  new PasswordRecoveryRepository(prisma, config),
  passwords,
);
const rate = new AuthRateLimitStore(config);
const emails: string[] = [];
const ids: string[] = [];
const prefix = 'cand010-' + randomUUID();
const password = 'PhraseAudit2026!';
let passwordHash: string;
async function fixture(label: string) {
  const email = `${prefix}-${label}@example.com`;
  emails.push(email);
  const user = await prisma.user.create({
    data: {
      email,
      firstName: 'Awa',
      lastName: 'Kouassi',
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });
  ids.push(user.id);
  return user;
}
before(async () => {
  await prisma.onModuleInit();
  passwordHash = await passwords.hash(password);
  await passwords.onModuleInit();
});
after(async () => {
  rate.onModuleDestroy();
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.onModuleDestroy();
});
void test('audit atomique : inscription, vérification, login, rejeu, logout et révocations persistés sans secrets', async () => {
  const email = `${prefix}-registered@example.com`;
  emails.push(email);
  const requestId = randomUUID();
  await requestContext.run({ requestId }, () =>
    auth.register(
      { email, firstName: 'Awa', lastName: 'Kouassi', password },
      passwordHash,
    ),
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  ids.push(user.id);
  const token = createVerificationToken(86400);
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
    },
  });
  assert.ok(await auth.verify(token.raw));
  const login = await sessions.login({ email, password });
  const rotated = await sessions.refresh(login.refresh);
  await assert.rejects(sessions.refresh(login.refresh), { status: 401 });
  await assert.rejects(sessions.refresh(rotated.refresh), { status: 401 });
  const second = await sessions.login({ email, password });
  await sessions.logout(second.refresh);
  await sessions.logout(second.refresh);
  const records = await prisma.auditLog.findMany({
    where: { OR: [{ actorUserId: user.id }, { targetId: user.id }] },
  });
  const types = records.map((row) => row.eventType);
  for (const event of [
    'REGISTER',
    'EMAIL_VERIFIED',
    'LOGIN',
    'REFRESH_REUSE',
    'LOGOUT',
    'SESSIONS_REVOKED',
  ])
    assert.ok(types.includes(event));
  assert.equal(types.filter((event) => event === 'LOGOUT').length, 1);
  assert.equal(
    records.find((row) => row.eventType === 'REGISTER')!.requestId,
    requestId,
  );
  const serialized = JSON.stringify(records);
  for (const secret of [
    email,
    password,
    passwordHash,
    token.raw,
    login.refresh,
    login.body.accessToken,
  ])
    assert.ok(!serialized.includes(secret));
});
void test('échecs login pertinents : audits anonymes identiques pour inconnu, password incorrect et non vérifié', async () => {
  const user = await fixture('failures');
  const requestId = randomUUID();
  await requestContext.run({ requestId }, async () => {
    await assert.rejects(
      sessions.login({ email: user.email, password: 'IncorrectPassword2026!' }),
      { status: 401 },
    );
    await assert.rejects(
      sessions.login({ email: `${prefix}-unknown@example.com`, password }),
      { status: 401 },
    );
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: null },
    });
    await assert.rejects(sessions.login({ email: user.email, password }), {
      status: 401,
    });
  });
  const records = await prisma.auditLog.findMany({ where: { requestId } });
  assert.equal(records.length, 3);
  for (const row of records) {
    assert.equal(row.actorUserId, null);
    assert.equal(row.targetId, null);
    assert.equal(row.eventType, 'LOGIN_FAILURE');
    assert.deepEqual(row.metadata, { reason: 'invalid_credentials' });
  }
});
void test('échec écriture audit : rollback réel de la mutation et maintien du token/sessions', async () => {
  const user = await fixture('rollback');
  const login = await sessions.login({ email: user.email, password });
  const raw = createVerificationToken(1800);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: raw.hash, expiresAt: raw.expiresAt },
  });
  // Extension Prisma locale au test : seule l'insertion audit échoue, les transactions restent réelles.
  const broken = prisma.$extends({
    query: {
      auditLog: {
        create() {
          return Promise.reject(new Error('private_audit_driver'));
        },
      },
    },
  });
  const brokenRecovery = new PasswordRecoveryRepository(
    broken as unknown as PrismaService,
    config,
  );
  await assert.rejects(
    brokenRecovery.reset(
      raw.raw,
      await passwords.hash('NouveauMotDePasse2026!'),
    ),
  );
  assert.ok(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .passwordHash === passwordHash,
  );
  assert.equal(
    (
      await prisma.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: raw.hash },
      })
    ).consumedAt,
    null,
  );
  const claims = await tokens.verify(login.body.accessToken);
  assert.ok(await repository.activeUser(claims.sid, user.id));
  const email = `${prefix}-rollback-register@example.com`;
  emails.push(email);
  await assert.rejects(
    new AuthRepository(broken as unknown as PrismaService, config).register(
      { email, firstName: 'Awa', lastName: 'Kouassi', password },
      passwordHash,
    ),
  );
  assert.equal(await prisma.user.count({ where: { email } }), 0);
});
void test('changement/reset : audit et révocation atomiques ; suppression User conserve l’historique', async () => {
  const user = await fixture('password');
  await sessions.login({ email: user.email, password });
  await recovery.change(user.id, password, 'NouveauMotDePasse2026!');
  const raw = createVerificationToken(1800);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: raw.hash, expiresAt: raw.expiresAt },
  });
  await recovery.reset(raw.raw, password);
  const records = await prisma.auditLog.findMany({
    where: { targetId: user.id },
  });
  assert.ok(records.some((row) => row.eventType === 'PASSWORD_CHANGED'));
  assert.ok(records.some((row) => row.eventType === 'PASSWORD_RESET'));
  assert.ok(
    records.filter((row) => row.eventType === 'SESSIONS_REVOKED').length >= 2,
  );
  const loginAudit = await prisma.auditLog.findFirstOrThrow({
    where: { actorUserId: user.id, eventType: 'LOGIN' },
  });
  await prisma.user.delete({ where: { id: user.id } });
  const kept = await prisma.auditLog.findUniqueOrThrow({
    where: { id: loginAudit.id },
  });
  assert.equal(kept.actorUserId, null);
  assert.ok(kept.targetId);
});
void test('maintenance : dry-run, expiration+conservation, cascade refresh et audits jamais supprimés', async () => {
  const user = await fixture('cleanup');
  const now = new Date('1960-01-08T00:00:00Z');
  const old = new Date('1959-01-01T00:00:00Z');
  const valid = new Date('1961-01-01T00:00:00Z');
  const oldSession = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(randomUUID()),
      expiresAt: old,
    },
  });
  const active = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashToken(randomUUID()),
      expiresAt: valid,
    },
  });
  await prisma.sessionRefreshToken.createMany({
    data: [
      { sessionId: oldSession.id, tokenHash: hashToken(randomUUID()) },
      { sessionId: active.id, tokenHash: hashToken(randomUUID()) },
    ],
  });
  for (const expiresAt of [old, valid]) {
    await prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashToken(randomUUID()), expiresAt },
    });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(randomUUID()), expiresAt },
    });
  }
  await writeAudit(prisma, {
    eventType: 'LOGIN',
    actorUserId: user.id,
    targetType: 'SESSION',
    targetId: oldSession.id,
  });
  const before = await prisma.auditLog.count({
    where: { actorUserId: user.id },
  });
  const dry = await cleanupTechnicalData(prisma, false, now);
  assert.equal(dry.sessions, 1);
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 2);
  const applied = await cleanupTechnicalData(prisma, true, now);
  assert.equal(applied.sessions, 1);
  assert.equal(applied.verificationTokens, 1);
  assert.equal(applied.resetTokens, 1);
  assert.equal(
    await prisma.sessionRefreshToken.count({
      where: { sessionId: oldSession.id },
    }),
    0,
  );
  assert.equal(
    await prisma.sessionRefreshToken.count({ where: { sessionId: active.id } }),
    1,
  );
  assert.equal(
    await prisma.auditLog.count({ where: { actorUserId: user.id } }),
    before,
  );
  const repeat = await cleanupTechnicalData(prisma, true, now);
  assert.equal(
    repeat.sessions + repeat.verificationTokens + repeat.resetTokens,
    0,
  );
  assert.equal(
    await prisma.passwordResetToken.count({ where: { userId: user.id } }),
    1,
  );
});
void test('HTTP réel : request ID et audit login/failure/password/reset/révocation corrélés, pas de route audit privée', async () => {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { setupApplication } =
    await import('../../src/config/setup-application.js');
  Object.assign(process.env, { DATABASE_URL: databaseUrl });
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuthRateLimitStore)
    .useValue({
      consume: (route: string, address: string, limit: number) =>
        rate.consume(prefix + route, address, limit),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  setupApplication(app);
  try {
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as import('node:http').Server;
    const user = await fixture('http');
    const csrf = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
    const failed = await request(server)
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: user.email, password: 'IncorrectPassword2026!' })
      .expect(401);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          requestId: String(failed.headers['x-request-id']),
          eventType: 'LOGIN_FAILURE',
          actorUserId: null,
          targetId: null,
        },
      }),
      1,
    );
    const login = await request(server)
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: user.email, password })
      .expect(200);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          requestId: String(login.headers['x-request-id']),
          eventType: 'LOGIN',
          actorUserId: user.id,
        },
      }),
      1,
    );
    await request(server)
      .get('/api/v1/audit')
      .set(
        'Authorization',
        'Bearer ' + (login.body as { accessToken: string }).accessToken,
      )
      .expect(404);
    const changed = await request(server)
      .post('/api/v1/auth/change-password')
      .set(csrf)
      .set(
        'Authorization',
        'Bearer ' + (login.body as { accessToken: string }).accessToken,
      )
      .send({
        currentPassword: password,
        newPassword: 'NouveauMotDePasse2026!',
      })
      .expect(200);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          requestId: String(changed.headers['x-request-id']),
          eventType: 'PASSWORD_CHANGED',
        },
      }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: {
          requestId: String(changed.headers['x-request-id']),
          eventType: 'SESSIONS_REVOKED',
        },
      }),
      1,
    );
    const raw = createVerificationToken(1800);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: raw.hash, expiresAt: raw.expiresAt },
    });
    const reset = await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw.raw, newPassword: password })
      .expect(200);
    assert.equal(
      await prisma.auditLog.count({
        where: {
          requestId: String(reset.headers['x-request-id']),
          eventType: 'PASSWORD_RESET',
        },
      }),
      1,
    );
    const records = await prisma.auditLog.findMany({
      where: { targetId: user.id },
    });
    assert.ok(!JSON.stringify(records).includes(user.email));
  } finally {
    await app.close();
  }
});
