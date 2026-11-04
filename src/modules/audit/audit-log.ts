import type { Prisma } from '../../generated/prisma/client.js';
import { currentRequestId } from '../../common/observability/request-context.js';
import { structuredLog } from '../../common/observability/structured-logger.js';
export const AUDIT_EVENTS = [
  'REGISTER',
  'EMAIL_VERIFIED',
  'LOGIN',
  'LOGIN_FAILURE',
  'LOGOUT',
  'REFRESH_REUSE',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET',
  'SESSIONS_REVOKED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENTS)[number];
export interface AuditEvent {
  eventType: AuditEventType;
  actorUserId?: string | null;
  targetType?: 'USER' | 'SESSION';
  targetId?: string;
  metadata?: {
    reason?: 'invalid_credentials' | 'refresh_reuse' | 'email_unverified';
    sessionsCount?: number;
  };
}
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function auditData(event: AuditEvent) {
  if (
    !(AUDIT_EVENTS as readonly string[]).includes(event.eventType) ||
    Object.keys(event).some(
      (key) =>
        ![
          'eventType',
          'actorUserId',
          'targetType',
          'targetId',
          'metadata',
        ].includes(key),
    )
  )
    throw new Error('Événement audit invalide.');
  if (
    (event.actorUserId && !uuid.test(event.actorUserId)) ||
    (event.targetId && !uuid.test(event.targetId)) ||
    (event.targetType && !['USER', 'SESSION'].includes(event.targetType))
  )
    throw new Error('Cible audit invalide.');
  const metadata: Record<string, string | number> = {};
  if (event.metadata) {
    if (
      Object.keys(event.metadata).some(
        (key) => !['reason', 'sessionsCount'].includes(key),
      )
    )
      throw new Error('Métadonnées audit invalides.');
    if (event.metadata.reason !== undefined) {
      if (
        !['invalid_credentials', 'refresh_reuse', 'email_unverified'].includes(
          event.metadata.reason,
        )
      )
        throw new Error('Raison audit invalide.');
      metadata.reason = event.metadata.reason;
    }
    if (event.metadata.sessionsCount !== undefined) {
      if (
        !Number.isInteger(event.metadata.sessionsCount) ||
        event.metadata.sessionsCount < 0
      )
        throw new Error('Compteur audit invalide.');
      metadata.sessionsCount = event.metadata.sessionsCount;
    }
  }
  return {
    eventType: event.eventType,
    outcome:
      event.eventType === 'LOGIN_FAILURE' || event.eventType === 'REFRESH_REUSE'
        ? ('FAILURE' as const)
        : ('SUCCESS' as const),
    actorUserId: event.actorUserId ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    requestId: currentRequestId() ?? null,
    metadata,
  };
}
export type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;
export async function writeAudit(
  tx: AuditClient,
  event: AuditEvent,
): Promise<void> {
  const data = auditData(event);
  try {
    await tx.auditLog.create({ data });
  } catch {
    structuredLog({
      level: 'error',
      module: 'Audit',
      event: 'audit.unavailable',
    });
    throw new Error('Audit critique indisponible.');
  }
}
export async function recordLoginFailure(client: AuditClient): Promise<void> {
  try {
    await writeAudit(client, {
      eventType: 'LOGIN_FAILURE',
      metadata: { reason: 'invalid_credentials' },
    });
  } catch {
    /* Échec de login conservé ; l'indisponibilité a déjà été journalisée sans secret. */
  }
}
