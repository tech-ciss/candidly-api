import { writeAudit } from '../audit/audit-log.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { hashToken } from './verification-token.js';
@Injectable()
export class PasswordRecoveryRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  credentials(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
  }
  async request(email: string): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() -
        this.config.getOrThrow<number>('PASSWORD_RESET_COOLDOWN_SECONDS') *
          1000,
    );
    await this.prisma.user.updateMany({
      where: {
        email,
        OR: [
          { passwordResetLastRequestedAt: null },
          { passwordResetLastRequestedAt: { lte: cutoff } },
        ],
      },
      data: {
        passwordResetRequestedAt: now,
        passwordResetLastRequestedAt: now,
      },
    });
  }
  private async replacePassword(
    tx: Prisma.TransactionClient,
    userId: string,
    passwordHash: string,
    now: Date,
    eventType: 'PASSWORD_CHANGED' | 'PASSWORD_RESET',
  ): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordResetRequestedAt: null },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    const revoked = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    const actorUserId = eventType === 'PASSWORD_CHANGED' ? userId : null;
    await writeAudit(tx, {
      eventType,
      actorUserId,
      targetType: 'USER',
      targetId: userId,
    });
    await writeAudit(tx, {
      eventType: 'SESSIONS_REVOKED',
      actorUserId,
      targetType: 'USER',
      targetId: userId,
      metadata: { sessionsCount: revoked.count },
    });
  }
  async change(
    userId: string,
    expectedHash: string,
    nextHash: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user || user.passwordHash !== expectedHash) return false;
      await this.replacePassword(
        tx,
        userId,
        nextHash,
        new Date(),
        'PASSWORD_CHANGED',
      );
      return true;
    });
  }
  async reset(raw: string, passwordHash: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(raw) },
        select: { userId: true, id: true },
      });
      if (!candidate) return false;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
      const token = await tx.passwordResetToken.findUnique({
        where: { id: candidate.id },
      });
      const now = new Date();
      if (!token || token.consumedAt || token.expiresAt <= now) return false;
      await this.replacePassword(
        tx,
        candidate.userId,
        passwordHash,
        now,
        'PASSWORD_RESET',
      );
      return true;
    });
  }
}
