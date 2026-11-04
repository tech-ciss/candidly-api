# Profil, préférences et récupération — CAND-008

Le module Users utilise le guard JWT et CurrentUser de CAND-007. L'identité
vient exclusivement du contexte vérifié, jamais d'un id dans le corps ou l'URL.
Les repositories sélectionnent les champs publics : id, firstName, lastName,
email, emailVerifiedAt, createdAt. Aucun hash ou état interne de session.

## Profil et préférences

GET/PATCH `/api/v1/users/me` lit ou modifie uniquement firstName/lastName, trim,
1–100 caractères, au moins un champ. Email, userId et toute propriété inconnue
sont refusés, de même que les valeurs nulles. GET/PATCH `/users/me/preferences`
accède uniquement à la clé unique userId du contexte.

UserPreference contient userId UUID primaire/FK, locale fr, timezone Africa/Abidjan,
createdAt et updatedAt. La migration initialise les comptes existants ; inscription
crée les préférences dans la même écriture que le compte. Une création INSERT ON CONFLICT DO NOTHING suivie de lecture/mise à jour
dans une transaction couvre aussi les comptes créés directement ou historiques sans préférences.
Locale acceptée pour le lancement : fr. Fuseaux IANA acceptés par le runtime
Node 24 via Intl.supportedValuesOf(timeZone), plus UTC ; aucune restriction de
continent. Le GET retourne locale, timezone, createdAt et updatedAt seulement.
Toutes ces réponses sont no-store. Le profil utilise uniquement le bearer,
aucune authentification implicite par cookie ; CORS autorise PATCH.

## Demande et email

POST `/api/v1/auth/forgot-password` reçoit l'email trim/lower et retourne toujours
202 avec le même message générique pour compte connu, inconnu ou en cooldown.
Les erreurs de validation/dépendance ne sont pas masquées. Un UPDATE conditionnel
atomique crée la demande durable seulement si le cooldown de compte est écoulé
(60 s par défaut). Marqueurs User : passwordResetRequestedAt et
passwordResetLastRequestedAt, tous deux nullables pour les comptes existants.

Un compte non vérifié est éligible à la récupération, mais le reset ne modifie
jamais emailVerifiedAt : l'email devra toujours être vérifié avant login.
Aucune nouvelle session ou confirmation implicite. Cette politique permet de
récupérer un mot de passe perdu avant la fin de l'inscription.

PasswordResetDeliveryService reprend au plus 20 demandes par passage, au lancement
puis à l'intervalle existant (30 s par défaut). Le cycle DurableEmailDelivery est
partagé avec l'envoi de vérification : un passage par instance, arrêt attendu,
logs génériques, déclenchement manuel déterministe en test. La logique de stockage
et les tables restent séparées. Le verrou User FOR UPDATE SKIP LOCKED coordonne
les envois concurrents et les opérations de mot de passe. Une erreur d'envoi
annule les écritures de tokens et conserve la demande ; les échecs sont replacés
en fin de lot lorsque PostgreSQL est disponible.

Le token opaque utilise 32 octets aléatoires (256 bits), base64url, 43 caractères.
Seul son SHA-256 est en base dans PasswordResetToken : id UUID, userId, tokenHash
unique, expiresAt, consumedAt nullable, createdAt. TTL initial 1800 s, configurable.
Le helper cryptographique existant est réutilisé, jamais les tokens ou tables de
vérification. Les anciens liens restent valides en cas d'échec ; un envoi réussi
consomme les anciens tokens de récupération actifs dans sa transaction.

Le transport EmailTransport existant prépare un email français avec lien
`/reset-password#token=…`. Le transport local écrit un JSON privé, aucun email
réellement délivré. Le token brut n'est ni dans les réponses, ni PostgreSQL,
ni Redis, ni les logs. La page frontend n'existe pas encore.

## Changement et reset atomiques

POST `/auth/change-password` exige JWT/session active, currentPassword et
newPassword (12–128 caractères), plus Origin exacte et X-Candidly-CSRF=1 puisque
le cookie est effacé. Le service vérifie Argon2id, calcule le nouveau hash hors
verrou, puis le repository verrouille User et compare à nouveau le hash attendu.
Deux changements concurrents ne peuvent tous deux utiliser l'ancien hash.

POST `/auth/reset-password` est public et exige un token conforme et newPassword.
Le hash Argon2id est calculé hors verrou, puis une transaction recherche son
empreinte dans PasswordResetToken, verrouille User et relit expiration/consommation.
Un token inconnu, expiré ou consommé produit le même 400 sans détail sensible.
Même avec des tokens actifs différents, une seule réinitialisation concurrente
réussit : toutes les autres empreintes sont consommées.

Les deux opérations remplacent le hash, annulent la demande en attente,
consomment tous les tokens de récupération actifs et révoquent **toutes** les
sessions de cet utilisateur, y compris l'appelante, dans une transaction commune.
Le contrôleur efface le cookie refresh courant après succès. Les autres comptes
ne sont pas modifiés. Aucune session ou JWT n'est créé, une nouvelle connexion
est nécessaire. Le guard existant consulte la base à chaque requête, donc les
anciens JWT comme les refresh sont refusés aux requêtes suivantes.

La création de session au login verrouille désormais User et vérifie que le hash
vérifié par Argon2id est toujours courant. Un login concurrent avec l'ancien mot
de passe est soit créé avant le reset puis révoqué, soit refusé après. Le même
ordre User → Session est utilisé par les écritures de mot de passe. Les refresh
et logout gardent leurs verrous Session et n'ajoutent pas de verrou User inverse.

## Protections et limites

- DTO stricts et champs inconnus refusés ; rate limiting Redis existant : change,
  forgot et reset 5/IP/15 min, panne Redis fermée. Le cooldown par compte de forgot
  est persistant et indépendant de l'IP, sans variation de réponse publique.
- Hash systématique avant validation transactionnelle du reset, borné par la
  limite IP ; aucune promesse de temps constant pour les chemins base.
- Les migrations précédentes sont inchangées. La nouvelle migration ajoute deux
  colonnes nullables, deux tables et les index, puis initialise les préférences ;
  aucun reset ou suppression de données existantes.
- Le transport local et le commit PostgreSQL ne forment pas une transaction commune :
  un arrêt après écriture peut laisser un message invalide. La demande reste
  reprenable ; pas de garantie de délivrance exactement une fois.
- Pas de fournisseur email, frontend, changement d'email, notifications, CRM,
  nettoyage automatique des tokens/fichiers ou purge des sessions historiques.
- Une requête déjà autorisée avant une révocation ne peut pas être annulée
  rétroactivement. Les mises à jour de profil concurrentes suivent la dernière
  écriture, sans verrouillage optimiste de formulaire dans ce ticket.
