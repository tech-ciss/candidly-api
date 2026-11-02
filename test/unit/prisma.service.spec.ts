import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { environment } from '../support/environment.js';

void test('Prisma se connecte, vérifie la base et ferme sa connexion au shutdown', async (context) => {
  const prisma = new PrismaService(new ConfigService(environment));
  // Le client Prisma est un proxy : substituer les fonctions directement.
  const connect = context.mock.fn(() => Promise.resolve());
  const ping = context.mock.fn(() => Promise.resolve());
  const disconnect = context.mock.fn(() => Promise.resolve());
  prisma.$connect = connect;
  prisma.ping = ping;
  prisma.$disconnect = disconnect;
  await prisma.onModuleInit();
  await prisma.onModuleDestroy();
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(ping.mock.callCount(), 1);
  assert.equal(disconnect.mock.callCount(), 1);
});

void test('un échec de connexion initiale est explicite et expurgé', async (context) => {
  const prisma = new PrismaService(new ConfigService(environment));
  prisma.$connect = () => Promise.reject(new Error('private_database_url'));
  const disconnect = context.mock.fn(() => Promise.resolve());
  prisma.$disconnect = disconnect;
  await assert.rejects(prisma.onModuleInit(), {
    message: 'Connexion PostgreSQL impossible.',
  });
  assert.equal(disconnect.mock.callCount(), 1);
});
