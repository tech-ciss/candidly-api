# Conventions de développement

Lire [AGENTS.md](../../AGENTS.md) avant toute modification : ce fichier conserve
les règles permanentes du projet.

## Nommage

Le code est écrit en TypeScript strict avec des identifiants anglais :
`camelCase` pour variables et fonctions, `PascalCase` pour classes, interfaces
et composants React, `UPPER_SNAKE_CASE` pour constantes globales et valeurs
d'énumération. Utiliser `kebab-case` pour les fichiers lorsque les conventions
du framework le permettent. Les messages utilisateur sont initialement en français.
Les fichiers utilisent UTF-8, LF et deux espaces d'indentation.

## Tickets et branches

Traiter un ticket à la fois : lire son périmètre, examiner l'existant, présenter
un bref plan, implémenter uniquement les changements nécessaires, vérifier puis
soumettre à validation. Préserver les modifications existantes. Ne pas commencer
le ticket suivant avant validation.

`main` doit rester stable. Créer les branches de travail depuis `main` :

- `feature/CAND-XXX-description` pour les évolutions.
- `fix/CAND-XXX-description` pour les corrections.

Les deux dépôts ont des historiques indépendants. Un ticket transversal doit
identifier les changements et revues nécessaires dans chacun.

## Commits

Utiliser Conventional Commits, avec des messages explicites :

```text
feat: add application management
fix: prevent unauthorized document access
docs: initialize project documentation
chore: configure repository
test: add ownership validation tests
```

## Revue et validation

Présenter une demande de revue liée au ticket : problème traité, changements,
commandes réellement exécutées et résultats, impacts de sécurité, décisions et
limitations. Le reviewer vérifie le périmètre, les conventions, la documentation,
l'absence de secrets et, lorsque pertinent, les autorisations et l'isolation
des données. Corriger les observations avant intégration à `main`.

Pour CAND-001, contrôler les fichiers attendus, les règles d'exclusion, la cohérence
des configurations, puis exécuter `git status` et `git diff --check` dans chaque
dépôt. Les nouveaux fichiers non suivis doivent aussi être inspectés :
`git diff --check` seul ne les vérifie pas.

Les scripts npm de lint, typecheck, test et build existent depuis CAND-003.
Exécuter les validations décrites ci-dessous et rapporter les résultats réels.
Les tests d'autorisation et d'isolation seront ajoutés avec les fonctionnalités
qui introduisent des ressources privées.

## Configuration et sécurité

Node.js 24 LTS est la ligne commune déclarée dans `.nvmrc`. Avec nvm disponible,
`nvm install` puis `nvm use` sélectionnent la dernière version corrective 24.x.
Vérifier les versions exactes des frameworks et leur compatibilité lors de leur
installation dans les tickets suivants.

`.env.example` contient uniquement des exemples locaux. Les fichiers `.env` et
leurs variantes sont ignorés ; ne jamais y substituer des secrets dans le fichier
exemple. Les variables publiques du frontend sont visibles dans le navigateur.
Les variables d'authentification, stockage et intégrations seront définies dans
leurs tickets respectifs.

Aucun distant, protection GitHub ou pipeline n'est configuré par CAND-001.
Leur mise en place sera traitée séparément ; tout push exige une autorisation
explicite. Ne pas déployer ni exécuter de migration en production sans autorisation.

## Infrastructure locale — CAND-002

Le [guide Docker](docker.md) décrit PostgreSQL 17, Redis 7, la configuration
locale, les contrôles de santé et de persistance ainsi que le dépannage.
Ces services sont préparés uniquement dans `candidly-api`. CAND-003 ajoute NestJS
et Prisma ; le frontend reste inchangé.

## Backend — CAND-003

Avec Node.js 24 actif, `npm ci` installe les versions verrouillées. Copier
`.env.example` vers `.env` sans écraser un fichier existant, adapter les valeurs,
puis lancer `docker compose up -d --wait`. Utiliser `npm run start:dev` pour la
compilation surveillée, ou `npm run build` puis `npm start` pour le JavaScript
compilé. Ctrl+C déclenche l'arrêt et la fermeture des connexions.

