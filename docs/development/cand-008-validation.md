# Rapport CAND-008 — 2026-11-04

Statut : implémenté et validé localement, prêt pour revue utilisateur.
Dépôt : candidly-api uniquement. Les changements CAND-006 et CAND-007 présents
non commités au démarrage ont été conservés. Les listes de fichiers ci-dessous
isolent CAND-008 par rapport à cet état initial, pas au dernier commit Git.
Aucune dépendance ajoutée ou mise à jour, aucun frontend ou CRM développé.

## Fonctionnalités et modèles

Profil public consultable et modifiable uniquement pour firstName/lastName,
préférences persistantes, changement de mot de passe authentifié, demande durable
et réinitialisation par token, révocation de toutes les sessions. Le guard JWT,
CurrentUser, Argon2id, Redis et EmailTransport existants sont réutilisés.

UserPreference : userId UUID primaire/FK unique, locale fr, timezone Africa/Abidjan,
createdAt et updatedAt. Préférences initialisées pour les comptes existants par
migration et pour les nouvelles inscriptions dans leur écriture ; les comptes
créés directement sont couverts par une création INSERT ON CONFLICT DO NOTHING
suivie de lecture/mise à jour dans une transaction. La concurrence est testée.
Locale acceptée au lancement : fr. Fuseaux : IANA pris en charge par Node 24 via
Intl.supportedValuesOf(timeZone), plus UTC, sans restriction de continent.

PasswordResetToken : id UUID, userId, tokenHash SHA-256 unique, expiresAt,
consumedAt nullable, createdAt ; index userId/consumedAt. Deux marqueurs User
nullables assurent demande durable et cooldown. Tokens de 256 bits aléatoires,
base64url, distincts des tokens de vérification. Durée initiale 30 minutes,
configurable via PASSWORD_RESET_TTL_SECONDS (1800, entier 1–86400), cooldown
PASSWORD_RESET_COOLDOWN_SECONDS (60, entier 1–86400).

[Schéma Prisma](../../prisma/schema.prisma) et
[migration 20261104000100_user_preferences_password_reset](../../prisma/migrations/20261104000100_user_preferences_password_reset/migration.sql).
La migration ajoute les tables, colonnes nullables et index, puis initialise
les préférences par INSERT/ON CONFLICT. Aucun reset, DROP ou suppression de données.
Les migrations CAND-006/007 ont conservé leurs empreintes SHA-256 initiales.

## Endpoints

| Endpoint                             | Auth / succès      | Fonction                                                                |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------- |
| GET `/api/v1/users/me`               | Bearer, 200        | Profil public, six champs seulement                                     |
| PATCH `/api/v1/users/me`             | Bearer, 200        | firstName/lastName, trim, 1–100 caractères, au moins un champ           |
| GET `/api/v1/users/me/preferences`   | Bearer, 200        | Préférences persistantes                                                |
| PATCH `/api/v1/users/me/preferences` | Bearer, 200        | locale/timezone validés, au moins un champ                              |
| POST `/api/v1/auth/change-password`  | Bearer + CSRF, 200 | currentPassword/newPassword, toutes sessions révoquées et cookie effacé |
| POST `/api/v1/auth/forgot-password`  | public, 202        | Email normalisé, réponse générique, demande durable et cooldown         |
| POST `/api/v1/auth/reset-password`   | token public, 200  | newPassword, usage unique, toutes sessions révoquées et cookie effacé   |

Les réponses ne contiennent aucun hash, token brut ou donnée interne de session.
User renvoie seulement id, firstName, lastName, email, emailVerifiedAt, createdAt.
Les préférences renvoient locale, timezone, createdAt, updatedAt. Les succès sont
no-store. Email et userId ne sont pas modifiables ; champs inconnus et nulls
sont refusés. Swagger et le préfixe /api/v1 sont conservés. CORS autorise PATCH.

## Sécurité, concurrence et reprise

Le contexte JWT définit le propriétaire. Le changement exige l'ancien mot de
passe, Argon2id et un nouveau mot de passe de 12–128 caractères sans transformation.
Il exige aussi Origin=FRONTEND_URL et X-Candidly-CSRF=1 avant mutation du cookie.
Les trois POST sont limités par Redis à 5 tentatives/IP/15 min, fail closed sur panne.
Forgot a aussi un cooldown par compte atomique et une réponse 202 identique pour
compte inconnu, connu ou en cooldown.

Changement et reset calculent le hash hors verrou, puis verrouillent User. Le
changement compare à nouveau le hash attendu ; le reset relit le token et son
expiration/consommation. La même transaction remplace le hash, consomme tous les
tokens de récupération actifs, annule la demande et révoque toutes les sessions
de cet utilisateur, y compris celle de l'appelant. Aucun autre compte touché.
Token inconnu, expiré ou consommé : même 400. Une seule réinitialisation concurrente
réussit, même avec des tokens actifs différents.

Le login prend désormais le même verrou User lors de la création de session et
recontrôle le hash vérifié. Une session basée sur l'ancien mot de passe est créée
avant puis révoquée, ou refusée après ; pas de session active oubliée lors d'une
course login/reset. Les anciens JWT et refresh sont refusés aux requêtes suivantes
grâce au contrôle session en base déjà présent. Aucune connexion automatique.

Les comptes non vérifiés peuvent récupérer le mot de passe, mais emailVerifiedAt
reste inchangé et le login leur reste refusé. Aucun token de vérification email
n'est accepté pour reset et aucune confirmation implicite n'est créée.

