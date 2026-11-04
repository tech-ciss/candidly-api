import { NotFoundException } from '@nestjs/common';
import { requireActor } from './authenticated-actor.js';
import type { AuthenticatedActor } from './authenticated-actor.js';
// AND reste externe : ni OR, ni un userId reçu dans les filtres ne remplacent la portée.
export function ownerWhere<T extends object>(
  actor: AuthenticatedActor,
  filter: T,
): { AND: [{ userId: string }, T] } {
  return { AND: [{ userId: requireActor(actor).userId }, filter] };
}
export function ownedIdWhere(
  actor: AuthenticatedActor,
  id: string,
): { id: string; userId: string } {
  return { id, userId: requireActor(actor).userId };
}
// User est lui-même le propriétaire ; il n'a pas de colonne userId.
export function selfWhere(actor: AuthenticatedActor): { id: string } {
  return { id: requireActor(actor).userId };
}
export function privateResource<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new NotFoundException();
  return value;
}
// En lot, appeler DANS la transaction pour annuler tout le lot si le compte diffère.
export function requireAffected(count: number, expected = 1): void {
  if (count !== expected) throw new NotFoundException();
}
