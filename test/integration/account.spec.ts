import { actorFromVerifiedSession } from '../../src/common/authorization/authenticated-actor.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service.js';
import { PasswordRecoveryRepository } from '../../src/modules/auth/password-recovery.repository.js';
import { PasswordResetDeliveryService } from '../../src/modules/auth/password-reset-delivery.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { SessionService } from '../../src/modules/auth/session.service.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import {
  createVerificationToken,
  hashToken,
} from '../../src/modules/auth/verification-token.js';
import type { VerificationEmail } from '../../src/integrations/email/email.transport.js';
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !databaseUrl)
  throw new Error('Base locale de test explicite obligatoire.');
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
)
  throw new Error('Base locale dédiée _test obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const passwords = new PasswordService();
const repository = new PasswordRecoveryRepository(prisma, config);
const recovery = new PasswordRecoveryService(repository, passwords);
const sessionRepository = new SessionRepository(prisma);
const tokens = new AccessTokenService(config);
const sessions = new SessionService(
  sessionRepository,
  passwords,
  tokens,
  config,
);
const users = new UsersRepository(prisma);
const actor = (userId: string) =>
  actorFromVerifiedSession(userId, randomUUID());
const rate = new AuthRateLimitStore(config);
const emails: string[] = [];
const prefix = 'cand008-' + randomUUID();
const oldPassword = 'AncienMotDePasse2026!';
const newPassword = 'NouveauMotDePasse2026!';
let passwordHash: string;
const messages: VerificationEmail[] = [];
let failure = false;
const transport = {
  send: (message: VerificationEmail) => {
    if (failure) return Promise.reject(new Error('private_transport'));
    messages.push(message);
    return Promise.resolve();
  },
};
const delivery = new PasswordResetDeliveryService(prisma, config, transport);
async function fixture(label: string, verified = true) {
  const email = `${prefix}-${label}@example.com`;
  emails.push(email);
  return prisma.user.create({
    data: {
      email,
      firstName: 'Awa',
      lastName: 'Kouassi',
      passwordHash,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}
function rawFor(email: string): string {
  const message = messages.findLast((value) => value.to === email);
  assert.ok(message);
  const raw = new URLSearchParams(
    new URL(message.text.match(/http[^\s]+/)![0]).hash.slice(1),
  ).get('token');
  assert.ok(raw);
  return raw;
}
async function tokenFor(userId: string, expired = false) {
  const token = createVerificationToken(
    1800,
    expired ? new Date(0) : new Date(),
  );
  await prisma.passwordResetToken.create({
    data: { userId, tokenHash: token.hash, expiresAt: token.expiresAt },
  });
  return token.raw;
}
before(async () => {
  await prisma.onModuleInit();
  passwordHash = await passwords.hash(oldPassword);
  await passwords.onModuleInit();
});
after(async () => {
  await delivery.onModuleDestroy();
  rate.onModuleDestroy();
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.onModuleDestroy();
});
void test('profil isolé et préférences persistantes : défauts, unicité et upserts concurrents', async () => {
  const a = await fixture('profile-a');
  const b = await fixture('profile-b');
  await users.updateProfile(actor(a.id), { firstName: 'Autre' });
  assert.equal((await users.profile(actor(b.id))).firstName, 'Awa');
  const results = await Promise.all(
    Array.from({ length: 5 }, () => users.preferences(actor(a.id))),
  );
  assert.ok(
    results.every(
      (value) => value.locale === 'fr' && value.timezone === 'Africa/Abidjan',
    ),
  );
  assert.equal(
    await prisma.userPreference.count({ where: { userId: a.id } }),
    1,
  );
  await users.updatePreferences(actor(a.id), { timezone: 'Asia/Tokyo' });
  assert.equal((await users.preferences(actor(a.id))).timezone, 'Asia/Tokyo');
  assert.equal(
    (await users.preferences(actor(b.id))).timezone,
    'Africa/Abidjan',
  );
  await assert.rejects(
    prisma.userPreference.create({ data: { userId: a.id } }),
  );
});
void test('changement : ancien mot de passe incorrect sans mutation ; succès révoque toutes ses sessions et annule la récupération', async () => {
  const user = await fixture('change');
  const other = await fixture('other');
  const a = await sessions.login({ email: user.email, password: oldPassword });
  await sessions.login({ email: user.email, password: oldPassword });
  const b = await sessions.login({ email: other.email, password: oldPassword });
  const raw = await tokenFor(user.id);
  await repository.request(user.email);
  await assert.rejects(
    recovery.change(user.id, 'IncorrectPassword2026!', newPassword),
    { status: 401 },
  );
  assert.equal(
    await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    2,
  );
  await recovery.change(user.id, oldPassword, newPassword);
  assert.equal(
    await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    0,
  );
  await assert.rejects(sessions.refresh(a.refresh), { status: 401 });
  assert.ok(await sessions.refresh(b.refresh));
  await assert.rejects(recovery.reset(raw, newPassword), { status: 400 });
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .passwordResetRequestedAt,
    null,
  );
  await assert.rejects(
    sessions.login({ email: user.email, password: oldPassword }),
    { status: 401 },
  );
  assert.ok(await sessions.login({ email: user.email, password: newPassword }));
});
void test('changements concurrents : seul le premier attendu peut remplacer le hash', async () => {
  const user = await fixture('change-race');
  const result = await Promise.allSettled([
    recovery.change(user.id, oldPassword, newPassword),
    recovery.change(user.id, oldPassword, 'AutreMotDePasse2026!'),
  ]);
  assert.equal(
    result.filter((value) => value.status === 'fulfilled').length,
    1,
  );
});
void test('récupération durable : cooldown, empreinte seule, TTL et politique des emails non vérifiés', async () => {
  const user = await fixture('unverified', false);
  assert.deepEqual(
    await recovery.forgot(user.email),
    await recovery.forgot('unknown@example.com'),
  );
  const firstRequest = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
  });
  await repository.request(user.email);
  assert.equal(
    (
      await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    ).passwordResetLastRequestedAt?.getTime(),
    firstRequest.passwordResetLastRequestedAt?.getTime(),
  );
  await delivery.runPending();
  const raw = rawFor(user.email);
  const token = await prisma.passwordResetToken.findUniqueOrThrow({
    where: { tokenHash: hashToken(raw) },
  });
  assert.notEqual(token.tokenHash, raw);
  assert.ok(
    Math.abs(token.expiresAt.getTime() - token.createdAt.getTime() - 1800000) <
      10000,
  );
  await recovery.reset(raw, newPassword);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .emailVerifiedAt,
    null,
  );
  await assert.rejects(
    sessions.login({ email: user.email, password: newPassword }),
    { status: 401 },
  );
});
void test('tokens inconnus/expirés/consommés et vérification email non utilisable pour reset', async () => {
  const user = await fixture('invalid');
  const expired = await tokenFor(user.id, true);
  const raw = await tokenFor(user.id);
  const emailToken = createVerificationToken(86400);
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: emailToken.hash,
      expiresAt: emailToken.expiresAt,
    },
  });
  for (const invalid of [
    expired,
    createVerificationToken(1800).raw,
    emailToken.raw,
  ])
    await assert.rejects(recovery.reset(invalid, newPassword), { status: 400 });
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .passwordHash,
    passwordHash,
  );
  await recovery.reset(raw, newPassword);
  await assert.rejects(recovery.reset(raw, oldPassword), { status: 400 });
});
void test('reset concurrent avec tokens identiques/différents : un succès, tous consommés et sessions révoquées', async () => {
  const user = await fixture('reset-race');
  await sessions.login({ email: user.email, password: oldPassword });
  const a = await tokenFor(user.id);
  const b = await tokenFor(user.id);
  const result = await Promise.allSettled([
    recovery.reset(a, newPassword),
    recovery.reset(b, oldPassword),
    recovery.reset(a, oldPassword),
  ]);
  assert.equal(
    result.filter((value) => value.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    await prisma.passwordResetToken.count({
      where: { userId: user.id, consumedAt: null },
    }),
    0,
  );
  assert.equal(
    await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    0,
  );
});
void test('login concurrent à reset : hash périmé refusé ou session créée avant puis révoquée', async () => {
  const user = await fixture('login-race');
  const raw = await tokenFor(user.id);
  const nextHash = await passwords.hash(newPassword);
  await Promise.allSettled([
    sessionRepository.create(
      randomUUID(),
      user.id,
      hashToken(createVerificationToken(1800).raw),
      new Date(Date.now() + 86400000),
      passwordHash,
    ),
    repository.reset(raw, nextHash),
  ]);
  assert.equal(
    await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    0,
  );
  await assert.rejects(
    sessionRepository.create(
      randomUUID(),
      user.id,
      hashToken(createVerificationToken(1800).raw),
      new Date(Date.now() + 86400000),
      passwordHash,
    ),
    { status: 401 },
  );
});
void test('reset concurrent à refresh : aucune session active après les deux opérations', async () => {
  const user = await fixture('refresh-race');
  const login = await sessions.login({
    email: user.email,
    password: oldPassword,
  });
  const raw = await tokenFor(user.id);
  const result = await Promise.allSettled([
    recovery.reset(raw, newPassword),
    sessions.refresh(login.refresh),
  ]);
  assert.equal(result[0].status, 'fulfilled');
  assert.equal(
    await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    0,
  );
});
void test('panne email : rollback, ancien lien préservé, reprise par nouvelle instance et remplacement du lien', async () => {
  const user = await fixture('retry');
  await repository.request(user.email);
  failure = true;
  try {
    await delivery.runPending();
  } finally {
    failure = false;
  }
  assert.ok(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .passwordResetRequestedAt,
  );
  assert.equal(
    await prisma.passwordResetToken.count({ where: { userId: user.id } }),
    0,
  );
  const restarted = new PasswordResetDeliveryService(prisma, config, transport);
  try {
    await restarted.runPending();
  } finally {
    await restarted.onModuleDestroy();
  }
  const old = rawFor(user.email);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetLastRequestedAt: new Date(0) },
  });
  await repository.request(user.email);
  failure = true;
  try {
    await delivery.runPending();
  } finally {
    failure = false;
  }
  assert.equal(
    (
      await prisma.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: hashToken(old) },
      })
    ).consumedAt,
    null,
  );
  await delivery.runPending();
  const fresh = rawFor(user.email);
  assert.notEqual(fresh, old);
  await assert.rejects(recovery.reset(old, newPassword), { status: 400 });
  await recovery.reset(fresh, newPassword);
});

