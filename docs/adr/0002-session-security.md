# ADR 0002 — JWT, sessions, cookies et CSRF

Statut : retenu pour CAND-007, 2026-11-03, avant implémentation.

## Origines et cookies

Le développement utilise frontend `http://localhost:3000` et API
`http://localhost:3001`. Le déploiement supporté est HTTPS avec frontend et API
sur le même site (exemple fictif `app.example.com` et `api.example.com`), ou une
origine commune via proxy. Aucun domaine réel ni déploiement n'est décidé ici.
Le frontend configuré par FRONTEND_URL est l'unique origine acceptée pour les
POST de connexion, refresh et logout et doit aussi être autorisé par CORS.
Le navigateur utilisera `credentials: include`. Ne pas mélanger localhost et
127.0.0.1 dans une utilisation navigateur.

Le refresh est exclusivement dans un cookie host-only `candidly_refresh`,
HttpOnly, SameSite=Strict, Secure en production, Path=/api/v1/auth,
expiration alignée sur celle de la session. Aucun Domain, aucun refresh dans
le JSON. L'access token sera conservé en mémoire par un futur frontend.
Les déploiements sur des sites différents ne sont pas supportés par ce choix ;
ils devront faire l'objet d'une décision dédiée, sans passer implicitement à None.

## Protection CSRF

Login (y compris login CSRF), refresh et logout exigent **simultanément** :
Origin strictement égal à FRONTEND_URL et en-tête X-Candidly-CSRF: 1.
Origin absent, null, différent, ou en-tête absent/incorrect : 403 avant mutation.
Les clients non navigateur doivent eux aussi fournir ces en-têtes. Le header
personnalisé force un preflight cross-origin ; le serveur contrôle aussi les
POST réels. CORS explicite avec credentials et SameSite sont des couches
supplémentaires, pas le seul contrôle CSRF. Une requête form ordinaire est refusée.
Le header n'est pas un secret ni un token de synchronisation ; cette stratégie
API repose sur la politique d'origine du navigateur et le contrôle strict du serveur.

## JWT et révocation

HS256 uniquement via jose, secret base64 de 32 octets minimum fourni par variable
d'environnement sans valeur de repli. Claims minimales sub, sid, iat, exp, iss,
aud. Signature, algorithme, type JWT, origine, audience, UUID, durée et expiration
sont vérifiés. TTL initial 900 s. Le guard consulte PostgreSQL pour une session
active appartenant à sub et un utilisateur toujours vérifié : révocation immédiate
aux requêtes suivantes, sans cache permissif en cas de panne.

## Rotation

Refresh opaque aléatoire 256 bits, SHA-256 en base, session absolue de 2592000 s
(30 jours), sans prolongation glissante. La session conserve l'empreinte courante ;
SessionRefreshToken conserve les empreintes déjà consommées jusqu'à la suppression
de la session, afin de distinguer réutilisation et valeur arbitraire inconnue.
Aucun token brut stocké. Un verrou de ligne sérialise rotation et logout.

Chaque refresh valide archive l'ancienne empreinte et enregistre la suivante
atomiquement. Un token consommé révoque la session entière et retourne 401,
sans créer de session. Une valeur aléatoire inconnue retourne 401 sans révoquer
une autre session. Deux refresh concurrents donnent un seul renouvellement,
puis une révocation stricte lors de la détection du second ; même le JWT issu
du gagnant sera refusé après cette révocation. Le futur client devra sérialiser
ses refresh et se reconnecter après une course. Pas de période de grâce ambiguë.
Logout courant ou consommé révoque cette session seulement, efface le cookie et
retourne 204 de manière idempotente. Les autres appareils restent connectés.

Références : [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[jose](https://github.com/panva/jose). Les données d'authentification seront purgées
par une politique future ; aucun nettoyage destructif automatique dans ce ticket.
