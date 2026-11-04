import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AuthModule } from '../../src/modules/auth/auth.module.js';
import {
  JwtAuthGuard,
  CurrentUser,
} from '../../src/modules/auth/jwt-auth.guard.js';
import type { PublicUserDto } from '../../src/modules/auth/session.dto.js';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { SessionCookieService } from '../../src/modules/auth/session-cookie.service.js';
import { hashToken } from '../../src/modules/auth/verification-token.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';
@Controller('session-test-probe')
class ProtectedProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() current: PublicUserDto): PublicUserDto {
    return current;
  }
}
@Module({ imports: [AuthModule], controllers: [ProtectedProbeController] })
class ProtectedProbeModule {}
let app: INestApplication;
let server: Server;
let allowed = true;
const password = 'MotDePasseFort2026!';
const user = {
  id: randomUUID(),
  firstName: 'Awa',
  lastName: 'Kouassi',
  email: 'awa@example.com',
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  passwordHash: '',
};
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
const history = new Map<string, string>();
const repository = {
  findCredentials: (email: string) =>
    Promise.resolve(email === user.email ? user : null),
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
  rotate: (raw: string, next: string) => {
    const hash = hashToken(raw);
    const current = [...sessions.values()].find(
      (value) => value.refreshTokenHash === hash,
    );
    const session = current ?? sessions.get(history.get(hash) ?? '');
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      return Promise.resolve(null);
    if (!current) {
      session.revokedAt = new Date();
      return Promise.resolve(null);
    }
    history.set(hash, session.id);
    session.refreshTokenHash = next;
    return Promise.resolve(session);
  },
  revoke: (raw: string) => {
    const hash = hashToken(raw);
    const value =
      [...sessions.values()].find(
        (session) => session.refreshTokenHash === hash,
      ) ?? sessions.get(history.get(hash) ?? '');
    if (value) value.revokedAt = new Date();
    return Promise.resolve();
  },
  activeUser: (id: string, sub: string) => {
    const value = sessions.get(id);
    const safe = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    };
    return Promise.resolve(
      value &&
        value.userId === sub &&
        !value.revokedAt &&
        value.expiresAt > new Date()
        ? safe
        : null,
    );
  },
};
const csrf = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
function cookie(result: request.Response): string {
  const values = result.headers['set-cookie'] as unknown as string[];
  assert.ok(values?.[0]);
  return values[0].split(';')[0]!;
}
async function login() {
  return request(server)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: ' AWA@EXAMPLE.COM ', password })
    .expect(200);
}
before(async () => {
  Object.assign(process.env, environment);
  user.passwordHash = await new PasswordService().hash(password);
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({
    imports: [AppModule, ProtectedProbeModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(SessionRepository)
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
void test('login vérifié : JWT, cookie privé et identité limitée, aucune fuite', async () => {
  const result = await login();
  const body = result.body as { accessToken: string; user: object };
  assert.deepEqual(Object.keys(body).sort(), [
    'accessToken',
    'expiresIn',
    'tokenType',
    'user',
  ]);
  assert.deepEqual(Object.keys(body.user).sort(), [
    'createdAt',
    'email',
    'emailVerifiedAt',
    'firstName',
    'id',
    'lastName',
  ]);
  const header = String(result.headers['set-cookie']);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\/api\/v1\/auth/);
  assert.ok(!header.includes('Domain='));
  assert.ok(!JSON.stringify(body).includes(user.passwordHash));
  assert.ok(!JSON.stringify(body).includes(password));
  const me = await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', 'Bearer ' + body.accessToken)
    .expect(200);
  assert.deepEqual(me.body, body.user);
  assert.equal(me.headers['cache-control'], 'no-store');
  await request(server).get('/api/v1/session-test-probe').expect(401);
  const reuse = await request(server)
    .get('/api/v1/session-test-probe')
    .set('Authorization', 'Bearer ' + body.accessToken)
    .expect(200);
  assert.deepEqual(reuse.body, body.user);
});
void test('login invalide, compte inconnu et email non vérifié : même réponse 401', async () => {
  const a = await request(server)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: user.email, password: 'WrongPassword2026!' })
    .expect(401);
  const b = await request(server)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'unknown@example.com', password })
    .expect(401);
  const original = user.emailVerifiedAt;
  user.emailVerifiedAt = null as unknown as Date;
  try {
    const c = await request(server)
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: user.email, password })
      .expect(401);
    assert.deepEqual(
      (a.body as { error: object }).error,
      (c.body as { error: object }).error,
    );
  } finally {
    user.emailVerifiedAt = original;
  }
  assert.deepEqual(
    (a.body as { error: object }).error,
    (b.body as { error: object }).error,
  );
});
void test('refresh valide puis réutilisé : rotation et révocation immédiate', async () => {
  const first = await login();
  const old = cookie(first);
  const fresh = await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', old)
    .expect(200);
  assert.notEqual(cookie(fresh), old);
  assert.deepEqual(Object.keys(fresh.body as object).sort(), [
    'accessToken',
    'expiresIn',
    'tokenType',
  ]);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', old)
    .expect(401);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', cookie(fresh))
    .expect(401);
  await request(server)
    .get('/api/v1/auth/me')
    .set(
      'Authorization',
      'Bearer ' + (fresh.body as { accessToken: string }).accessToken,
    )
    .expect(401);
});
void test('refresh expiré, absent et cookie ambigu refusés', async () => {
  const result = await login();
  const value = cookie(result);
  const hash = hashToken(value.split('=')[1]!);
  [...sessions.values()].find(
    (session) => session.refreshTokenHash === hash,
  )!.expiresAt = new Date(0);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', value)
    .expect(401);
  await request(server).post('/api/v1/auth/refresh').set(csrf).expect(401);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', value + '; ' + value)
    .expect(401);
});
void test('logout idempotent, cookie effacé, refresh et JWT immédiatement refusés', async () => {
  const result = await login();
  const value = cookie(result);
  const out = await request(server)
    .post('/api/v1/auth/logout')
    .set(csrf)
    .set('Cookie', value)
    .expect(204);
  assert.match(String(out.headers['set-cookie']), /Expires=Thu, 01 Jan 1970/);
  assert.match(String(out.headers['set-cookie']), /Path=\/api\/v1\/auth/);
  await request(server)
    .post('/api/v1/auth/logout')
    .set(csrf)
    .set('Cookie', value)
    .expect(204);
  await request(server).post('/api/v1/auth/logout').set(csrf).expect(204);
  await request(server)
    .post('/api/v1/auth/refresh')
    .set(csrf)
    .set('Cookie', value)
    .expect(401);
  await request(server)
    .get('/api/v1/auth/me')
    .set(
      'Authorization',
      'Bearer ' + (result.body as { accessToken: string }).accessToken,
    )
    .expect(401);
});
void test('me refuse absence, JWT falsifié et session d’un autre utilisateur', async () => {
  await request(server).get('/api/v1/auth/me').expect(401);
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', 'Bearer forged.token.signature')
    .expect(401);
  const result = await login();
  const value = [...sessions.values()].find(
    (session) =>
      session.refreshTokenHash === hashToken(cookie(result).split('=')[1]!),
  )!;
  const wrong = await app
    .get(AccessTokenService)
    .sign(randomUUID(), value.id, value.expiresAt);
  await request(server)
    .get('/api/v1/auth/me')
    .set('Authorization', 'Bearer ' + wrong)
    .expect(401);
});
void test('CSRF : absence, origine null/hostile et formulaire refusés sur les trois POST', async () => {
  for (const route of ['login', 'refresh', 'logout']) {
    for (const headers of [
      {},
      { Origin: csrf.Origin },
      { 'X-Candidly-CSRF': '1' },
      { Origin: 'null', 'X-Candidly-CSRF': '1' },
      { Origin: 'https://evil.example', 'X-Candidly-CSRF': '1' },
    ])
      await request(server)
        .post('/api/v1/auth/' + route)
        .set(headers)
        .send({})
        .expect(403);
    await request(server)
      .post('/api/v1/auth/' + route)
      .set('Origin', csrf.Origin)
      .type('form')
      .send({ email: user.email, password })
      .expect(403);
  }
  const preflight = await request(server)
    .options('/api/v1/auth/refresh')
    .set('Origin', csrf.Origin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'X-Candidly-CSRF')
    .expect(204);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
});
void test('cookie production est Secure et garde les attributs à l’effacement', () => {
  const service = new SessionCookieService(
    new ConfigService({ NODE_ENV: 'production' }),
  );
  let options: unknown;
  const response = {
    cookie: (_name: string, _token: string, value: unknown) => {
      options = value;
    },
    clearCookie: (_name: string, value: unknown) => {
      options = value;
    },
  } as unknown as import('express').Response;
  service.set(response, 'test', new Date(Date.now() + 10000));
  assert.equal((options as { secure: boolean }).secure, true);
  service.clear(response);
  assert.deepEqual(options, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
});
void test('limitation login/refresh et Swagger', async () => {
  allowed = false;
  try {
    for (const route of ['login', 'refresh'])
      await request(server)
        .post('/api/v1/auth/' + route)
        .set(csrf)
        .send({})
        .expect(429);
  } finally {
    allowed = true;
  }
  const result = await request(server).get('/docs-json').expect(200);
  const doc = result.body as {
    paths: Record<string, unknown>;
    components: { securitySchemes: Record<string, unknown> };
  };
  for (const route of ['login', 'refresh', 'logout', 'me'])
    assert.ok(doc.paths['/api/v1/auth/' + route]);
  assert.ok(doc.components.securitySchemes.bearer);
  assert.ok(doc.components.securitySchemes.cookie);
});
