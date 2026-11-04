import { UnauthorizedException } from '@nestjs/common';
const authenticated = Symbol('authenticated-actor');
const verifiedActors = new WeakSet<object>();
export interface AuthenticatedActor {
  readonly userId: string;
  readonly sessionId: string;
  readonly [authenticated]: true;
}
// Production : appelé uniquement par JwtAuthGuard APRÈS validation JWT et session active.
export function actorFromVerifiedSession(
  userId: string,
  sessionId: string,
): AuthenticatedActor {
  if (!userId || !sessionId) throw new UnauthorizedException();
  const actor = Object.freeze({
    userId,
    sessionId,
    [authenticated]: true as const,
  });
  verifiedActors.add(actor);
  return actor;
}
export function requireActor(actor: AuthenticatedActor): AuthenticatedActor {
  if (
    !actor ||
    !verifiedActors.has(actor) ||
    actor[authenticated] !== true ||
    !actor.userId ||
    !actor.sessionId
  )
    throw new UnauthorizedException();
  return actor;
}
