import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { VerificationDeliveryService } from '../../src/modules/auth/verification-delivery.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import {
  createVerificationToken,
  hashToken,
} from '../../src/modules/auth/verification-token.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import type { VerificationEmail } from '../../src/integrations/email/email.transport.js';
import { verify } from 'argon2';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error(
    'Définir NODE_ENV=test et INTEGRATION_DATABASE_URL locale dédiée.',
  );
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('Base locale dédiée avec suffixe _test obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const repository = new AuthRepository(prisma, config);
const passwords = new PasswordService();
const auth = new AuthService(repository, passwords);
const messages: VerificationEmail[] = [];
let failSend = false;
const transport = {
  send(message: VerificationEmail): Promise<void> {
    if (failSend) return Promise.reject(new Error('private_transport_secret'));
    messages.push(message);
    return Promise.resolve();
  },
};
const delivery = new VerificationDeliveryService(prisma, config, transport);
const rateStore = new AuthRateLimitStore(config);
const prefix = 'cand006-' + randomUUID();
const emails: string[] = [];
const input = (label: string) => {
  const email = `${prefix}-${label}@example.com`;
  emails.push(email);
  return {
    email,
    firstName: 'Awa',
    lastName: 'Kouassi',
    password: 'MotDePasseFort2026!',
  };
};
function rawFor(email: string): string {
  const message = messages.findLast((value) => value.to === email);
  assert.ok(message);
  const match = message.text.match(/http[^\s]+/);
  assert.ok(match);
  const raw = new URLSearchParams(new URL(match[0]).hash.slice(1)).get('token');
  assert.ok(raw);
  return raw;
}
before(async () => {
  await prisma.onModuleInit();
});
after(async () => {
  await delivery.onModuleDestroy();
  rateStore.onModuleDestroy();
  // Uniquement les fixtures de cette exécution ; aucune troncature ni suppression globale.
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.onModuleDestroy();
});
void test('inscription réelle : données attendues, Argon2id, token uniquement hashé, vérification unique', async () => {
  const body = input('register');
  await auth.register(body);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  assert.equal(user.firstName, body.firstName);
  assert.equal(user.emailVerifiedAt, null);
  assert.ok(await verify(user.passwordHash, body.password));
  assert.ok(user.verificationRequestedAt);
  await delivery.runPending();
  const raw = rawFor(body.email);
  const token = await prisma.emailVerificationToken.findUniqueOrThrow({
    where: { tokenHash: hashToken(raw) },
  });
  assert.equal(token.userId, user.id);
  assert.notEqual(token.tokenHash, raw);
  assert.ok(
    Math.abs(token.expiresAt.getTime() - token.createdAt.getTime() - 86400000) <
      10000,
  );
  assert.equal(await repository.verify(raw), true);
  assert.equal(await repository.verify(raw), false);
  const verified = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });
  assert.ok(verified.emailVerifiedAt);
  assert.equal(verified.verificationRequestedAt, null);
});
void test('inscriptions concurrentes et contrainte SQL : un seul email normalisé, aucun écrasement', async () => {
  const body = input('duplicate');
  const results = await Promise.all([
    auth.register(body),
    auth.register({ ...body, firstName: 'Autre' }),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(await prisma.user.count({ where: { email: body.email } }), 1);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  await assert.rejects(
    prisma.user.create({
      data: {
        email: body.email.toUpperCase(),
        firstName: 'Awa',
        lastName: 'Kouassi',
        passwordHash: user.passwordHash,
      },
    }),
  );
  await assert.rejects(
    prisma.user.create({
      data: {
        email: body.email,
        firstName: 'Awa',
        lastName: 'Kouassi',
        passwordHash: user.passwordHash,
      },
    }),
  );
});
void test('tokens expirés et inconnus refusés sans mutation utilisateur', async () => {
  const body = input('expired');
  await auth.register(body);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  const expired = createVerificationToken(1, new Date(Date.now() - 10000));
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: expired.hash,
      expiresAt: expired.expiresAt,
    },
  });
  assert.equal(await repository.verify(expired.raw), false);
  assert.equal(await repository.verify(createVerificationToken(60).raw), false);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerifiedAt,
    null,
  );
});
void test('vérifications concurrentes : un seul succès, tous les tokens actifs consommés', async () => {
  const body = input('concurrent');
  await auth.register(body);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  const tokens = [createVerificationToken(60), createVerificationToken(60)];
  for (const token of tokens)
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: token.hash,
        expiresAt: token.expiresAt,
      },
    });
  const results = await Promise.all([
    repository.verify(tokens[0]!.raw),
    repository.verify(tokens[1]!.raw),
    repository.verify(tokens[0]!.raw),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    await prisma.emailVerificationToken.count({
      where: { userId: user.id, consumedAt: null },
    }),
    0,
  );
});
void test('panne transport : rollback du token, demande durable et reprise avec un nouveau worker', async () => {
  const body = input('retry');
  await auth.register(body);
  failSend = true;
  try {
    await delivery.runPending();
  } finally {
    failSend = false;
  }
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  assert.ok(user.verificationRequestedAt);
  assert.equal(
    await prisma.emailVerificationToken.count({ where: { userId: user.id } }),
    0,
  );
  const restarted = new VerificationDeliveryService(prisma, config, transport);
  try {
    await restarted.runPending();
  } finally {
    await restarted.onModuleDestroy();
  }
  assert.equal(await repository.verify(rawFor(body.email)), true);
});
void test('renvoi : cooldown, remplacement après succès, ancien token préservé sur échec, aucune demande pour vérifié/inconnu', async () => {
  const body = input('resend');
  await auth.register(body);
  await delivery.runPending();
  const firstRaw = rawFor(body.email);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: body.email },
  });
  await repository.requestVerification(body.email);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .verificationRequestedAt,
    null,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationLastRequestedAt: new Date(0) },
  });
  await Promise.all([
    repository.requestVerification(body.email),
    repository.requestVerification(body.email),
  ]);
  failSend = true;
  try {
    await delivery.runPending();
  } finally {
    failSend = false;
  }
  const oldToken = await prisma.emailVerificationToken.findUniqueOrThrow({
    where: { tokenHash: hashToken(firstRaw) },
  });
  assert.equal(oldToken.consumedAt, null);
  await delivery.runPending();
  const secondRaw = rawFor(body.email);
  assert.notEqual(firstRaw, secondRaw);
  assert.equal(await repository.verify(firstRaw), false);
  assert.equal(await repository.verify(secondRaw), true);
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationLastRequestedAt: new Date(0) },
  });
  const a = await auth.resend(body.email);
  const b = await auth.resend('unknown@example.com');
  assert.deepEqual(a, b);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .verificationRequestedAt,
    null,
  );
});
void test('envois concurrents : une seule préparation et aucun token actif après vérification', async () => {
  const body = input('parallel-delivery');
  await auth.register(body);
  const other = new VerificationDeliveryService(prisma, config, transport);
  try {
    await Promise.all([delivery.runPending(), other.runPending()]);
  } finally {
    await other.onModuleDestroy();
  }
  assert.equal(messages.filter((value) => value.to === body.email).length, 1);
  assert.equal(await repository.verify(rawFor(body.email)), true);
});
void test('limitation Redis réelle atomique : seuil partagé et panne fermée', async () => {
  const address = 'fixture-' + randomUUID();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      rateStore.consume('integration', address, 5),
    ),
  );
  assert.equal(results.filter(Boolean).length, 5);
  const unavailable = new AuthRateLimitStore(
    new ConfigService({ REDIS_HOST: '127.0.0.1', REDIS_PORT: 1 }),
  );
  try {
    await assert.rejects(unavailable.consume('integration', address, 5), {
      status: 503,
    });
  } finally {
    unavailable.onModuleDestroy();
  }
});

