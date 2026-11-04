# Rapport CAND-009 — 2026-11-04

Statut : implémenté et validé localement, prêt pour validation utilisateur.
Dépôt : candidly-api uniquement. Les changements CAND-006/007/008 présents et
non commités au démarrage ont été préservés. Les fichiers ci-dessous sont les
changements CAND-009 par rapport à cet état initial, pas au dernier commit Git.

## Résumé et architecture retenue

La [stratégie d'autorisation](../architecture/authorization.md) a été écrite avant
implémentation, puis complétée avec les conventions et tests. JwtAuthGuard,
CurrentUser, validation de session, CSRF, DTO, CORS, rate limiting et filtre
HTTP sont réutilisés. Aucun second système d'authentification ni rôle admin.

AuthenticatedActor expose seulement userId/sessionId, readonly et gelés.
Un Symbol privé et un WeakSet garantissent que seuls les objets créés par la
fabrique serveur sont reconnus ; JSON client et copies spread sont refusés.
La fabrique n'authentifie pas et son unique appel de production se trouve dans
JwtAuthGuard après validation du JWT, de la session et de l'identité sub.
Le guard efface tout contexte préalable. CurrentActor lit ce contexte ; CurrentUser
reste compatible avec les identités publiques, conservées séparément sur la requête.

Les contrôleurs Users passent le contexte aux services et repositories, qui
l'exigent au lieu d'un userId libre. Le changement de mot de passe récupère aussi
l'id depuis CurrentActor. Les opérations publiques email/token continuent à
utiliser leurs capacités vérifiées et ne demandent pas de JWT inexistant.

## Mécanismes d'ownership

- ownerWhere : AND externe propriétaire + filtre métier, impossible à remplacer
  par un OR ou un userId adverse dans le filtre.
- ownedIdWhere : id et userId dans le même prédicat pour les modèles possédés.
- selfWhere : id=userId authentifié pour le modèle User lui-même.
- privateResource : 404 générique sur null/undefined, sans recherche globale.
- requireAffected : même 404 si le nombre d'écritures n'est pas celui attendu ;
  utilisé à l'intérieur d'une transaction pour annuler un lot mixte.

UsersRepository applique ces filtres sur les lectures, les mutations
updateManyAndReturn et les préférences. L'initialisation des préférences crée
uniquement userId issu du contexte. Aucun update non filtré après un précontrôle.
La politique 404 absent/étranger et les 403 d'interdiction explicite utilisent
le filtre d'erreur normalisé existant sans exposer nom, email, hash ou token.

Les conventions de lecture, mutation, suppression, pagination, count, recherche,
curseur, lots et relations sont documentées avec des exemples basés sur Session
ou fictifs limités aux tests. Les futurs liens CRM doivent imposer propriétaire
commun ET invariants companyId dans les transactions et contraintes adaptées ;
aucune table ou contrainte CRM n'est créée ici.

## Isolation testée

Les utilisateurs A et B sont fictifs, avec UUID distincts et emails example.com.

- Chaque utilisateur lit/modifie son profil et ses préférences, y compris en parallèle.
- Body userId/id/auth/currentUser et headers/query arbitraires ne donnent pas accès
  au compte tiers ; les propriétés de mutation inconnues restent refusées.
- Un objet client, une copie du contexte ou un contexte absent est refusé.
- JWT signé avec sub A et sid B refusé, session légitime B toujours active.
- Cookie A avec bearer/body/header B : logout révoque seulement la session A.
- Refresh arbitraire avec sid B dans le body refusé sans effet sur B ; le cookie
  valide B reste utilisable. Les capacités cookie ne sont pas remplacées par un ID.
- Prédicats Prisma réels : AND propriétaire, OR hostile, pagination et count filtrés.
- Lecture/mutation/suppression d'une session B ou inexistante par A : aucune ligne
  révélée ou affectée, même 404 au helper, utilisateur B inchangé.
- Lot mixte PostgreSQL : l'écriture sur A est annulée quand B/inconnu manque dans
  le nombre attendu ; un lot propre ne modifie pas B.
- Repository fictif en mémoire : lecture, suppression, recherche/liste/total,
  déduplication des lots, relations entre propriétaires/entreprises incompatibles,
  filtre revérifié après changement de propriétaire entre lecture et mutation.
- Erreurs normalisées 403/404 sans données privées et absence de route choisissant
  le profil d'un tiers. Aucun endpoint CRM ou table de test déployé.

## Vérifications exécutées

| Commande / contrôle                      | Résultat                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                           | réussi                                                                                                                       |
| `npm run typecheck`                      | réussi                                                                                                                       |
| `npm run format:check`                   | réussi                                                                                                                       |
| `npm run test`                           | 52 tests réussis                                                                                                             |
| `npm run test:e2e`                       | 35 tests réussis                                                                                                             |
| `npm run test:integration`               | 35 tests réussis, PostgreSQL/Redis dédiés                                                                                    |
| `npm run build`                          | réussi                                                                                                                       |
| Prisma Client                            | généré par les scripts existants, aucun schéma modifié                                                                       |
| `git diff --check`                       | réussi                                                                                                                       |
| Conservation des fichiers hors périmètre | empreintes avant/après identiques pour schéma, migrations, dépendances, Docker, configuration, AGENTS et rapports précédents |

Node 24.22.2 ; PostgreSQL 17 local port 55439, Redis 7 port 56386,
projet candidly-cand009-check, base candidly_test et utilisateur fictif candidly_ci.
Cible et absence de tables vérifiées avant application des **trois migrations
existantes inchangées**, uniquement pour préparer la base de test vide.
Aucune migration CAND-009, modification structurelle, reset ou base de production.
Les fixtures sont retirées par leurs seuls emails uniques, sans purge globale.

Une première exécution d'intégration pendant d'autres validations a échoué sur
le démarrage PostgreSQL du module HTTP (connexion indisponible). La suite relancée
seule a réussi sans modifier les délais ou protections PostgreSQL. La passe finale
exécute les trois suites séquentiellement. Les messages génériques des scénarios
de panne volontaires des tickets précédents restent attendus et sans secrets.
Aucun pipeline GitHub n'a été exécuté à distance.

## Risques résiduels et limites

Les helpers ne sont pas une sandbox ou une politique RLS. Un futur code serveur
peut encore oublier un filtre ou appeler directement Prisma/la fabrique : les
conventions, la revue de chaque requête et les tests à deux utilisateurs restent
obligatoires. L'acteur est local au processus et non sérialisable comme preuve
d'authentification ; une tâche de fond doit revalider ses propres entrées de confiance.

Les ressources CRM n'existent pas. Les tests fictifs ne prouvent ni des FK
composites ni des invariants de concurrence sur de futurs modèles ; chaque module
devra ajouter ses contraintes et tests sur la vraie base. Aucun transfert de
propriétaire ou rôle global n'est fourni. Le vol d'un refresh est un vol de
justificatif, qui relève des protections cookies/CSRF/rotation déjà présentes.
Une requête déjà autorisée ne peut pas être annulée rétroactivement après révocation.

Les services de test ont été arrêtés en conservant les volumes.
Aucune dépendance ajoutée, aucun secret réel, frontend, déploiement, commit ou push.
Schéma et migrations, AGENTS.md, infrastructure, .env.example, package.json/lock,
workflow CI et rapports précédents inchangés. CAND-010 n'a pas été commencé.

## Fichiers CAND-009

### Créés (7)

- `docs/architecture/authorization.md`
- `docs/development/cand-009-validation.md`
- `src/common/authorization/authenticated-actor.ts`
- `src/common/authorization/ownership.ts`
- `test/e2e/authorization.spec.ts`
- `test/integration/authorization.spec.ts`
- `test/unit/authorization.spec.ts`

### Modifiés (11)

- `README.md`
- `docs/architecture/README.md`
- `docs/development/README.md`
- `src/modules/auth/jwt-auth.guard.ts`
- `src/modules/auth/password-recovery.controller.ts`
- `src/modules/users/users.controller.ts`
- `src/modules/users/users.repository.ts`
- `src/modules/users/users.service.ts`
- `test/e2e/account.spec.ts`
- `test/integration/account.spec.ts`
- `test/unit/account.spec.ts`
