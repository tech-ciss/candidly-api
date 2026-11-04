import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { RegisterDto } from './dto/auth.dto.js';
import { hashToken } from './verification-token.js';

@Injectable()
export class AuthRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterDto, passwordHash: string): Promise<void> {
    try {
      await this.prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          preference: { create: {} },
          verificationRequestedAt: new Date(),
        },
      });
    } catch (error) {
      // Une collision concurrente est couverte par la contrainte unique, jamais par un simple précontrôle.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return;
      throw error;
    }
  }

  async requestVerification(email: string): Promise<void> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() -
        this.config.getOrThrow<number>('EMAIL_RESEND_COOLDOWN_SECONDS') * 1000,
    );
    await this.prisma.user.updateMany({
      where: {
        email,
        emailVerifiedAt: null,
        verificationLastRequestedAt: { lte: cutoff },
      },
      data: { verificationRequestedAt: now, verificationLastRequestedAt: now },
    });
  }

  async verify(raw: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.emailVerificationToken.findUnique({
        where: { tokenHash: hashToken(raw) },
        select: { userId: true, id: true },
      });
      if (!candidate) return false;
      // Ordre de verrouillage commun avec l'envoi : utilisateur puis tokens.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId}::uuid FOR UPDATE`;
      const token = await tx.emailVerificationToken.findUnique({
        where: { id: candidate.id },
      });
      const user = await tx.user.findUnique({
        where: { id: candidate.userId },
        select: { emailVerifiedAt: true },
      });
      const now = new Date();
      if (
        !token ||
        token.consumedAt ||
        token.expiresAt <= now ||
        !user ||
        user.emailVerifiedAt
      )
        return false;
      await tx.user.update({
        where: { id: candidate.userId },
        data: { emailVerifiedAt: now, verificationRequestedAt: null },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: candidate.userId, consumedAt: null },
        data: { consumedAt: now },
      });
      return true;
    });
  }
}