Variables obligatoires au démarrage :

| Variable             | Validation                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `NODE_ENV`           | `development`, `test` ou `production`                            |
| `PORT`, `REDIS_PORT` | entiers entre 1 et 65535                                         |
| `DATABASE_URL`       | URL PostgreSQL avec utilisateur, hôte et base                    |
| `REDIS_HOST`         | hôte ou IP, sans schéma d'URL                                    |
| `CORS_ORIGIN`        | une ou plusieurs origines HTTP(S) exactes, séparées par virgules |

Les variables Docker `POSTGRES_*` restent compatibles avec CAND-002. Elles ne
modifient pas les comptes d'un volume déjà initialisé. Synchroniser le mot de
passe et le port hôte avec `DATABASE_URL`. La validation ne journalise jamais
les valeurs reçues. L'API écoute uniquement sur `127.0.0.1`.

### Commandes de qualité

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run format:check
```

`npm run format` applique Prettier ; `AGENTS.md` et les sorties générées sont
exclus. Les tests TypeScript sont compilés dans `.test-dist` puis exécutés par
le runner natif Node.js 24. Les tests HTTP créent le module principal avec des
dépendances simulées ; le contrôleur de sonde réservé aux tests n'est jamais
monté dans l'API réelle. Ils couvrent aussi Swagger désactivé en production,
le format d'erreur, les entrées inconnues, CORS et Helmet.

### Tests d'intégration

Les tests réels refusent une base distante et exigent `NODE_ENV=test` ainsi
qu'une URL `INTEGRATION_DATABASE_URL` explicite. Ils exécutent uniquement des
requêtes techniques, sans modèle ni données métier.

Exemple de projet Docker dédié, avec des ports libres et les valeurs fictives
de `.env.example` :

```bash
POSTGRES_DB=candidly_test POSTGRES_PORT=55433 REDIS_PORT=56380 docker compose --env-file .env.example -p candidly-cand003-check up -d --wait
NODE_ENV=test PORT=3301 INTEGRATION_DATABASE_URL=postgresql://candidly:change_me_local_only@127.0.0.1:55433/candidly_test REDIS_HOST=127.0.0.1 REDIS_PORT=56380 CORS_ORIGIN=http://localhost:3000 npm run test:integration
docker compose --env-file .env.example -p candidly-cand003-check down
```

Les tests vérifient les connexions Prisma et Redis, la fermeture propre et un
refus de connexion vers un port local indisponible. L'arrêt ne supprime pas les
volumes. Ne jamais utiliser `down -v` automatiquement.

### Prisma

`npm run prisma:validate` valide le schéma ; `npm run prisma:generate` produit
le client ESM ignoré par Git. L'URL est gérée dans `prisma.config.ts`, chargé
avec dotenv pour la CLI. Les variables exportées ont priorité sur `.env`.
La génération ne nécessite pas de connexion PostgreSQL.

Le schéma initial est vide : aucune évolution technique utile ne justifie une
migration. Ne pas ajouter de modèle fictif ou de migration vide. Au premier
changement réel, utiliser une base locale dédiée et exécuter
`npm run prisma:migrate:dev -- --name description`, puis générer le client.
Versionner les migrations SQL. `prisma:migrate:deploy` applique les migrations
existantes ; aucune migration de production sans autorisation explicite.

### Contrôles manuels

```bash
curl --fail http://localhost:3001/api/v1/health
curl --fail http://localhost:3001/docs-json
```

Le healthcheck renvoie 200 si les deux dépendances sont disponibles, sinon 503
avec les seuls états publics. Une base indisponible dès le démarrage provoque
un échec explicite ; Redis indisponible n'empêche pas le démarrage et sera signalé
par la sonde. Swagger est absent lorsque `NODE_ENV=production`.
Voir [l'architecture](../architecture/README.md) pour la convention d'erreur.

## Qualité et GitHub Actions — CAND-005

Chaque dépôt possède son workflow indépendant `.github/workflows/ci.yml`.
Il se déclenche sur les pull requests ciblant `main` et les push vers `main`,
avec un runner GitHub hébergé `ubuntu-24.04`, Node.js 24 et cache npm indexé sur
`package-lock.json`. Le cache contient les téléchargements npm, pas une copie
persistante de `node_modules` : `npm ci` reste exécuté à chaque run.
Les anciens runs d'une même branche sont annulés lorsqu'un nouveau run arrive.
Un job est limité à 25 minutes.

Les scripts communs conservent la même signification dans les deux dépôts :

| Script         | Contrôle                             |
| -------------- | ------------------------------------ |
| `lint`         | ESLint, sans correction automatique  |
| `typecheck`    | TypeScript strict, sans émission     |
| `format:check` | Prettier, sans modifier les fichiers |
| `test`         | tests unitaires/techniques du dépôt  |
| `build`        | compilation de production            |

Les frameworks de test existants sont conservés : Vitest pour le frontend et
le runner Node.js pour le backend. Les configurations de lint, formatage et
TypeScript ne sont pas remplacées. `npm ci` doit réussir avec le manifeste et
le lockfile versionnés ; ne pas remplacer cette étape par `npm install` en CI.

### Actions et permissions

- [actions/checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) : `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- [actions/setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) : `949feb2413d6458794dcd2491c4babbbce0c15c1`.