void test('parcours HTTP réel PostgreSQL/Redis : inscription, email, vérification, renvoi et limite effective', async () => {
  const { Test } = await import('@nestjs/testing');
  const { setupApplication } =
    await import('../../src/config/setup-application.js');
  const { EmailTransport } =
    await import('../../src/integrations/email/email.transport.js');
  const { default: request } = await import('supertest');
  Object.assign(process.env, { DATABASE_URL: databaseUrl });
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuthRateLimitStore)
    .useValue({
      consume: (route: string, address: string, limit: number) =>
        rateStore.consume(prefix + route, address, limit),
    })
    .overrideProvider(EmailTransport)
    .useValue(transport)
    .compile();
  const app = module.createNestApplication({ logger: false });
  setupApplication(app);
  try {
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as import('node:http').Server;
    const body = input('http');
    const first = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...body, email: ' ' + body.email.toUpperCase() + ' ' })
      .expect(202);
    const duplicate = await request(server)
      .post('/api/v1/auth/register')
      .send(body)
      .expect(202);
    assert.deepEqual(first.body, duplicate.body);
    assert.equal(first.headers['set-cookie'], undefined);
    await app.get(VerificationDeliveryService).runPending();
    const token = rawFor(body.email);
    const verified = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(200);
    assert.deepEqual(Object.keys(verified.body as object).sort(), [
      'message',
      'success',
    ]);
    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);
    const a = await request(server)
      .post('/api/v1/auth/resend-verification')
      .send({ email: body.email })
      .expect(202);
    const b = await request(server)
      .post('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@example.com' })
      .expect(202);
    assert.deepEqual(a.body, b.body);
    for (let i = 0; i < 3; i++)
      await request(server)
        .post('/api/v1/auth/register')
        .send({ ...body, password: 'bad' })
        .expect(400);
    await request(server).post('/api/v1/auth/register').send(body).expect(429);
  } finally {
    await app.close();
  }
});
