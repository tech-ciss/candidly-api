import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { createVerificationToken } from '../../src/modules/auth/verification-token.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';

let app: INestApplication;
let server: Server;
let allowed = true;
const users = new Map<
  string,
  { verified: boolean; token: string; expiresAt: Date }
>();
const input = {
  firstName: 'Awa',
  lastName: 'Kouassi',
  email: 'awa@example.com',
  password: 'MotDePasseFort2026!',
};
let registrations = 0;
const repository = {
  register(body: typeof input): Promise<void> {
    if (!users.has(body.email)) {
      const token = createVerificationToken(86400);
      users.set(body.email, {
        verified: false,
        token: token.raw,
        expiresAt: token.expiresAt,
      });
      registrations++;
    }
    return Promise.resolve();
  },
  verify(token: string): Promise<boolean> {
    const user = [...users.values()].find((value) => value.token === token);
    if (!user || user.verified || user.expiresAt <= new Date())
      return Promise.resolve(false);
    user.verified = true;
    return Promise.resolve(true);
  },
  requestVerification(): Promise<void> {
    return Promise.resolve();
  },
};
before(async () => {
  Object.assign(process.env, environment);
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(AuthRepository)
    .useValue(repository)
    .overrideProvider(AuthRateLimitStore)
    .useValue({ consume: () => Promise.resolve(allowed) })
    .compile();
  app = module.createNestApplication({ logger: false });
  setupApplication(app);
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer() as Server;
});
after(async () => {
  await app?.close();
});
void test('inscription valide et doublon normalisé : même réponse publique sans secret ni session', async () => {
  const first = await request(server)
    .post('/api/v1/auth/register')
    .send(input)
    .expect(202);
  const duplicate = await request(server)
    .post('/api/v1/auth/register')
    .send({ ...input, email: ' AWA@EXAMPLE.COM ' })
    .expect(202);
  assert.deepEqual(first.body, duplicate.body);
  assert.equal(registrations, 1);
  assert.deepEqual(Object.keys(first.body as object).sort(), [
    'message',
    'success',
  ]);
  assert.equal(first.headers['set-cookie'], undefined);
  assert.ok(!JSON.stringify(first.body).includes(input.password));
});
void test('inscription invalide et champs inconnus refusés', async () => {
  for (const extra of [
    { password: 'short' },
    { firstName: ' ' },
    { email: 'invalid' },
    { userId: 'forged' },
  ])
    await request(server)
      .post('/api/v1/auth/register')
      .send({ ...input, ...extra })
      .expect(400);
});
void test('vérification valide puis répétée, inconnue et expirée', async () => {
  const user = users.get(input.email)!;
  await request(server)
    .post('/api/v1/auth/verify-email')
    .send({ token: user.token })
    .expect(200);
  await request(server)
    .post('/api/v1/auth/verify-email')
    .send({ token: user.token })
    .expect(400);
  await request(server)
    .post('/api/v1/auth/verify-email')
    .send({ token: 'x'.repeat(43) })
    .expect(400);
  user.verified = false;
  user.expiresAt = new Date(0);
  await request(server)
    .post('/api/v1/auth/verify-email')
    .send({ token: user.token })
    .expect(400);
});
void test('renvoi : réponse identique pour inconnu, non vérifié et vérifié', async () => {
  const a = await request(server)
    .post('/api/v1/auth/resend-verification')
    .send({ email: 'unknown@example.com' })
    .expect(202);
  const b = await request(server)
    .post('/api/v1/auth/resend-verification')
    .send({ email: input.email })
    .expect(202);
  users.get(input.email)!.verified = true;
  const c = await request(server)
    .post('/api/v1/auth/resend-verification')
    .send({ email: input.email })
    .expect(202);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(b.body, c.body);
});
void test('rate limiting des trois routes et Retry-After', async () => {
  allowed = false;
  try {
    for (const [route, body] of [
      ['register', input],
      ['verify-email', { token: 'x'.repeat(43) }],
      ['resend-verification', { email: input.email }],
    ] as const) {
      const result = await request(server)
        .post('/api/v1/auth/' + route)
        .send(body)
        .expect(429);
      assert.equal(result.headers['retry-after'], '900');
    }
  } finally {
    allowed = true;
  }
});
void test('Swagger décrit les DTO et les principales erreurs des trois endpoints', async () => {
  const result = await request(server).get('/docs-json').expect(200);
  const doc = result.body as {
    paths: Record<
      string,
      { post: { responses: Record<string, unknown>; requestBody: unknown } }
    >;
  };
  for (const route of ['register', 'verify-email', 'resend-verification']) {
    const operation = doc.paths['/api/v1/auth/' + route]!.post;
    assert.ok(operation.requestBody);
    for (const status of [
      '400',
      '429',
      '503',
      route === 'verify-email' ? '200' : '202',
    ])
      assert.ok(operation.responses[status]);
  }
});
