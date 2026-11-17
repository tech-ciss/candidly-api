import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/modules/health/redis.service.js';
import { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
import { CompaniesRepository } from '../../src/modules/companies/companies.repository.js';
import type {
  CompanyDto,
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesDto,
} from '../../src/modules/companies/dto/companies.dto.js';
import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import { requireActor } from '../../src/common/authorization/authenticated-actor.js';
import { privateResource } from '../../src/common/authorization/ownership.js';
import { normalizedCompanyName } from '../../src/modules/companies/company-name.js';
import { setupApplication } from '../../src/config/setup-application.js';
import { environment } from '../support/environment.js';
let app: INestApplication, server: Server;
const owners: string[] = [randomUUID(), randomUUID()];
const rows = new Map<string, CompanyDto & { userId: string }>();
const publicRow = (row: CompanyDto & { userId: string }) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'userId'));
function owned(actor: AuthenticatedActor, id: string) {
  requireActor(actor);
  const row = rows.get(id);
  return privateResource(row?.userId === actor.userId ? row : null);
}
const repository = {
  create: (actor: AuthenticatedActor, data: CreateCompanyDto) => {
    requireActor(actor);
    if (
      [...rows.values()].some(
        (row) =>
          row.userId === actor.userId &&
          normalizedCompanyName(row.name) === normalizedCompanyName(data.name),
      )
    )
      throw Object.assign(new Error('Duplicate'), { code: 'P2002' });
    const row = {
      id: randomUUID(),
      userId: actor.userId,
      industry: null,
      website: null,
      country: null,
      city: null,
      address: null,
      description: null,
      notes: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      ...data,
    };
    rows.set(row.id, row);
    return publicRow(row);
  },
  get: (actor: AuthenticatedActor, id: string) => publicRow(owned(actor, id)),
  update: (actor: AuthenticatedActor, id: string, data: UpdateCompanyDto) => {
    const row = owned(actor, id);
    Object.assign(row, data);
    return publicRow(row);
  },
  transition: (actor: AuthenticatedActor, id: string, archive: boolean) => {
    const row = owned(actor, id);
    row.status = archive ? 'ARCHIVED' : 'ACTIVE';
    row.archivedAt = archive ? new Date() : null;
    return publicRow(row);
  },
  delete: (actor: AuthenticatedActor, id: string) => {
    owned(actor, id);
    rows.delete(id);
  },
  list: (actor: AuthenticatedActor, query: ListCompaniesDto) => {
    requireActor(actor);
    const data = [...rows.values()].filter(
      (row) =>
        row.userId === actor.userId &&
        row.status === query.status &&
        (!query.search ||
          row.name.toLowerCase().includes(query.search.toLowerCase())),
    );
    return {
      data: data
        .slice((query.page - 1) * query.limit, query.page * query.limit)
        .map(publicRow),
      meta: {
        page: query.page,
        limit: query.limit,
        total: data.length,
        totalPages: Math.ceil(data.length / query.limit),
      },
    };
  },
};
const bearers: string[] = [];
before(async () => {
  Object.assign(process.env, environment);
  const { AppModule } = await import('../../src/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ ping: () => {} })
    .overrideProvider(RedisService)
    .useValue({ ping: () => {} })
    .overrideProvider(AuthRateLimitStore)
    .useValue({ consume: () => true })
    .overrideProvider(SessionRepository)
    .useValue({
      activeUser: (_sid: string, sub: string) =>
        owners.includes(sub) ? { id: sub, emailVerifiedAt: new Date() } : null,
    })
    .overrideProvider(CompaniesRepository)
    .useValue(repository)
    .compile();
  app = module.createNestApplication({ logger: false });
  setupApplication(app);
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer() as Server;
  for (const owner of owners)
    bearers.push(
      'Bearer ' +
        (await app
          .get(AccessTokenService)
          .sign(owner, randomUUID(), new Date(Date.now() + 3600000))),
    );
});
after(async () => {
  await app?.close();
});
void test('toutes les routes Companies exigent une session JWT', async () => {
  for (const [verb, suffix] of [
    ['get', ''],
    ['post', ''],
    ['get', '/' + randomUUID()],
    ['patch', '/' + randomUUID()],
    ['post', '/' + randomUUID() + '/archive'],
    ['post', '/' + randomUUID() + '/restore'],
    ['delete', '/' + randomUUID()],
  ] as const)
    await request(server)
      [verb]('/api/v1/companies' + suffix)
      .send({ name: 'A' })
      .expect(401);
});
void test('parcours Companies HTTP, validation stricte et absence de champs internes', async () => {
  const auth = bearers[0]!;
  const response = await request(server)
    .post('/api/v1/companies')
    .set('Authorization', auth)
    .send({ name: '  Orange  CI ' })
    .expect(201);
  const row = response.body as { id: string; name: string };
  assert.equal(row.name, 'Orange CI');
  assert.ok(!('userId' in row));
  assert.ok(!('normalizedName' in row));
  await request(server)
    .post('/api/v1/companies')
    .set('Authorization', auth)
    .send({ name: 'orange ci' })
    .expect(409);
  for (const body of [
    { name: 'X', userId: owners[1] },
    { name: 'X', id: randomUUID() },
    { name: 'X', normalizedName: 'x' },
    { name: 'X', status: 'ARCHIVED' },
    { name: 'X', archivedAt: null },
    { name: null },
    { name: 'X', notes: {} },
    { name: 'X', website: 'ftp://example.com' },
  ])
    await request(server)
      .post('/api/v1/companies')
      .set('Authorization', auth)
      .send(body)
      .expect(400);
  await request(server)
    .patch('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .send({ notes: null })
    .expect(200);
  await request(server)
    .patch('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .send({})
    .expect(400);
  await request(server)
    .patch('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .send({ name: null })
    .expect(400);
  const list = await request(server)
    .get('/api/v1/companies?search=Orange&limit=1')
    .set('Authorization', auth)
    .expect(200);
  assert.deepEqual((list.body as { meta: object }).meta, {
    page: 1,
    limit: 1,
    total: 1,
    totalPages: 1,
  });
  for (const suffix of [
    '?page=0',
    '?page=1e2',
    '?limit=101',
    '?sortBy=userId',
    '?status=DELETED',
    '?userId=' + owners[1],
  ])
    await request(server)
      .get('/api/v1/companies' + suffix)
      .set('Authorization', auth)
      .expect(400);
  await request(server)
    .post('/api/v1/companies/' + row.id + '/archive')
    .set('Authorization', auth)
    .send({ userId: owners[1] })
    .expect(400);
  await request(server)
    .post('/api/v1/companies/' + row.id + '/archive')
    .set('Authorization', auth)
    .expect(200);
  const archived = await request(server)
    .get('/api/v1/companies?status=ARCHIVED')
    .set('Authorization', auth)
    .expect(200);
  assert.equal((archived.body as { meta: { total: number } }).meta.total, 1);
  await request(server)
    .get('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .expect(200);
  const errors = [];
  for (const id of [row.id, randomUUID()]) {
    const response = await request(server)
      .get('/api/v1/companies/' + id)
      .set('Authorization', bearers[1]!)
      .expect(404);
    errors.push((response.body as { error: object }).error);
    await request(server)
      .patch('/api/v1/companies/' + id)
      .set('Authorization', bearers[1]!)
      .send({ notes: 'stolen' })
      .expect(404);
    await request(server)
      .post('/api/v1/companies/' + id + '/archive')
      .set('Authorization', bearers[1]!)
      .expect(404);
    await request(server)
      .post('/api/v1/companies/' + id + '/restore')
      .set('Authorization', bearers[1]!)
      .expect(404);
    await request(server)
      .delete('/api/v1/companies/' + id)
      .set('Authorization', bearers[1]!)
      .expect(404);
  }
  assert.deepEqual(errors[0], errors[1]);
  await request(server)
    .post('/api/v1/companies/' + row.id + '/restore')
    .set('Authorization', auth)
    .expect(200);
  await request(server)
    .delete('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .expect(204);
  await request(server)
    .get('/api/v1/companies/' + row.id)
    .set('Authorization', auth)
    .expect(404);
});
