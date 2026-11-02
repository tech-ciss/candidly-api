import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsInt } from 'class-validator';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';

// Fixtures HTTP techniques réservées au module de test, jamais exposées par l'application.
class ProbeDto {
  @IsInt()
  value!: number;
}
@Controller('probe')
class ProbeController {
  @Post()
  validate(@Body() body: ProbeDto): ProbeDto {
    return body;
  }

  @Get('error')
  fail(): never {
    throw new Error('private_driver_password');
  }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

let app: INestApplication;
let server: Server;
let databaseUp = true;
let redisUp = true;

before(async () => {
  Object.assign(process.env, environment);
  const { AppModule } = await import('../../src/app.module.js');
  const builder = Test.createTestingModule({
    imports: [AppModule, ProbeModule],
  })
    .overrideProvider(PrismaService)
    .useValue({
      ping: () =>
        databaseUp
          ? Promise.resolve()
          : Promise.reject(new Error('private_database_url')),
    })
    .overrideProvider(RedisService)
    .useValue({
      ping: () =>
        redisUp
          ? Promise.resolve()
          : Promise.reject(new Error('private_redis_host')),
    });
  const module = await builder.compile();
  app = module.createNestApplication({ logger: false });
  setupApplication(app);
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer() as Server;
});
after(async () => {
  await app?.close();
});

void test('le module principal démarre et health est versionné', async () => {
  const result = await request(server).get('/api/v1/health').expect(200);
  assert.deepEqual(result.body, {
    status: 'ok',
    services: { database: 'up', redis: 'up' },
  });
  await request(server).get('/health').expect(404);
});

void test('Swagger documente le chemin versionné et les réponses 200/503', async () => {
  await request(server).get('/docs/').expect(200);
  const result = await request(server).get('/docs-json').expect(200);
  const doc = result.body as {
    info: { title: string };
    paths: Record<string, { get: { responses: Record<string, unknown> } }>;
  };
  assert.equal(doc.info.title, 'Candidly API');
  const route = doc.paths['/api/v1/health'];
  assert.ok(route?.get.responses['200']);
  assert.ok(route.get.responses['503']);
});

for (const dependency of ['database', 'redis'] as const) {
  void test(`health répond 503 lorsque ${dependency} est indisponible`, async () => {
    databaseUp = dependency !== 'database';
    redisUp = dependency !== 'redis';
    try {
      const result = await request(server)
        .get('/api/v1/health?token=private_query')
        .expect(503);
      const body = result.body as {
        success: boolean;
        error: { code: string };
        path: string;
        services: Record<string, string>;
      };
      assert.equal(body.success, false);
      assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
      assert.equal(body.path, '/api/v1/health');
      assert.equal(body.services[dependency], 'down');
      assert.ok(!JSON.stringify(body).includes('private_'));
    } finally {
      databaseUp = true;
      redisUp = true;
    }
  });
}

void test('les erreurs inattendues sont normalisées et sans stack ni secret', async () => {
  const result = await request(server).get('/api/v1/probe/error').expect(500);
  const body = result.body as { error: { code: string }; timestamp: string };
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  assert.ok(!JSON.stringify(body).includes('private_driver_password'));
  assert.ok(!JSON.stringify(body).includes('stack'));
});

void test('le ValidationPipe refuse les propriétés inconnues et les conversions implicites', async () => {
  await request(server).post('/api/v1/probe').send({ value: 1 }).expect(201);
  await request(server)
    .post('/api/v1/probe')
    .send({ value: 1, unexpected: true })
    .expect(400);
  await request(server).post('/api/v1/probe').send({ value: '1' }).expect(400);
});

void test('Helmet et CORS limitent les origines explicitement autorisées', async () => {
  const allowed = await request(server)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:3000')
    .expect(200);
  assert.equal(
    allowed.headers['access-control-allow-origin'],
    'http://localhost:3000',
  );
  assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
  const denied = await request(server)
    .get('/api/v1/health')
    .set('Origin', 'https://untrusted.example')
    .expect(200);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

void test('Swagger n’est pas monté en production', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  let production: INestApplication | undefined;
  try {
    const { AppModule } = await import('../../src/app.module.js');
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ping: () => Promise.resolve() })
      .overrideProvider(RedisService)
      .useValue({ ping: () => Promise.resolve() })
      .compile();
    production = module.createNestApplication({ logger: false });
    setupApplication(production);
    await production.listen(0, '127.0.0.1');
    await request(production.getHttpServer() as Server)
      .get('/docs/')
      .expect(404);
    await request(production.getHttpServer() as Server)
      .get('/docs-json')
      .expect(404);
  } finally {
    await production?.close();
    process.env.NODE_ENV = previous;
  }
});
