# Checklist sécurité et diagnostic avant production

CAND-010 prépare ces contrôles ; aucun déploiement n'est effectué. Les éléments
à faire en production sont des prérequis d'exploitation, pas une affirmation
qu'ils sont déjà appliqués à un serveur réel.

## Contrôles locaux exécutables

Avec Node 24 et services dédiés, vérifier DATABASE_URL/INTEGRATION_DATABASE_URL,
les migrations SQL, puis lancer lint, typecheck, format:check, test, test:e2e,
test:integration, build, prisma:validate et les deux audits npm. Les exemples
PostgreSQL/Redis de développement sont fictifs. Ne pas utiliser de base distante
ou production, reset, down -v, audit fix --force, ni désactiver les guards.

La validation CAND-010 utilise projet candidly-cand010-check, PostgreSQL 17 port
55440 et Redis 7 port 56387, base candidly_test, utilisateur fictif candidly_ci.
Les anciennes migrations restent intactes ; AuditLog est la quatrième migration.
Les tests retirent seulement leurs comptes fictifs. Leurs audits sont conservés,
avec actorUserId mis à null par FK lorsque le compte est retiré.

## Diagnostic sans secrets

- Relever X-Request-Id sur la réponse, filtrer les lignes JSON par requestId,
  consulter event/statusCode/durationMs/module, jamais demander un token ou password.
- audit.unavailable : vérifier PostgreSQL, migration AuditLog, droits d'insertion,
  espace et santé. Les mutations critiques peuvent avoir rollback ; ne pas annoncer
  une révocation ou un reset réussi sur une réponse 500.
- application.bootstrap_failed : contrôler les noms/règles des variables et les
  services locaux. La validation ne doit jamais afficher les valeurs de secrets.
  Les messages framework/driver et stacks sont volontairement absents des logs.
- 413 : contrôler la taille et HTTP_BODY_LIMIT_BYTES, pas augmenter sans besoin métier.
  415 : corps compressé refusé ; envoyer un JSON simple. 429 : attendre Retry-After,
  vérifier le modèle proxy/NAT ; ne pas ignorer Redis ou falsifier X-Forwarded-For.
- Derrière proxy : comparer le pair direct réseau et request.ip dans un diagnostic
  local contrôlé, sans ajouter d'IP brute aux logs permanents par défaut. Le Nginx
  connu doit écraser les headers et être seul à joindre l'API.

## Maintenance manuelle locale

Après build et vérification de la cible, NODE_ENV development/test et nom de base
_dev ou _test, `npm run maintenance:cleanup` produit un dry-run JSON borné.
`npm run maintenance:cleanup -- --apply` applique au plus 100 suppressions par
catégorie, limitées aux expirations + 7 j. Répéter manuellement si nécessaire.
Aucun nettoyage AuditLog, compte, préférence ou fichier local. Ne pas changer
l'horloge pour contourner la rétention ; les dates historiques sont réservées aux tests.
Pas de cron ni commande de purge production dans ce ticket.

## À confirmer avant mise en service

- HTTPS et domaines exacts, CORS sans joker, FRONTEND_URL dans CORS_ORIGIN, cookies
  Secure et SameSite adaptés au même site, CSRF inchangé et testé sur le vrai domaine.
- Proxy unique connu, TRUSTED_PROXY_IP exacte et filtrage réseau ; supprimer les
  X-Forwarded-* clients à la frontière et valider le Host. Pas de trust proxy=true.
- Clé JWT aléatoire, stockage secret, procédure de rotation/révocation et accès DB
  minimaux. Aucun secret dans image Docker, dépôt, logs, artefacts ou support.
- Transport email réel approuvé et page frontend ; le transport actuel est local
  seulement et ne délivre rien. Réexaminer timeout/idempotence d'un futur fournisseur.
- Collecte JSON, rotation des logs, accès restreint aux UUID pseudonymes/audits,
  alertes sur 5xx/audit.unavailable et taille du journal, sauvegardes/restauration testées.
- Valider les hypothèses de conservation avec les responsables concernés ; aucune
  conclusion juridique n'est prise ici. Ne pas supprimer l'historique de rejeu trop tôt.
- Lire l'[analyse des dépendances](dependency-audit-cand-010.md) et planifier la
  correction compatible de minimatch dans l'outillage. Ne pas confondre audit npm
  production à zéro avec une certification ou l'absence de tout risque.
- Refaire les tests d'isolation et de sécurité de chaque futur module selon CAND-009.

Voir [security.md](../architecture/security.md) et
[audit-logging.md](../architecture/audit-logging.md) pour les garanties exactes et limites.
