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
qu'une URL `INTEGRATION_DATABASE_URL` explicite. Depuis CAND-006 ils couvrent aussi les modèles auth, l'envoi, la concurrence
et un parcours HTTP réel. Le nom de base doit finir par `_test`. Les fixtures
sont fictives et supprimées par leurs seuls emails uniques après les tests.

Exemple de projet Docker dédié, avec des ports libres et les valeurs fictives
de `.env.example` :

```bash
POSTGRES_DB=candidly_test POSTGRES_PORT=55433 REDIS_PORT=56380 docker compose --env-file .env.example -p candidly-cand003-check up -d --wait
export DATABASE_URL=postgresql://candidly:change_me_local_only@127.0.0.1:55433/candidly_test
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
export JWT_SIGNING_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
# Contrôler la cible locale et le SQL avant application.
npm run prisma:migrate:deploy
NODE_ENV=test PORT=3301 REDIS_HOST=127.0.0.1 REDIS_PORT=56380 CORS_ORIGIN=http://localhost:3000 npm run test:integration
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

Le schéma comprend les modèles métier ajoutés par CAND-006 et les sessions
CAND-007. Sur une base locale dédiée, `npm run prisma:migrate:deploy` applique
les migrations versionnées après vérification de la cible et du SQL. Une nouvelle
évolution utilisera `prisma:migrate:dev -- --name description` en développement.
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
npm run prisma:migrate:deploy # uniquement la base de test isolée vérifiée
npm run test:integration
npm audit --omit=dev
```

Le client Prisma est explicitement généré avant les vérifications qui l'utilisent ;
les hooks existants des scripts assurent aussi sa génération. Depuis CAND-006,
la CI applique `npm run prisma:migrate:deploy` au service PostgreSQL de test
éphémère avant les tests d'intégration. Aucun reset ni migration de production.

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

## Inscription et email — CAND-006

Dépendance ajoutée : `argon2@0.45.2` (stable, bibliothèque native avec binaires
précompilés, Node 24 vérifié). Le runner natif Node, Prisma et Redis existants
sont réutilisés. CAND-006 n'ajoutait ni fournisseur email, ni JWT, ni nouveau
framework de test ; CAND-007 ajoute les JWT décrits plus bas.

| Variable                         | Valeur par défaut                                       | Validation / usage                                                     |
| -------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `FRONTEND_URL`                   | `http://localhost:3000`                                 | origine exacte sans chemin ; HTTPS explicite obligatoire en production |
| `EMAIL_TRANSPORT`                | `local` en développement/test, `disabled` en production | local interdit en production ; aucun fournisseur réel                  |
| `EMAIL_LOCAL_DIRECTORY`          | `.local-emails`                                         | chemin non vide, privé et hors serveur web                             |
| `EMAIL_VERIFICATION_TTL_SECONDS` | 86400                                                   | entier 1 à 604800                                                      |
| `EMAIL_RESEND_COOLDOWN_SECONDS`  | 60                                                      | entier 1 à 86400                                                       |
| `EMAIL_RETRY_INTERVAL_SECONDS`   | 30                                                      | entier 1 à 3600                                                        |

Le traitement des demandes démarre au lancement puis toutes les 30 s, 20 comptes
au maximum par passage. En `NODE_ENV=test`, il est déclenché explicitement par
les tests pour rester déterministe. En cas d'échec, la demande reste en base et
sera reprise ; les logs contiennent seulement un avertissement générique.
Les fichiers JSON locaux sont en mode 0600, leur dossier en 0700, ignoré par Git.
Ils contiennent des tokens bruts uniquement pour la consultation locale : ne
pas les commiter, copier dans les logs ou exposer par HTTP. Supprimer les fichiers
de test après usage. Un succès API signifie « demande acceptée », jamais « délivré ».

Pour essayer : démarrer les services, vérifier la base cible, appliquer la
migration puis démarrer en development. Appeler les trois endpoints dans
Swagger. Après inscription, attendre le passage du traitement, ouvrir le JSON
local, extraire `token` du fragment du lien et l'envoyer à `verify-email`.
La page frontend du lien n'est pas implémentée dans ce ticket.

### Validation sur une base isolée

Exemple uniquement local, avec identifiants fictifs. Ne pas reprendre une base
contenant des données à conserver :

```bash
POSTGRES_DB=candidly_test POSTGRES_USER=candidly_ci POSTGRES_PASSWORD=ci_only_password POSTGRES_PORT=55436 REDIS_PORT=56383 docker compose --env-file .env.example -p candidly-cand006-check up -d --wait
export NODE_ENV=test
export JWT_SIGNING_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
export PORT=3001
export DATABASE_URL=postgresql://candidly_ci:ci_only_password@127.0.0.1:55436/candidly_test
export INTEGRATION_DATABASE_URL="$DATABASE_URL"
export REDIS_HOST=127.0.0.1
export REDIS_PORT=56383
export CORS_ORIGIN=http://localhost:3000
# Vérifier la cible locale, l'état et le contenu SQL avant cette commande :
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run lint
npm run typecheck
npm run format:check
npm run test
npm run test:e2e
npm run test:integration
npm run build
POSTGRES_DB=candidly_test POSTGRES_USER=candidly_ci POSTGRES_PASSWORD=ci_only_password POSTGRES_PORT=55436 REDIS_PORT=56383 docker compose --env-file .env.example -p candidly-cand006-check down
```

