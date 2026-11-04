import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { verify } from 'argon2';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RegisterDto,
  VerifyEmailDto,
  normalizeEmail,
} from '../../src/modules/auth/dto/auth.dto.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  createVerificationToken,
  hashToken,
} from '../../src/modules/auth/verification-token.js';
import { verificationEmail } from '../../src/integrations/email/email.transport.js';
import { LocalEmailTransport } from '../../src/integrations/email/local-email.transport.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { environment } from '../support/environment.js';

void test('normalise les emails et les noms mais préserve le mot de passe', async () => {
  assert.equal(normalizeEmail(' Awa@Example.COM '), 'awa@example.com');
  const value = plainToInstance(RegisterDto, {
    email: ' Awa@Example.COM ',
    firstName: ' Awa ',
    lastName: ' Kouassi ',
    password: '  une phrase secrète  ',
  });
  assert.equal(value.email, 'awa@example.com');
  assert.equal(value.firstName, 'Awa');
  assert.equal(value.password, '  une phrase secrète  ');
  assert.deepEqual(await validate(value), []);
});
void test('refuse champs inconnus, types incorrects, noms vides, email et longueurs invalides', async () => {
  const base = {
    email: 'awa@example.com',
    firstName: 'Awa',
    lastName: 'Kouassi',
    password: 'une phrase secrète',
  };
  for (const invalid of [
    { firstName: ' ' },
    { lastName: 'x'.repeat(101) },
    { email: 'bad' },
    { password: 'court' },
    { password: 'x'.repeat(129) },
    { password: 123456789012 },
    { unexpected: true },
  ]) {
    const errors = await validate(
      plainToInstance(RegisterDto, { ...base, ...invalid }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    assert.ok(errors.length > 0);
  }
  assert.ok(
    (await validate(plainToInstance(VerifyEmailDto, { token: 'bad' }))).length >
      0,
  );
});
void test('Argon2id utilise un sel aléatoire, les paramètres prévus et ne conserve pas le mot de passe', async () => {
  const password = 'une phrase secrète';
  const service = new PasswordService();
  const a = await service.hash(password);
  const b = await service.hash(password);
  assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes(password));
  assert.ok(await verify(a, password));
  assert.equal(await verify(a, 'incorrect'), false);
});
void test('tokens cryptographiques distincts : 256 bits, empreinte SHA256 et expiration configurable', () => {
  const now = new Date('2026-11-03T00:00:00Z');
  const a = createVerificationToken(86400, now);
  const b = createVerificationToken(60, now);
  assert.match(a.raw, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.hash, /^[a-f0-9]{64}$/);
  assert.equal(a.hash, hashToken(a.raw));
  assert.notEqual(a.raw, b.raw);
  assert.equal(a.expiresAt.toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(b.expiresAt.getTime() - now.getTime(), 60000);
});
void test('transport local privé : fichier de test lisible et lien en fragment sans appel externe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'candidly-email-'));
  try {
    const transport = new LocalEmailTransport(
      new ConfigService({
        NODE_ENV: 'test',
        EMAIL_TRANSPORT: 'local',
        EMAIL_LOCAL_DIRECTORY: directory,
      }),
    );
    const message = verificationEmail(
      'awa@example.com',
      'http://localhost:3000',
      'private-token',
    );
    await transport.send(message);
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    const file = join(directory, files[0]!);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), message);
    assert.match(message.text, /\/verify-email#token=private-token/);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true });
  }
});
void test('transport désactivé et configuration dangereuse refusés sans fuite', async () => {
  const transport = new LocalEmailTransport(
    new ConfigService({ EMAIL_TRANSPORT: 'disabled' }),
  );
  await assert.rejects(
    transport.send(
      verificationEmail('awa@example.com', 'http://localhost:3000', 'secret'),
    ),
  );
  for (const overrides of [
    { FRONTEND_URL: 'javascript:secret' },
    { EMAIL_VERIFICATION_TTL_SECONDS: '0' },
    { EMAIL_RESEND_COOLDOWN_SECONDS: '-1' },
    { EMAIL_RETRY_INTERVAL_SECONDS: '3601' },
    { EMAIL_TRANSPORT: 'external' },
    {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://example.com',
      EMAIL_TRANSPORT: 'local',
    },
  ]) {
    assert.throws(() => validateEnvironment({ ...environment, ...overrides }));
  }
});

void test('repository : doublon P2002 absorbé, panne inattendue propagée', async () => {
  const { AuthRepository } =
    await import('../../src/modules/auth/auth.repository.js');
  const { Prisma } = await import('../../src/generated/prisma/client.js');
  let duplicate = true;
  const prisma = {
    user: {
      create: () =>
        Promise.reject(
          duplicate
            ? new Prisma.PrismaClientKnownRequestError('private', {
                code: 'P2002',
                clientVersion: '7.10.1',
              })
            : new Error('private_database_secret'),
        ),
    },
  };
  const repository = new AuthRepository(
    prisma as unknown as import('../../src/database/prisma.service.js').PrismaService,
    new ConfigService(),
  );
  const body = plainToInstance(RegisterDto, {
    firstName: 'Awa',
    lastName: 'Kouassi',
    email: 'awa@example.com',
    password: 'une phrase secrète',
  });
  await assert.doesNotReject(repository.register(body, 'hash'));
  duplicate = false;
  await assert.rejects(repository.register(body, 'hash'));
});
