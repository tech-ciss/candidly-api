# Architecture

Deux dépôts Git indépendants : `candidly-web` pour le frontend web/PWA et
`candidly-api` pour l'API REST. Aucun monorepo, submodule ou dépôt Git imbriqué.

```text
Navigateur → candidly-web → API REST /api/v1 → candidly-api
                                                ├── PostgreSQL / Prisma
                                                ├── Redis (sonde technique)
                                                └── Stockage objet privé S3 (futur)
```

Le frontend n'accède jamais à PostgreSQL. Le backend est un monolithe modulaire.
Les futurs contrôleurs gèreront HTTP, les DTO la validation, les services la
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
- `prisma/` : datasource PostgreSQL sans modèle métier. L'URL est dans
  `prisma.config.ts`. Aucune migration vide ou table fictive.
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
et des conversions explicites lorsque nécessaires. Aucun DTO métier fictif.
CORS accepte uniquement les origines HTTP(S) explicites configurées. Helmet
ajoute les en-têtes de sécurité. L'authentification reste hors périmètre.

Swagger expose `/docs` et `/docs-json` en développement/test, avec les routes
versionnées et les schémas 200/503. Il n'est jamais monté automatiquement en
production.

## Suite de l'architecture cible

Redis et BullMQ serviront aux rappels, notifications, emails et imports, avec
reprises et idempotence. Aucun worker métier n'est initialisé ici.
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
