import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service.js';
import { CompaniesRepository } from '../../src/modules/companies/companies.repository.js';
import { CompaniesService } from '../../src/modules/companies/companies.service.js';
import { ListCompaniesDto } from '../../src/modules/companies/dto/companies.dto.js';
import { actorFromVerifiedSession } from '../../src/common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import { validateEnvironment } from '../../src/config/env.validation.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { AuthRateLimitStore } from '../../src/modules/auth/auth-rate-limit.store.js';
const databaseUrl = process.env.INTEGRATION_DATABASE_URL;
if (!databaseUrl || process.env.NODE_ENV !== 'test')
  throw new Error('Base de test explicite requise.');
const url = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
  !url.pathname.endsWith('_test')
)
  throw new Error('Base locale dédiée obligatoire.');
const config = new ConfigService(
  validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
);
const prisma = new PrismaService(config);
const repository = new CompaniesRepository(prisma);
const service = new CompaniesService(repository);
const prefix = 'cand011-' + randomUUID();
const ids: string[] = [];
let a: AuthenticatedActor, b: AuthenticatedActor;
const password = 'PhraseEntreprises2026!';
before(async () => {
  await prisma.onModuleInit();
  const hash = await new PasswordService().hash(password);
  for (const label of ['a', 'b']) {
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${label}@example.com`,
        firstName: 'Fixture',
        lastName: label,
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      },
    });
    ids.push(user.id);
  }
  a = actorFromVerifiedSession(ids[0]!, randomUUID());
  b = actorFromVerifiedSession(ids[1]!, randomUUID());
});
after(async () => {
  await prisma.company.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.onModuleDestroy();
});
const query = (data: Partial<ListCompaniesDto> = {}) =>
  Object.assign(new ListCompaniesDto(), data);
void test('unicité DB par propriétaire, Unicode NFC, collision création concurrente et archivage inclus', async () => {
  const attempts = await Promise.allSettled([
    service.create(a, { name: '  École   Côte ' }),
    service.create(a, { name: 'E\u0301COLE Côte' }),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  const failure = attempts.find(
    (r) => r.status === 'rejected',
  ) as PromiseRejectedResult;
  assert.equal((failure.reason as { status: number }).status, 409);
  const row = await service.create(b, { name: 'École Côte' });
  assert.equal((await service.get(b, row.id)).name, 'École Côte');
  await assert.rejects(service.get(a, row.id), { status: 404 });
  const own = (await service.list(a, query({ search: 'École' }))).data[0]!;
  await service.archive(a, own.id);
  await assert.rejects(service.create(a, { name: 'école côte' }), {
    status: 409,
  });
});
void test('recherche nom/secteur/ville, filtres, count privé, tri déterministe et snapshot pendant écritures', async () => {
  for (const [actor, name, industry, city] of [
    [a, 'Alpha', 'Tech', 'Abidjan'],
    [a, 'Beta', 'Finance', 'Dakar'],
    [a, 'Gamma', 'Tech', 'Abidjan'],
    [b, 'Alpha', 'Tech', 'Abidjan'],
  ] as const)
    await service.create(actor, {
      name,
      industry,
      city,
      country: 'Côte d’Ivoire',
    });
  await service.create(a, {
    name: 'Literal 100%_\\ test',
    industry: 'Sector_%\\',
  });
  assert.equal(
    (await service.list(a, query({ industry: 'sector_%\\' }))).meta.total,
    1,
  );
  const literal = await service.list(a, query({ search: '%_\\' }));
  assert.equal(literal.meta.total, 1);
  assert.equal(literal.data[0]!.name, 'Literal 100%_\\ test');
  const result = await service.list(
    a,
    query({
      search: 'tech',
      country: 'côte d’ivoire',
      city: 'abidjan',
      limit: 1,
    }),
  );
  assert.equal(result.meta.total, 2);
  assert.equal(result.meta.totalPages, 2);
  assert.equal(result.data[0]!.name, 'Alpha');
  assert.equal(
    (await service.list(a, query({ search: 'dakar' }))).meta.total,
    1,
  );
  const page2 = await service.list(
    a,
    query({ industry: 'TECH', page: 2, limit: 1 }),
  );
  assert.equal(page2.data[0]!.name, 'Gamma');
  const item = page2.data[0]!;
  const [list] = await Promise.all([
    service.list(a, query({ search: 'Gamma' })),
    service.update(a, item.id, { name: 'Gamma updated' }),
  ]);
  assert.equal(list.data.length, list.meta.total);
  const desc = await service.list(
    a,
    query({ sortBy: 'createdAt', sortOrder: 'desc' }),
  );
  assert.ok(
    desc.data.every(
      (row, index) =>
        index === 0 ||
        desc.data[index - 1]!.createdAt.getTime() >= row.createdAt.getTime(),
    ),
  );
  const updatedSort = await service.list(
    a,
    query({ sortBy: 'updatedAt', sortOrder: 'desc' }),
  );
  assert.ok(
    updatedSort.data.every(
      (row, index) =>
        index === 0 ||
        updatedSort.data[index - 1]!.updatedAt.getTime() >=
          row.updatedAt.getTime(),
    ),
  );
  const nameSort = await service.list(
    a,
    query({ sortBy: 'name', sortOrder: 'desc', search: 'a' }),
  );
  assert.equal(nameSort.data[0]!.name, 'Literal 100%_\\ test');
  assert.ok(
    desc.data.every((row) => !('userId' in row) && !('normalizedName' in row)),
  );
});
void test('mutations étrangères/inconnues identiques, collisions update concurrentes, propriétaire immuable', async () => {
  const one = await service.create(a, { name: 'Concurrent One' });
  const two = await service.create(a, { name: 'Concurrent Two' });
  const attempts = await Promise.allSettled([
    service.update(a, one.id, { name: 'Concurrent Target' }),
    service.update(a, two.id, { name: 'Concurrent Target' }),
  ]);
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      (attempts.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason as { status: number }
    ).status,
    409,
  );
  for (const id of [one.id, randomUUID()])
    for (const action of [
      () => service.get(b, id),
      () => service.update(b, id, { notes: 'secret' }),
      () => service.archive(b, id),
      () => service.restore(b, id),
      () => service.delete(b, id),
    ])
      await assert.rejects(action(), { status: 404 });
  assert.equal(
    (await prisma.company.findUniqueOrThrow({ where: { id: one.id } })).userId,
    a.userId,
  );
});
void test('archive/restauration concurrentes idempotentes, dates préservées, suppression concurrente et historique conservé', async () => {
  const row = await service.create(a, { name: 'Lifecycle' });
  const archived = await Promise.all([
    service.archive(a, row.id),
    service.archive(a, row.id),
  ]);
  assert.equal(
    archived[0].archivedAt!.getTime(),
    archived[1].archivedAt!.getTime(),
  );
  assert.equal((await service.get(a, row.id)).status, 'ARCHIVED');
  assert.equal(
    (await service.list(a, query({ search: 'Lifecycle' }))).meta.total,
    0,
  );
  assert.equal(
    (await service.list(a, query({ search: 'Lifecycle', status: 'ARCHIVED' })))
      .meta.total,
    1,
  );
  await Promise.all([service.restore(a, row.id), service.restore(a, row.id)]);
  assert.equal((await service.get(a, row.id)).archivedAt, null);
  const outcomes = await Promise.allSettled([
    service.delete(a, row.id),
    service.delete(a, row.id),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (
      (outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult)
        .reason as { status: number }
    ).status,
    404,
  );
  const logs = await prisma.auditLog.findMany({ where: { targetId: row.id } });
  assert.deepEqual(
    logs.map((l) => l.eventType).sort(),
    [
      'COMPANY_CREATED',
      'COMPANY_ARCHIVED',
      'COMPANY_RESTORED',
      'COMPANY_DELETED',
    ].sort(),
  );
  for (const log of logs) {
    assert.equal(log.actorUserId, a.userId);
    assert.equal(log.targetType, 'COMPANY');
    assert.deepEqual(log.metadata, {});
  }
});
void test('audit indisponible : rollback réel création, update, archive, restauration et suppression', async () => {
  const row = await service.create(a, {
    name: 'Rollback',
    notes: 'confidentiel',
  });
  const broken = prisma.$extends({
    query: {
      auditLog: {
        create() {
          return Promise.reject(new Error('audit test'));
        },
      },
    },
  });
  const failing = new CompaniesService(
    new CompaniesRepository(broken as unknown as PrismaService),
  );
  await assert.rejects(failing.create(a, { name: 'Rollback absent' }));
  assert.equal(
    await prisma.company.count({
      where: { userId: a.userId, name: 'Rollback absent' },
    }),
    0,
  );
  await assert.rejects(failing.update(a, row.id, { notes: null }));
  assert.equal((await service.get(a, row.id)).notes, 'confidentiel');
  await assert.rejects(failing.archive(a, row.id));
  assert.equal((await service.get(a, row.id)).status, 'ACTIVE');
  await service.archive(a, row.id);
  await assert.rejects(failing.restore(a, row.id));
  assert.equal((await service.get(a, row.id)).status, 'ARCHIVED');
  await assert.rejects(failing.delete(a, row.id));
  assert.ok(await service.get(a, row.id));
});
void test('contraintes SQL statut/date et FK RESTRICT empêchent les suppressions implicites', async () => {
  await assert.rejects(
    prisma.company.create({
      data: {
        userId: a.userId,
        name: 'Invalid archive',
        normalizedName: 'invalid archive',
        status: 'ARCHIVED',
      },
    }),
  );
  await assert.rejects(prisma.user.delete({ where: { id: a.userId } }));
  assert.ok(await prisma.user.findUnique({ where: { id: a.userId } }));
});
void test('HTTP réel : sessions/JWT, CRUD, validation, 404 identique, audits corrélés et Swagger', async () => {
  const { Test } = await import('@nestjs/testing');
  const { default: request } = await import('supertest');
  const { setupApplication } =
    await import('../../src/config/setup-application.js');
  Object.assign(process.env, { DATABASE_URL: databaseUrl });
  const { AppModule } = await import('../../src/app.module.js');
  const rate = new AuthRateLimitStore(config);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuthRateLimitStore)
    .useValue({
      consume: (route: string, ip: string, limit: number) =>
        rate.consume(prefix + route, ip, limit),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  setupApplication(app);
  try {
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as import('node:http').Server;
    const auths: string[] = [];
    for (const label of ['a', 'b']) {
      const login = await request(server)
        .post('/api/v1/auth/login')
        .set({ Origin: 'http://localhost:3000', 'X-Candidly-CSRF': '1' })
        .send({ email: `${prefix}-${label}@example.com`, password })
        .expect(200);
      auths.push(
        'Bearer ' + (login.body as { accessToken: string }).accessToken,
      );
    }
    const authorization = auths[0]!;
    await request(server).get('/api/v1/companies').expect(401);
    const create = await request(server)
      .post('/api/v1/companies')
      .set('Authorization', authorization)
      .send({
        name: 'HTTP Company',
        notes: 'note privée',
        website: 'https://example.com',
      })
      .expect(201);
    const id = (create.body as { id: string }).id;
    for (const forbidden of ['userId', 'normalizedName', 'passwordHash'])
      assert.ok(!(forbidden in (create.body as object)));
    await request(server)
      .post('/api/v1/companies')
      .set('Authorization', authorization)
      .send({ name: ' http company ' })
      .expect(409);
    const updated = await request(server)
      .patch('/api/v1/companies/' + id)
      .set('Authorization', authorization)
      .send({ notes: null })
      .expect(200);
    assert.equal((updated.body as { notes: null }).notes, null);
    const errors = [];
    for (const target of [id, randomUUID()]) {
      const response = await request(server)
        .get('/api/v1/companies/' + target)
        .set('Authorization', auths[1]!)
        .expect(404);
      errors.push((response.body as { error: object }).error);
      for (const verb of ['patch', 'delete', 'post'] as const)
        await request(server)
          [verb](
            '/api/v1/companies/' + target + (verb === 'post' ? '/archive' : ''),
          )
          .set('Authorization', auths[1]!)
          .send(verb === 'patch' ? { name: 'stolen' } : {})
          .expect(404);
    }
    assert.deepEqual(errors[0], errors[1]);
    for (const data of [
      { name: 'X', userId: ids[1] },
      { name: null },
      { name: 'X', status: 'ACTIVE' },
      { name: 'X', website: 'javascript:alert(1)' },
    ])
      await request(server)
        .post('/api/v1/companies')
        .set('Authorization', authorization)
        .send(data)
        .expect(400);
    await request(server)
      .patch('/api/v1/companies/' + id)
      .set('Authorization', authorization)
      .send({})
      .expect(400);
    for (const suffix of ['?limit=101', '?page=1e2', '?userId=' + ids[1]])
      await request(server)
        .get('/api/v1/companies' + suffix)
        .set('Authorization', authorization)
        .expect(400);
    const list = await request(server)
      .get('/api/v1/companies?search=HTTP&limit=1')
      .set('Authorization', authorization)
      .expect(200);
    assert.equal((list.body as { meta: { total: number } }).meta.total, 1);
    await request(server)
      .post('/api/v1/companies/' + id + '/archive')
      .set('Authorization', authorization)
      .expect(200);
    const archived = await request(server)
      .get('/api/v1/companies?status=ARCHIVED&search=HTTP')
      .set('Authorization', authorization)
      .expect(200);
    assert.equal((archived.body as { meta: { total: number } }).meta.total, 1);
    await request(server)
      .post('/api/v1/companies/' + id + '/restore')
      .set('Authorization', authorization)
      .expect(200);
    await request(server)
      .delete('/api/v1/companies/' + id)
      .set('Authorization', authorization)
      .expect(204);
    const audits = await prisma.auditLog.findMany({ where: { targetId: id } });
    assert.equal(audits.length, 5);
    assert.equal(
      audits.find((l) => l.eventType === 'COMPANY_CREATED')!.requestId,
      String(create.headers['x-request-id']),
    );
    const serialized = JSON.stringify(audits);
    for (const secret of ['HTTP Company', 'note privée', 'https://example.com'])
      assert.ok(!serialized.includes(secret));
    const docs = await request(server).get('/docs-json').expect(200);
    assert.ok('/api/v1/companies' in (docs.body as { paths: object }).paths);
  } finally {
    rate.onModuleDestroy();
    await app.close();
  }
});
