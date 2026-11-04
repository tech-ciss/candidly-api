# Sécurité HTTP et exploitation — CAND-010

## Diagnostic initial

Déjà conformes : JWT HS256 strict, sessions actives en base, ownership et contexte
serveur, DTO avec rejet des champs inconnus, Argon2id, tokens hashés, cookies
HttpOnly/SameSite Strict/Secure en production, CSRF par origine exacte et header,
CORS explicite, Helmet, Swagger hors production et rate limiting Redis atomique
sans repli permissif. Les erreurs publiques masquaient déjà les messages bruts.

À compléter : logs textuels sans corrélation, absence d'audit persistant, taille
JSON dépendant du défaut du framework, politique proxy implicite et absence de
politique de nettoyage. CAND-010 complète ces points sans reconstruire Auth.

## Configuration réellement appliquée

- HTTP_BODY_LIMIT_BYTES : 16384 octets par défaut, entier 1–1048576. JSON strict
  et urlencoded bornés ; formulaires limités à 20 paramètres, corps compressés refusés.
  Les parsers personnalisés sont enregistrés avant ceux par défaut du framework.
- Requêtes mal formées : 400 ; taille excessive : 413 ; encodage refusé : 415.
  Les messages proviennent de la liste du filtre commun, jamais de l'exception/parser.
- Helmet existant conservé, sans ajouter de CSP plus restrictive. HTML et bundle
  Swagger locaux sont servis avec ses en-têtes ; vérifier aussi l'UI dans le navigateur
  lors d'une évolution de CSP. Swagger n'est pas monté en production.
- X-Powered-By désactivé. Aucun header Server ajouté par l'application.
- CORS exact avec credentials, headers Content-Type/Authorization/X-Candidly-CSRF,
  méthodes GET/POST/PATCH/OPTIONS, exposition de X-Request-Id. En production,
  toutes les origines CORS et FRONTEND_URL doivent être HTTPS.
- Erreurs 400/401/403/404/429/500 standardisées, sans stack, mot de passe ou message
  SQL. La corrélation reste dans X-Request-Id, sans ajouter de champ métier au JSON.
- Chaque requête reçoit un UUID aléatoire serveur, même si le client fournit un ID.
  Il est propagé via AsyncLocalStorage aux logs et audits, y compris en cas d'erreur.

## Proxy connu et IP client

Par défaut TRUSTED_PROXY_IP est vide et aucune IP de proxy n'est approuvée.
request.socket.remoteAddress décrit le pair direct ; request.ip est la valeur
utilisée par le rate limiting. Sans proxy fiable, les headers X-Forwarded-* ne
peuvent pas changer request.ip. Une IP exacte (pas true, hostname, CIDR ou nombre
de sauts) peut être configurée pour un unique proxy connu ; IPv4 mappée IPv6
est normalisée. Les tests montrent qu'un pair 127.0.0.2 ne peut pas se faire passer
pour le proxy 127.0.0.1, tandis que ce dernier peut transmettre l'IP client.

Ne configurer cette confiance que lorsque l'API est joignable exclusivement par
ce proxy et que celui-ci **écrase** les headers entrants. La confiance repose sur
le réseau/hôte : un processus local capable de joindre l'API depuis l'IP approuvée
est dans cette frontière. L'API reste liée à 127.0.0.1 ; aucun serveur Nginx réel
n'est modifié. Plusieurs proxies/cloud LB exigent une nouvelle analyse réseau.

Exemple préparatoire pour un Nginx HTTPS connu, non déployé :

```nginx
# Dans un serveur HTTPS dont server_name est validé, avec serveur par défaut refusant les autres Host.
location / {
    client_max_body_size 16k;
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host api.example.invalid;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Host api.example.invalid;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Request-Id ""; # L'application génère son propre ID.
}
```

