import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import {
  SessionService,
  createRefreshToken,
} from '../../src/modules/auth/session.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { actorFromVerifiedSession } from '../../src/common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import {
  ownerWhere,
  ownedIdWhere,
  privateResource,
  requireAffected,
} from '../../src/common/authorization/ownership.js';
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Base de test locale explicite obligatoire.');
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('Base localhost dédiée _test obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const users = new UsersRepository(prisma);
const repository = new SessionRepository(prisma);
const passwords = new PasswordService();
const tokens = new AccessTokenService(config);
const sessions = new SessionService(repository, passwords, tokens, config);
const rate = new AuthRateLimitStore(config);
const emails: string[] = [];
const prefix = 'cand009-' + randomUUID();
const password = 'PhraseIsolation2026!';
let a: AuthenticatedActor;
let b: AuthenticatedActor;
before(async () => {
  await prisma.onModuleInit();
  const passwordHash = await passwords.hash(password);
  await passwords.onModuleInit();
  const actors = [];
  for (const label of ['a', 'b']) {
    const email = `${prefix}-${label}@example.com`;
    emails.push(email);
    await prisma.user.create({
      data: {
        email,
        firstName: 'User-' + label,
        lastName: 'Fixture',
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    const login = await sessions.login({ email, password });
    const claims = await tokens.verify(login.body.accessToken);
    assert.ok(await repository.activeUser(claims.sid, claims.sub));
    actors.push(actorFromVerifiedSession(claims.sub, claims.sid));
  }
  a = actors[0]!;
  b = actors[1]!;
});
after(async () => {
  rate.onModuleDestroy();
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.onModuleDestroy();
});
void test('repositories Users réels : profil/préférences isolés et écritures concurrentes A/B', async () => {
  await Promise.all([
    users.updateProfile(a, { firstName: 'Changed-A' }),
    users.updateProfile(b, { firstName: 'Changed-B' }),
    users.updatePreferences(a, { timezone: 'Asia/Tokyo' }),
    users.updatePreferences(b, { timezone: 'Europe/Paris' }),
  ]);
  assert.equal((await users.profile(a)).id, a.userId);
  assert.equal((await users.profile(a)).firstName, 'Changed-A');
  assert.equal((await users.profile(b)).firstName, 'Changed-B');
  assert.equal((await users.preferences(a)).timezone, 'Asia/Tokyo');
  assert.equal((await users.preferences(b)).timezone, 'Europe/Paris');
  assert.equal(
    await prisma.userPreference.count({ where: ownerWhere(a, {}) }),
    1,
  );
  assert.equal(
    await prisma.userPreference.count({ where: ownerWhere(b, {}) }),
    1,
  );
});
void test('requêtes Prisma composées : propriété obligatoire même avec OR hostile, pagination et total', async () => {
  const rows = await prisma.session.findMany({
    where: ownerWhere(a, { OR: [{ userId: b.userId }, { id: a.sessionId }] }),
    orderBy: { id: 'asc' },
    skip: 0,
    take: 10,
  });
  assert.equal(rows.length, 1);
  assert.ok(rows.every((row) => row.userId === a.userId));
  assert.equal(
    await prisma.session.count({ where: ownerWhere(a, { userId: b.userId }) }),
    0,
  );
  for (const id of [b.sessionId, randomUUID()]) {
    assert.throws(() => privateResource(null), { status: 404 });
    const row = await prisma.session.findFirst({ where: ownedIdWhere(a, id) });
    assert.equal(row, null);
    const update = await prisma.session.updateMany({
      where: ownedIdWhere(a, id),
      data: { revokedAt: new Date() },
    });
    assert.throws(() => requireAffected(update.count), { status: 404 });
    const deleted = await prisma.session.deleteMany({
      where: ownedIdWhere(a, id),
    });
    assert.throws(() => requireAffected(deleted.count), { status: 404 });
  }
  assert.ok(await repository.activeUser(b.sessionId, b.userId));
});
void test('lot mixte PostgreSQL : rollback intégral, propriétaire imposé et autre utilisateur inchangé', async () => {
  const login = await sessions.login({ email: emails[0]!, password });
  const claims = await tokens.verify(login.body.accessToken);
  const ids = [claims.sid, b.sessionId];
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: ownerWhere(a, { id: { in: ids } }),
        data: { revokedAt: new Date() },
      });
      requireAffected(result.count, new Set(ids).size);
    }),
    { status: 404 },
  );
  assert.ok(await repository.activeUser(claims.sid, a.userId));
  assert.ok(await repository.activeUser(b.sessionId, b.userId));
  const own = await prisma.session.updateMany({
    where: ownedIdWhere(a, claims.sid),
    data: { revokedAt: new Date() },
  });
  requireAffected(own.count);
  assert.equal(await repository.activeUser(claims.sid, a.userId), null);
  assert.ok(await repository.activeUser(b.sessionId, b.userId));
});
void test('couple session/utilisateur et contextes invalides : aucun accès horizontal', async () => {
  assert.equal(await repository.activeUser(b.sessionId, a.userId), null);
  assert.equal(await repository.activeUser(a.sessionId, b.userId), null);
  const clientObject = JSON.parse(JSON.stringify(a)) as AuthenticatedActor;
  await assert.rejects(users.profile(clientObject), { status: 401 });
  assert.throws(() => users.preferences(clientObject), { status: 401 });
  const missing = actorFromVerifiedSession(randomUUID(), randomUUID());
  await assert.rejects(users.profile(missing), { status: 404 });
  await assert.rejects(users.updateProfile(missing, { firstName: 'forged' }), {
    status: 404,
  });
  await assert.rejects(users.preferences(missing), { status: 404 });
});
void test('HTTP et DB réels : A/B, injections, faux couple JWT, cookie A et bearer B, erreurs sans fuite', async () => {
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
    const csrf = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
    const login = (email: string) =>
      request(server)
        .post('/api/v1/auth/login')
        .set(csrf)
        .send({ email, password })
        .expect(200);
    const first = await login(emails[0]!);
    const second = await login(emails[1]!);
    const access = (value: import('supertest').Response) =>
      (value.body as { accessToken: string }).accessToken;
    const authA = 'Bearer ' + access(first);
    const authB = 'Bearer ' + access(second);
    const claimsA = await tokens.verify(access(first));
    const claimsB = await tokens.verify(access(second));
    const profile = await request(server)
      .get(`/api/v1/users/me?userId=${b.userId}&sessionId=${b.sessionId}`)
      .set('Authorization', authA)
      .set('X-User-Id', b.userId)
      .expect(200);
    assert.equal((profile.body as { id: string }).id, a.userId);
    for (const body of [
      { userId: a.userId, firstName: 'stolen' },
      { auth: { userId: a.userId, sessionId: a.sessionId } },
    ])
      await request(server)
        .patch('/api/v1/users/me')
        .set('Authorization', authB)
        .send(body)
        .expect(400);
    await Promise.all([
      request(server)
        .patch('/api/v1/users/me/preferences')
        .set('Authorization', authA)
        .send({ timezone: 'America/New_York' })
        .expect(200),
      request(server)
        .patch('/api/v1/users/me/preferences')
        .set('Authorization', authB)
        .send({ timezone: 'UTC' })
        .expect(200),
    ]);
    assert.equal((await users.preferences(a)).timezone, 'America/New_York');
    assert.equal((await users.preferences(b)).timezone, 'UTC');
    const fake = await tokens.sign(
      a.userId,
      claimsB.sid,
      new Date(Date.now() + 86400000),
    );
    const forbidden = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer ' + fake)
      .expect(401);
    assert.ok(!JSON.stringify(forbidden.body).includes(emails[1]!));
    const errors = [];
    for (const id of [b.userId, randomUUID()])
      errors.push(
        await request(server)
          .get('/api/v1/users/' + id)
          .set('Authorization', authA)
          .expect(404),
      );
    assert.deepEqual(
      (errors[0]!.body as { error: object }).error,
      (errors[1]!.body as { error: object }).error,
    );
    assert.ok(
      errors.every((value) => !JSON.stringify(value.body).includes(emails[1]!)),
    );
    const cookieA = (
      first.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    await request(server)
      .post('/api/v1/auth/logout')
      .set(csrf)
      .set('Authorization', authB)
      .set('Cookie', cookieA)
      .send({ userId: b.userId, sessionId: claimsB.sid })
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', authA)
      .expect(401);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', authB)
      .expect(200);
    assert.equal(await repository.activeUser(claimsA.sid, a.userId), null);
    assert.ok(await repository.activeUser(claimsB.sid, b.userId));
    const cookieB = (
      second.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(csrf)
      .set('Cookie', 'candidly_refresh=' + createRefreshToken())
      .send({ sessionId: claimsB.sid })
      .expect(401);
    assert.ok(await repository.activeUser(claimsB.sid, b.userId));
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(csrf)
      .set('Cookie', cookieB)
      .expect(200);
  } finally {
    await app.close();
  }
});
