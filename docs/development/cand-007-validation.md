# Rapport CAND-007 — 2026-11-03

Statut : implémenté et validé localement, prêt pour revue utilisateur.
Périmètre : candidly-api uniquement, aucun frontend ni CAND-008. Les changements
CAND-006 présents et non commités au démarrage ont été conservés. Les listes de
fichiers ci-dessous isolent les ajouts et modifications de CAND-007 par rapport
à cet état initial, et non par rapport au dernier commit Git.

## Résumé et dépendance

Connexion email/password avec Argon2id et email vérifié obligatoire, JWT court,
refresh opaque en cookie avec rotation atomique, sessions persistantes et
révocables, logout idempotent et identité publique protégée. Le guard JWT est
réutilisable dans un autre module NestJS ; son import/export est testé.

Seule dépendance directe ajoutée : **jose@6.2.15**, stable ESM, sans dépendance
transitive propre. Aucune version préexistante n'a été modifiée. Argon2 0.45.2,
Prisma 7.10.1, Redis et le runner natif existants sont conservés. Node utilisé :
24.22.2. Aucun Passport ou cookie-parser nécessaire pour ce périmètre.

## Modèle et migration

[Schéma Prisma](../../prisma/schema.prisma) : Session (id UUID, userId UUID,
refreshTokenHash unique, expiresAt, revokedAt nullable, createdAt, updatedAt)
et SessionRefreshToken (tokenHash primaire, sessionId, consumedAt) pour détecter
les tokens consommés. Aucun token brut en base.

[Migration 20261103000200_sessions](../../prisma/migrations/20261103000200_sessions/migration.sql) :
création des deux tables, index userId/revokedAt, expiresAt et sessionId,
clés étrangères limitées aux données d'authentification. Aucun DROP, suppression
de données, reset ou modification de colonne existante. La migration CAND-006
est inchangée, vérifiée par empreinte avant/après.

Les migrations ont été relues puis appliquées sur la nouvelle base locale dédiée
`candidly_test` (PostgreSQL 17, port 55437, utilisateur fictif candidly_ci),
projet Docker `candidly-cand007-check`, Redis 7 port 56384. La cible et son absence
de tables ont été vérifiées avant application. Les deux migrations ont réussi ;
`prisma migrate status` indique une base à jour. Aucune base distante ou de production.

## Endpoints et politiques

| Endpoint                    | Succès | Comportement                                                                         |
| --------------------------- | ------ | ------------------------------------------------------------------------------------ |
| POST `/api/v1/auth/login`   | 200    | Email normalisé/password, email confirmé requis, JWT et user public ; cookie refresh |
| POST `/api/v1/auth/refresh` | 200    | Rotation du refresh et JWT, échéance de session inchangée                            |
| POST `/api/v1/auth/logout`  | 204    | Révocation par cookie courant ou consommé, effacement du cookie, idempotent          |
| GET `/api/v1/auth/me`       | 200    | Bearer valide + session active appartenant à sub, identité publique uniquement       |

L'identité contient exactement id, firstName, lastName, email, emailVerifiedAt,
createdAt. Aucun passwordHash, refresh ou secret. Les réponses login/refresh
contiennent accessToken, tokenType, expiresIn ; le refresh est uniquement Set-Cookie.
Les réponses sensibles sont no-store. Swagger décrit les routes et les schémas,
avec bearer et cookie ; il reste désactivé en production.

JWT HS256 uniquement, typ JWT, sub/sid UUID, iat/exp entiers, issuer et audience
exacts, expiration et durée vérifiées. Durée initiale 15 min configurable, plafonnée
par l'expiration de session. Clé base64 d'au moins 32 octets obligatoire depuis
l'environnement ; `.env.example` contient un marqueur inutilisable, aucune clé réelle.

Refresh aléatoire 256 bits, hash SHA-256 en base et historique d'empreintes
consommées. Session de 30 jours absolus configurable, sans extension glissante.
Verrou PostgreSQL Session commun à rotation/logout : une seule rotation réussit
par token. Réutilisation reconnue → révocation de toute la session, commise
avant le 401. Token aléatoire inconnu → 401, sans révocation tierce.
Deux refresh concurrents peuvent donner un gagnant, puis la révocation stricte
de sa session par détection du second appel ; le client doit sérialiser les refresh.
Le guard consulte la session et l'utilisateur vérifié en base à chaque requête,
donc les JWT existants sont refusés aux requêtes suivantes après révocation.

