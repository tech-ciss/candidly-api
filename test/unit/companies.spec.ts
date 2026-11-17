import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  companyName,
  normalizedCompanyName,
} from '../../src/modules/companies/company-name.js';
import {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesDto,
} from '../../src/modules/companies/dto/companies.dto.js';
import { companyFilter } from '../../src/modules/companies/companies.repository.js';
import { CompaniesService } from '../../src/modules/companies/companies.service.js';
import type { CompaniesRepository } from '../../src/modules/companies/companies.repository.js';
import { actorFromVerifiedSession } from '../../src/common/authorization/authenticated-actor.js';
import { randomUUID } from 'node:crypto';
import { auditData } from '../../src/modules/audit/audit-log.js';
const actor = actorFromVerifiedSession(randomUUID(), randomUUID());
void test('nom NFC, espaces Unicode, casse, accents conservés et normalisation déterministe', () => {
  assert.equal(
    companyName('  E\u0301cole\t  Côte\u00a0Ivoire  '),
    'École Côte Ivoire',
  );
  assert.equal(normalizedCompanyName(' ÉCOLE  Côte '), 'école côte');
  assert.notEqual(normalizedCompanyName('Côte'), normalizedCompanyName('Cote'));
  assert.equal(normalizedCompanyName('İ'.repeat(150)).length, 300);
});
void test('DTO création/update : types, bornes, URL, null facultatif, inconnus et nom obligatoire', async () => {
  for (const data of [
    {},
    { name: '' },
    { name: '  ' },
    { name: null },
    { name: 1 },
    { name: {} },
    { name: 'a'.repeat(151) },
    { name: 'A', website: 'ftp://example.com' },
    { name: 'A', website: '/local' },
    { name: 'A', notes: 'x'.repeat(5001) },
    { name: 'A', userId: randomUUID() },
    { name: 'A', city: '' },
  ])
    assert.ok(
      (
        await validate(plainToInstance(CreateCompanyDto, data), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
      JSON.stringify(data),
    );
  for (const data of [
    { name: 'A', website: 'https://example.com' },
    { name: 'A', notes: null },
    { name: ' École ', city: ' Abidjan ' },
  ])
    assert.equal(
      (await validate(plainToInstance(CreateCompanyDto, data))).length,
      0,
    );
  assert.ok(
    (await validate(plainToInstance(UpdateCompanyDto, { name: null }))).length >
      0,
  );
  assert.equal(
    (await validate(plainToInstance(UpdateCompanyDto, { notes: null }))).length,
    0,
  );
});
void test('query stricte, pagination bornée et recherche OR séparée des filtres', async () => {
  for (const query of [
    { page: '0' },
    { page: '1.2' },
    { page: '1e2' },
    { page: ' 1' },
    { limit: '101' },
    { limit: ['2'] },
    { status: null },
    { sortBy: 'userId' },
    { sortOrder: 'DROP' },
    { search: {} },
    { search: '' },
    { userId: randomUUID() },
  ])
    assert.ok(
      (
        await validate(plainToInstance(ListCompaniesDto, query), {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length > 0,
    );
  const query = plainToInstance(ListCompaniesDto, {
    page: '2',
    limit: '5',
    search: 'Orange',
    city: 'Abidjan',
  });
  assert.equal((await validate(query)).length, 0);
  assert.equal(query.page, 2);
  assert.equal(query.limit, 5);
  assert.deepEqual(companyFilter(query), {
    status: 'ACTIVE',
    city: { equals: 'Abidjan', mode: 'insensitive' },
    OR: ['name', 'industry', 'city'].map((key) => ({
      [key]: { contains: 'Orange', mode: 'insensitive' },
    })),
  });
});
void test('service : conflits DB normalisés et refus des patch vides', async () => {
  const repository = {
    create: () =>
      Promise.reject(Object.assign(new Error('Duplicate'), { code: 'P2002' })),
    delete: () =>
      Promise.reject(Object.assign(new Error('Related'), { code: 'P2003' })),
  } as unknown as CompaniesRepository;
  const service = new CompaniesService(repository);
  await assert.rejects(service.create(actor, { name: 'A' }), { status: 409 });
  await assert.rejects(service.delete(actor, randomUUID()), { status: 409 });
  assert.throws(() => service.update(actor, randomUUID(), {}), { status: 400 });
});
void test('audit Companies : acteur/cible seulement, aucun nom/site/notes dans metadata', () => {
  for (const eventType of [
    'COMPANY_CREATED',
    'COMPANY_UPDATED',
    'COMPANY_ARCHIVED',
    'COMPANY_RESTORED',
    'COMPANY_DELETED',
  ] as const) {
    const data = auditData({
      eventType,
      actorUserId: actor.userId,
      targetType: 'COMPANY',
      targetId: randomUUID(),
    });
    assert.equal(data.outcome, 'SUCCESS');
    assert.deepEqual(data.metadata, {});
  }
  assert.throws(() =>
    auditData({
      eventType: 'COMPANY_CREATED',
      metadata: { name: 'Secret' },
    } as unknown as Parameters<typeof auditData>[0]),
  );
});
