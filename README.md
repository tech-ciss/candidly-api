# candidly-api

Candidly — « Chaque candidature compte. » — est une plateforme SaaS de gestion
des candidatures et des relations professionnelles, un CRM personnel de carrière
initialement destiné au marché ivoirien et disponible en français.

## Rôle du backend

Ce dépôt porte l’API REST versionnée `/api/v1` : validation des entrées,
logique métier et accès aux données. Le backend sera un monolithe modulaire,
avec vérification systématique de l’appartenance des ressources privées.

## Stack prévue

Node.js, NestJS, TypeScript, PostgreSQL, Prisma ORM, Redis, BullMQ,
Swagger/OpenAPI, JWT et Argon2id.

Ces technologies seront installées dans les tickets suivants.

## Architecture générale

`candidly-web` et `candidly-api` sont deux dépôts Git indépendants.
Le frontend consomme l'API REST du backend ; PostgreSQL est la source de vérité,
Redis/BullMQ traite les tâches asynchrones et les documents utilisent un stockage
objet privé compatible S3. Voir [l'architecture cible](docs/architecture/README.md).

## Prérequis

- Git pour travailler avec le dépôt.
- Node.js **24 LTS**, ligne commune aux deux dépôts, déclarée dans `.nvmrc`.
- nvm, facultatif, pour sélectionner cette ligne avec `nvm install` et `nvm use`.

La ligne 24 reste en support LTS selon le [calendrier officiel Node.js](https://github.com/nodejs/Release).
Elle satisfait les prérequis publiés de [Next.js](https://nextjs.org/docs/app/getting-started/installation)
et [NestJS](https://docs.nestjs.com/first-steps). Les versions exactes des frameworks
seront vérifiées lors de leur installation. `.nvmrc` suit la dernière corrective
24.x disponible plutôt que de figer un correctif ancien.

## État actuel — CAND-001

Seules les fondations Git, les configurations générales et la documentation sont
préparées. Aucun framework, dépendance applicative, service de données ou Docker
n'est installé. Aucun `package.json` ni script npm n'existe : il n'y a pas encore
de commande de démarrage, lint, typecheck, test ou build.

[.env.example](.env.example) décrit uniquement la configuration locale future.
Les valeurs sont fictives et ne démarrent aucun service. Les fichiers `.env`
réels sont ignorés et ne doivent jamais être commités.

## Documentation

- [AGENTS.md](AGENTS.md) : règles permanentes à lire avant toute modification.
- [Architecture](docs/architecture/README.md) : séparation des applications et services cibles.
- [ADR](docs/adr/README.md) : procédure de documentation des décisions architecturales.
- [Développement](docs/development/README.md) : nommage, tickets, branches, commits, revue et validation.

## Conventions de développement

Respecter TypeScript strict, les identifiants techniques anglais et les messages
utilisateur français. Utiliser Conventional Commits, garder `main` stable et
travailler sur `feature/CAND-XXX-description` ou `fix/CAND-XXX-description`.
Chaque ticket nécessite une revue et un rapport de validation factuel.
Ne jamais publier de secrets ni effectuer de push sans autorisation explicite.

CAND-001 est soumis à validation ; CAND-002 ne doit pas commencer automatiquement.
