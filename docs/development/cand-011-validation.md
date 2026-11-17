# Validation CAND-011 — Module CRM Entreprises

Date : 2026-11-06. Dépôt : candidly-api uniquement. Node 24.22.2 temporaire,
PostgreSQL 17 et Redis 7 locaux dédiés. Aucune dépendance ajoutée/modifiée.

## Résultat fonctionnel

Module Companies séparant controller/service/repository/DTO. Les sept routes
REST sous /api/v1/companies sont disponibles : POST, GET liste, GET :id,
PATCH :id, POST :id/archive, POST :id/restore, DELETE :id. JWT/session active,
CurrentActor et helpers CAND-009 conservés. Voir [le contrat détaillé](../architecture/companies.md).

Company inclut les champs métier, le propriétaire privé immuable, la clé interne
normalisée, le statut et les dates UTC. Migration additive
20261106000100_companies : enum/table/index/unique/FK RESTRICT/CHECK de cohérence
archive. Les quatre anciennes migrations restent inchangées.

Unicité PostgreSQL par propriétaire après NFC, trim, réduction des espaces et
minuscules Unicode ; accents conservés, archives incluses. Collisions = 409.
Facultatifs null effacés ; chaînes vides et champs inconnus refusés ; PATCH vide 400. Archive/restore répétés sans événement ou changement de dates. DELETE effectif
204 puis 404. Relations métier futures à protéger par RESTRICT et règle explicite.

Listes et compteurs filtrés par le même propriétaire, recherche OR limitée aux
champs autorisés, tri stable avec id, pagination bornée. Transaction RepeatableRead
pour un total et une page au même instantané. Filtres case-insensitive et recherche
littérale avec échappement des motifs LIKE. Propriétaire absent/étranger : même 404,
sans prélecture globale ni mutation non filtrée.

Cinq événements COMPANY_* atomiques avec la mutation, acteur authentifié, cible
UUID COMPANY, requestId et metadata {}. Aucun nom, URL, note ni valeur métier dans
l’audit ; rollback complet en cas de panne. Pas de route publique de lecture audit.

## Vérifications exécutées

| Commande                      | Résultat final                          |
| ----------------------------- | --------------------------------------- |
| npm run lint                  | Réussi                                  |
| npm run typecheck             | Réussi                                  |
| npm run format:check          | Réussi                                  |
| npm run test                  | 64 tests réussis                        |
| npm run test:e2e              | 43 tests réussis                        |
| npm run test:integration      | 48 tests réussis                        |
| npm run build                 | Réussi                                  |
| npm run prisma:validate       | Réussi                                  |
| npm run prisma:generate       | Réussi                                  |
| npm run prisma:migrate:deploy | 5 migrations appliquées sur base dédiée |
| prisma migrate status         | Base à jour                             |
| git diff --check              | Réussi                                  |

Unitaires nouveaux : nom Unicode et expansion des minuscules, DTO/bornes/types/
null/champs inconnus/URL, query et filtre, conflits DB normalisés, PATCH vide,
audit sans métadonnées métier. E2E isolés : toutes routes sans JWT, CRUD,
doublons, validation, pagination/recherche/archive, 404 lecture et mutations
étrangères/inconnues, champs internes absents. Repository doublé dans cette suite ;
les garanties DB sont vérifiées par les tests d’intégration réels.

Intégration nouvelle avec deux comptes fictifs par exécution : collisions de
création et de renommage simultanées, même entreprise pour deux utilisateurs,
Unicode et archives uniques, recherche par nom/secteur/ville, filtres, caractères
LIKE littéraux, pagination/count privés, trois tris, liste pendant modification,
mutations étrangères refusées, archive/restore/delete concurrents, historique
conservé, contraintes SQL et rollback réel des cinq mutations en cas d’échec audit.
Le parcours HTTP réel utilise les sessions/JWT existants et vérifie correlation
requestId/audit, données sensibles absentes et Swagger. Les tests antérieurs
restent inclus dans tous les totaux ci-dessus.

