# Architecture

Deux dépôts Git indépendants : `candidly-web` pour le frontend web/PWA et
`candidly-api` pour l'API REST. Aucun monorepo, submodule ou dépôt Git imbriqué.

```text
Navigateur → candidly-web → API REST /api/v1 → candidly-api
                                                ├── PostgreSQL / Prisma
                                                ├── Redis (sonde et limitation auth)
                                                └── Stockage objet privé S3 (futur)
```

Le frontend n'accède jamais à PostgreSQL. Le backend est un monolithe modulaire.
Les contrôleurs gèrent HTTP, les DTO la validation, les services la
logique métier et les repositories les accès complexes. Les vérifications
systématiques d'appartenance seront ajoutées avec les ressources privées.

## Socle CAND-003

- `main.ts` : démarrage, écoute locale et arrêt propre sur SIGINT/SIGTERM.
- `app.module.ts` : composition de la configuration globale et du module health.
- `config/` : validation des variables, configuration typée, préfixe unique
  `api/v1`, Swagger, ValidationPipe, Helmet et CORS.
- `database/` : module injectable et PrismaService, connexion vérifiée au
  démarrage, déconnexion au shutdown. Prisma 7 utilise l'adaptateur PostgreSQL
  `@prisma/adapter-pg` et un client ESM généré localement.
- `modules/health/` : contrôleur, DTO OpenAPI techniques, orchestration des sondes
  et connexion Redis courte, fermée après chaque requête.
- `common/filters/` : normalisation de toutes les erreurs HTTP et inattendues.
- `common/interceptors/` : emplacement réservé ; aucun enveloppement des succès
  n'est ajouté artificiellement.
- `prisma/` : modèles User et EmailVerificationToken depuis CAND-006 ; URL dans
  `prisma.config.ts` et première migration métier versionnée.
- `test/` : tests unitaires, HTTP avec mocks et connexions locales réelles.

PostgreSQL reste la source de vérité. Les connexions, requêtes et statements
PostgreSQL sont bornés à deux secondes chacun. La sonde Redis est bornée à deux
secondes au total, sans reconnexion automatique, et les sondes sont lancées en
parallèle. Une base indisponible au démarrage empêche l'API de démarrer ; après
démarrage, toute dépendance indisponible entraîne un healthcheck HTTP 503.

## Contrats HTTP et sécurité

Le succès du healthcheck conserve sa forme simple :
`{ "status": "ok", "services": { "database": "up", "redis": "up" } }`.

Toutes les erreurs suivent ce contrat :

```json
{
  "success": false,
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Un service est temporairement indisponible."
  },
  "timestamp": "2026-11-02T00:00:00.000Z",
  "path": "/api/v1/health",
  "services": { "database": "down", "redis": "up" }
}
```

`services` est optionnel et réservé aux états de dépendances du healthcheck.
Le code correspond au nom du statut HTTP ; le message public provient d'une
liste contrôlée. Les exceptions brutes, valeurs invalides, identifiants de
connexion, query strings et stacks ne sont jamais renvoyés. Les logs du filtre
indiquent seulement le statut HTTP des erreurs serveur.

Validation globale : whitelist, refus des champs inconnus, transformation
activée sans conversion implicite ; les futurs DTO utiliseront class-validator
et des conversions explicites lorsque nécessaires. Le module auth ajoute les DTO métier.
CORS accepte uniquement les origines HTTP(S) explicites configurées. Helmet
ajoute les en-têtes de sécurité. Le login et les sessions sont décrits dans
[l'architecture CAND-007](sessions.md).

Swagger expose `/docs` et `/docs-json` en développement/test, avec les routes
versionnées et les schémas 200/503. Il n'est jamais monté automatiquement en
production.

## Suite de l'architecture cible

Redis et BullMQ serviront aux rappels, notifications, emails et imports, avec
reprises et idempotence. Pour CAND-006, un traitement borné dans le processus
reprend un marqueur durable PostgreSQL sans file supplémentaire ; voir
[l'architecture d'inscription](authentication.md) et l'ADR 0001.
Les documents utiliseront un stockage objet privé compatible S3, avec contrôle
d'accès, URL signée temporaire et préservation des versions historiques.
Le fournisseur reste à définir.

Séparer `development`, `staging` et `production`. Les services Docker locaux sont
démarrables depuis CAND-002 ; voir le [guide Docker](../development/docker.md).
Ne jamais utiliser de données de production dans les tests. Les modules métier
seront créés progressivement selon [AGENTS.md](../../AGENTS.md).

## Références des versions installées

- [NestJS : conventions ESM et prérequis](https://docs.nestjs.com/migration-guide)
- [Prisma 7 : génération du client](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/generating-prisma-client)
- [Prisma 7 : fichier de configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)

## Sessions — CAND-007

Le module auth ajoute le contrôleur de sessions, les DTO login/identité,
SessionService et SessionRepository, AccessTokenService, JwtAuthGuard réutilisable,
CurrentUser typé, CookieCsrfGuard et SessionCookieService. La protection reste
explicite sur les routes privées, sans fermer inscription et vérification.
Voir [sessions.md](sessions.md) et [l'ADR 0002](../adr/0002-session-security.md).

## Compte et récupération — CAND-008

`modules/users` ajoute contrôleur, DTO, service et repository du profil et des
préférences. Il importe AuthModule et utilise JwtAuthGuard/CurrentUser existants.
`modules/auth` ajoute PasswordRecoveryController/Service/Repository et le traitement
des demandes durables PasswordResetDeliveryService. Les deux traitements email
partagent désormais leur cycle de vie DurableEmailDelivery sans mélanger les
modèles de tokens. Voir [account-recovery.md](account-recovery.md).

## Autorisations — CAND-009

Voir [authorization.md](authorization.md) : contexte minimal CurrentActor,
propriétaire imposé dans les repositories, filtres AND/id+userId, mutations
conditionnelles, politique 403/404, lots tout-ou-rien et invariants de relations.
CurrentUser reste compatible pour l'identité publique ; le contexte transmis au
module Users ne transporte plus le profil. Aucune migration ou table CRM.

## Durcissement et audit — CAND-010

[security.md](security.md) décrit HTTP, proxy exact, seuils Redis et rétention.
[audit-logging.md](audit-logging.md) définit les champs autorisés, la corrélation,
les événements, les transactions et les limites de livraison. AuditLog est ajouté
sans modifier les anciennes migrations ; la maintenance reste manuelle et locale.
