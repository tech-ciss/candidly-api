import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { validateEnvironment } from '../../src/config/env.validation.js';

// Aucun repli implicite sur une URL de développement ou de production.
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test') {
  throw new Error(
    'Définir NODE_ENV=test et INTEGRATION_DATABASE_URL vers une base locale dédiée.',
  );
}
const url = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('Les tests d’intégration exigent une base sur localhost.');
}
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);

void test(
  'connexion Prisma réelle à PostgreSQL et fermeture propre',
  { timeout: 10000 },
  async () => {
    const prisma = new PrismaService(config);
    try {
      await prisma.onModuleInit();
      const rows = await prisma.$queryRaw<
        { value: number }[]
      >`SELECT 1::int AS value`;
      assert.deepEqual(rows, [{ value: 1 }]);
    } finally {
      await prisma.onModuleDestroy();
    }
  },
);

void test(
  'connexion réelle Redis et fermeture de la sonde',
  { timeout: 10000 },
  async () => {
    const redis = new RedisService(config);
    try {
      await redis.ping();
    } finally {
      redis.onModuleDestroy();
    }
  },
);

void test(
  'une base indisponible fait échouer le démarrage sans fuite de secret',
  { timeout: 10000 },
  async () => {
    const unavailable = new URL(databaseUrl);
    unavailable.port = '1';
    const prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: unavailable.toString() }),
    );
    try {
      await assert.rejects(prisma.onModuleInit(), {
        message: 'Connexion PostgreSQL impossible.',
      });
    } finally {
      await prisma.onModuleDestroy();
    }
  },
);

void test(
  'une sonde Redis indisponible échoue dans un délai borné',
  { timeout: 5000 },
  async () => {
    const redis = new RedisService(
      new ConfigService({ REDIS_HOST: '127.0.0.1', REDIS_PORT: 1 }),
    );
    try {
      await assert.rejects(redis.ping());
    } finally {
      redis.onModuleDestroy();
    }
  },
);
