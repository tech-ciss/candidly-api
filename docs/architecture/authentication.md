# Inscription et vérification email — CAND-006

Le monolithe ajoute `modules/auth` (DTO, contrôleur, service, repository,
limitation Redis et traitement des demandes) et `integrations/email`
(contrat indépendant du prestataire et adaptateur local). CAND-006 n'introduisait
pas de login ou session ; ceux-ci sont ajoutés par CAND-007 dans
[l'architecture des sessions](sessions.md). Les ressources CRM restent hors périmètre.

## Modèles et cycle

`User` contient id UUID, email unique (254), passwordHash (255), firstName et
lastName (100), emailVerifiedAt nullable, createdAt et updatedAt. Deux champs
techniques assurent la reprise : verificationRequestedAt nullable (demande en
attente) et verificationLastRequestedAt (cooldown). Les noms sont trim, les
emails trim/lower sans règles spécifiques aux fournisseurs (pas de retrait de
points ou de suffixes). Les mots de passe de 12–128 caractères sont conservés
exactement, sans trim ni règles de composition imposées.

`EmailVerificationToken` contient id UUID, userId UUID, tokenHash SHA-256 unique,
expiresAt, consumedAt nullable et createdAt. Les 32 octets aléatoires sont produits
par `crypto.randomBytes`, encodés base64url (43 caractères). La base ne conserve
jamais leur forme brute. Le TTL de 24 h commence à la tentative d'envoi.

1. `POST /api/v1/auth/register` valide et normalise, calcule Argon2id et crée le
   compte non vérifié avec une demande durable. Une collision P2002 retourne le
   même succès 202 sans écraser nom, hash ou état du compte existant.
2. Le traitement récupère au plus 20 demandes par passage, verrouille User avec
   `FOR UPDATE SKIP LOCKED`, recontrôle son état, prépare un token et son email.
   Il consomme les anciens tokens actifs et persiste uniquement la nouvelle
   empreinte. Le transport écrit le message local puis la transaction supprime
   le marqueur en attente. Un échec annule toutes ces écritures en base.
3. `POST /api/v1/auth/verify-email` retrouve l'empreinte, verrouille le même User,
   relit le token après verrou, contrôle expiration/consommation/état du compte,
   puis marque l'email vérifié, consomme tous ses tokens et annule toute demande
   restante dans la même transaction. Un seul appel concurrent réussit, même
   avec des tokens différents. Inconnu/expiré/consommé : même erreur 400.
4. `POST /api/v1/auth/resend-verification` crée une demande seulement pour un
   compte non vérifié dont le cooldown est écoulé. L'UPDATE conditionnel est
   atomique. Les anciens tokens restent valides jusqu'à un nouvel envoi réussi,
   puis sont consommés. Un compte inconnu ou vérifié ne déclenche rien.

Les succès ont `{ success: true, message: "…" }` ; inscription et renvoi ont
exactement la même réponse générique 202. Les erreurs gardent le filtre global,
les messages français contrôlés, sans corps reçu, hash ou token. Les erreurs de
validation restent 400, les pannes de dépendances 500/503 ; ne pas les masquer
comme un succès. Aucun compte n'est retourné par ces routes publiques.

## Reprise et transport

Voir [l'ADR](../adr/0001-verification-email-delivery.md). Un marqueur persistant
évite de perdre la demande au redémarrage sans stocker de token brut dans une
outbox ou Redis. Une reprise génère un nouveau token. La tâche s'exécute au
lancement et à intervalle configurable, sans passages simultanés dans une même
instance ; les verrous PostgreSQL coordonnent plusieurs instances. L'arrêt attend
le passage en cours. Les tentatives sont séquentielles et chaque transaction a
un timeout de 5 secondes, en plus des limites PostgreSQL existantes de 2 s.

`EmailTransport.send` est le contrat pour un futur adaptateur approuvé. Le
transport actuel écrit un fichier JSON privé dans `.local-emails` (dossier 0700,
fichiers 0600). Aucun appel réseau ni email réellement délivré. Le lien pointe
vers l'origine frontend configurée et `/verify-email#token=…` : le fragment
évite les journaux d'accès frontend. La page frontend n'existe pas encore.
En production, le transport local est interdit, le transport désactivé laisse
les demandes en attente ; aucun fournisseur n'est intégré implicitement.

## Sécurité et protections

Argon2id v19 : mémoire 19 MiB, deux passes, parallélisme 1, sortie 32 octets,
sel aléatoire fourni par la bibliothèque. Paramètres issus de la
[recommandation OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
La bibliothèque stable [node-argon2](https://github.com/ranisalt/node-argon2)
est ajoutée pour éviter l'API Argon2 expérimentale de Node 24.

La limitation est appliquée avant la validation et le hash sur chaque endpoint
public : 5 inscriptions, 5 renvois, 30 vérifications par IP et fenêtre fixe de
15 minutes. Un script Redis atomique INCR/EXPIRE partage le compteur entre
instances. Clés avec SHA-256 de l'adresse réseau, TTL 900 s ; aucune adresse
email, token ou mot de passe dans Redis. Réponse 429 avec Retry-After 900 ;
panne Redis : 503, sans repli permissif. Le cooldown PostgreSQL ajoute une
limitation par compte existant sans modifier la réponse publique.

`trust proxy` reste désactivé : X-Forwarded-For ne permet pas de contourner les
limites. Une future installation derrière proxy devra configurer uniquement
les proxies de confiance. CORS, Helmet, whitelist et rejet des champs inconnus
restent actifs. Les contraintes SQL protègent l'unicité et la normalisation.

## Limites explicites

- Le succès d'inscription confirme la demande, pas la délivrance. Le local
  n'est pas un service email de production ; les fichiers contiennent des liens
  privés à retirer manuellement après usage. Aucun endpoint de lecture n'est exposé.
- L'écriture fichier et le commit PostgreSQL ne sont pas une transaction commune :
  un arrêt après écriture peut laisser un message dont le token n'est pas valide.
  La demande reste reprenable et un nouveau message est préparé. Pas de promesse
  d'exactement une délivrance. Un futur transport réseau devra borner ses appels,
  définir l'idempotence et revoir la durée du verrou transactionnel.
- Le lot de 20 demandes et l'intervalle fixe conviennent au développement/MVP ;
  pas de backoff exponentiel, nettoyage automatique des tokens historiques,
  purge des fichiers ou file distribuée. Les échecs sont replacés en fin de lot
  si PostgreSQL reste disponible ; supervision et évolution nécessaires à grande échelle.
- Les réponses génériques et le hash systématique des doublons limitent
  l'énumération, sans promettre un temps constant des chemins HTTP/base.
- La limite IP peut toucher des utilisateurs partageant un réseau ; la fenêtre
  fixe permet un pic au changement de fenêtre. Ces seuils sont des protections
  initiales, pas une garantie contre un abus distribué.

## Évolutions CAND-008

Le changement et la récupération du mot de passe réutilisent ce socle sans
confirmer l'email. Les demandes et tokens sont distincts de ceux de vérification,
mais partagent transport, cryptographie de token opaque et cycle de reprise.
Voir [l'architecture du compte](account-recovery.md).
