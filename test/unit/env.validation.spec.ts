import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { environment } from '../support/environment.js';

void test('valide et convertit uniquement les ports déclarés', () => {
  const result = validateEnvironment(environment);
  assert.equal(result.PORT, 3001);
  assert.equal(result.REDIS_PORT, 6379);
  assert.equal(result.NODE_ENV, 'test');
});

for (const name of Object.keys(environment)) {
  void test(`refuse la variable obligatoire absente : ${name}`, () => {
    const input: Record<string, unknown> = { ...environment };
    delete input[name];
    assert.throws(() => validateEnvironment(input), new RegExp(name));
  });
}

for (const value of ['0', '65536', '3.5', '1e3', 'abc', 3001]) {
  void test(`refuse un port invalide (${String(value)})`, () => {
    assert.throws(
      () => validateEnvironment({ ...environment, PORT: value }),
      /PORT/,
    );
  });
}

for (const value of [
  '*',
  'https://example.com/path',
  'https://user:password@example.com',
  'null',
]) {
  void test(`refuse une origine CORS invalide (${value})`, () => {
    assert.throws(
      () => validateEnvironment({ ...environment, CORS_ORIGIN: value }),
      /CORS_ORIGIN/,
    );
  });
}

void test('accepte plusieurs origines explicites et refuse les URL de base invalides sans fuite', () => {
  assert.doesNotThrow(() =>
    validateEnvironment({
      ...environment,
      CORS_ORIGIN: 'https://example.com,http://localhost:3000',
    }),
  );
  const secret = 'secret_that_must_not_appear';
  assert.throws(
    () =>
      validateEnvironment({
        ...environment,
        NODE_ENV: 'invalid',
        DATABASE_URL: secret,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /NODE_ENV/);
      assert.match(error.message, /DATABASE_URL/);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});
