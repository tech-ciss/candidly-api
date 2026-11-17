import { Injectable } from '@nestjs/common';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import { requireActor } from '../../common/authorization/authenticated-actor.js';
import {
  ownerWhere,
  ownedIdWhere,
  privateResource,
  requireAffected,
} from '../../common/authorization/ownership.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../audit/audit-log.js';
import type {
  CreateCompanyDto,
  UpdateCompanyDto,
  ListCompaniesDto,
} from './dto/companies.dto.js';
import { normalizedCompanyName } from './company-name.js';
export const companySelect = {
  id: true,
  name: true,
  industry: true,
  website: true,
  country: true,
  city: true,
  address: true,
  description: true,
  notes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
} as const;
function literalLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
export function companyFilter(
  query: ListCompaniesDto,
): Prisma.CompanyWhereInput {
  const search = query.search?.replace(
    /[\\%_]/g,
    (character) => `\\${character}`,
  );
  return {
    status: query.status,
    ...Object.fromEntries(
      ['industry', 'country', 'city'].flatMap((key) => {
        const value = query[key as 'industry' | 'country' | 'city'];
        return value === undefined
          ? []
          : [[key, { equals: literalLike(value), mode: 'insensitive' }]];
      }),
    ),
    ...(query.search
      ? {
          OR: ['name', 'industry', 'city'].map((key) => ({
            [key]: { contains: search, mode: 'insensitive' },
          })),
        }
      : {}),
  };
}
function editable(data: CreateCompanyDto | UpdateCompanyDto) {
  return {
    name: data.name,
    industry: data.industry,
    website: data.website,
    country: data.country,
    city: data.city,
    address: data.address,
    description: data.description,
    notes: data.notes,
    ...(data.name !== undefined
      ? { normalizedName: normalizedCompanyName(data.name) }
      : {}),
  };
}
@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(actor: AuthenticatedActor, data: CreateCompanyDto) {
    const { userId } = requireActor(actor);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.company.create({
        data: {
          ...editable(data),
          name: data.name,
          normalizedName: normalizedCompanyName(data.name),
          userId,
        },
        select: companySelect,
      });
      await writeAudit(tx, {
        eventType: 'COMPANY_CREATED',
        actorUserId: userId,
        targetType: 'COMPANY',
        targetId: row.id,
      });
      return row;
    });
  }
  async get(actor: AuthenticatedActor, id: string) {
    return privateResource(
      await this.prisma.company.findFirst({
        where: ownedIdWhere(actor, id),
        select: companySelect,
      }),
    );
  }
  list(actor: AuthenticatedActor, query: ListCompaniesDto) {
    const where = ownerWhere(actor, companyFilter(query));
    return this.prisma.$transaction(
      async (tx) => {
        const data = await tx.company.findMany({
          where,
          select: companySelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [
            { [query.sortBy]: query.sortOrder },
            { id: query.sortOrder },
          ],
        });
        const total = await tx.company.count({ where });
        return {
          data,
          meta: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  update(actor: AuthenticatedActor, id: string, data: UpdateCompanyDto) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.company.updateManyAndReturn({
        where: ownedIdWhere(actor, id),
        data: editable(data),
        select: companySelect,
      });
      const row = privateResource(rows[0]);
      await writeAudit(tx, {
        eventType: 'COMPANY_UPDATED',
        actorUserId: requireActor(actor).userId,
        targetType: 'COMPANY',
        targetId: id,
      });
      return row;
    });
  }
  transition(actor: AuthenticatedActor, id: string, archived: boolean) {
    const where = ownedIdWhere(actor, id);
    return this.prisma.$transaction(async (tx) => {
      // Seule une transition effective modifie les dates et produit un audit.
      const rows = await tx.company.updateManyAndReturn({
        where: { ...where, status: archived ? 'ACTIVE' : 'ARCHIVED' },
        data: {
          status: archived ? 'ARCHIVED' : 'ACTIVE',
          archivedAt: archived ? new Date() : null,
        },
        select: companySelect,
      });
      if (rows[0]) {
        await writeAudit(tx, {
          eventType: archived ? 'COMPANY_ARCHIVED' : 'COMPANY_RESTORED',
          actorUserId: requireActor(actor).userId,
          targetType: 'COMPANY',
          targetId: id,
        });
        return rows[0];
      }
      return privateResource(
        await tx.company.findFirst({ where, select: companySelect }),
      );
    });
  }
  delete(actor: AuthenticatedActor, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Les futurs FK métier devront être RESTRICT, jamais CASCADE.
      const result = await tx.company.deleteMany({
        where: ownedIdWhere(actor, id),
      });
      requireAffected(result.count);
      await writeAudit(tx, {
        eventType: 'COMPANY_DELETED',
        actorUserId: requireActor(actor).userId,
        targetType: 'COMPANY',
        targetId: id,
      });
    });
  }
}