Les premiers essais ont révélé des erreurs de typage/lint des nouveaux tests et
un compte mock non marqué email vérifié (401 attendu du guard existant) ; corrigés.
Un lancement d’intégration a été refusé avant connexion car PORT n’avait pas été
exporté ; corrigé par PORT=3001, sans changer la validation de configuration.
Le diff Prisma depuis le répertoire de migrations nécessite une shadow database ;
le SQL a été extrait de la génération depuis un schéma vide, limité aux seuls
objets Company, relu puis appliqué sur la base de test. Aucun reset/db push utilisé.
Certains contrôles Node 24 sont restés sans progression dans le bac à sable :
interrompus puis exécutés avec accès local autorisé, sans affaiblir les contrôles.

## Environnement et reproductibilité

Projet Compose `candidly-cand011-check`, PostgreSQL 127.0.0.1:55441,
Redis 127.0.0.1:56388, base candidly_test, identifiants fictifs
candidly_ci/ci_only_password. Volumes créés pour ce ticket uniquement.
Exporter NODE_ENV=test, PORT=3001, DATABASE_URL et INTEGRATION_DATABASE_URL
identiques vers cette base, REDIS_HOST/REDIS_PORT, FRONTEND_URL et CORS_ORIGIN
http://localhost:3000, EMAIL_TRANSPORT=disabled et JWT_SIGNING_KEY éphémère sans
l’afficher. Appliquer les migrations versionnées, puis les commandes du tableau.
Les tests retirent uniquement leurs propres entreprises puis comptes example.com ;
les audits restent conservés. Pas de purge globale d’une table ou de Redis.
Contrôle SQL final : 0 entreprise et 0 compte de fixture restants ; 46 audits
COMPANY conservés. PK, index unique, trois index de tri, FK RESTRICT et CHECK
archive présents. Services arrêtés après validation, volumes conservés.

## Limites et risques résiduels

- Pas d’instantané entre deux pages HTTP distinctes ; grands offsets/recherches
  contains à profiler avant gros volume. Aucun trigram ni moteur de recherche ajouté.
- Case folding Unicode simple, sans fusion ß/ss ni suppression d’accents.
- Une panne audit bloque la mutation (500) et doit être supervisée en exploitation.
- Suppression de compte bloquée par FK tant que le portefeuille existe ; future
  politique d’effacement et ordre de verrous à définir avec les modules concernés.
- Les FK des futurs contacts/candidatures et leurs règles ne sont pas encore créées.
- Limite HTTP globale 16 KiB conservée ; peut limiter un corps multioctet maximal.
- Validation locale ; aucune exécution GitHub Actions distante, migration distante,
  modification frontend, déploiement, commit ou push. CAND-012 non commencé.

## Fichiers créés et modifiés

13 fichiers créés :

- `docs/architecture/companies.md`
- `docs/development/cand-011-validation.md`
- `prisma/migrations/20261106000100_companies/migration.sql`
- `src/modules/companies/companies.controller.ts`
- `src/modules/companies/companies.module.ts`
- `src/modules/companies/companies.repository.ts`
- `src/modules/companies/companies.service.ts`
- `src/modules/companies/company-name.ts`
- `src/modules/companies/dto/companies.dto.ts`
- `src/modules/companies/dto/empty-company-body.pipe.ts`
- `test/e2e/companies.spec.ts`
- `test/integration/companies.spec.ts`
- `test/unit/companies.spec.ts`

8 fichiers modifiés :

- `README.md`
- `docs/architecture/README.md`
- `docs/architecture/audit-logging.md`
- `docs/development/README.md`
- `prisma/migrations/README.md`
- `prisma/schema.prisma`
- `src/app.module.ts`
- `src/modules/audit/audit-log.ts`

Statut : implémenté et validé localement, prêt pour revue utilisateur.
