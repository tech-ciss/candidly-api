# candidly-api

Candidly — « Chaque candidature compte. » — est un SaaS de gestion des
candidatures et des relations professionnelles, un CRM personnel de carrière
initialement destiné au marché ivoirien et disponible en français.

Ce dépôt contient l'API REST NestJS. `candidly-web` est un dépôt indépendant et
communique exclusivement avec cette API. Lire [AGENTS.md](AGENTS.md) avant toute
intervention.

## État actuel — CAND-011

Le socle technique comprend TypeScript strict, la configuration validée, Prisma
avec PostgreSQL, une sonde Redis, Swagger, la validation des entrées, Helmet,
CORS et des erreurs HTTP normalisées. Le module auth permet l'inscription, la
vérification email et le renvoi, avec Argon2id et limitation Redis. CAND-007
ajoute login, JWT court, refresh par cookie avec rotation, sessions révocables
et `/auth/me`. CAND-008 ajoute profil, préférences et récupération de compte.
Le transport email reste strictement local. CAND-011 ajoute le répertoire privé
d’entreprises, sa recherche paginée, l’archivage et les audits transactionnels.

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

Adapter `.env` aux services locaux. Remplacer le marqueur `JWT_SIGNING_KEY` par
une clé base64 cryptographiquement aléatoire de 32 octets minimum, uniquement
dans `.env`. Exemple de génération à exécuter dans un terminal privé :
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Ne pas partager la clé ni la commiter. La configuration refuse le marqueur exemple.

Garder `DATABASE_URL` cohérent avec
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` et `POSTGRES_PORT`.
Les exemples sont réservés au développement ; ne jamais commiter de secret.

```bash
docker compose config --quiet
docker compose up -d --wait
npm run prisma:validate
npm run prisma:generate
# Après vérification de la cible locale et du SQL versionné :
npm run prisma:migrate:deploy
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

La migration `20261103000100_user_email_verification` crée `User` et
`EmailVerificationToken`, leurs contraintes et index. Les emails sont uniques
et normalisés ; seuls les hashes Argon2id et les empreintes SHA-256 des tokens
sont conservés. Voir [les migrations](prisma/migrations/README.md).

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

## Inscription et vérification

| Route POST `/api/v1/auth/…` | Succès | Fonction                                                                           |
| --------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `register`                  | 202    | Email, password (12–128 caractères), firstName, lastName (1–100) ; demande durable |
| `verify-email`              | 200    | `{ "token": "…" }`, token à usage unique, validité initiale 24 h                   |
| `resend-verification`       | 202    | `{ "email": "awa@example.com" }`, réponse générique et cooldown de 60 s            |