void test('HTTP réel : profils isolés, préférences, changements/reset, révocation des JWT et seuils Redis', async () => {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { setupApplication } =
    await import('../../src/config/setup-application.js');
  const { EmailTransport } =
    await import('../../src/integrations/email/email.transport.js');
  Object.assign(process.env, { DATABASE_URL: databaseUrl });
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailTransport)
    .useValue(transport)
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
    const a = await fixture('http-a');
    const b = await fixture('http-b');
    const csrf = { Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' };
    const login = (email: string, password: string) =>
      request(server)
        .post('/api/v1/auth/login')
        .set(csrf)
        .send({ email, password })
        .expect(200);
    const auth = (response: import('supertest').Response) =>
      'Bearer ' + (response.body as { accessToken: string }).accessToken;
    const first = await login(a.email, oldPassword);
    const other = await login(b.email, oldPassword);
    await request(server).get('/api/v1/users/me').expect(401);
    await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', auth(first))
      .send({ firstName: ' Fatou ' })
      .expect(200);
    const safe = await request(server)
      .get('/api/v1/users/me')
      .set('Authorization', auth(first))
      .expect(200);
    assert.deepEqual(Object.keys(safe.body as object).sort(), [
      'createdAt',
      'email',
      'emailVerifiedAt',
      'firstName',
      'id',
      'lastName',
    ]);
    await request(server)
      .patch('/api/v1/users/me')
      .set('Authorization', auth(first))
      .send({ userId: b.id, email: b.email })
      .expect(400);
    assert.equal((await users.profile(actor(b.id))).firstName, 'Awa');
    await request(server)
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', auth(first))
      .send({ timezone: 'Europe/Paris' })
      .expect(200);
    const prefs = await request(server)
      .get('/api/v1/users/me/preferences')
      .set('Authorization', auth(first))
      .expect(200);
    assert.equal((prefs.body as { timezone: string }).timezone, 'Europe/Paris');
    assert.equal(
      (await users.preferences(actor(b.id))).timezone,
      'Africa/Abidjan',
    );
    await request(server)
      .post('/api/v1/auth/change-password')
      .set('Authorization', auth(first))
      .send({ currentPassword: oldPassword, newPassword })
      .expect(403);
    await request(server)
      .post('/api/v1/auth/change-password')
      .set(csrf)
      .set('Authorization', auth(first))
      .send({ currentPassword: 'IncorrectPassword2026!', newPassword })
      .expect(401);
    const changed = await request(server)
      .post('/api/v1/auth/change-password')
      .set(csrf)
      .set('Authorization', auth(first))
      .send({ currentPassword: oldPassword, newPassword })
      .expect(200);
    assert.match(
      String(changed.headers['set-cookie']),
      /Expires=Thu, 01 Jan 1970/,
    );
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', auth(first))
      .expect(401);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', auth(other))
      .expect(200);
    await request(server)
      .post('/api/v1/auth/login')
      .set(csrf)
      .send({ email: a.email, password: oldPassword })
      .expect(401);
    const current = await login(a.email, newPassword);
    const known = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: ' ' + a.email.toUpperCase() + ' ' })
      .expect(202);
    const unknown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'unknown@example.com' })
      .expect(202);
    assert.deepEqual(known.body, unknown.body);
    assert.deepEqual(Object.keys(known.body as object).sort(), [
      'message',
      'success',
    ]);
    await app.get(PasswordResetDeliveryService).runPending();
    const raw = rawFor(a.email);
    const expired = await tokenFor(a.id, true);
    for (const token of [expired, createVerificationToken(1800).raw])
      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: oldPassword })
        .expect(400);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, newPassword: oldPassword })
      .expect(200);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, newPassword })
      .expect(400);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', auth(current))
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(csrf)
      .set(
        'Cookie',
        (current.headers['set-cookie'] as unknown as string[])[0]!.split(
          ';',
        )[0]!,
      )
      .expect(401);
    await login(a.email, oldPassword);
    await assert.rejects(
      sessions.login({ email: a.email, password: newPassword }),
      { status: 401 },
    );
    for (let i = 0; i < 3; i++)
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: a.email })
        .expect(202);
    await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: a.email })
      .expect(429);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({})
      .expect(400);
    await request(server)
      .post('/api/v1/auth/reset-password')
      .send({})
      .expect(429);
  } finally {
    await app.close();
  }
});
