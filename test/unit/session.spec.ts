import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { decodeJwt, SignJWT } from 'jose';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { createRefreshToken } from '../../src/modules/auth/session.service.js';
import { SessionCookieService } from '../../src/modules/auth/session-cookie.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { environment } from '../support/environment.js';
import type { Request } from 'express';
const config = new ConfigService(validateEnvironment(environment));
const tokens = new AccessTokenService(config);
const userId = randomUUID();
const sessionId = randomUUID();
void test('Argon2 : mot de passe valide, incorrect, compte absent et hash invalide', async () => {
  const passwords = new PasswordService();
  const hash = await passwords.hash('une phrase de test');
  assert.ok(await passwords.verify(hash, 'une phrase de test'));
  assert.equal(await passwords.verify(hash, 'mauvais mot de passe'), false);
  assert.equal(await passwords.verify(undefined, 'une phrase de test'), false);
  assert.equal(
    await passwords.verify('not-a-hash', 'une phrase de test'),
    false,
  );
});
void test('JWT signé : claims minimales, durée 15 min et échéance limitée à la session', async () => {
  const token = await tokens.sign(
    userId,
    sessionId,
    new Date(Date.now() + 86400000),
  );
  const claims = decodeJwt(token);
  assert.deepEqual(Object.keys(claims).sort(), [
    'aud',
    'exp',
    'iat',
    'iss',
    'sid',
    'sub',
  ]);
  assert.equal(claims.exp! - claims.iat!, 900);
  assert.deepEqual(await tokens.verify(token), { sub: userId, sid: sessionId });
  const short = decodeJwt(
    await tokens.sign(userId, sessionId, new Date(Date.now() + 10000)),
  );
  assert.ok(short.exp! - short.iat! <= 10);
});
void test('JWT refuse falsification, mauvais algorithme, clé, origine, audience, expiration et claims', async () => {
  const now = Math.floor(Date.now() / 1000);
  const base = {
    sub: userId,
    sid: sessionId,
    iss: 'candidly-api',
    aud: 'candidly-web',
    iat: now,
    exp: now + 900,
  };
  const key = Buffer.from(environment.JWT_SIGNING_KEY, 'base64');
  for (const [patch, algorithm, signingKey] of [
    [{}, 'HS384', key],
    [{}, 'HS256', Buffer.alloc(32, 1)],
    [{ iss: 'other' }, 'HS256', key],
    [{ aud: 'other' }, 'HS256', key],
    [{ exp: now - 1 }, 'HS256', key],
    [{ iat: now + 10 }, 'HS256', key],
    [{ sub: 'forged' }, 'HS256', key],
    [{ sid: 'forged' }, 'HS256', key],
    [{ exp: now + 3600 }, 'HS256', key],
    [{ aud: ['candidly-web'] as string[] }, 'HS256', key],
    [{ iat: undefined }, 'HS256', key],
    [{ exp: undefined }, 'HS256', key],
  ] as const) {
    const token = await new SignJWT({ ...base, ...patch })
      .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
      .sign(signingKey);
    await assert.rejects(tokens.verify(token), { status: 401 });
  }
  const valid = await tokens.sign(
    userId,
    sessionId,
    new Date(Date.now() + 86400000),
  );
  const parts = valid.split('.');
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify({ ...base, sub: randomUUID() })).toString('base64url')}.${parts[2]}`;
  await assert.rejects(tokens.verify(forged), { status: 401 });
  await assert.rejects(tokens.verify('invalid'), { status: 401 });
  const unsigned =
    Buffer.from('{"alg":"none"}').toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify(base)).toString('base64url') +
    '.';
  await assert.rejects(tokens.verify(unsigned), { status: 401 });
});
void test('refresh aléatoire 256 bits, lecture stricte du cookie et doublons refusés', () => {
  const first = createRefreshToken();
  const second = createRefreshToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  const cookies = new SessionCookieService(config);
  const request = (cookie?: string) => ({ headers: { cookie } }) as Request;
  assert.equal(
    cookies.read(request(`other=value; candidly_refresh=${first}`)),
    first,
  );
  for (const value of [
    undefined,
    'candidly_refresh=bad',
    `candidly_refresh=${first}; candidly_refresh=${second}`,
    `candidly_refresh=%${first}`,
  ])
    assert.equal(cookies.read(request(value)), undefined);
});
void test('configuration : clé absente/invalide, durées et origine incohérentes refusées sans fuite', () => {
  for (const patch of [
    { JWT_SIGNING_KEY: '' },
    { JWT_SIGNING_KEY: 'private_secret' },
    { ACCESS_TOKEN_TTL_SECONDS: '3601' },
    { REFRESH_TOKEN_TTL_SECONDS: '0' },
    { JWT_ISSUER: '' },
    { JWT_AUDIENCE: ' ' },
    { FRONTEND_URL: 'http://untrusted.example' },
  ]) {
    assert.throws(
      () => validateEnvironment({ ...environment, ...patch }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('private_secret'));
        return true;
      },
    );
  }
});

void test('service refresh : contrôle du format, délégation de rotation, échéance absolue et refus de session inactive', async () => {
  const { SessionService } =
    await import('../../src/modules/auth/session.service.js');
  let active = true;
  let calls = 0;
  let nextHash = '';
  const expiresAt = new Date(Date.now() + 60000);
  const repository = {
    rotate: (_raw: string, hash: string) => {
      calls++;
      nextHash = hash;
      return Promise.resolve(
        active ? { id: sessionId, userId, expiresAt } : null,
      );
    },
  };
  const service = new SessionService(
    repository as unknown as import('../../src/modules/auth/session.repository.js').SessionRepository,
    new PasswordService(),
    tokens,
    config,
  );
  await assert.rejects(service.refresh(undefined), { status: 401 });
  await assert.rejects(service.refresh('invalid'), { status: 401 });
  assert.equal(calls, 0);
  const result = await service.refresh(createRefreshToken());
  assert.equal(result.expiresAt, expiresAt);
  assert.match(nextHash, /^[a-f0-9]{64}$/);
  assert.notEqual(result.refresh, nextHash);
  assert.deepEqual(await tokens.verify(result.body.accessToken), {
    sub: userId,
    sid: sessionId,
  });
  assert.ok(result.body.expiresIn <= 60);
  active = false;
  await assert.rejects(service.refresh(createRefreshToken()), { status: 401 });
});
void test('service logout : absence/malformation idempotentes et révocation par token présenté', async () => {
  const { SessionService } =
    await import('../../src/modules/auth/session.service.js');
  const values: string[] = [];
  const repository = {
    revoke: (raw: string) => {
      values.push(raw);
      return Promise.resolve();
    },
  };
  const service = new SessionService(
    repository as unknown as import('../../src/modules/auth/session.repository.js').SessionRepository,
    new PasswordService(),
    tokens,
    config,
  );
  await service.logout(undefined);
  await service.logout('invalid');
  assert.deepEqual(values, []);
  const raw = createRefreshToken();
  await service.logout(raw);
  assert.deepEqual(values, [raw]);
});