En développement, lire les messages JSON dans `.local-emails/` : ils contiennent
un lien privé vers `/verify-email#token=…`. Aucun email n'est réellement délivré.
Le frontend de vérification sera créé dans un ticket ultérieur ; envoyer le
token à l'endpoint POST via Swagger pour tester le parcours dès maintenant.
Ne pas partager ces fichiers ni placer ce dossier dans un serveur web.
Voir [le cycle et ses limites](docs/architecture/authentication.md) et
[le guide local](docs/development/README.md#inscription-et-email--cand-006).

## Connexion et sessions — CAND-007

| Endpoint                    | Succès | Fonction                                                                             |
| --------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `POST /api/v1/auth/login`   | 200    | Email normalisé + password, email vérifié requis ; access token et identité publique |
| `POST /api/v1/auth/refresh` | 200    | Cookie refresh tournant, nouvel access token                                         |
| `POST /api/v1/auth/logout`  | 204    | Révocation de la session et effacement du cookie, idempotent                         |
| `GET /api/v1/auth/me`       | 200    | Bearer JWT et session active ; uniquement six champs d'identité publique             |

Login, refresh et logout exigent `Origin: http://localhost:3000` (ou FRONTEND_URL
configurée) et `X-Candidly-CSRF: 1`. Les clients navigateur utilisent
`credentials: include`. Cookie host-only HttpOnly, SameSite=Strict, Secure en
production, Path=/api/v1/auth. Le refresh n'apparaît jamais dans le JSON.
Le JWT expire initialement après 15 min et la session après 30 jours absolus.
Une réutilisation révoque toute la session, y compris après une course de refresh.
La révocation est vérifiée en base à chaque requête protégée.

Voir [l'architecture des sessions](docs/architecture/sessions.md) et
[l'ADR cookies/CSRF](docs/adr/0002-session-security.md). Le frontend n'est pas
modifié par ce ticket. CAND-007 a fourni le socle réutilisé par CAND-008.

## Profil, préférences et récupération — CAND-008

| Endpoint                             | Fonction                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `GET /api/v1/users/me`               | Profil public de l'utilisateur authentifié                                             |
| `PATCH /api/v1/users/me`             | firstName/lastName uniquement, au moins un champ                                       |
| `GET /api/v1/users/me/preferences`   | Préférences persistantes, fr et Africa/Abidjan par défaut                              |
| `PATCH /api/v1/users/me/preferences` | locale fr et fuseau IANA pris en charge par Node, ou UTC                               |
| `POST /api/v1/auth/change-password`  | currentPassword/newPassword ; JWT et contrôles CSRF, révocation de toutes les sessions |
| `POST /api/v1/auth/forgot-password`  | email normalisé ; 202 générique et demande durable avec cooldown                       |
| `POST /api/v1/auth/reset-password`   | token/newPassword ; usage unique, révocation de toutes les sessions                    |

Le changement et le reset imposent une nouvelle connexion. Les mots de passe
restent entre 12 et 128 caractères. Le reset n'authentifie pas et ne confirme
pas implicitement l'email. Un compte non vérifié peut récupérer son mot de passe,
mais doit encore vérifier son email avant de se connecter.

En local, le message privé pointe vers la future page `/reset-password#token=…`.
Aucun email n'est réellement délivré. Le token expire initialement après 30 min,
le cooldown est de 60 s. Consulter [l'architecture de récupération](docs/architecture/account-recovery.md).

## Autorisations — CAND-009

Les routes privées réutilisent JwtAuthGuard. CurrentActor transmet un contexte
minimal userId/sessionId aux services et repositories Users ; CurrentUser conserve
les réponses d'identité publiques. Les requêtes et mutations sont filtrées par
propriétaire, avec helpers réutilisables et 404 identique pour une ressource privée
absente ou étrangère. Aucun nouveau modèle ou endpoint CRM.

Voir [la stratégie et les conventions obligatoires](docs/architecture/authorization.md)
pour les lectures, recherches, listes, lots, relations et futurs modules.

## Sécurité et audit — CAND-010

Logs JSON à champs autorisés, X-Request-Id généré côté serveur, limite JSON/form
16 Kio par défaut et confiance proxy désactivée par défaut. AuditLog conserve les
événements sensibles ; les audits critiques sont atomiques avec leurs mutations.
Aucun token, corps sensible, email brut ou chaîne de connexion n'est journalisé.

Après build, `npm run maintenance:cleanup` est un dry-run local ; `-- --apply`
reste explicite et borné, sur expirations + 7 jours, sans supprimer les audits.
Voir [la sécurité HTTP](docs/architecture/security.md),
[la politique d'audit](docs/architecture/audit-logging.md) et
[la checklist avant production](docs/development/security-checklist.md).

Audit npm : 12 alertes modérées dans l'outillage de développement, aucune dans
les dépendances de production à la date du contrôle. Le correctif minimatch
majeur reste à planifier ; voir l'analyse détaillée. Aucun déploiement effectué.
CAND-010 est soumis à validation ; ne pas commencer le ticket suivant.

## Entreprises — CAND-011

`/api/v1/companies` : création, liste paginée/recherche/filtres, consultation,
modification, archivage, restauration et suppression. JWT et session active requis.
Unicité du nom normalisé par propriétaire, archives comprises ; doublon 409 et
ressource privée étrangère/inexistante 404. Audit des cinq mutations dans la même
transaction ; aucun champ privé de l’entreprise dans ses métadonnées.
Voir [le contrat complet](docs/architecture/companies.md) et
[la validation](docs/development/cand-011-validation.md).
