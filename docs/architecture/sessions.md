# Authentification JWT et sessions — CAND-007

Les choix d'origine, cookies et CSRF ont été documentés avant implémentation dans
[l'ADR 0002](../adr/0002-session-security.md). La configuration validée exige
une clé JWT base64 aléatoire d'au moins 32 octets sans repli. La bibliothèque
stable `jose@6.2.15` signe et vérifie les JWT avec HS256 uniquement.

## Login et identité

POST `/api/v1/auth/login` reçoit email/password, normalise l'email et applique
les validations 12–128 caractères sans modifier le mot de passe. Un hash Argon2
factice aléatoire est préparé au démarrage : compte inconnu et mauvais mot de
passe font chacun une vérification Argon2. Échec ou email non confirmé : même
401 générique. Cela limite les écarts observables sans promettre un temps constant.

Le succès crée une nouvelle session UUID, avec userId, empreinte refresh unique,
expiresAt, revokedAt nullable, createdAt et updatedAt, et retourne uniquement
accessToken, tokenType=Bearer, expiresIn, user. User et GET `/api/v1/auth/me`
contiennent exactement id, firstName, lastName, email, emailVerifiedAt, createdAt.
Les succès sensibles portent Cache-Control: no-store.

## JWT et guard réutilisable

JWT : claims sub, sid, iat, exp, iss, aud uniquement. HS256 imposé, typ JWT,
issuer/audience exacts configurés, UUID valides, iat/exp entiers, iat non futur,
expiration valide et durée au plus ACCESS_TOKEN_TTL_SECONDS (900 par défaut).
Aucun email, mot de passe, hash, refresh ou donnée CRM dans le JWT. La durée
émise est plafonnée à l'échéance de session.

JwtAuthGuard exige un seul bearer conforme et valide le JWT, puis cherche une
session dont id=sid ET userId=sub, non révoquée, non expirée, avec utilisateur
existant et email vérifié. Il attache un contexte AuthenticatedRequest typé.
Le décorateur CurrentUser donne l'identité sélectionnée au contrôleur. AuthModule
exporte le guard et ses dépendances AccessTokenService/SessionRepository pour
les futurs modules ; importer AuthModule et utiliser
`@UseGuards(JwtAuthGuard)`. Aucun userId client ne définit le propriétaire.
Une panne base n'autorise aucun accès. Inscription et vérification restent publiques.

Chaque requête protégée consulte PostgreSQL : logout ou détection de rejeu
empêchent les requêtes suivantes avec les JWT déjà émis, sans attendre 15 min.
Une requête déjà admise avant la révocation ne peut pas être annulée rétroactivement.

## Refresh et logout

Le refresh est opaque, 32 octets cryptographiques base64url, sans identifiant
public de session dans sa valeur. SHA-256 uniquement en base. La session dure
30 jours absolus par défaut ; la rotation ne repousse pas son expiresAt.

POST `/auth/refresh` lit exclusivement le cookie. Le repository cherche
l'empreinte courante, puis l'historique SessionRefreshToken. Dans une transaction,
un verrou FOR UPDATE sur Session sérialise rotations et déconnexion. Il relit
l'état après verrou, refuse expiration/révocation et utilisateur non vérifié,
archive l'empreinte consommée et remplace l'empreinte courante. Le brut ne passe
que par la mémoire et Set-Cookie, jamais par PostgreSQL, Redis ou les logs.

Une empreinte consommée révoque toute la session. La transaction **commet** cette
révocation avant que le service retourne 401. Une valeur arbitraire inconnue
ne révoque aucune autre session. Deux requêtes concurrentes avec le même refresh
produisent au plus un renouvellement ; la suivante détecte le rejeu et révoque
la session, même celle du gagnant. Pas de période de grâce : le futur frontend
doit sérialiser ses refresh, y compris entre onglets, et demander une reconnexion
en cas de course. Un arrêt après commit mais avant réception du cookie peut
nécessiter une reconnexion ; l'ancien token ne redevient jamais valide.

POST `/auth/logout` retrouve la session par empreinte courante ou consommée,
prend le même verrou et la révoque. Le cookie est effacé avec les mêmes Path,
HttpOnly, SameSite et Secure. Succès 204 identique pour cookie absent, invalide,
expiré ou déjà révoqué ; les contrôles CSRF et de débit restent actifs.
Les sessions des autres appareils/utilisateurs ne sont pas touchées.

## Cookie et CSRF

Cookie `candidly_refresh`, host-only (aucun Domain), Path=/api/v1/auth, HttpOnly,
SameSite=Strict, Secure en production. Expires et Max-Age suivent la durée
restante de la session, pas 30 jours renouvelés. Les cookies doublons ou mal
formés sont refusés ; aucun refresh dans un JSON ou dans localStorage.

Login, refresh et logout exigent Origin exactement égal à FRONTEND_URL **et**
X-Candidly-CSRF: 1. Absence, null, origine différente ou header incorrect : 403
avant mutation, même si un cookie valide est joint. Le header n'est pas secret :
il interdit les POST de formulaire et impose un preflight navigateur ; la
vérification d'origine est appliquée aux POST eux-mêmes. CORS avec credentials
n'autorise que les origines explicites, les headers nécessaires et GET/POST/OPTIONS.
FRONTEND_URL doit figurer dans CORS_ORIGIN. Aucune exception locale/Swagger.

Le modèle supporté est même site (HTTPS en production) avec origines frontend/API
éventuellement distinctes. Les déploiements sur des sites différents nécessitent
une nouvelle décision cookies/CSRF. SameSite, CORS et CSRF ne remplacent pas la
prévention XSS. Le mode local HTTP omet Secure uniquement pour permettre les essais.

## Limites opérationnelles

- Une clé active, pas de keyring ni rotation automatique. Changer la clé invalide
  les JWT existants ; les sessions peuvent encore obtenir un JWT avec leur refresh.
  Une révocation de toutes les sessions doit être décidée séparément en cas d'incident.
- Pas de nettoyage automatique des sessions/historiques expirés, pas de liste
  des appareils ou de logout global ; pas de frontend ou de stockage client ajouté.
- Le contrôle session en base ajoute une lecture par requête protégée ; aucun cache
  dont l'invalidation pourrait retarder une révocation.
- Limites Redis par IP : login 5, refresh/logout 30 sur fenêtre fixe 15 min. Pas de
  garantie contre une attaque distribuée ; les réseaux partagés peuvent être limités.
  trust proxy reste désactivé, X-Forwarded-For n'est pas une identité fiable.
- Rejeu strict : des refresh légitimes simultanés ou une réponse réseau perdue
  peuvent conduire à une reconnexion, choix de sécurité documenté.
- HttpOnly ne rend pas Set-Cookie non sensible : reverse proxies et outils de
  diagnostic futurs devront masquer Authorization, Cookie et Set-Cookie, comme
  les corps login/verify. L'application ne journalise pas ces valeurs.

## Révocation après changement/reset — CAND-008

Toute modification de mot de passe révoque toutes les sessions de cet utilisateur,
y compris celle de l'appelant, dans la transaction qui remplace le hash. Le
contrôleur efface le cookie refresh courant. Aucun nouveau JWT ou session n'est
créé automatiquement. Les autres utilisateurs ne sont pas touchés.

La création de session prend maintenant le verrou User et recontrôle sous verrou
le hash précédemment vérifié au login. Un login avec l'ancien hash concurrent
à une modification est soit créé avant puis révoqué, soit refusé après, sans
laisser de session active basée sur l'ancien mot de passe. Les refresh/logout
conservent leur verrou Session ; les opérations de mot de passe prennent User
puis révoquent Session, sans ajouter de verrou User dans un refresh.
Voir [la politique complète](account-recovery.md).
