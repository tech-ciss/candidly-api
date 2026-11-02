# Architecture cible

Candidly sépare deux dépôts Git autonomes : `candidly-web` pour le frontend
web/PWA et `candidly-api` pour le backend. Chaque dépôt gère sa configuration,
ses futures dépendances et sa documentation ; aucun monorepo ni submodule.

```text
Navigateur → candidly-web → API REST /api/v1 → candidly-api
                                                ├── PostgreSQL
                                                ├── Redis / BullMQ
                                                └── Stockage objet privé compatible S3
```

Le frontend communique exclusivement avec l'API REST et ne se connecte jamais
à PostgreSQL. Le backend est un monolithe modulaire : contrôleurs pour HTTP,
DTO pour la validation, services pour la logique métier et repositories pour
les accès complexes aux données. Swagger/OpenAPI documentera les endpoints.
Les ressources privées seront systématiquement filtrées par propriétaire.

PostgreSQL est la base principale et la source de vérité métier. Prisma gérera
les accès et migrations lors du ticket correspondant. Redis et BullMQ serviront
aux traitements asynchrones (rappels, notifications, emails transactionnels,
imports), avec reprise sur erreur et idempotence lorsque nécessaire.

Les documents seront conservés dans un stockage objet privé compatible S3.
Le téléchargement nécessitera une autorisation et une URL signée temporaire.
Les versions historiquement associées aux candidatures seront préservées.
Le fournisseur de stockage reste à définir.

## Environnements prévus

Séparer `development`, `staging` et `production`, avec des configurations et
services distincts. Les exemples locaux utilisent le frontend sur le port 3000,
l'API sur 3001, PostgreSQL sur 5432 et Redis sur 6379. Ces services ne sont pas
installés ni démarrables à ce stade. Ne jamais utiliser de données de production
pour les tests ni publier de secrets.

CAND-001 prépare uniquement les conventions et la documentation. Les frameworks,
services, modules métier, conteneurs et pipelines seront configurés par les
prochains tickets. Les structures cibles de code figurent dans
[AGENTS.md](../../AGENTS.md) et seront créées progressivement.
