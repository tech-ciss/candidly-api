import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import {
  SessionService,
  createRefreshToken,
} from '../../src/modules/auth/session.service.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { hashToken } from '../../src/modules/auth/verification-token.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error('Base locale de test explicite obligatoire.');
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('Base localhost avec suffixe _test obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const repository = new SessionRepository(prisma);
const passwords = new PasswordService();
const tokens = new AccessTokenService(config);
const service = new SessionService(repository, passwords, tokens, config);
const rate = new AuthRateLimitStore(config);
const emails: string[] = [];
const prefix = 'cand007-' + randomUUID();
const password = 'MotDePasseFort2026!';
let passwordHash: string;
async function fixture(label: string, verified = true) {
  const email = `${prefix}-${label}@example.com`;
  emails.push(email);
  const user = await prisma.user.create({
    data: {
      email,
      firstName: 'Awa',
      lastName: 'Kouassi',
      passwordHash,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
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
void test('session persistée : hash uniquement, JWT minimal et appartenance imposée', async () => {
  const user = await fixture('creation');
  const login = await service.login({ email: user.email, password });
  const session = await prisma.session.findUniqueOrThrow({
    where: { refreshTokenHash: hashToken(login.refresh) },
  });
  assert.notEqual(session.refreshTokenHash, login.refresh);
  assert.equal(session.userId, user.id);
  assert.ok(
    Math.abs(session.expiresAt.getTime() - Date.now() - 2592000000) < 10000,
  );
  const claims = await tokens.verify(login.body.accessToken);
  assert.equal(claims.sub, user.id);
  assert.equal(claims.sid, session.id);
  assert.ok(await repository.activeUser(session.id, user.id));
  assert.equal(await repository.activeUser(session.id, randomUUID()), null);
  await assert.rejects(
    repository.create(
      randomUUID(),
      randomUUID(),
      hashToken(createRefreshToken()),
      new Date(Date.now() + 10000),
      user.passwordHash,
    ),
  );
  await assert.rejects(
    repository.create(
      randomUUID(),
      user.id,
      session.refreshTokenHash,
      session.expiresAt,
      user.passwordHash,
    ),
  );
});
void test('rotation absolue et réutilisation : commit de révocation, aucune session nouvelle', async () => {
  const user = await fixture('rotation');
  const initial = await service.login({ email: user.email, password });
  const first = await prisma.session.findUniqueOrThrow({
    where: { refreshTokenHash: hashToken(initial.refresh) },
  });
  const rotated = await service.refresh(initial.refresh);
  assert.notEqual(rotated.refresh, initial.refresh);
  assert.equal(rotated.expiresAt.getTime(), first.expiresAt.getTime());
  assert.equal(
    await prisma.sessionRefreshToken.count({
      where: { sessionId: first.id, tokenHash: hashToken(initial.refresh) },
    }),
    1,
  );
  await assert.rejects(service.refresh(initial.refresh), { status: 401 });
  const revoked = await prisma.session.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.ok(revoked.revokedAt);
  await assert.rejects(service.refresh(rotated.refresh), { status: 401 });
  assert.equal(await repository.activeUser(first.id, user.id), null);
  assert.equal(await prisma.session.count({ where: { userId: user.id } }), 1);
});
void test('refresh concurrent : un gagnant puis révocation stricte de la session entière', async () => {
  const user = await fixture('concurrent');
  const login = await service.login({ email: user.email, password });
  const claims = await tokens.verify(login.body.accessToken);
  const results = await Promise.allSettled([
    service.refresh(login.refresh),
    service.refresh(login.refresh),
    service.refresh(login.refresh),
  ]);
  assert.equal(
    results.filter((value) => value.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.filter((value) => value.status === 'rejected').length,
    2,
  );
  assert.ok(
    (await prisma.session.findUniqueOrThrow({ where: { id: claims.sid } }))
      .revokedAt,
  );
  assert.equal(
    await prisma.sessionRefreshToken.count({
      where: { sessionId: claims.sid },
    }),
    1,
  );
  for (const result of results)
    if (result.status === 'fulfilled')
      await assert.rejects(service.refresh(result.value.refresh), {
        status: 401,
      });
});
void test('logout concurrent avec refresh : aucune session active après les deux appels', async () => {
  const user = await fixture('logout-race');
  const login = await service.login({ email: user.email, password });
  const claims = await tokens.verify(login.body.accessToken);
  await Promise.allSettled([
    service.refresh(login.refresh),
    service.logout(login.refresh),
  ]);
  assert.equal(await repository.activeUser(claims.sid, user.id), null);
  await service.logout(login.refresh);
  await service.logout(undefined);
  await service.logout(createRefreshToken());
});
void test('sessions isolées : valeur arbitraire sans révocation tierce et logout limité à son appareil', async () => {
  const first = await fixture('first');
  const other = await fixture('other');
  const a = await service.login({ email: first.email, password });
  const b = await service.login({ email: other.email, password });
  const aClaims = await tokens.verify(a.body.accessToken);
  const bClaims = await tokens.verify(b.body.accessToken);
  await assert.rejects(service.refresh(createRefreshToken()), { status: 401 });
  assert.ok(await repository.activeUser(aClaims.sid, first.id));
  assert.ok(await repository.activeUser(bClaims.sid, other.id));
  assert.equal(await repository.activeUser(aClaims.sid, other.id), null);
  await service.logout(a.refresh);
  assert.ok(await repository.activeUser(bClaims.sid, other.id));
});
void test('sessions expirées, révoquées et utilisateur non vérifié refusés', async () => {
  const user = await fixture('expiry');
  const login = await service.login({ email: user.email, password });
  const claims = await tokens.verify(login.body.accessToken);
  await prisma.session.update({
    where: { id: claims.sid },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(service.refresh(login.refresh), { status: 401 });
  assert.equal(await repository.activeUser(claims.sid, user.id), null);
  assert.equal(
    await prisma.sessionRefreshToken.count({
      where: { sessionId: claims.sid },
    }),
    0,
  );
  const fresh = await service.login({ email: user.email, password });
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: null },
  });
  await assert.rejects(service.refresh(fresh.refresh), { status: 401 });
  await assert.rejects(service.login({ email: user.email, password }), {
    status: 401,
  });
});
void test('parcours HTTP réel : CSRF, cookies, refresh, me, logout, rejeu, expiration et débit Redis', async () => {
  const { Test } = await import('@nestjs/testing');
  const { setupApplication } =
    await import('../../src/config/setup-application.js');
  const { default: request } = await import('supertest');
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
    const headers = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
    const cookie = (result: import('supertest').Response): string =>
      (result.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const token = (result: import('supertest').Response): string =>
      (result.body as { accessToken: string }).accessToken;
    const login = () =>
      request(server)
        .post('/api/v1/auth/login')
        .set(headers)
        .send({ email: ' ' + user.email.toUpperCase() + ' ', password })
        .expect(200);
    // Le POST hostile ne crée pas de session ; il consomme une tentative du limiteur.
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password })
      .expect(403);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
    const first = await login();
    const firstCookie = cookie(first);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token(first))
      .expect(200);
    const state = await prisma.session.findUniqueOrThrow({
      where: { refreshTokenHash: hashToken(firstCookie.split('=')[1]!) },
    });
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', firstCookie)
      .set('Origin', 'https://evil.example')
      .set('X-Candidly-CSRF', '1')
      .expect(403);
    assert.equal(
      (await prisma.session.findUniqueOrThrow({ where: { id: state.id } }))
        .refreshTokenHash,
      state.refreshTokenHash,
    );
    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .set('Cookie', firstCookie)
      .expect(200);
    assert.notEqual(cookie(rotated), firstCookie);
    assert.deepEqual(Object.keys(rotated.body as object).sort(), [
      'accessToken',
      'expiresIn',
      'tokenType',
    ]);
    await request(server)
      .post('/api/v1/auth/logout')
      .set(headers)
      .set('Cookie', cookie(rotated))
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token(rotated))
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .set('Cookie', cookie(rotated))
      .expect(401);
    const replay = await login();
    const replayCookie = cookie(replay);
    const newToken = await request(server)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .set('Cookie', replayCookie)
      .expect(200);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .set('Cookie', replayCookie)
      .expect(401);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ' + token(newToken))
      .expect(401);
    const expired = await login();
    await prisma.session.update({
      where: { refreshTokenHash: hashToken(cookie(expired).split('=')[1]!) },
      data: { expiresAt: new Date(0) },
    });
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(headers)
      .set('Cookie', cookie(expired))
      .expect(401);
    await request(server)
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: user.email, password: 'WrongPassword2026!' })
      .expect(401);
    await request(server)
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ email: user.email, password })
      .expect(429);
    for (let i = 0; i < 30; i++)
      await request(server)
        .post('/api/v1/auth/refresh')
        .set(headers)
        .expect(i < 24 ? 401 : 429);
  } finally {
    await app.close();
  }
});
