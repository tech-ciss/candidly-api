import { request as httpRequest } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { proxyTrust } from '../../src/config/proxy-trust.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Controller, Get, Module, HttpException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';
@Controller('security-test')
class SecurityProbe {
  @Get('fail') fail(): never {
    throw new Error('private_database_secret');
  }
  @Get('forbidden') forbidden(): never {
    throw new HttpException('private_permission', 403);
  }
}
@Module({ controllers: [SecurityProbe] })
class ProbeModule {}
let app: INestApplication;
let server: Server;
let ipSeen = '';
const logs: string[] = [];
let original: typeof process.stdout.write;
before(async () => {
  Object.assign(process.env, environment);
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({
    imports: [AppModule, ProbeModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(RedisService)
    .useValue({ ping: () => Promise.resolve() })
    .overrideProvider(AuthRateLimitStore)
    .useValue({
      consume: (_route: string, ip: string) => {
        ipSeen = ip;
        return Promise.resolve(false);
      },
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  setupApplication(app);
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer() as Server;
  original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    const line = String(chunk);
    if (line.startsWith('{')) logs.push(line);
    else original.call(process.stdout, chunk);
    return true;
  };
});
after(async () => {
  process.stdout.write = original;
  await app?.close();
});
void test('request ID nouveau à chaque requête, client ignoré et exposition CORS explicite', async () => {
  const first = await request(server)
    .get('/api/v1/health')
    .set('X-Request-Id', 'private_client_id')
    .set('Origin', 'http://localhost:3000')
    .expect(200);
  const second = await request(server).get('/api/v1/health').expect(200);
  assert.match(String(first.headers['x-request-id']), /^[a-f0-9-]{36}$/i);
  assert.notEqual(
    first.headers['x-request-id'],
    second.headers['x-request-id'],
  );
  assert.notEqual(first.headers['x-request-id'], 'private_client_id');
  assert.equal(first.headers['access-control-expose-headers'], 'X-Request-Id');
});
void test('limite JSON explicite et erreurs parser normalisées avec corrélation, Helmet et CORS', async () => {
  for (const [payload, status] of [
    [JSON.stringify({ value: 'x'.repeat(20000) }), 413],
    ['{"password":"private_body",', 400],
  ] as const) {
    const result = await request(server)
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .type('json')
      .send(payload)
      .expect(status);
    assert.ok(result.headers['x-request-id']);
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    assert.equal(
      result.headers['access-control-allow-origin'],
      'http://localhost:3000',
    );
    assert.ok(!JSON.stringify(result.body).includes('private_body'));
  }
});
void test('erreurs 401/403/404/429/500 sans stack ou secrets, logs corrélés sans URL/query/body', async () => {
  const responses = [
    await request(server).get('/api/v1/auth/me').expect(401),
    await request(server).get('/api/v1/security-test/forbidden').expect(403),
    await request(server)
      .get('/private_path_token?token=private_query')
      .expect(404),
    await request(server)
      .post('/api/v1/auth/login')
      .send({ password: 'private_password' })
      .expect(429),
    await request(server).get('/api/v1/security-test/fail').expect(500),
  ];
  for (const result of responses) {
    assert.ok(result.headers['x-request-id']);
    const body = JSON.stringify(result.body);
    assert.ok(
      !body.includes('stack') &&
        !body.includes('private_database_secret') &&
        !body.includes('private_password'),
    );
  }
  const records = logs.map(
    (line) =>
      JSON.parse(line) as {
        event: string;
        requestId: string;
        statusCode?: number;
        durationMs?: number;
      },
  );
  for (const result of responses)
    assert.ok(
      records.some(
        (record) =>
          record.event === 'http.completed' &&
          record.requestId === result.headers['x-request-id'] &&
          record.statusCode === result.status &&
          typeof record.durationMs === 'number',
      ),
    );
  assert.ok(!logs.join('').includes('private_'));
});
void test('X-Forwarded-For falsifié n’influence pas le limiteur sans proxy de confiance', async () => {
  await request(server)
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', '203.0.113.10')
    .send({})
    .expect(429);
  assert.ok(ipSeen.includes('127.0.0.1'));
  assert.notEqual(ipSeen, '203.0.113.10');
});
void test('Swagger local servi sous Helmet sans politique CSP ajoutée et informations techniques absentes', async () => {
  const html = await request(server).get('/docs/').expect(200);
  await request(server).get('/docs/swagger-ui-bundle.js').expect(200);
  assert.ok(html.headers['content-security-policy']);
  assert.equal(html.headers['x-powered-by'], undefined);
  assert.equal(html.headers['server'], undefined);
});

void test('proxy exact : seul le pair connu peut transmettre une IP client', async () => {
  const expressApp = app as NestExpressApplication;
  expressApp.set('trust proxy', proxyTrust('127.0.0.1'));
  try {
    await request(server)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({})
      .expect(429);
    assert.equal(ipSeen, '203.0.113.10');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const client = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          path: '/api/v1/auth/login',
          method: 'POST',
          localAddress: '127.0.0.2',
          headers: { 'X-Forwarded-For': '203.0.113.10', 'Content-Length': '0' },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      client.on('error', reject);
      client.end();
    });
    assert.equal(status, 429);
    assert.equal(ipSeen, '127.0.0.2');
  } finally {
    expressApp.set('trust proxy', proxyTrust(''));
  }
});
