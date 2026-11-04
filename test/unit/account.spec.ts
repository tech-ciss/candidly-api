import { actorFromVerifiedSession } from '../../src/common/authorization/authenticated-actor.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateProfileDto,
  UpdatePreferencesDto,
  isSupportedTimezone,
} from '../../src/modules/users/users.dto.js';
import {
  ChangePasswordDto,
  ResetPasswordDto,
} from '../../src/modules/auth/password-recovery.dto.js';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service.js';
import type { PasswordRecoveryRepository } from '../../src/modules/auth/password-recovery.repository.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import {
  createVerificationToken,
  hashToken,
} from '../../src/modules/auth/verification-token.js';
import { passwordResetEmail } from '../../src/integrations/email/email.transport.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { environment } from '../support/environment.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import type { UsersRepository } from '../../src/modules/users/users.repository.js';
const validation = { whitelist: true, forbidNonWhitelisted: true };
void test('profil : trim et validation stricte des noms, email/ownership non modifiables', async () => {
  const value = plainToInstance(UpdateProfileDto, {
    firstName: ' Awa ',
    lastName: ' Kouassi ',
  });
  assert.deepEqual(await validate(value, validation), []);
  assert.equal(value.firstName, 'Awa');
  for (const invalid of [
    { firstName: ' ' },
    { lastName: 'x'.repeat(101) },
    { firstName: null },
    { firstName: 2 },
    { email: 'other@example.com' },
    { userId: 'forged' },
  ])
    assert.ok(
      (await validate(plainToInstance(UpdateProfileDto, invalid), validation))
        .length > 0,
    );
  const users = new UsersService({} as UsersRepository);
  assert.throws(
    () => users.updateProfile(actorFromVerifiedSession('id', 'session'), {}),
    { status: 400 },
  );
  assert.throws(
    () =>
      users.updatePreferences(actorFromVerifiedSession('id', 'session'), {}),
    { status: 400 },
  );
});
void test('préférences : fr et fuseaux mondiaux IANA, refus des valeurs invalides et nulles', async () => {
  for (const timezone of [
    'Africa/Abidjan',
    'Europe/Paris',
    'America/New_York',
    'Asia/Tokyo',
    'Pacific/Auckland',
    'UTC',
  ]) {
    assert.ok(isSupportedTimezone(timezone));
    assert.deepEqual(
      await validate(
        plainToInstance(UpdatePreferencesDto, { locale: 'fr', timezone }),
        validation,
      ),
      [],
    );
  }
  for (const invalid of [
    { locale: 'xx' },
    { locale: null },
    { timezone: null },
    { timezone: '+01:00' },
    { timezone: 'Unknown/Zone' },
    { notifications: true },
  ])
    assert.ok(
      (
        await validate(
          plainToInstance(UpdatePreferencesDto, invalid),
          validation,
        )
      ).length > 0,
    );
});
void test('mots de passe et token : DTO sans conversion, longueurs et format opaque stricts', async () => {
  for (const invalid of [
    { currentPassword: 'short', newPassword: 'PhraseDeTest2026!' },
    { currentPassword: 'PhraseDeTest2026!', newPassword: 'short' },
    { currentPassword: 'PhraseDeTest2026!', newPassword: 'x'.repeat(129) },
  ])
    assert.ok(
      (await validate(plainToInstance(ChangePasswordDto, invalid))).length > 0,
    );
  for (const token of ['invalid', null, 'x'.repeat(44)])
    assert.ok(
      (
        await validate(
          plainToInstance(ResetPasswordDto, {
            token,
            newPassword: 'PhraseDeTest2026!',
          }),
        )
      ).length > 0,
    );
});
void test('récupération : token 256 bits hashé et expiration 30 minutes, email français avec fragment', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  const token = createVerificationToken(1800, now);
  assert.match(token.raw, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(token.hash, hashToken(token.raw));
  assert.equal(token.expiresAt.getTime() - now.getTime(), 1800000);
  const message = passwordResetEmail(
    'awa@example.com',
    'http://localhost:3000',
    token.raw,
  );
  assert.match(message.text, /\/reset-password#token=/);
  assert.match(message.subject, /mot de passe/);
  assert.throws(() =>
    validateEnvironment({ ...environment, PASSWORD_RESET_TTL_SECONDS: '0' }),
  );
  assert.throws(() =>
    validateEnvironment({
      ...environment,
      PASSWORD_RESET_COOLDOWN_SECONDS: '86401',
    }),
  );
});
void test('changement : ancien mot de passe vérifié, hash Argon2id seulement au repository, course refusée', async () => {
  const passwords = new PasswordService();
  const current = await passwords.hash('AncienMotDePasse2026!');
  let changed = 0;
  let accepts = true;
  const repository = {
    credentials: () => Promise.resolve({ passwordHash: current }),
    change: async (_id: string, expected: string, hash: string) => {
      assert.equal(expected, current);
      assert.ok(await passwords.verify(hash, 'NouveauMotDePasse2026!'));
      changed++;
      return accepts;
    },
  };
  const service = new PasswordRecoveryService(
    repository as unknown as PasswordRecoveryRepository,
    passwords,
  );
  await assert.rejects(
    service.change('user', 'IncorrectPassword2026!', 'NouveauMotDePasse2026!'),
    { status: 401 },
  );
  assert.equal(changed, 0);
  assert.equal(
    (
      await service.change(
        'user',
        'AncienMotDePasse2026!',
        'NouveauMotDePasse2026!',
      )
    ).success,
    true,
  );
  accepts = false;
  await assert.rejects(
    service.change('user', 'AncienMotDePasse2026!', 'NouveauMotDePasse2026!'),
    { status: 401 },
  );
});
void test('récupération : demande générique, token invalide refusé et panne non masquée', async () => {
  let valid = false;
  const passwords = new PasswordService();
  const repository = {
    request: () => Promise.resolve(),
    reset: (_token: string, hash: string) => {
      assert.match(hash, /^\$argon2id\$/);
      return Promise.resolve(valid);
    },
  };
  const service = new PasswordRecoveryService(
    repository as unknown as PasswordRecoveryRepository,
    passwords,
  );
  assert.deepEqual(
    await service.forgot('known@example.com'),
    await service.forgot('unknown@example.com'),
  );
  await assert.rejects(service.reset('token', 'NouveauMotDePasse2026!'), {
    status: 400,
  });
  valid = true;
  assert.ok((await service.reset('token', 'NouveauMotDePasse2026!')).success);
  const broken = new PasswordRecoveryService(
    {
      request: () => Promise.reject(new Error('private_driver')),
    } as unknown as PasswordRecoveryRepository,
    passwords,
  );
  await assert.rejects(broken.forgot('awa@example.com'));
});