Ces releases stables officielles ont été vérifiées et sont épinglées par SHA de
commit immuable. Les commentaires des workflows indiquent la version lisible.
Lors d'une mise à jour, vérifier la release officielle, son runtime et son SHA ;
ne pas remplacer une référence immuable par une branche mobile.
Les actions utilisent Node 24 ; un éventuel runner auto-hébergé devra être
compatible avec leurs prérequis avant toute adaptation du workflow.

Permissions limitées à `contents: read`. Le checkout ne persiste pas ses
identifiants dans la configuration Git. Aucun PAT ni secret GitHub ajouté,
aucun événement `pull_request_target`, aucun accès à une infrastructure de production
et aucune publication ou étape de déploiement.

### Audit des dépendances

Après les contrôles bloquants, `npm audit --omit=dev` examine les dépendances de
production. **Seule cette étape est non bloquante**, avec `continue-on-error`.
En cas d'échec, un avertissement et un message dans le résumé GitHub demandent
une revue des résultats. Aucun lint, test, typecheck, installation ou build
n'est rendu facultatif ; aucun `|| true` n'est utilisé.

Une sortie non nulle peut indiquer des vulnérabilités ou une indisponibilité du
registre : examiner le détail, ne pas conclure automatiquement à une faille
exploitable. L'audit dépend des avis publiés, n'examine pas les dépendances de
développement avec cette option et ne remplace ni revue de code ni tests de
sécurité. Créer un ticket de remédiation selon le risque réel et vérifier les
mises à jour compatibles. Ne jamais lancer `npm audit fix --force` ni effectuer
une mise à jour majeure automatique.

### Pull requests et échecs CI

Créer une branche `feature/CAND-XXX-description` ou `fix/CAND-XXX-description`.
La pull request décrit le problème, le périmètre, les fichiers importants, les
commandes réellement exécutées et leurs résultats, les impacts de sécurité et
les limites. Lier le ticket et demander une revue avant intégration à `main`.
Pour un changement transversal, préparer une revue dans chacun des deux dépôts.
Aucune protection GitHub n'est configurée automatiquement par ce ticket.

En cas d'échec :

1. Identifier la première étape en échec et lire son journal.
2. Reproduire localement avec Node 24 et `npm ci`, puis la même commande et les
   variables de test documentées. Ne pas utiliser de base partagée/production.
3. Corriger la cause : aligner le lockfile si nécessaire sans mise à jour massive,
   traiter le lint/typecheck, appliquer `npm run format` si nécessaire, puis
   corriger les tests ou le build sans masquer leurs erreurs.