Dans ce modèle seulement : TRUSTED_PROXY_IP=127.0.0.1. Ne pas utiliser
$proxy_add_x_forwarded_for aveuglément ni trust proxy=true. Voir la
[documentation Express](https://expressjs.com/en/guide/behind-proxies/).

## Limites de fréquence vérifiées

Fenêtre fixe Redis : 900 secondes. Clé par endpoint et SHA-256 de request.ip,
INCR/EXPIRE atomiques, réponse 429 normalisée et Retry-After: 900. Panne Redis :
503, aucun contournement local permissif. Les seuils existants sont conservés :

| Endpoint POST auth  | Limite/IP/15 min |
| ------------------- | ---------------- |
| register            | 5                |
| login               | 5                |
| refresh             | 30               |
| verify-email        | 30               |
| resend-verification | 5                |
| forgot-password     | 5                |
| reset-password      | 5                |
| change-password     | 5                |
| logout              | 30               |

La politique est centralisée et testée. Vérification/renvoi et récupération ont
aussi leurs cooldowns en base existants. Les erreurs DTO/CSRF après le guard
consomment une tentative, les corps rejetés par le parser avant le guard non.
NAT, VPN, entreprises et proxy mal configuré peuvent partager une limite ; les
attaques distribuées restent possibles. Ne pas augmenter/désactiver les seuils
sans examiner cette exposition et le modèle réseau.

## Données techniques et maintenance

Hypothèse opérationnelle à valider, **pas une décision juridique** : supprimer
les sessions et tokens expirés seulement après sept jours supplémentaires.
L'historique refresh est conservé jusqu'à expiration absolue de sa session + 7 j,
même si celle-ci est révoquée ; il est supprimé uniquement par la cascade de cette
session. Aucun token encore dans sa période de validité ou de rétention n'est supprimé.
Les audits ne sont jamais supprimés par la commande.

`npm run maintenance:cleanup` (après build) est un dry-run. `-- --apply` est une
action explicite, locale seulement, NODE_ENV development/test, URL loopback et
nom de base finissant par _dev ou _test. Au plus 100 lignes par catégorie par
passage, transaction et filtre d'expiration revérifié à la suppression. La sortie
JSON expose uniquement mode, cutoff et compteurs. Répéter manuellement pour les
lots restants ; aucune tâche cron, aucun déclenchement automatique en production.
Une exécution réappliquée ne retire pas de données supplémentaires hors de la
même règle d'éligibilité. Aucun User, préférence ou AuditLog n'est visé.

Les fichiers email locaux ne sont **pas** supprimés automatiquement : ils peuvent
contenir des liens encore valides. Hypothèse de purge manuelle après le plus grand
TTL configuré + 7 j, seulement dans le dossier privé connu, sans suivre de liens
symboliques et après vérification de la cible. Aucun glob rm automatique dans ce ticket.
Une procédure de conservation production devra traiter sauvegardes, copies et
obligations de sécurité/confidentialité avant une mise en service.

## Risques avant production

Transport email seulement local ; fournisseur réel et page frontend restent hors
périmètre. Pas de keyring JWT ni rotation automatique. Pas de RLS ou rôle admin.
Les logs/audits contiennent des UUID pseudonymes et des horaires : contrôler accès,
collecte, rotation, sauvegardes et durée de conservation. Un audit PostgreSQL n'est
pas un stockage inviolable pour l'administrateur de la base. Les lectures privées
et l'isolation restent sous les conventions CAND-009.

Les mutations critiques sont bloquées si leur audit ne peut pas être écrit :
voir [audit-logging.md](audit-logging.md). La disponibilité, les privilèges PostgreSQL,
les migrations et les alertes doivent être vérifiés avant production. La révocation
critique peut elle aussi échouer/rollback si l'audit est indisponible ; l'erreur 500
et l'alerte ne doivent pas être ignorées. Aucun accès ne doit être réputé révoqué
sans succès de l'opération. Une requête déjà autorisée reste non annulable.
