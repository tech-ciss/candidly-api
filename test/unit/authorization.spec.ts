import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import {
  actorFromVerifiedSession,
  requireActor,
} from '../../src/common/authorization/authenticated-actor.js';
import type { AuthenticatedActor } from '../../src/common/authorization/authenticated-actor.js';
import {
  ownerWhere,
  ownedIdWhere,
  selfWhere,
  privateResource,
  requireAffected,
} from '../../src/common/authorization/ownership.js';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../../src/modules/auth/jwt-auth.guard.js';
import type { AccessTokenService } from '../../src/modules/auth/access-token.service.js';
import type { SessionRepository } from '../../src/modules/auth/session.repository.js';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter.js';
const a = actorFromVerifiedSession(randomUUID(), randomUUID());
const b = actorFromVerifiedSession(randomUUID(), randomUUID());
// Repository fictif, exclusivement en mémoire, sans modèle Prisma ou route déployée.
interface Row {
  id: string;
  userId: string;
  title: string;
  parentId?: string;
}
interface Filter {
  id?: string | { in: string[] };
  userId?: string;
  title?: { contains: string };
  AND?: Filter[];
  OR?: Filter[];
}
function matches(row: Row, where: Filter): boolean {
  return (
    (!where.userId || row.userId === where.userId) &&
    (!where.id ||
      (typeof where.id === 'string'
        ? row.id === where.id
        : where.id.in.includes(row.id))) &&
    (!where.title || row.title.includes(where.title.contains)) &&
    (!where.AND || where.AND.every((filter) => matches(row, filter))) &&
    (!where.OR || where.OR.some((filter) => matches(row, filter)))
  );
}
class MemoryPrivateRepository {
  constructor(public rows: Row[]) {}
  read(actor: AuthenticatedActor, id: string) {
    return privateResource(
      this.rows.find((row) => matches(row, ownedIdWhere(actor, id))),
    );
  }
  patch(actor: AuthenticatedActor, id: string, title: string) {
    const row = this.rows.find((value) =>
      matches(value, ownedIdWhere(actor, id)),
    );
    requireAffected(row ? 1 : 0);
    row!.title = title;
  }
  delete(actor: AuthenticatedActor, id: string) {
    const scoped = ownedIdWhere(actor, id);
    const selected = this.rows.filter((row) => matches(row, scoped));
    requireAffected(selected.length);
    this.rows = this.rows.filter((row) => !matches(row, scoped));
  }
  list(actor: AuthenticatedActor, filter: Filter, skip = 0, take = 2) {
    const selected = this.rows
      .filter((row) => matches(row, ownerWhere(actor, filter)))
      .sort((left, right) => left.id.localeCompare(right.id));
    return { total: selected.length, rows: selected.slice(skip, skip + take) };
  }
  bulk(actor: AuthenticatedActor, ids: string[], title: string) {
    const unique = [...new Set(ids)];
    const staged = this.rows.map((row) => ({ ...row }));
    const selected = staged.filter((row) =>
      matches(row, ownerWhere(actor, { id: { in: unique } })),
    );
    for (const row of selected) row.title = title;
    requireAffected(selected.length, unique.length);
    this.rows = staged;
  }
  relate(actor: AuthenticatedActor, childId: string, parentId: string) {
    const child = this.read(actor, childId);
    const parent = this.read(actor, parentId);
    // Une entreprise différente est également refusée malgré un propriétaire commun.
    privateResource(child.parentId === parent.parentId ? parent : null);
    this.patch(actor, child.id, 'linked');
  }
}
const fixture = () =>
  new MemoryPrivateRepository([
    { id: 'a1', userId: a.userId, title: 'private-A', parentId: 'company-A' },
    { id: 'a2', userId: a.userId, title: 'private-A2', parentId: 'company-A' },
    {
      id: 'a3',
      userId: a.userId,
      title: 'private-A3',
      parentId: 'company-other',
    },
    { id: 'b1', userId: b.userId, title: 'private-B', parentId: 'company-A' },
  ]);
