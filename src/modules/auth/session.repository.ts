import { writeAudit, recordLoginFailure } from '../audit/audit-log.js';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { hashToken } from './verification-token.js';

export const publicUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;
@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}
  findCredentials(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      select: { ...publicUserSelect, passwordHash: true },
    });
  }
  create(
    id: string,
    userId: string,
    refreshTokenHash: string,
    expiresAt: Date,
    expectedPasswordHash: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, emailVerifiedAt: true },
      });
      if (!user?.emailVerifiedAt || user.passwordHash !== expectedPasswordHash)
        throw new UnauthorizedException();
      const session = await tx.session.create({
        data: { id, userId, refreshTokenHash, expiresAt },
      });
      await writeAudit(tx, {
        eventType: 'LOGIN',
        actorUserId: userId,
        targetType: 'SESSION',
        targetId: id,
      });
      return session;
    });
  }
  private async findSessionId(hash: string): Promise<string | undefined> {
    const current = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: { id: true },
    });
    if (current) return current.id;
    const previous = await this.prisma.sessionRefreshToken.findUnique({
      where: { tokenHash: hash },
      select: { sessionId: true },
    });
    return previous?.sessionId;
  }
  private async lockSession(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const owner = await tx.session.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!owner) return false;
    // AuditLog possède une FK User : même ordre User -> Session que changement/reset/login.
    const user = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "User" WHERE id = ${owner.userId}::uuid FOR UPDATE`;
    if (user.length === 0) return false;
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Session" WHERE id = ${id}::uuid AND "userId" = ${owner.userId}::uuid FOR UPDATE`;
    return locked.length === 1;
  }
  async rotate(raw: string, nextHash: string) {
    const hash = hashToken(raw);
    const id = await this.findSessionId(hash);
    if (!id) return null;
    return this.prisma.$transaction(async (tx) => {
      if (!(await this.lockSession(tx, id))) return null;
      const session = await tx.session.findUnique({
        where: { id },
        include: { user: { select: publicUserSelect } },
      });
      const now = new Date();
      if (!session || session.revokedAt || session.expiresAt <= now)
        return null;
      if (session.refreshTokenHash !== hash) {
        // Le hash a été trouvé dans l'historique, ou vient d'être consommé par un refresh concurrent.
        await tx.session.update({ where: { id }, data: { revokedAt: now } });
        await writeAudit(tx, {
          eventType: 'REFRESH_REUSE',
          actorUserId: session.userId,
          targetType: 'SESSION',
          targetId: id,
          metadata: { reason: 'refresh_reuse' },
        });
        await writeAudit(tx, {
          eventType: 'SESSIONS_REVOKED',
          actorUserId: session.userId,
          targetType: 'SESSION',
          targetId: id,
          metadata: { sessionsCount: 1 },
        });
        return null; // Commit de révocation AVANT de produire l'erreur HTTP.
      }
      if (!session.user.emailVerifiedAt) {
        await tx.session.update({ where: { id }, data: { revokedAt: now } });
        await writeAudit(tx, {
          eventType: 'SESSIONS_REVOKED',
          targetType: 'SESSION',
          targetId: id,
          metadata: { reason: 'email_unverified', sessionsCount: 1 },
        });
        return null;
      }
      await tx.sessionRefreshToken.create({
        data: { tokenHash: hash, sessionId: id },
      });
      return tx.session.update({
        where: { id },
        data: { refreshTokenHash: nextHash },
      });
    });
  }
  async revoke(raw: string): Promise<void> {
    const id = await this.findSessionId(hashToken(raw));
    if (!id) return;
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockSession(tx, id))) return;
      const session = await tx.session.findUnique({
        where: { id },
        select: { userId: true, revokedAt: true },
      });
      if (!session || session.revokedAt) return;
      await tx.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, {
        eventType: 'LOGOUT',
        actorUserId: session.userId,
        targetType: 'SESSION',
        targetId: id,
      });
      await writeAudit(tx, {
        eventType: 'SESSIONS_REVOKED',
        actorUserId: session.userId,
        targetType: 'SESSION',
        targetId: id,
        metadata: { sessionsCount: 1 },
      });
    });
  }
  async recordLoginFailure(): Promise<void> {
    await recordLoginFailure(this.prisma);
  }
  async activeUser(sessionId: string, userId: string) {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { emailVerifiedAt: { not: null } },
      },
      select: { user: { select: publicUserSelect } },
    });
    return session?.user ?? null;
  }
}
