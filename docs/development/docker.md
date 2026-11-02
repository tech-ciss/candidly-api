# Infrastructure locale avec Docker

## Prérequis

Installer Docker Engine et le plugin Docker Compose. Vérifier `docker version`,
`docker compose version` et `docker info`. Le moteur doit être démarré et accessible
au compte courant. Aucune modification de la configuration globale Docker n'est
nécessaire dans ce ticket. Exécuter les commandes suivantes depuis `candidly-api`.

## Configuration

Copier l'exemple uniquement si `.env` n'existe pas encore :

```bash
cp -n .env.example .env
docker compose config --quiet
```

Compose lit `.env` ; les variables exportées dans le shell ont priorité.
`POSTGRES_PASSWORD` doit être renseigné, sinon la validation échoue explicitement.
L'exemple `change_me_local_only` est réservé au développement local. Ne jamais
utiliser de secret de production ou commiter `.env`.

| Service | Image officielle | Adresse hôte par défaut | Volume nommé |
| --- | --- | --- | --- |
| PostgreSQL | `postgres:17` | `127.0.0.1:5432` | `postgres_data` |
| Redis | `redis:7` | `127.0.0.1:6379` | `redis_data` |

La base par défaut est `candidly_dev`, avec l'utilisateur `candidly`. Les volumes
sont préfixés par le nom du projet Compose `candidly-local`. Le réseau est créé
automatiquement, sans réseau externe ni nom de conteneur imposé.

Si des ports sont occupés, modifier `.env`, par exemple :

```dotenv
POSTGRES_PORT=55432
DATABASE_URL=postgresql://candidly:change_me_local_only@localhost:55432/candidly_dev
REDIS_HOST=localhost
REDIS_PORT=56379
```

Les ports internes restent 5432 et 6379. Maintenir `DATABASE_URL` cohérent avec
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` et `POSTGRES_PORT`.
Encoder les caractères réservés du mot de passe dans l'URL (encodage pour cent),
sans modifier sa valeur brute dans `POSTGRES_PASSWORD`.
`DATABASE_URL` prépare la future API et n'est pas utilisée pour initialiser le
conteneur. Les variables `POSTGRES_*` d'initialisation ne changent pas les comptes
ou bases d'un volume déjà initialisé. Changer un mot de passe existant nécessite
une intervention SQL explicite ; ne pas supprimer les volumes pour contourner
un problème d'identifiants.

## Cycle de vie

```bash
# Démarrage en arrière-plan
docker compose up -d
# État et santé des services
docker compose ps
# Logs en continu (Ctrl+C quitte uniquement la consultation)
docker compose logs -f
# Arrêt et suppression des conteneurs et du réseau, données conservées
docker compose down
```

`docker compose up -d --wait --wait-timeout 120` permet aussi d'attendre les
healthchecks. La politique `unless-stopped` relance les services après un arrêt
inattendu du moteur, sauf s'ils ont été arrêtés explicitement.

**Attention : `docker compose down -v` supprime les volumes et peut entraîner
la perte définitive des données. Ne jamais l'exécuter automatiquement.**

## Connexions et santé

PostgreSQL utilise `pg_isready` ; Redis utilise `redis-cli ping` pour leurs
healthchecks. Pour vérifier une véritable requête PostgreSQL via TCP avec le
mot de passe configuré, puis Redis :

```bash
docker compose exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SELECT current_database(), current_user;"'
docker compose exec -T redis redis-cli ping
```

La première commande doit afficher la base et l'utilisateur configurés ; la
seconde doit répondre `PONG`.

Vérifier les publications :

```bash
docker compose port postgres 5432
docker compose port redis 6379
```

Les réponses doivent commencer par `127.0.0.1:`. Les services ne sont pas
publiés sur les interfaces réseau distantes. Redis est réservé à cet environnement
local sans authentification ; ne pas exposer son port à distance.

## Vérification manuelle de la persistance

Utiliser un projet isolé et des ports libres afin de ne pas toucher aux bases
existantes. Exemple avec uniquement les valeurs fictives du fichier exemple :

```bash
POSTGRES_PORT=55432 REDIS_PORT=56379 docker compose --env-file .env.example -p candidly-cand002-check up -d --wait
```

Pour les commandes de ce test, utiliser systématiquement le même préfixe :
`POSTGRES_PORT=55432 REDIS_PORT=56379 docker compose --env-file .env.example -p candidly-cand002-check`.

1. Avec ce préfixe, exécuter les commandes suivantes pour écrire puis relire
   les données fictives après recréation des conteneurs :

   ```bash
   # Arguments à ajouter au préfixe Compose pour écrire
   exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "CREATE TABLE cand002_probe (value text); INSERT INTO cand002_probe VALUES (\$\$persisted\$\$);"'
   exec -T redis redis-cli SET cand002:probe persisted
   # Arguments à ajouter au même préfixe pour relire
   exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "TABLE cand002_probe;"'
   exec -T redis redis-cli GET cand002:probe
   ```
2. Attendre au moins deux secondes pour la synchronisation AOF Redis.
3. Exécuter `down` **sans `-v`**, puis `up -d --wait` avec le même préfixe.
4. Relire la ligne SQL et la clé Redis avec `SELECT` et `redis-cli GET`.
5. Arrêter le projet de contrôle avec `down` sans `-v`. Les volumes de contrôle
   restent présents ; leur éventuelle suppression doit être une action manuelle
   explicite après vérification.

PostgreSQL utilise `/var/lib/postgresql/data` dans son volume. Redis utilise
`/data` avec AOF activé et synchronisation chaque seconde. Cette persistance
survit à la recréation des conteneurs ; elle ne constitue pas une sauvegarde et
Redis peut perdre les toutes dernières écritures lors d'un arrêt brutal.

## Dépannage

- **Docker indisponible** : consulter `docker info`. Vérifier l'installation,
  le démarrage du moteur et le contexte Docker sélectionné. En cas de refus
  d'accès au socket, demander à l'administrateur l'accès approprié ; ne pas
  rendre le socket accessible à tous ni modifier sa configuration globalement.
- **Port déjà utilisé** : sélectionner des ports hôte libres dans `.env`, adapter
  `DATABASE_URL`, puis relancer `docker compose up -d`. Ne pas arrêter les bases
  existantes de la machine.
- **PostgreSQL non prêt** : consulter `docker compose logs postgres`, attendre
  l'initialisation et vérifier `docker compose ps`. Contrôler les identifiants
  du volume existant et exécuter la requête de connexion ci-dessus.
- **Redis non prêt** : consulter `docker compose logs redis`, puis vérifier
  `docker compose exec -T redis redis-cli ping` et l'espace disque disponible.
- **Variables manquantes** : vérifier la présence de `.env`, renseigner le mot
  de passe et exécuter `docker compose config --quiet`. `docker compose config`
  permet d'inspecter la résolution complète mais peut afficher le mot de passe :
  ne pas publier sa sortie. Vérifier aussi les variables exportées dans le shell.
- **Permissions des volumes** : consulter les logs et `docker volume inspect`
  sur le volume concerné ; vérifier le contexte Docker et les droits du stockage
  avec l'administrateur. Conserver les volumes nommés et les utilisateurs des
  images officielles. Ne pas appliquer de `chmod 777`, de suppression ou de
  changement global de permissions pour contourner une erreur.

## Références

- [Image PostgreSQL officielle](https://hub.docker.com/_/postgres)
- [Image Redis officielle](https://hub.docker.com/_/redis)
- [Référence des services Compose](https://docs.docker.com/reference/compose-file/services/)
- [Persistance Redis](https://redis.io/docs/latest/management/persistence/)