void test('acteur minimal immuable : contexte absent ou objet client refusé, usine réservée au guard', () => {
  assert.deepEqual(Object.keys(a).sort(), ['sessionId', 'userId']);
  assert.ok(Object.isFrozen(a));
  assert.equal(requireActor(a), a);
  assert.throws(() => requireActor({ ...a, userId: b.userId }), {
    status: 401,
  });
  assert.throws(
    () => requireActor(JSON.parse(JSON.stringify(a)) as AuthenticatedActor),
    { status: 401 },
  );
  assert.throws(
    () => requireActor(undefined as unknown as AuthenticatedActor),
    { status: 401 },
  );
  assert.throws(() => actorFromVerifiedSession('', 'session'), { status: 401 });
  assert.deepEqual(selfWhere(a), { id: a.userId });
  assert.deepEqual(ownedIdWhere(a, 'resource'), {
    id: 'resource',
    userId: a.userId,
  });
});
void test('lecture/mutation/suppression : propriétaire obligatoire et 404 identiques pour inconnu/étranger', () => {
  const repository = fixture();
  assert.equal(repository.read(a, 'a1').userId, a.userId);
  assert.equal(repository.read(b, 'b1').userId, b.userId);
  for (const id of ['b1', 'unknown']) {
    assert.throws(() => repository.read(a, id), { status: 404 });
    assert.throws(() => repository.patch(a, id, 'stolen'), { status: 404 });
    assert.throws(() => repository.delete(a, id), { status: 404 });
  }
  assert.throws(() => repository.patch(b, 'a1', 'forged'), { status: 404 });
  repository.patch(a, 'a1', 'own');
  repository.delete(a, 'a2');
  assert.equal(repository.read(b, 'b1').title, 'private-B');
});
void test('listes paginées, recherche et OR adversarial restent dans le même filtre propriétaire', () => {
  const repository = fixture();
  const filter: Filter = {
    OR: [{ userId: b.userId }, { title: { contains: 'private' } }],
  };
  const result = repository.list(a, filter, 1, 1);
  assert.equal(result.total, 3);
  assert.equal(result.rows.length, 1);
  assert.ok(result.rows.every((row) => row.userId === a.userId));
  assert.equal(repository.list(a, { userId: b.userId }).total, 0);
  assert.equal(repository.list(b, {}).total, 1);
  assert.deepEqual(ownerWhere(a, filter), {
    AND: [{ userId: a.userId }, filter],
  });
});
void test('lots : intersection de propriétaire et rollback du lot mixte ; déduplication des identifiants', () => {
  const repository = fixture();
  const before = JSON.stringify(repository.rows);
  assert.throws(() => repository.bulk(a, ['a1', 'b1'], 'stolen'), {
    status: 404,
  });
  assert.equal(JSON.stringify(repository.rows), before);
  assert.throws(() => repository.bulk(a, ['a1', 'unknown'], 'stolen'), {
    status: 404,
  });
  assert.equal(JSON.stringify(repository.rows), before);
  repository.bulk(a, ['a1', 'a1', 'a2'], 'updated');
  assert.equal(repository.read(a, 'a2').title, 'updated');
  assert.equal(repository.read(b, 'b1').title, 'private-B');
});
void test('relations et changement concurrent de propriétaire : aucune mutation après changement de portée', async () => {
  const repository = fixture();
  assert.throws(() => repository.relate(a, 'a1', 'b1'), { status: 404 });
  assert.throws(() => repository.relate(a, 'a1', 'a3'), { status: 404 });
  repository.relate(a, 'a1', 'a2');
  // Simule un transfert entre un précontrôle et l'écriture : le prédicat est revérifié à la mutation.
  repository.read(a, 'a1');
  await Promise.resolve();
  repository.rows.find((row) => row.id === 'a1')!.userId = b.userId;
  assert.throws(() => repository.patch(a, 'a1', 'after-transfer'), {
    status: 404,
  });
  assert.equal(repository.read(b, 'a1').title, 'linked');
});
void test('filtre HTTP existant : absent/étranger même 404 ; 403 explicite sans identité privée', () => {
  const normalize = (error: unknown) => {
    let body: unknown;
    const response = {
      status: () => response,
      json: (value: unknown) => {
        body = value;
      },
    };
    new HttpExceptionFilter().catch(error, {
      switchToHttp: () => ({
        getRequest: () => ({ path: '/private-test' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost);
    return body as { error: { code: string; message: string } };
  };
  const repository = fixture();
  const bodies = ['b1', 'unknown'].map((id) => {
    try {
      repository.read(a, id);
    } catch (error) {
      return normalize(error);
    }
    throw new Error();
  });
  assert.deepEqual(bodies[0]!.error, bodies[1]!.error);
  assert.ok(!JSON.stringify(bodies).includes('private-B'));
  assert.equal(
    normalize(new ForbiddenException('private-details')).error.code,
    'FORBIDDEN',
  );
  assert.ok(
    !JSON.stringify(
      normalize(new ForbiddenException('private-details')),
    ).includes('private-details'),
  );
});
void test('guard : pas de contexte préfourni, couple sub/sid vérifié, identité incohérente refusée', async () => {
  let userId = a.userId;
  const user = () => ({
    id: userId,
    emailVerifiedAt: new Date(),
    firstName: 'Awa',
    lastName: 'Kouassi',
    email: 'awa@example.com',
    createdAt: new Date(),
  });
  const guard = new JwtAuthGuard(
    {
      verify: () => Promise.resolve({ sub: a.userId, sid: a.sessionId }),
    } as unknown as AccessTokenService,
    {
      activeUser: (sid: string, sub: string) => {
        assert.equal(sid, a.sessionId);
        assert.equal(sub, a.userId);
        return Promise.resolve(user());
      },
    } as unknown as SessionRepository,
  );
  const request = {
    headers: { authorization: 'Bearer one.two.three' },
    auth: b,
  } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  assert.equal(await guard.canActivate(context), true);
  assert.equal(request.auth!.userId, a.userId);
  userId = b.userId;
  await assert.rejects(guard.canActivate(context), { status: 401 });
  assert.equal(request.auth, undefined);
  assert.equal(request.currentUser, undefined);
  delete request.headers.authorization;
  request.auth = b;
  await assert.rejects(guard.canActivate(context), { status: 401 });
  assert.equal(request.auth, undefined);
});
