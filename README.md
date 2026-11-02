# candidly-api

Candidly — « Chaque candidature compte. » — est un SaaS de gestion des
candidatures et des relations professionnelles, un CRM personnel de carrière
initialement destiné au marché ivoirien et disponible en français.

Ce dépôt contient l'API REST NestJS. `candidly-web` est un dépôt indépendant et
communique exclusivement avec cette API. Lire [AGENTS.md](AGENTS.md) avant toute
intervention.

## État actuel — CAND-003

Le socle technique comprend TypeScript strict, la configuration validée, Prisma
avec PostgreSQL, une sonde Redis, Swagger, la validation des entrées, Helmet,
CORS et des erreurs HTTP normalisées. Aucun module métier ni authentification
n'est implémenté. BullMQ, le stockage privé et les intégrations restent à venir.

## Prérequis et installation

- Node.js **24 LTS** (voir `.nvmrc`) et npm.
- Docker Engine et le plugin Docker Compose pour PostgreSQL 17 et Redis 7.
- Git.

Depuis ce dépôt :

```bash
nvm install
nvm use
npm ci
cp -n .env.example .env
```

Adapter `.env` aux services locaux. Garder `DATABASE_URL` cohérent avec
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` et `POSTGRES_PORT`.
Les exemples sont réservés au développement ; ne jamais commiter de secret.

```bash
docker compose config --quiet
docker compose up -d --wait
npm run prisma:validate
npm run prisma:generate
npm run start:dev
```

L'API écoute sur `127.0.0.1:3001` par défaut. La validation refuse les variables
absentes ou invalides avant le démarrage. PostgreSQL doit être disponible au
démarrage ; Redis est vérifié à chaque requête health. Pour exécuter le build :

```bash
npm run build
npm start
```

## API et documentation OpenAPI

- `GET /api/v1/health` : disponibilité de PostgreSQL et Redis.
- [Swagger local](http://localhost:3001/docs) et `/docs-json` en développement/test.
- Swagger est automatiquement désactivé lorsque `NODE_ENV=production`.

Réponse HTTP 200 :

```json
{ "status": "ok", "services": { "database": "up", "redis": "up" } }
```

En cas de dépendance indisponible, HTTP 503 avec le format d'erreur commun et
les seuls états `up`/`down`. Voir [la convention d'erreur](docs/architecture/README.md).
Le préfixe `api/v1` est l'unique stratégie de versionnement.

## Vérifications

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run format:check
```

Les tests unitaires et HTTP isolent les dépendances par des mocks. Les tests
réels de connexion exigent une base locale dédiée et des variables explicites :
voir [le guide de développement](docs/development/README.md#tests-dintégration).
Ils s'exécutent avec `npm run test:integration` après configuration.

## Prisma et migrations

Prisma utilise `prisma.config.ts` pour l'URL de connexion et génère le client ESM
dans `src/generated/prisma` (ignoré par Git). `npm ci` installe les dépendances ;
`prisma:generate`, `build` et les validations génèrent le client.

Le schéma ne contient aucun modèle métier. Une migration vide ou une table
fictive n'apporterait aucune évolution : aucune migration artificielle n'est
créée. Lors du premier changement réel de schéma, sur une base locale dédiée :

```bash
npm run prisma:migrate:dev -- --name description
npm run prisma:generate
```

`npm run prisma:migrate:deploy` applique les migrations déjà versionnées ; ne
pas l'utiliser en production sans sauvegarde vérifiée et autorisation explicite.
Aucune commande de reset n'est nécessaire dans ce ticket.

## Documentation et collaboration

- [Architecture](docs/architecture/README.md) : modules et contrats techniques.
- [Développement](docs/development/README.md) : environnement, tests et conventions.
- [Docker](docs/development/docker.md) : services, ports, volumes et dépannage.
- [ADR](docs/adr/README.md) : procédure de documentation des décisions.

Conventional Commits, `main` stable, branches `feature/CAND-XXX-description`
ou `fix/CAND-XXX-description`. Chaque ticket nécessite revue et validation
factuelle. Aucun push ni déploiement sans autorisation explicite.

CAND-003 est soumis à validation ; ne pas commencer automatiquement CAND-004.
