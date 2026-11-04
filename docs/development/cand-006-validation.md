# Rapport CAND-006 — 2026-11-03

Statut : implémenté et validé localement, prêt pour revue utilisateur.
Aucun début de CAND-007, push, déploiement ou migration de production.

## Fonctionnalités et dépendances

- Modèles User et EmailVerificationToken, première migration métier SQL.
- Inscription, vérification atomique et renvoi sans session ni JWT.
- Email trim/lower unique en base ; DTO stricts, noms trim, mots de passe préservés.
- Argon2id (19 MiB, deux passes, parallélisme 1), tokens 256 bits/SHA-256, TTL 24 h.
- Demande durable, reprise après panne, invalidation des anciens tokens après succès.
- Redis partagé : 5 inscriptions, 5 renvois, 30 vérifications / IP / 15 min ;
  cooldown par compte 60 s, panne Redis fermée en 503.
- Transport email local privé, aucun fournisseur ni délivrance réelle.

Dépendance directe ajoutée : `argon2@0.45.2`. Transitifs ajoutés au verrouillage :
`@epic-web/invariant@1.0.0`, `@phc/format@1.0.0`, `cross-env@10.1.0`,
`node-addon-api@8.9.2`, `node-gyp-build@4.8.4`. Aucune version préexistante
n'a été modifiée. Node local utilisé : 24.22.2 ; Prisma reste 7.10.1.

## Schéma, API et transport

Voir [schema.prisma](../../prisma/schema.prisma),
[la migration](../../prisma/migrations/20261103000100_user_email_verification/migration.sql),
[les contraintes](../../prisma/migrations/README.md),
[l'architecture auth](../architecture/authentication.md) et
[l'ADR de reprise](../adr/0001-verification-email-delivery.md).

| POST sous `/api/v1/auth` | Succès                                       | Principales erreurs                                    |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------ |
| `/register`              | 202, générique y compris doublon             | 400, 429, erreur de dépendance                         |
| `/verify-email`          | 200, aucun cookie/session                    | 400 inconnu/expiré/consommé, 429, erreur de dépendance |
| `/resend-verification`   | 202, identique pour inconnu/vérifié/cooldown | 400, 429, erreur de dépendance                         |

Les réponses ne contiennent que success/message. Les DTO et statuts sont
vérifiés via `/docs-json`. Les erreurs conservent le filtre global sûr.
Le transport écrit des JSON 0600 dans un dossier 0700, sans token dans les logs.
Le lien frontend utilise un fragment `/verify-email#token=…` ; sa page n'est pas
implémentée. Les fichiers locaux permettent de tester le POST de vérification.

## Validations réellement exécutées

| Commande / contrôle             | Résultat                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| `npm run lint`                  | réussi                                                      |
| `npm run typecheck`             | réussi                                                      |
| `npm run format:check`          | réussi                                                      |
| `npm run test`                  | 31 tests réussis                                            |
| `npm run test:e2e`              | 14 tests réussis                                            |
| `npm run test:integration`      | 13 tests réussis, PostgreSQL et Redis réels                 |
| `npm run build`                 | réussi                                                      |
| `npm run prisma:validate`       | schéma valide                                               |
| `npm run prisma:generate`       | client généré                                               |
| `npm run prisma:migrate:deploy` | migration appliquée sur la base locale dédiée vérifiée vide |
| `prisma migrate status`         | base à jour                                                 |
| `actionlint`                    | workflow CI adapté valide                                   |
| `npm audit --omit=dev --json`   | 0 vulnérabilité connue de production à cette date           |
| Versions du lock préexistantes  | aucune modification                                         |
| `git diff --check`              | réussi                                                      |

La migration a été inspectée avant exécution. Cible vérifiée par `current_database`,
`current_user` et absence de relations : `candidly_test`, utilisateur fictif
`candidly_ci`, PostgreSQL 17 local port 55436, Redis 7 port 56383, projet Docker
`candidly-cand006-check`. Aucun reset ni modification de l'infrastructure Docker.
Les tests suppriment seulement leurs fixtures par emails aléatoires `example.com`.
Les clés Redis de test sont isolées et expirables, aucun FLUSHDB.

Les tests couvrent notamment les contraintes SQL, les inscriptions concurrentes,
les vérifications concurrentes avec tokens identiques et différents, les tokens
expirés/consommés, les renvois avec cooldown, la conservation des anciens tokens
sur panne email, la reprise par un nouveau traitement, les envois concurrents,
les réponses génériques, le rate limiting et les réponses sans secrets.
Les avertissements génériques pendant les scénarios de panne sont attendus.

L'audit complet informatif de l'installation signalait aussi 12 vulnérabilités
modérées ; l'audit production filtré ci-dessus est distinct. Aucun `audit fix`
ni mise à jour hors périmètre n'a été appliqué.

## Sécurité, limites et périmètre

Aucun token brut ni mot de passe en clair en base ; aucun secret réel ajouté.
Les tokens bruts existent seulement en mémoire et dans les messages locaux privés.
Aucun endpoint de lecture de ces messages, aucune donnée personnelle réelle.
CORS, Helmet, validation globale et filtre d'erreur conservés. Vérification et
consommation sont transactionnelles avec ordre de verrouillage utilisateur/tokens.
Les contrôles de dépendance et les erreurs d'envoi sont testés sans fuite de secrets.

Pas de prestataire email ni délivrance réelle, pas de page frontend de vérification,
pas de login ou sessions. Pas d'atomicité entre fichier et commit PostgreSQL :
un arrêt peut produire un message invalide, mais la demande reste reprenable.
Les limites de débit, conservation et futurs transports sont documentés dans
l'architecture. Le workflow GitHub Actions n'a pas été exécuté à distance.
Le frontend et les fichiers AGENTS.md restent inchangés. Les conteneurs de test
ont été arrêtés sans suppression des volumes.

## Fichiers

### Créés (20)

- `docs/adr/0001-verification-email-delivery.md`
- `docs/architecture/authentication.md`
- `docs/development/cand-006-validation.md`
- `prisma/migrations/20261103000100_user_email_verification/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `src/integrations/email/email.transport.ts`
- `src/integrations/email/local-email.transport.ts`
- `src/modules/auth/auth-rate-limit.guard.ts`
- `src/modules/auth/auth-rate-limit.store.ts`
- `src/modules/auth/auth.controller.ts`
- `src/modules/auth/auth.module.ts`
- `src/modules/auth/auth.repository.ts`
- `src/modules/auth/auth.service.ts`
- `src/modules/auth/dto/auth.dto.ts`
- `src/modules/auth/password.service.ts`
- `src/modules/auth/verification-delivery.service.ts`
- `src/modules/auth/verification-token.ts`
- `test/e2e/auth.spec.ts`
- `test/integration/auth.spec.ts`
- `test/unit/auth.spec.ts`

### Modifiés (13)

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `docs/architecture/README.md`
- `docs/development/README.md`
- `package-lock.json`
- `package.json`
- `prisma/migrations/README.md`
- `prisma/schema.prisma`
- `src/app.module.ts`
- `src/config/env.validation.ts`
- `test/e2e/app.spec.ts`
