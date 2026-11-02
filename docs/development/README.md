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