4. Pour une intégration en échec, vérifier les healthchecks et la cohérence des
   identifiants de la base de test, des ports et de l'environnement.
5. Rejouer les contrôles concernés, documenter le résultat et soumettre la correction
   à revue. Tout push reste soumis à une autorisation explicite.

Les validations locales et la validation YAML ne prouvent pas qu'un run GitHub
réussit. **Les workflows devront être réellement exécutés sur GitHub après
publication autorisée des dépôts.** Aucun run GitHub n'est déclenché par CAND-005.

### Ordre backend et services de test

```bash
npm ci
npm run prisma:generate
npm run prisma:validate
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run build
npm run test:e2e
npm run test:integration
npm audit --omit=dev
```

Le client Prisma est explicitement généré avant les vérifications qui l'utilisent ;
les hooks existants des scripts assurent aussi sa génération. Le schéma actuel
n'a aucun modèle métier : aucune migration vide, reset ou table artificielle
n'est ajoutée. Les futures migrations utiles devront être appliquées uniquement
au service de test isolé, dans leur ticket correspondant.

Le job hébergé utilise des services PostgreSQL 17 et Redis 7 éphémères, avec
healthchecks. GitHub attend leur état sain avant les étapes. Les ports hôte
sont publiés sur `127.0.0.1` ; aucune base externe n'est appelée. La base est
`candidly_test`, l'utilisateur `candidly_ci`, le mot de passe fictif
`ci_only_password`, uniquement dans ce runner jetable. Aucun volume persistant
ni accès au développement local n'est configuré dans le workflow.

`DATABASE_URL` et `INTEGRATION_DATABASE_URL` pointent toutes deux vers
`postgresql://candidly_ci:ci_only_password@127.0.0.1:5432/candidly_test`.
`NODE_ENV=test`, `PORT=3001`, `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379` et
`CORS_ORIGIN=http://localhost:3000` complètent l'environnement CI.
Les e2e utilisent des mocks ; seuls les tests d'intégration vérifient les services
réels et refusent une URL de base distante.

Pour reproduire localement sans toucher à la base de développement, choisir des
ports libres et un nouveau projet Compose dédié :

```bash
POSTGRES_DB=candidly_test POSTGRES_USER=candidly_ci POSTGRES_PASSWORD=ci_only_password POSTGRES_PORT=55435 REDIS_PORT=56382 docker compose --env-file .env.example -p candidly-cand005-check up -d --wait
NODE_ENV=test PORT=3001 DATABASE_URL=postgresql://candidly_ci:ci_only_password@127.0.0.1:55435/candidly_test INTEGRATION_DATABASE_URL=postgresql://candidly_ci:ci_only_password@127.0.0.1:55435/candidly_test REDIS_HOST=127.0.0.1 REDIS_PORT=56382 CORS_ORIGIN=http://localhost:3000 npm run test:integration
docker compose --env-file .env.example -p candidly-cand005-check down
```

Les volumes de reproduction sont conservés après `down`. Ne jamais exécuter
`down -v` automatiquement. Les services GitHub, eux, sont détruits avec le job.

### Résultat de l'audit local — 3 novembre 2026

`npm audit --omit=dev` s'est terminé avec le code 0 : aucune vulnérabilité connue
remontée pour les dépendances de production verrouillées à cette date. Ce résultat
est un instantané du registre, ne couvre pas les dépendances de développement et
ne constitue pas une garantie d'absence de faille. Aucune correction automatique
ni mise à jour majeure n'a été appliquée.

La chaîne locale CAND-005 réussit sous Node.js 24.22.2 : `npm ci`, génération et
validation Prisma, lint, typecheck, formatage, 24 tests unitaires, build,
8 tests e2e et 4 tests d'intégration réels sur le projet Docker dédié.
La syntaxe et les expressions des workflows sont validées avec actionlint 1.7.12.
Il s'agit de validations locales ; aucun run GitHub Actions n'a été exécuté.
