import type { PrismaService } from '../database/prisma.service.js';
export const RETENTION_DAYS = 7; // Hypothèse opérationnelle à valider, pas une durée juridique.
export const CLEANUP_BATCH_SIZE = 100;
export function expiredCutoff(now = new Date()): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 86400000);
}
export async function cleanupTechnicalData(
  prisma: PrismaService,
  apply = false,
  now = new Date(),
) {
  const cutoff = expiredCutoff(now);
  return prisma.$transaction(async (tx) => {
    const sessions = await tx.session.findMany({
      where: { expiresAt: { lte: cutoff } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    const verification = await tx.emailVerificationToken.findMany({
      where: { expiresAt: { lte: cutoff } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    const reset = await tx.passwordResetToken.findMany({
      where: { expiresAt: { lte: cutoff } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    let counts = {
      sessions: sessions.length,
      verificationTokens: verification.length,
      resetTokens: reset.length,
    };
    if (apply) {
      // L'historique refresh n'est supprimé que par la cascade d'une session expirée depuis 7 jours.
      const expiredSessions = await tx.session.deleteMany({
        where: {
          id: { in: sessions.map((row) => row.id) },
          expiresAt: { lte: cutoff },
        },
      });
      const expiredVerification = await tx.emailVerificationToken.deleteMany({
        where: {
          id: { in: verification.map((row) => row.id) },
          expiresAt: { lte: cutoff },
        },
      });
      const expiredReset = await tx.passwordResetToken.deleteMany({
        where: {
          id: { in: reset.map((row) => row.id) },
          expiresAt: { lte: cutoff },
        },
      });
      counts = {
        sessions: expiredSessions.count,
        verificationTokens: expiredVerification.count,
        resetTokens: expiredReset.count,
      };
    }
    return {
      mode: apply ? 'apply' : 'dry-run',
      cutoff: cutoff.toISOString(),
      batchSize: CLEANUP_BATCH_SIZE,
      ...counts,
    };
  });
}
export function assertLocalMaintenance(
  input: { nodeEnv?: string; databaseUrl?: string },
  args: string[],
): boolean {
  if (
    !['development', 'test'].includes(input.nodeEnv ?? '') ||
    !input.databaseUrl ||
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  )
    throw new Error('Maintenance locale explicite uniquement.');
  const url = new URL(input.databaseUrl);
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['_dev', '_test'].some((suffix) => url.pathname.endsWith(suffix)) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Maintenance locale explicite uniquement.');
  return args.includes('--apply');
}
