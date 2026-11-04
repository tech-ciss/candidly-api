import { Injectable } from '@nestjs/common';
import { DurableEmailDelivery } from '../../integrations/email/durable-email-delivery.js';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import {
  EmailTransport,
  passwordResetEmail,
} from '../../integrations/email/email.transport.js';
import { createVerificationToken as createResetToken } from './verification-token.js';

@Injectable()
export class PasswordResetDeliveryService extends DurableEmailDelivery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly transport: EmailTransport,
  ) {
    super(config, PasswordResetDeliveryService.name);
  }

  protected async processBatch(): Promise<void> {
    // Marqueur durable sur User : aucun contenu d'email ni token brut dans PostgreSQL/Redis.
    const pending = await this.prisma.user.findMany({
      where: { passwordResetRequestedAt: { not: null } },
      orderBy: { passwordResetRequestedAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    for (const { id } of pending) {
      if (this.stopped) return;
      try {
        await this.deliver(id);
      } catch {
        this.logger.warn(
          'Préparation d’un email échouée ; demande conservée pour reprise.',
        );
        // Replacer l'échec en fin de lot pour ne pas affamer les autres demandes.
        try {
          await this.prisma.user.updateMany({
            where: {
              id,

              passwordResetRequestedAt: { not: null },
            },
            data: { passwordResetRequestedAt: new Date() },
          });
        } catch {
          /* La demande initiale reste durable si PostgreSQL est indisponible. */
        }
      }
    }
  }
  private async deliver(id: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return;
        const user = await tx.user.findUnique({
          where: { id },
          select: {
            email: true,

            passwordResetRequestedAt: true,
          },
        });
        if (!user || !user.passwordResetRequestedAt) return;
        const now = new Date();
        const token = createResetToken(
          this.config.getOrThrow<number>('PASSWORD_RESET_TTL_SECONDS'),
          now,
        );
        await tx.passwordResetToken.updateMany({
          where: { userId: id, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.passwordResetToken.create({
          data: {
            userId: id,
            tokenHash: token.hash,
            expiresAt: token.expiresAt,
          },
        });
        // Transport local borné ; une future intégration réseau devra ajouter son propre timeout.
        await this.transport.send(
          passwordResetEmail(
            user.email,
            this.config.getOrThrow<string>('FRONTEND_URL'),
            token.raw,
          ),
        );
        await tx.user.update({
          where: { id },
          data: { passwordResetRequestedAt: null },
        });
      },
      { timeout: 5000 },
    );
  }
}
