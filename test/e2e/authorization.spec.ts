import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { requireActor } from '../../src/common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import { hashToken } from '../../src/modules/auth/verification-token.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';
let app: INestApplication;
let server: Server;
const password = 'PhraseIsolation2026!';
const people = ['a', 'b'].map((label) => ({
  id: randomUUID(),
  firstName: 'User-' + label,
  lastName: 'Fixture',
  email: `isolation-${label}@example.com`,
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  passwordHash: '',
}));
const sessions = new Map<
  string,
  {
    id: string;
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }
>();
const seen: AuthenticatedActor[] = [];
const preferences = new Map<
  string,
  { locale: string; timezone: string; createdAt: Date; updatedAt: Date }
>(
  people.map((user) => [
    user.id,
    {
      locale: 'fr',
      timezone: 'Africa/Abidjan',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]),
);
const safe = (user: (typeof people)[number]) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  emailVerifiedAt: user.emailVerifiedAt,
  createdAt: user.createdAt,
});
const person = (actor: AuthenticatedActor) => {
  seen.push(requireActor(actor));
  return people.find((value) => value.id === actor.userId)!;
};
const users = {
  profile: (actor: AuthenticatedActor) => Promise.resolve(safe(person(actor))),
  updateProfile: (
    actor: AuthenticatedActor,
    body: { firstName?: string; lastName?: string },
  ) => {
    const user = person(actor);
    Object.assign(user, body);
    return Promise.resolve(safe(user));
  },
  preferences: (actor: AuthenticatedActor) => {
    person(actor);
    return Promise.resolve(preferences.get(actor.userId));
  },
  updatePreferences: (
    actor: AuthenticatedActor,
    body: { timezone?: string; locale?: string },
  ) => {
    person(actor);
    const value = preferences.get(actor.userId)!;
    Object.assign(value, body);
    return Promise.resolve(value);
  },
};
const sessionRepository = {
  recordLoginFailure: () => Promise.resolve(),
  findCredentials: (email: string) =>
    Promise.resolve(people.find((value) => value.email === email) ?? null),
  create: (
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
  ) => {
    const value = { id, userId, refreshTokenHash, expiresAt, revokedAt: null };
    sessions.set(id, value);
    return Promise.resolve(value);
  },
  activeUser: (sid: string, sub: string) => {
    const value = sessions.get(sid);
    const user = people.find((person) => person.id === sub);
    return Promise.resolve(
      value && value.userId === sub && !value.revokedAt && user
        ? safe(user)
        : null,
    );
  },
  revoke: (raw: string) => {
    const value = [...sessions.values()].find(
      (session) => session.refreshTokenHash === hashToken(raw),
    );
    if (value) value.revokedAt = new Date();
    return Promise.resolve();
  },
  rotate: () => Promise.resolve(null),
};
const csrf = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
let a: request.Response;
let b: request.Response;
const bearer = (response: request.Response) =>
  'Bearer ' + (response.body as { accessToken: string }).accessToken;