L'arrêt conserve les volumes. Aucun `down -v`, reset ou migration de production.
Les tests unitaires couvrent les DTO, Argon2id, tokens et transport local. Les
e2e isolent les dépendances pour tester les contrats HTTP ; l'intégration utilise
PostgreSQL et Redis réels, y compris un parcours HTTP du module principal,
les courses et la reprise après échec. Les clés Redis des tests sont isolées
par préfixes aléatoires et expirent après 15 minutes ; aucun FLUSHDB.
Voir [les choix et limites](../architecture/authentication.md).

## Connexion et sessions — CAND-007

Dépendance ajoutée : `jose@6.2.15`, stable ESM, pour la signature et la validation
JWT sans implémentation cryptographique maison. Argon2, Prisma et Redis existants
sont réutilisés. Pas de cookie-parser ni Passport : le cookie unique est lu
strictement et le guard réutilisable est injectable dans NestJS.

| Variable                    | Défaut / validation                                                               |
| --------------------------- | --------------------------------------------------------------------------------- |
| `JWT_SIGNING_KEY`           | obligatoire, base64 canonique, au moins 32 octets décodés ; aucune clé par défaut |
| `JWT_ISSUER`                | `candidly-api`, chaîne explicite 1–200 caractères                                 |
| `JWT_AUDIENCE`              | `candidly-web`, chaîne explicite 1–200 caractères                                 |
| `ACCESS_TOKEN_TTL_SECONDS`  | 900, entier 1–3600 et inférieur ou égal à la durée refresh                        |
| `REFRESH_TOKEN_TTL_SECONDS` | 2592000, entier 1–7776000, échéance absolue de session                            |

Remplacer le marqueur `.env.example` dans son `.env` privé lors de la première
installation. Une clé peut être générée avec `crypto.randomBytes(32)` en base64 ;
ne pas ajouter de clé utilisable à l'exemple ou aux scripts. Pour les tests,
utiliser une clé éphémère non affichée :

```bash
export JWT_SIGNING_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))")"
```

La CI génère sa clé éphémère dans GITHUB_ENV et ne l'affiche pas. Les fixtures
unitaires/e2e génèrent leurs propres clés en mémoire. L'intégration exige une
clé explicite, Node 24, PostgreSQL local avec base `_test` et Redis dédiés.
Le projet de validation CAND-007 utilise les ports hôte 55437/56384 et le nom
`candidly-cand007-check` avec la même procédure Compose locale documentée plus
haut ; appliquer les deux migrations après contrôle de la cible.

Les quatre endpoints et leurs DTO sont dans Swagger. Login exige email/password.
Login, refresh et logout exigent Origin=FRONTEND_URL et X-Candidly-CSRF=1, même
pour curl/Supertest. L'interface Swagger de l'API n'est pas le frontend autorisé
si elle est servie depuis une autre origine ; utiliser un client HTTP qui fournit
ces en-têtes, sans élargir CSRF pour les essais. Aucune exception de développement.

Le futur frontend devra conserver l'access token en mémoire, envoyer ses requêtes
avec credentials, et sérialiser les refresh. Ne pas mélanger localhost et 127.0.0.1
pour les cookies navigateur. Pas de localStorage, sessionStorage ou service worker
pour les tokens. Aucun frontend n'est développé ici.

Débit par IP / 15 min : login 5, refresh 30, logout 30 (inscription et renvoi 5,
vérification 30 inchangés). Les requêtes invalides et les échecs CSRF consomment
une tentative. Redis indisponible refuse les POST limités avec 503. Les mocks
e2e isolent le transport ; l'intégration teste aussi les seuils Redis réels,
la rotation atomique, les refresh concurrents, logout concurrent, l'isolation
session/utilisateur, le rejeu et le parcours HTTP avec PostgreSQL réel.

Voir [les limites et politiques](../architecture/sessions.md). Aucun push,
déploiement, modification Docker ou migration de production.

## Profil, préférences et récupération — CAND-008

Aucune dépendance ajoutée. Réutilisation du guard JWT, Argon2id, Prisma, Redis,
EmailTransport et de la cryptographie de token opaque existants. Les durées
supplémentaires sont validées au démarrage :

| Variable                          | Défaut | Limites        |
| --------------------------------- | ------ | -------------- |
| `PASSWORD_RESET_TTL_SECONDS`      | 1800   | entier 1–86400 |
| `PASSWORD_RESET_COOLDOWN_SECONDS` | 60     | entier 1–86400 |

