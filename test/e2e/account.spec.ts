import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { PasswordRecoveryRepository } from '../../src/modules/auth/password-recovery.repository.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  hashToken,
  createVerificationToken,
} from '../../src/modules/auth/verification-token.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';
let app: INestApplication;
let server: Server;
let allowed = true;
const original = 'AncienMotDePasse2026!';
const changed = 'NouveauMotDePasse2026!';
const resetPassword = 'ResetMotDePasse2026!';
const people = [0, 1].map((index) => ({
  id: randomUUID(),
  email: `account-${index}@example.com`,
  firstName: 'Awa',
  lastName: 'Kouassi',
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  passwordHash: '',
}));
const sessions = new Map<
  string,
  { userId: string; active: boolean; expiresAt: Date }
>();
const tokens = new Map<
  string,
  { userId: string; expiresAt: Date; consumed: boolean }
>();
const preferences = new Map<
  string,
  { locale: string; timezone: string; createdAt: Date; updatedAt: Date }
>();
const headers = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
const publicUser = (user: (typeof people)[number]) => ({
  id: user.id,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});
function revoke(userId: string) {
  for (const session of sessions.values())
    if (session.userId === userId) session.active = false;
  for (const token of tokens.values())
    if (token.userId === userId) token.consumed = true;
}
function tokenFor(userId: string, expired = false) {
  const token = createVerificationToken(1800);
  tokens.set(hashToken(token.raw), {
    userId,
    expiresAt: expired ? new Date(0) : token.expiresAt,
    consumed: false,
  });
  return token.raw;
}
const sessionRepository = {
  recordLoginFailure: () => Promise.resolve(),
  findCredentials: (email: string) =>
    Promise.resolve(people.find((user) => user.email === email) ?? null),
  create: (id: string, userId: string, _hash: string, expiresAt: Date) => {
    sessions.set(id, { userId, expiresAt, active: true });
    return Promise.resolve();
  },
  activeUser: (sid: string, sub: string) => {
    const session = sessions.get(sid);
    const user = people.find((value) => value.id === sub);
    return Promise.resolve(
      session?.active && session.userId === sub && user
        ? publicUser(user)
        : null,
    );
  },
  rotate: () => Promise.resolve(null),
};
const recoveryRepository = {
  credentials: (id: string) =>
    Promise.resolve(people.find((user) => user.id === id) ?? null),
  request: () => Promise.resolve(),
  change: (id: string, expected: string, hash: string) => {
    const user = people.find((value) => value.id === id);
    if (!user || user.passwordHash !== expected) return Promise.resolve(false);
    user.passwordHash = hash;
    revoke(id);
    return Promise.resolve(true);
  },
  reset: (raw: string, hash: string) => {
    const token = tokens.get(hashToken(raw));
    if (!token || token.consumed || token.expiresAt <= new Date())
      return Promise.resolve(false);
    people.find((user) => user.id === token.userId)!.passwordHash = hash;
    revoke(token.userId);
    return Promise.resolve(true);
  },
};
const usersRepository = {
  profile: (actor: AuthenticatedActor) =>
    Promise.resolve(
      publicUser(people.find((user) => user.id === actor.userId)!),
    ),
  updateProfile: (
    actor: AuthenticatedActor,
    body: { firstName?: string; lastName?: string },
  ) => {
    const user = people.find((value) => value.id === actor.userId)!;
    Object.assign(user, body);
    return Promise.resolve(publicUser(user));
  },
  preferences: (actor: AuthenticatedActor) => {
    const value = preferences.get(actor.userId) ?? {
      locale: 'fr',
      timezone: 'Africa/Abidjan',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    preferences.set(actor.userId, value);
    return Promise.resolve(value);
  },
  updatePreferences: async (
    actor: AuthenticatedActor,
    body: { locale?: string; timezone?: string },
  ) => {
    const value = await usersRepository.preferences(actor);
    Object.assign(value, body);
    return value;
  },
};
async function login(index = 0, password = original) {
  return request(server)
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email: people[index]!.email, password })
    .expect(200);
}
const bearer = (result: request.Response) =>
  'Bearer ' + (result.body as { accessToken: string }).accessToken;