Cookie host-only candidly_refresh, HttpOnly, SameSite=Strict, Secure en production,
Path=/api/v1/auth, expiration alignée sur l'échéance absolue. Pas de Domain,
localStorage, cookie lisible par JS ou refresh dans JSON. Cookies doublons refusés.
Login/refresh/logout exigent Origin exactement FRONTEND_URL et X-Candidly-CSRF: 1.
CORS avec credentials et SameSite complètent ces contrôles explicites sans les
remplacer. Modèle supporté : frontend/API même site, HTTPS en production ; voir
[l'ADR écrit avant implémentation](../adr/0002-session-security.md).

Limitation Redis par IP et fenêtre de 15 min : login 5, refresh/logout 30 ;
inscription/renvoi 5 et vérification 30 conservés. Les échecs CSRF consomment aussi
une tentative. Panne Redis : 503, aucun repli permissif. Compte inconnu, mauvais
password et email non vérifié partagent le même 401 ; un hash factice aléatoire
permet une vérification Argon2 aussi pour le compte inconnu.

## Vérifications exécutées

| Vérification                      | Résultat                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                    | réussi                                                                                                                                                                                        |
| `npm run typecheck`               | réussi                                                                                                                                                                                        |
| `npm run format:check`            | réussi                                                                                                                                                                                        |
| `npm run test`                    | 39 tests réussis                                                                                                                                                                              |
| `npm run test:e2e`                | 23 tests réussis                                                                                                                                                                              |
| `npm run test:integration`        | 20 tests réussis, PostgreSQL et Redis dédiés                                                                                                                                                  |
| `npm run build`                   | réussi                                                                                                                                                                                        |
| `npm run prisma:validate`         | valide                                                                                                                                                                                        |
| `npm run prisma:generate`         | client généré                                                                                                                                                                                 |
| `npm run prisma:migrate:deploy`   | deux migrations appliquées localement                                                                                                                                                         |
| `prisma migrate status`           | à jour                                                                                                                                                                                        |
| Swagger via tests HTTP            | routes, schémas, sécurité bearer/cookie, désactivation production                                                                                                                             |
| API compilée sans mocks           | inscription → email local automatique → vérification → login → me → rotation → logout ; révocation immédiate confirmée, aucun token/clé/password dans les logs, fixtures temporaires retirées |
| Guard dans un module consommateur | requête sans token refusée, identité valide retournée                                                                                                                                         |
| `actionlint`                      | workflow valide, clé CI éphémère générée sans valeur versionnée                                                                                                                               |
| `npm audit --omit=dev --json`     | zéro vulnérabilité connue de production à cette date                                                                                                                                          |
| `git diff --check`                | réussi                                                                                                                                                                                        |

Les tests CAND-006 restent compatibles. Sont couverts : JWT falsifiés, algorithme
ou clé incorrects, claims invalides/manquantes, expiration, rotation, rejeu,
refresh concurrents, logout concurrent au refresh, révocation et isolation entre
sessions/utilisateurs. Le parcours HTTP avec Prisma/Redis réels vérifie login,
refresh, me, logout, rejeu, expiration, absence de secrets, mutation interdite
par CSRF et seuils Redis réels. Les erreurs génériques des scénarios de panne
CAND-006 sont attendues et ne contiennent pas de secret.

L'installation informait aussi de 12 vulnérabilités modérées dans l'audit complet ;
l'audit production filtré ci-dessus est distinct. Aucun audit fix ou changement
massif de dépendances. Aucun workflow exécuté sur GitHub à distance.

## Sécurité et limites

Aucun secret réel versionné. Les tests utilisent des données fictives example.com,
des clés aléatoires éphémères et nettoient seulement leurs fixtures. Pas de
suppression globale de tables, FLUSHDB ou suppression de volume. Les empreintes
consommées restent pour la détection de rejeu ; aucun nettoyage automatique.
CORS, Helmet, DTO stricts et filtre d'erreur commun conservés. La clé JWT et les
variables invalides ne sont jamais recopiées dans les messages d'erreur.

Limites : pas de keyring/rotation automatique de clés, nettoyage des sessions,
interface d'appareils, logout global ou frontend. Pas de déploiement inter-sites
avec SameSite=None. Chaque requête protégée ajoute une lecture base. Une requête
déjà admise ne peut pas être annulée après révocation. Une réponse refresh perdue
ou une course légitime peut nécessiter une reconnexion selon la politique stricte.
Voir [l'architecture complète](../architecture/sessions.md).

Les services de test ont été arrêtés en conservant les volumes.
Ni AGENTS.md, ni infrastructure Docker, ni frontend modifiés. Aucun commit,
push, déploiement ou migration de production. CAND-008 n'a pas été commencé.

## Fichiers CAND-007

### Créés (15)

- `docs/adr/0002-session-security.md`
- `docs/architecture/sessions.md`
- `docs/development/cand-007-validation.md`
- `prisma/migrations/20261103000200_sessions/migration.sql`
- `src/modules/auth/access-token.service.ts`
- `src/modules/auth/cookie-csrf.guard.ts`
- `src/modules/auth/jwt-auth.guard.ts`
- `src/modules/auth/session-cookie.service.ts`
- `src/modules/auth/session.controller.ts`
- `src/modules/auth/session.dto.ts`
- `src/modules/auth/session.repository.ts`
- `src/modules/auth/session.service.ts`
- `test/e2e/session.spec.ts`
- `test/integration/session.spec.ts`
- `test/unit/session.spec.ts`

### Modifiés (17)

- `.env.example`
- `.github/workflows/ci.yml`
- `README.md`
- `docs/architecture/README.md`
- `docs/architecture/authentication.md`
- `docs/development/README.md`
- `package-lock.json`
- `package.json`
- `prisma/migrations/README.md`
- `prisma/schema.prisma`
- `src/config/env.validation.ts`
- `src/config/setup-application.ts`
- `src/modules/auth/auth-rate-limit.guard.ts`
- `src/modules/auth/auth.module.ts`
- `src/modules/auth/password.service.ts`
- `test/e2e/app.spec.ts`
- `test/support/environment.ts`