Le traitement de récupération utilise EMAIL_RETRY_INTERVAL_SECONDS et les mêmes
conditions de démarrage que la vérification (automatique en développement,
transport désactivé ignoré, déclenchement explicite dans les tests). Le cycle
commun est DurableEmailDelivery ; les marqueurs et tables de tokens restent distincts.
Une panne conserve la demande en base et les anciens liens valides. Un nouvel
envoi réussi consomme les anciens tokens de récupération actifs.

Les messages locaux restent des JSON privés 0600 dans un dossier 0700 ignoré
par Git. Le lien `/reset-password#token=…` est destiné à une future page frontend.
Pour essayer dès maintenant, extraire son token et appeler le POST reset-password
avec un nouveau mot de passe via un client HTTP. Ne pas publier ces fichiers ni
copier les liens dans les logs. Aucun email réel n'est délivré et aucun fournisseur
n'est ajouté. Les limites de transaction/fichier et les possibilités de reprise
des tickets précédents restent applicables.

Profil et préférences exigent Authorization: Bearer. Les PATCH utilisent le
même préfixe /api/v1 et CORS autorise maintenant PATCH pour les origines explicites.
Le changement de mot de passe exige aussi Origin=FRONTEND_URL et X-Candidly-CSRF=1,
car il efface le cookie. Forgot/reset sont publics, n'utilisent pas le cookie
comme authentifiant, et sont limités comme change à 5 tentatives/IP/15 minutes.
Un cooldown de compte de 60 s complète la limite de forgot. Les cookies/headers
ne contiennent jamais de nouveau mot de passe ; les DTO et logs ne les exposent pas.

Locale initialement acceptée : fr. Fuseaux acceptés : valeurs IANA retournées par
Intl.supportedValuesOf('timeZone') de Node 24, plus UTC. Les offsets numériques,
valeurs nulles et identifiants inconnus sont refusés. Africa/Abidjan est seulement
un défaut, les fuseaux européens, américains, asiatiques et océaniens sont testés.
Email et userId ne sont modifiables par aucune de ces routes.

Pour valider sur services isolés, reprendre la procédure CAND-007 avec projet
`candidly-cand008-check` et ports 55438/56385, base candidly_test et identifiants
fictifs. Exporter NODE_ENV=test, DATABASE_URL, INTEGRATION_DATABASE_URL identique,
REDIS_HOST/PORT, CORS_ORIGIN et une JWT_SIGNING_KEY aléatoire non affichée.
Après vérification de la cible et du SQL, exécuter prisma:validate,
prisma:migrate:deploy, prisma:generate puis lint, typecheck, format:check,
test, test:e2e, test:integration et build. L'arrêt Compose conserve les volumes.
Voir [la sécurité et les limites](../architecture/account-recovery.md).

## Autorisations — CAND-009

[Les règles d'autorisation](../architecture/authorization.md) sont obligatoires
pour les futurs modules privés. JwtAuthGuard est inchangé dans ses vérifications
JWT/session ; il fournit CurrentActor (userId/sessionId marqués et immuables),
et garde CurrentUser pour les réponses publiques existantes. Ne jamais construire
un acteur à partir d'un DTO : en production, la fabrique est réservée au guard.

Les services et repositories Users prennent un AuthenticatedActor, pas un userId
libre. Les tests directs simulent un contexte vérifié explicitement ; aucun objet
JSON client ne possède le marquage serveur. Utiliser ownerWhere/ownedIdWhere pour
les modèles ayant userId, selfWhere pour User. Conserver les DTO stricts, les
mutations atomiques et le même 404 pour absence/propriété étrangère. Le filtre
HTTP commun, CSRF, CORS, rate limiting et les endpoints publics sont conservés.

Les tests de fondation couvrent la lecture, mutation, suppression, pagination,
recherche, lots et relations avec un repository fictif en mémoire, sans modèle
Prisma artificiel. L'intégration utilise les modèles User/UserPreference/Session
existants et teste le rollback d'un lot mixte et l'isolation HTTP réelle de A/B.
Aucune route permettant de sélectionner le profil d'un tiers n'est créée.

Pour reproduire la validation locale, utiliser la procédure précédente avec
projet `candidly-cand009-check`, ports PostgreSQL 55439 / Redis 56386, base locale
`candidly_test`, identifiants fictifs candidly_ci/ci_only_password. Vérifier la
cible puis appliquer uniquement les trois migrations existantes pour préparer la
base de test vide. Exporter les variables test, les deux URL identiques et une
JWT_SIGNING_KEY éphémère non affichée. Exécuter lint, typecheck, format:check,
test, test:e2e, test:integration et build. Les tests retirent uniquement leurs
fixtures example.com ; l'arrêt Compose conserve les volumes.

Aucune dépendance, modification du schéma/migrations, infrastructure, rôle admin,
frontend ou déploiement. Les exemples ne dispensent pas d'auditer chaque nouveau
repository et de tester ses modèles réels à deux utilisateurs.