Le cycle DurableEmailDelivery est partagé par les deux traitements de demandes,
sans nouvelle architecture d'authentification. La récupération possède ses propres
marqueurs et table. Une panne transport annule les nouvelles écritures de tokens,
conserve la demande et les anciens liens valides ; un nouveau passage/une nouvelle
instance reprend et remplace les liens après succès. Le transport local écrit
un email français et `/reset-password#token=…` dans des JSON privés 0600/dossier
0700, sans réseau, token en base ou logs. Aucun email réellement délivré.

## Vérifications réellement exécutées

| Vérification                      | Résultat                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| `npm run lint`                    | réussi                                                            |
| `npm run typecheck`               | réussi                                                            |
| `npm run format:check`            | réussi                                                            |
| `npm run test`                    | 45 tests réussis                                                  |
| `npm run test:e2e`                | 29 tests réussis                                                  |
| `npm run test:integration`        | 30 tests réussis, PostgreSQL et Redis réels                       |
| `npm run build`                   | réussi                                                            |
| `npm run prisma:validate`         | schéma valide                                                     |
| `npm run prisma:generate`         | client généré                                                     |
| `prisma migrate deploy`           | migration appliquée sur base locale dédiée                        |
| `prisma migrate status`           | trois migrations, base à jour                                     |
| Migration avec compte préexistant | prénom/hash préservés, préférences fr/Africa/Abidjan initialisées |
| Swagger                           | sept nouvelles opérations et leurs schémas vérifiés par HTTP      |
| `git diff --check`                | réussi                                                            |

Le parcours de l'API compilée a également réussi sans mocks : profil et préférences,
preflight CORS PATCH, changement de mot de passe, email local préparé automatiquement,
reset, nouveau login et refus des anciens JWT/refresh. Les logs ont été contrôlés :
aucun token, clé, hash ou mot de passe. La fixture et les fichiers temporaires ont
été retirés ; zéro fixture CAND-008 reste en base.

Node utilisé : 24.22.2. Cible vérifiée par current_database/current_user et absence
de tables : PostgreSQL 17 local port 55438, base candidly_test, utilisateur fictif
candidly_ci ; Redis 7 port 56385, projet candidly-cand008-check. Les migrations
précédentes ont été appliquées d'abord, puis un compte fictif inséré avant CAND-008
pour vérifier la préservation et l'initialisation. La fixture a ensuite été retirée.
Aucune base distante ou de production.

Les suites précédentes restent compatibles. Tests de données réelles : unicité
et création concurrente des préférences, isolation, ancien password incorrect,
révocation de plusieurs sessions, changements concurrents, tokens expirés/consommés,
reset concurrent, login/refresh concurrent au reset, cooldown et reprise après panne.
Le parcours HTTP réel vérifie profil, préférences, changement/reset, nouveau login,
refus des anciens credentials et tokens, CSRF et seuils Redis des nouvelles routes.
Les avertissements génériques dans les scénarios de panne sont attendus.

## Limites et périmètre

Email exclusivement local, aucune délivrance réelle ni page frontend reset-password.
L'écriture fichier et le commit SQL ne sont pas une transaction commune : un arrêt
peut laisser un message invalide, mais la demande reste reprenable. Pas de garantie
exactement une fois, fournisseur externe, nettoyage automatique de tokens/fichiers,
notification, changement d'email ou CRM. Locale fr seulement pour le lancement,
fuseaux IANA non limités à Africa/Abidjan. Une requête déjà autorisée ne peut pas
être annulée rétroactivement après révocation.

Aucun secret réel ajouté ; fixtures fictives example.com, clés éphémères non
versionnées, nettoyage limité à leurs identifiants. Pas de FLUSHDB ou purge globale.
Les services de test ont été arrêtés en conservant les volumes.
AGENTS.md, Docker, package.json/package-lock.json, migrations SQL et rapports précédents
inchangés. Aucun commit, push, déploiement ou migration de production. CAND-009
n'a pas été commencé. Voir [l'architecture complète](../architecture/account-recovery.md).

## Fichiers CAND-008

### Créés (17)

- `docs/architecture/account-recovery.md`
- `docs/development/cand-008-validation.md`
- `prisma/migrations/20261104000100_user_preferences_password_reset/migration.sql`
- `src/integrations/email/durable-email-delivery.ts`
- `src/modules/auth/password-recovery.controller.ts`
- `src/modules/auth/password-recovery.dto.ts`
- `src/modules/auth/password-recovery.repository.ts`
- `src/modules/auth/password-recovery.service.ts`
- `src/modules/auth/password-reset-delivery.service.ts`
- `src/modules/users/users.controller.ts`
- `src/modules/users/users.dto.ts`
- `src/modules/users/users.module.ts`
- `src/modules/users/users.repository.ts`
- `src/modules/users/users.service.ts`
- `test/e2e/account.spec.ts`
- `test/integration/account.spec.ts`
- `test/unit/account.spec.ts`

### Modifiés (18)

- `.env.example`
- `README.md`
- `docs/architecture/README.md`
- `docs/architecture/authentication.md`
- `docs/architecture/sessions.md`
- `docs/development/README.md`
- `prisma/migrations/README.md`
- `prisma/schema.prisma`
- `src/app.module.ts`
- `src/config/env.validation.ts`
- `src/config/setup-application.ts`
- `src/integrations/email/email.transport.ts`
- `src/modules/auth/auth.module.ts`
- `src/modules/auth/auth.repository.ts`
- `src/modules/auth/session.repository.ts`
- `src/modules/auth/session.service.ts`
- `src/modules/auth/verification-delivery.service.ts`
- `test/integration/session.spec.ts`
