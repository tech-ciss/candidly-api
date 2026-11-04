# Rapport CAND-010 — 2026-11-04

Statut : implémenté et validé localement, prêt pour validation utilisateur.
Périmètre : candidly-api uniquement. Aucun CRM, frontend, fournisseur email,
déploiement, push ou ticket suivant. Aucune nouvelle dépendance ; versions et
package-lock.json préservés. package.json ajoute seulement le script de maintenance.

## Diagnostic initial et changements

Déjà conformes : JWT strict, sessions révocables, ownership/AuthenticatedActor,
DTO, CSRF, cookies, CORS exact, Helmet, Swagger hors production, limitation Redis
atomique fail closed et erreurs sans secrets. Manquaient logs structurés,
request ID, audit persistant, limite de corps/proxy explicités et rétention technique.

- Request ID UUID cryptographique serveur pour chaque requête, client ignoré,
  X-Request-Id exposé par CORS, propagation AsyncLocalStorage aux logs/audits.
- Logs JSON UTC à champs autorisés : niveau, service/module, événement, requestId,
  statut/durée/méthode/template de route. Aucun body, URL/query, message d'erreur,
  stack, email, IP, cookie, clé ou token. Logger Nest adapté sans sérialisation de
  ses arguments arbitraires. Contrats JSON métier inchangés.
- JSON/form stricts limités à 16 Kio par défaut, corps compressés refusés,
  erreurs parser 400/413/415 normalisées, en-têtes Helmet et CORS conservés.
- X-Powered-By désactivé ; aucun Server ajouté. CSP Helmet conservée sans nouveau
  durcissement cassant ; HTML/bundle Swagger local servis, Swagger absent en production.
- TRUSTED_PROXY_IP vide par défaut ; confiance uniquement dans une IP exacte
  connue, distinction pair direct/request.ip. Tests réels contre header falsifié.
- Audit transactionnel des mutations critiques, échecs login anonymes best effort.
- Commande de maintenance locale, explicite, dry-run par défaut, bornée et testée.

Voir [security.md](../architecture/security.md),
[audit-logging.md](../architecture/audit-logging.md) et
[la checklist](security-checklist.md).

## AuditLog et migration

[Schéma Prisma](../../prisma/schema.prisma) et
[migration 20261104000200_security_audit_log](../../prisma/migrations/20261104000200_security_audit_log/migration.sql).
AuditLog : id UUID, actorUserId nullable/FK SET NULL, eventType, outcome enum
SUCCESS/FAILURE, targetType/targetId nullable, requestId nullable, createdAt UTC,
metadata JSON contrôlé. Index acteur/date, événement/date et requestId.
Suppression User conserve le journal, targetId historique pseudonyme conservé.
Aucune route d'audit, rôle admin ou suppression d'audit ajoutée.

Seule nouvelle migration : création de l'enum/table/index/FK, aucune suppression,
reset ou réécriture des tables métier. Les trois migrations précédentes sont
inchangées, vérifiées par empreintes. Cible locale vérifiée vide avant application :
PostgreSQL 17, candidly_test, utilisateur fictif candidly_ci, port 55440 ; Redis 7
port 56387, projet candidly-cand010-check. Quatre migrations appliquées, base à jour.
Aucune migration distante ou de production.

## Événements et fiabilité

Effectivement branchés : REGISTER, EMAIL_VERIFIED, LOGIN, LOGIN_FAILURE, LOGOUT,
REFRESH_REUSE, PASSWORD_CHANGED, PASSWORD_RESET et SESSIONS_REVOKED.
Les événements de succès/rejeu critique sont atomiques avec les mutations de leurs
repositories. Audit indisponible : rollback, 500 normalisé et audit.unavailable,
sans succès annoncé. LOGIN_FAILURE reste 401 anonyme sans acteur/cible, même en
cas d'échec d'audit secondaire ; un événement peut alors être perdu. Metadata
n'accepte que reason contrôlée et sessionsCount, aucun identifiant sensible brut.
Pas de promesse exactement une fois, ni audits de chaque lecture de profil.

La FK audit vers User nécessite l'ordre de verrouillage User → Session aussi dans
refresh/logout. Les tests de concurrence password/reset/refresh restent compatibles.
Les capacités, JWT, cookies et contrôles d'ownership ne sont pas reconstruits.

## Limitation et nettoyage

Seuils existants centralisés et vérifiés : 5/IP/900 s pour register/login/resend/
forgot/reset/change ; 30 pour verify/refresh/logout. Redis indisponible refuse en
503, 429 reste normalisé avec Retry-After: 900. Cooldowns en base conservés.
Risques NAT/VPN/proxy et abus distribués documentés, aucun seuil augmenté.

Maintenance : `npm run maintenance:cleanup` ou -- --dry-run ; -- --apply explicite,
NODE_ENV development/test, URL loopback et base _dev/_test. Au plus 100 sessions,
100 tokens de vérification et 100 tokens reset par passage, éligibles seulement
après expiration + 7 j. Cascade de l'historique refresh uniquement avec sa session,
jamais avant sa fin de validité/rétention. Transaction et prédicats revérifiés.
Aucun AuditLog/User/préférence/fichier email supprimé. La cascade peut concerner
plusieurs empreintes par session ; les limites et timeouts DB restent applicables.
Pas de cron ou purge automatique. Durées proposées comme hypothèses à valider,
pas comme conclusions juridiques. Fichiers email : procédure manuelle documentée.

## Résultats des vérifications