before(async () => {
  Object.assign(process.env, environment);
  const hash = await new PasswordService().hash(password);
  for (const user of people) user.passwordHash = hash;
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(SessionRepository)
    .useValue(sessionRepository)
    .overrideProvider(UsersRepository)
    .useValue(users)
    .overrideProvider(AuthRateLimitStore)
    .useValue({ consume: () => Promise.resolve(true) })
    .compile();
  app = module.createNestApplication({ logger: false });
  setupApplication(app);
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer() as Server;
  a = await request(server)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: people[0]!.email, password })
    .expect(200);
  b = await request(server)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: people[1]!.email, password })
    .expect(200);
});
after(async () => {
  await app?.close();
});
void test('A et B lisent leurs profils, contexte minimal serveur et identité publique compatibles', async () => {
  for (const [login, user] of [
    [a, people[0]!],
    [b, people[1]!],
  ] as const) {
    const profile = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', bearer(login))
      .expect(200);
    const identity = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', bearer(login))
      .expect(200);
    assert.equal((profile.body as { id: string }).id, user.id);
    assert.deepEqual(profile.body, identity.body);
  }
  assert.ok(
    seen.every(
      (actor) =>
        Object.isFrozen(actor) &&
        Object.keys(actor).sort().join(',') === 'sessionId,userId',
    ),
  );
});
void test('query et headers arbitraires ne changent pas le propriétaire ; body et contexte client refusés', async () => {
  const other = people[1]!;
  const read = await request(server)
    .get(`/api/v1/users/me?userId=${other.id}&sessionId=arbitrary`)
    .set('Authorization', bearer(a))
    .set('X-User-Id', other.id)
    .set('X-Session-Id', randomUUID())
    .expect(200);
  assert.equal((read.body as { id: string }).id, people[0]!.id);
  for (const body of [
    { firstName: 'stolen', userId: other.id },
    { firstName: 'stolen', id: other.id },
    { auth: { userId: other.id, sessionId: randomUUID() } },
    { currentUser: { id: other.id } },
  ])
    await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(a))
      .send(body)
      .expect(400);
  assert.equal(other.firstName, 'User-b');
});
void test('mutations et préférences concurrentes restent isolées entre A et B', async () => {
  await Promise.all([
    request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(a))
      .send({ firstName: 'Changed-A' })
      .expect(200),
    request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(b))
      .send({ firstName: 'Changed-B' })
      .expect(200),
    request(server)
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', bearer(a))
      .send({ timezone: 'Asia/Tokyo' })
      .expect(200),
    request(server)
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', bearer(b))
      .send({ timezone: 'Europe/Paris' })
      .expect(200),
  ]);
  assert.equal(people[0]!.firstName, 'Changed-A');
  assert.equal(people[1]!.firstName, 'Changed-B');
  for (const [login, timezone] of [
    [a, 'Asia/Tokyo'],
    [b, 'Europe/Paris'],
  ] as const) {
    const result = await request(server)
      .get('/api/v1/users/me/preferences')
      .set('Authorization', bearer(login))
      .expect(200);
    assert.equal((result.body as { timezone: string }).timezone, timezone);
  }
  await request(server)
    .patch('/api/v1/users/me/preferences')
    .set('Authorization', bearer(b))
    .send({ userId: people[0]!.id, timezone: 'UTC' })
    .expect(400);
  assert.equal(preferences.get(people[0]!.id)!.timezone, 'Asia/Tokyo');
});
void test('aucune route de sélection de tiers : 404 sans identité privée pour ID étranger ou inconnu', async () => {
  const results = [];
  for (const id of [people[1]!.id, randomUUID()])
    results.push(
      await request(server)
        .get('/api/v1/users/' + id)
        .set('Authorization', bearer(a))
        .expect(404),
    );
  assert.deepEqual(
    (results[0]!.body as { error: object }).error,
    (results[1]!.body as { error: object }).error,
  );
  assert.ok(
    results.every(
      (result) =>
        !JSON.stringify(result.body).includes(people[1]!.email) &&
        !JSON.stringify(result.body).includes(people[1]!.passwordHash),
    ),
  );
});
void test('JWT valide avec mauvais couple sub/sid refusé, sans effet sur les sessions légitimes', async () => {
  const sessionB = [...sessions.values()].find(
    (value) => value.userId === people[1]!.id,
  )!;
  const forged = await app
    .get(AccessTokenService)
    .sign(people[0]!.id, sessionB.id, sessionB.expiresAt);
  const result = await request(server)
    .get('/api/v1/users/me')
    .set('Authorization', 'Bearer ' + forged)
    .expect(401);
  assert.ok(!JSON.stringify(result.body).includes(people[1]!.email));
  await request(server)
    .get('/api/v1/users/me')
    .set('Authorization', bearer(b))
    .expect(200);
});
void test('logout authentifié par cookie A révoque seulement A, même avec bearer/header ciblant B', async () => {
  const cookieA = (a.headers['set-cookie'] as unknown as string[])[0]!.split(
    ';',
  )[0]!;
  await request(server)
    .post('/api/v1/auth/logout')
    .set(csrf)
    .set('Cookie', cookieA)
    .set('Authorization', bearer(b))
    .set('X-User-Id', people[1]!.id)
    .expect(204);
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', bearer(a))
    .expect(401);
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', bearer(b))
    .expect(200);
});