before(async () => {
  Object.assign(process.env, environment);
  const hash = await new PasswordService().hash(original);
  for (const user of people) user.passwordHash = hash;
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(SessionRepository)
    .useValue(sessionRepository)
    .overrideProvider(PasswordRecoveryRepository)
    .useValue(recoveryRepository)
    .overrideProvider(UsersRepository)
    .useValue(usersRepository)
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
void test('profil : lecture, modification limitée à soi, champs inconnus et absence d’authentification refusés', async () => {
  const a = await login();
  const b = await login(1);
  await request(server).get('/api/v1/users/me').expect(401);
  await request(server)
    .patch('/api/v1/users/me')
    .send({ firstName: 'forged' })
    .expect(401);
  const profile = await request(server)
    .get('/api/v1/users/me')
    .set('Authorization', bearer(a))
    .expect(200);
  assert.deepEqual(Object.keys(profile.body as object).sort(), [
    'createdAt',
    'email',
    'emailVerifiedAt',
    'firstName',
    'id',
    'lastName',
  ]);
  const updated = await request(server)
    .patch('/api/v1/users/me')
    .set('Authorization', bearer(a))
    .send({ firstName: ' Fatou ' })
    .expect(200);
  assert.equal((updated.body as { firstName: string }).firstName, 'Fatou');
  const other = await request(server)
    .get('/api/v1/users/me')
    .set('Authorization', bearer(b))
    .expect(200);
  assert.equal((other.body as { firstName: string }).firstName, 'Awa');
  for (const body of [
    { email: people[1]!.email },
    { userId: people[1]!.id },
    { firstName: null },
    {},
  ])
    await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(a))
      .send(body)
      .expect(400);
});
void test('préférences : défauts persistants, fuseau mondial et validation', async () => {
  const auth = bearer(await login());
  const defaults = await request(server)
    .get('/api/v1/users/me/preferences')
    .set('Authorization', auth)
    .expect(200);
  assert.equal(
    (defaults.body as { timezone: string }).timezone,
    'Africa/Abidjan',
  );
  await request(server)
    .patch('/api/v1/users/me/preferences')
    .set('Authorization', auth)
    .send({ timezone: 'America/New_York', locale: 'fr' })
    .expect(200);
  const read = await request(server)
    .get('/api/v1/users/me/preferences')
    .set('Authorization', auth)
    .expect(200);
  assert.equal(
    (read.body as { timezone: string }).timezone,
    'America/New_York',
  );
  for (const body of [
    { timezone: 'invalid' },
    { locale: 'xx' },
    { userId: people[1]!.id },
    {},
  ])
    await request(server)
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', auth)
      .send(body)
      .expect(400);
});
void test('changement : ancien password refusé, CSRF appliqué, toutes sessions révoquées et cookie effacé', async () => {
  const a = await login();
  const second = await login();
  await request(server)
    .post('/api/v1/auth/change-password')
    .set(headers)
    .set('Authorization', bearer(a))
    .send({ currentPassword: 'IncorrectPassword2026!', newPassword: changed })
    .expect(401);
  await request(server)
    .post('/api/v1/auth/change-password')
    .set('Authorization', bearer(a))
    .send({ currentPassword: original, newPassword: changed })
    .expect(403);
  const result = await request(server)
    .post('/api/v1/auth/change-password')
    .set(headers)
    .set('Authorization', bearer(a))
    .send({ currentPassword: original, newPassword: changed })
    .expect(200);
  assert.match(
    String(result.headers['set-cookie']),
    /Expires=Thu, 01 Jan 1970/,
  );
  for (const session of [a, second])
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', bearer(session))
      .expect(401);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(headers)
    .set(
      'Cookie',
      (a.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
    )
    .expect(401);
  await request(server)
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email: people[0]!.email, password: original })
    .expect(401);
  await login(0, changed);
});
void test('forgot : réponse publique identique pour compte connu et inconnu, sans token', async () => {
  const a = await request(server)
    .post('/api/v1/auth/forgot-password')
    .send({ email: ' ' + people[0]!.email.toUpperCase() + ' ' })
    .expect(202);
  const b = await request(server)
    .post('/api/v1/auth/forgot-password')
    .send({ email: 'unknown@example.com' })
    .expect(202);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(Object.keys(a.body as object).sort(), [
    'message',
    'success',
  ]);
});
void test('reset : inconnu/expiré/consommé refusés, succès révoque sessions et nouveau password utilisable', async () => {
  const previous = await login(0, changed);
  const raw = tokenFor(people[0]!.id);
  const expired = tokenFor(people[0]!.id, true);
  for (const token of [expired, createVerificationToken(1800).raw])
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: resetPassword })
      .expect(400);
  const result = await request(server)
    .post('/api/v1/auth/reset-password')
    .send({ token: raw, newPassword: resetPassword })
    .expect(200);
  assert.deepEqual(Object.keys(result.body as object).sort(), [
    'message',
    'success',
  ]);
  await request(server)
    .post('/api/v1/auth/reset-password')
    .send({ token: raw, newPassword: changed })
    .expect(400);
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', bearer(previous))
    .expect(401);
  await request(server)
    .post('/api/v1/auth/login')
    .set(headers)
    .send({ email: people[0]!.email, password: changed })
    .expect(401);
  await login(0, resetPassword);
});
void test('débit Redis guard et Swagger des sept routes', async () => {
  allowed = false;
  try {
    for (const route of [
      'forgot-password',
      'reset-password',
      'change-password',
    ])
      await request(server)
        .post('/api/v1/auth/' + route)
        .send({})
        .expect(429);
  } finally {
    allowed = true;
  }
  const response = await request(server).get('/docs-json').expect(200);
  const doc = response.body as {
    paths: Record<string, Record<string, unknown>>;
  };
  for (const [path, method] of [
    ['/users/me', 'get'],
    ['/users/me', 'patch'],
    ['/users/me/preferences', 'get'],
    ['/users/me/preferences', 'patch'],
    ['/auth/change-password', 'post'],
    ['/auth/forgot-password', 'post'],
    ['/auth/reset-password', 'post'],
  ])
    assert.ok(doc.paths['/api/v1' + path!]?.[method!]);
});