| Commande / contrôle                                        | Résultat                                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                                             | réussi                                                                                                                                          |
| `npm run typecheck`                                        | réussi                                                                                                                                          |
| `npm run format:check`                                     | réussi                                                                                                                                          |
| `npm run test`                                             | 59 tests réussis                                                                                                                                |
| `npm run test:e2e`                                         | 41 tests réussis                                                                                                                                |
| `npm run test:integration`                                 | 41 tests réussis, PostgreSQL et Redis dédiés                                                                                                    |
| `npm run build`                                            | réussi                                                                                                                                          |
| `npm run prisma:validate`                                  | valide                                                                                                                                          |
| `npm run prisma:generate`                                  | client généré                                                                                                                                   |
| `npm run prisma:migrate:deploy` / migrate status           | quatrième migration appliquée localement, base à jour                                                                                           |
| `npm run maintenance:cleanup -- --dry-run` puis -- --apply | CLI compilée réussie sur base de test, zéro ligne éligible restante                                                                             |
| Serveur compilé NODE_ENV=production                        | Swagger 404, cookies Secure, audits login/échec/password/révocation corrélés ; toutes les lignes serveur JSON, aucun secret ou ID client repris |
| `npm audit --json`                                         | 12 alertes modérées dans l'outillage de développement                                                                                           |
| `npm audit --omit=dev --json`                              | 0 vulnérabilité connue de production à cette date                                                                                               |
| `git diff --check` et contrôle de périmètre                | réussis                                                                                                                                         |

Node utilisé : 24.22.2. Les tests existants restent compatibles. Les nouveaux tests
couvrent request IDs asynchrones, liste blanche des logs/métadonnées, classification,
proxy connu vs pair non fiable, parser et erreurs, audit HTTP, persistance,
rollback réel sur erreur audit, histoire après suppression User, maintenance
positive/dry-run/répétition, préservation des sessions/tokens valides et du refresh
encore dans sa rétention. Le test de maintenance utilise une horloge historique
contrôlée pour ne pas sélectionner les fixtures expirées des autres suites.
Les avertissements des scénarios de panne volontaires sont génériques et attendus.

Le contrôle du processus serveur compilé a utilisé un compte fictif et une clé
éphémère ; logs stdout/stderr contrôlés, compte retiré ensuite et audit conservé.
Aucun secret réel ajouté. Les tests nettoient uniquement leurs comptes uniques
example.com ; les audits restent dans le volume de test, actorUserId devient null.
Aucun pipeline distant GitHub ou serveur Nginx modifié/exécuté.

## Audit des dépendances et risques résiduels

[Analyse détaillée](dependency-audit-cand-010.md) : les 12 entrées proviennent de
minimatch 10.2.6 et de ses chaînes Nest CLI/ESLint/typescript-eslint. Correctif
annoncé 11.0.1, changement majeur transitif non forcé. Aucun audit fix --force,
override ou mise à jour majeure. Le runtime omit=dev ne contient pas cette chaîne ;
les runners/outils qui traitent du contenu non fiable restent exposés. Ce résultat
ne constitue pas une certification ou l'absence de toute vulnérabilité.

Les opérations critiques peuvent être indisponibles si l'audit l'est, y compris
une révocation dont la transaction rollback ; ne pas l'annoncer réussie sur 500.
Les audits PostgreSQL ne sont pas immuables pour un administrateur DB, et stdout
n'est pas une livraison externe garantie. Prévoir privilèges, alertes, rétention,
collecte, sauvegardes et restauration. Les UUID/horaires restent pseudonymes, pas
anonymes. Modèle proxy unique connu seulement ; un accès depuis le pair approuvé
fait partie de la frontière de confiance. Email uniquement local, pas de keyring
JWT, pas de RLS ou nouveau module CRM. Checklist avant production à compléter.

Les services dédiés ont été arrêtés en conservant leurs volumes et leurs audits.
AGENTS.md, Docker, CI, package-lock.json, dépendances et migrations/rapports
précédents sont inchangés. Aucun push, déploiement ou ticket suivant commencé.

## Fichiers CAND-010

### Créés (17)

- `docs/architecture/audit-logging.md`
- `docs/architecture/security.md`
- `docs/development/cand-010-validation.md`
- `docs/development/dependency-audit-cand-010.md`
- `docs/development/security-checklist.md`
- `prisma/migrations/20261104000200_security_audit_log/migration.sql`
- `src/common/observability/http-observability.ts`
- `src/common/observability/request-context.ts`
- `src/common/observability/structured-logger.ts`
- `src/config/proxy-trust.ts`
- `src/maintenance/run-cleanup.ts`
- `src/maintenance/technical-cleanup.ts`
- `src/modules/audit/audit-log.ts`
- `src/modules/auth/auth-rate-limit.policy.ts`
- `test/e2e/security.spec.ts`
- `test/integration/security.spec.ts`
- `test/unit/security.spec.ts`

### Modifiés (22)

- `.env.example`
- `README.md`
- `docs/architecture/README.md`
- `docs/architecture/sessions.md`
- `docs/development/README.md`
- `package.json`
- `prisma/migrations/README.md`
- `prisma/schema.prisma`
- `src/common/filters/http-exception.filter.ts`
- `src/config/env.validation.ts`
- `src/config/setup-application.ts`
- `src/main.ts`
- `src/modules/auth/auth-rate-limit.guard.ts`
- `src/modules/auth/auth-rate-limit.store.ts`
- `src/modules/auth/auth.repository.ts`
- `src/modules/auth/password-recovery.repository.ts`
- `src/modules/auth/session.repository.ts`
- `src/modules/auth/session.service.ts`
- `test/e2e/account.spec.ts`
- `test/e2e/authorization.spec.ts`
- `test/e2e/session.spec.ts`
- `test/unit/auth.spec.ts`
