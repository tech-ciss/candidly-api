import { Injectable } from '@nestjs/common';
import { DurableEmailDelivery } from '../../integrations/email/durable-email-delivery.js';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import {
  EmailTransport,
  verificationEmail,
} from '../../integrations/email/email.transport.js';
import { createVerificationToken } from './verification-token.js';

@Injectable()
export class VerificationDeliveryService extends DurableEmailDelivery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly transport: EmailTransport,
  ) {
    super(config, VerificationDeliveryService.name);
  }

  protected async processBatch(): Promise<void> {
    // Marqueur durable sur User : aucun contenu d'email ni token brut dans PostgreSQL/Redis.
    const pending = await this.prisma.user.findMany({
      where: { verificationRequestedAt: { not: null }, emailVerifiedAt: null },
      orderBy: { verificationRequestedAt: 'asc' },
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
              emailVerifiedAt: null,
              verificationRequestedAt: { not: null },
            },
            data: { verificationRequestedAt: new Date() },
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
            emailVerifiedAt: true,
            verificationRequestedAt: true,
          },
        });
        if (!user || user.emailVerifiedAt || !user.verificationRequestedAt)
          return;
        const now = new Date();
        const token = createVerificationToken(
          this.config.getOrThrow<number>('EMAIL_VERIFICATION_TTL_SECONDS'),
          now,
        );
        await tx.emailVerificationToken.updateMany({
          where: { userId: id, consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.emailVerificationToken.create({
          data: {
            userId: id,
            tokenHash: token.hash,
            expiresAt: token.expiresAt,
          },
        });
        // Transport local borné ; une future intégration réseau devra ajouter son propre timeout.
        await this.transport.send(
          verificationEmail(
            user.email,
            this.config.getOrThrow<string>('FRONTEND_URL'),
            token.raw,
          ),
        );
        await tx.user.update({
          where: { id },
          data: { verificationRequestedAt: null },
        });
      },
      { timeout: 5000 },
    );
  }
}
