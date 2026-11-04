import { requireActor } from '../../common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../common/authorization/authenticated-actor.js';
import {
  selfWhere,
  ownerWhere,
  privateResource,
} from '../../common/authorization/ownership.js';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { publicUserSelect } from '../auth/session.repository.js';
import type { UpdateProfileDto, UpdatePreferencesDto } from './users.dto.js';
const preferenceSelect = {
  locale: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}
  async profile(actor: AuthenticatedActor) {
    return privateResource(
      await this.prisma.user.findFirst({
        where: selfWhere(actor),
        select: publicUserSelect,
      }),
    );
  }
  async updateProfile(actor: AuthenticatedActor, data: UpdateProfileDto) {
    const updated = await this.prisma.user.updateManyAndReturn({
      where: selfWhere(actor),
      data: { firstName: data.firstName, lastName: data.lastName },
      select: publicUserSelect,
    });
    return privateResource(updated[0]);
  }
  preferences(actor: AuthenticatedActor) {
    const { userId } = requireActor(actor);
    return this.prisma.$transaction(async (tx) => {
      privateResource(
        await tx.user.findFirst({
          where: selfWhere(actor),
          select: { id: true },
        }),
      );
      await tx.userPreference.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      });
      return privateResource(
        await tx.userPreference.findFirst({
          where: ownerWhere(actor, {}),
          select: preferenceSelect,
        }),
      );
    });
  }
  updatePreferences(actor: AuthenticatedActor, data: UpdatePreferencesDto) {
    const { userId } = requireActor(actor);
    return this.prisma.$transaction(async (tx) => {
      privateResource(
        await tx.user.findFirst({
          where: selfWhere(actor),
          select: { id: true },
        }),
      );
      await tx.userPreference.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      });
      const updated = await tx.userPreference.updateManyAndReturn({
        where: ownerWhere(actor, {}),
        data: { locale: data.locale, timezone: data.timezone },
        select: preferenceSelect,
      });
      return privateResource(updated[0]);
    });
  }
}
