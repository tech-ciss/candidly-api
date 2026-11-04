# Autorisations et isolation — CAND-009

Stratégie retenue avant implémentation, 2026-11-04 : conserver JwtAuthGuard,
la validation JWT/session active et CurrentUser pour les réponses d'identité.
Ajouter CurrentActor, contexte minimal userId/sessionId créé uniquement après
ces vérifications, puis imposer ce contexte aux services/repositories Users.
Aucun rôle administrateur, nouvelle authentification, route de sélection d'un
compte tiers, modèle CRM ou migration.

Le propriétaire vient du contexte authentifié, jamais du body/query/paramètre.
Les filtres de lecture ET d'écriture doivent l'inclure. La fondation fournit un
filtre AND non écrasable par les filtres de recherche, un filtre id+userId pour
les mutations unitaires, le filtre propre à User (id=userId), et des résultats
404 identiques pour absence et propriété étrangère. Les contrôleurs ne sont pas
la seule barrière : les repositories reçoivent le contexte et construisent les
prédicats. Les conventions complètes et leurs limites seront détaillées ici
avec les tests réels et les exemples fictifs limités aux tests.

## Contexte et frontières de confiance

AuthenticatedActor contient seulement userId et sessionId en lecture seule. Le
contexte est gelé, marqué par un Symbol interne et enregistré dans un WeakSet
privé. Les objets JSON et les copies par spread ne sont pas des acteurs valides.
actorFromVerifiedSession n'est **pas** un authentificateur : en production, seul
JwtAuthGuard doit appeler cette fabrique, après signature, claims, session active,
email vérifié et cohérence de l'utilisateur retourné avec sub. Les tests peuvent
simuler cette frontière. Le guard efface tout contexte préalable avant validation.
CurrentActor refuse un contexte absent ou non marqué. Aucun header X-User-Id,
query userId, body auth/currentUser ou claim de rôle n'accorde de droit.

CurrentUser est conservé pour /auth/me et les consommateurs d'identité publique :
le guard garde séparément les champs publics déjà sélectionnés et le décorateur
vérifie leur cohérence avec l'acteur. Ces données ne sont pas le contexte transmis
aux services Users. Les routes publiques d'inscription/vérification/récupération
restent publiques avec leurs protections existantes.

Le marquage empêche les confusions accidentelles avec des DTO et les objets JSON,
pas un module serveur malveillant capable d'appeler la fabrique ou Prisma. Pas de
nouveau guard d'authentification, de rôle, de middleware global Prisma ou de RLS.

## Responsabilités

- Contrôleur : JwtAuthGuard, CurrentActor, DTO strict, paramètres métier seulement.
  Il ne construit pas de contexte depuis le body/query et ne choisit pas un userId tiers.
- Service : reçoit l'acteur, applique les règles métier et orchestre les transactions.
  Il ne remplace pas l'identité par une valeur reçue ou une relation chargée sans portée.
- Repository : exige l'acteur, le valide et construit les prédicats propriétaires
  à chaque lecture, comptage, mutation ou relation. Une vérification contrôleur seule
  ne suffit pas. Propriétaire immuable dans les données de mutation.

UsersService et UsersRepository reçoivent désormais AuthenticatedActor plutôt
qu'un identifiant libre. User est son propre propriétaire : selfWhere(actor)
produit id=userId vérifié. UserPreference est filtré par userId. Les écritures
profil/préférences utilisent updateManyAndReturn avec la portée dans le WHERE ;
aucune mutation non filtrée après une vérification préalable. L'initialisation des
préférences insère exclusivement userId validé par le contexte dans une transaction,
puis lit ou met à jour sous le même filtre propriétaire.

## Helpers et conventions Prisma

ownerWhere(actor, filter) compose `{ AND: [{ userId: actor.userId }, filter] }`.
Ne jamais remplacer cela par `{ userId, ...clientFilter }` ou un OR externe qui
pourrait supprimer la barrière. Le filtre métier est construit à partir de DTO
validés ; le helper ne rend pas sûrs des filtres Prisma arbitraires fournis par le client.
ownedIdWhere(actor, id) produit id ET userId. selfWhere est réservé au modèle User.
privateResource transforme null/undefined en NotFoundException sans message privé.
requireAffected vérifie le nombre de mutations et produit le même 404 si le compte
diffère de celui attendu.

Exemples avec le modèle existant Session, **sans ajouter de route de gestion** :

```typescript
// Lecture : jamais findUnique({ where: { id } }) seul pour une ressource privée.
const session = privateResource(
  await prisma.session.findFirst({
    where: ownedIdWhere(actor, sessionId),
    select: { id: true, expiresAt: true },
  }),
);

// Mutation atomique : pas de check puis update({ where: { id } }) non filtré.
const result = await prisma.session.updateMany({
  where: ownedIdWhere(actor, sessionId),
  data: { revokedAt: new Date() },
});
requireAffected(result.count);
```

Pour les listes et recherches, le même ownerWhere entoure tous les filtres, y
compris les OR. Appliquer le filtre aussi au count, agrégats et recherche par
curseur ; un total global serait déjà une fuite. Borne positive de take (maximum
100 initialement recommandé pour les futurs DTO), ordre déterministe avec id en
départage, et curseur résolu sous la même portée. Ces conventions ne créent aucun
endpoint de liste/pagination prématuré.

Pour une suppression, utiliser deleteMany avec ownedIdWhere puis requireAffected,
ou une opération conditionnelle retournant la ligne ; respecter les règles de
conservation du modèle. Pour un lot, valider la taille, dédupliquer les IDs et
intersecter `{ id: { in: ids } }` avec ownerWhere. Exemple tout-ou-rien :

```typescript
const uniqueIds = [...new Set(validatedIds)]; // DTO : 1 à 100 IDs, pas de lot vide.
await prisma.$transaction(async (tx) => {
  const result = await tx.session.updateMany({
    where: ownerWhere(actor, { id: { in: uniqueIds } }),
    data: { revokedAt: new Date() },
  });
  requireAffected(result.count, uniqueIds.length); // DANS la transaction : rollback.
});
```

Un lot contenant un ID inconnu ou étranger retourne 404 sans nommer l'ID et annule
les écritures déjà effectuées. Ne pas appeler requireAffected après le commit pour
ce comportement tout-ou-rien. Pour une API future à succès partiel, faire approuver
et documenter son contrat sans indiquer les IDs privés étrangers.

## Relations entre ressources futures

Résoudre chaque côté avec le **même acteur**, dans la transaction qui associe les
ressources. L'appartenance commune ne suffit pas : imposer aussi le même companyId
lorsque le domaine l'exige, par exemple contact et candidature de la même entreprise.
Un document, une action, une entreprise ou un contact étranger doit être traité
comme inexistant. Les IDs du client ne prouvent ni propriété ni compatibilité.

Privilégier des contraintes relationnelles composites qui incluent userId, puis
companyId quand nécessaire (clés uniques et FK composites à définir dans les futurs
modèles). Ces contraintes n'existent pas encore pour le CRM et ne sont pas ajoutées
ici. Si la règle dépend de lignes modifiables, verrouiller les lignes concernées
dans un ordre déterministe ou choisir une isolation et des retries adaptés. Une
simple lecture préalable, même dans une transaction Read Committed, ne suffit pas
à protéger un invariant si une transaction concurrente peut le changer.

Le propriétaire doit rester immuable dans les mises à jour ordinaires. Tout futur
transfert exige une opération métier dédiée, une transaction et ses propres tests.
Les tests fictifs simulent un changement entre précontrôle et écriture pour vérifier
que le filtre est appliqué au moment de la mutation, sans exposer de transfert réel.

## Politique d'erreurs

Sans identité valide : 401. Ressource privée identifiée absente **ou étrangère** :
404, même code/message normalisé. Ne pas faire une recherche globale pour produire
un 403 distinct lorsque l'ID appartient à un autre compte. Action explicitement
interdite et sans fuite d'existence privée : 403 (par exemple CSRF). Ne pas utiliser
404 pour masquer une panne de base ; les erreurs inattendues restent normalisées
par le filtre existant. Aucun identifiant trouvé, email, nom, hash, token ou trace
SQL dans le message. Le path public peut contenir un identifiant fourni par le
client, mais aucune donnée découverte en base ; la query string est retirée.

## Authentification par session et capacités publiques

SessionRepository.activeUser impose déjà id=sid ET userId=sub et l'état actif,
avec utilisateur vérifié. Un JWT signé mais combinant sub A et sid B est refusé.
La création de session reste synchronisée avec les changements de mot de passe.
Refresh et logout s'authentifient par le cookie opaque, pas par un userId/sessionId
ou un bearer access en parallèle. Un cookie A révoque/renouvelle uniquement sa
session A, même si un header/body mentionne B. La possession d'un cookie B volé est
un vol de justificatif, pas un accès autorisé par l'identité A ; les protections de
rotation, rejeu, CSRF et cookies restent nécessaires et inchangées.

Les recherches par email à l'inscription/login et par empreinte au refresh/reset
sont les mécanismes publics d'authentification/capacité existants. On ne peut pas
leur imposer un acteur JWT inexistant. Elles n'exposent aucune lecture privée par
ID et restent circonscrites au module Auth, avec réponses génériques, expiration,
transactions, rate limiting et DTO. Les workers ne prennent leur userId que depuis
les demandes persistantes, jamais d'une donnée HTTP non vérifiée.

## Tests et limites

- Tests unitaires : acteur minimal/marquage, filtres AND, lecture/mutation/suppression,
  liste paginée/recherche, total filtré, lots mixtes annulés, relations incompatibles,
  changement concurrent de propriétaire, 403/404 sans données privées, guard sans
  confiance dans un contexte préalable. Repository fictif en mémoire uniquement.
- E2E : deux utilisateurs, profils/préférences concurrents, champs/query/headers
  forgés, JWT avec mauvaise session, logout par cookie et absence de route tierce.
- Intégration : mêmes règles sur PostgreSQL/Redis réels, count/pagination filtrés,
  mutations et suppressions étrangères sans effet, rollback réel du lot mixte,
  profils/préférences/sessions isolés et contextes non marqués refusés.

Aucune table ou route CRM, nouvelle migration, dépendance, politique admin,
déploiement ou frontend. Les helpers ne sont pas une sandbox de base : un futur
repository qui utilise Prisma sans portée peut encore introduire une faille.
Chaque futur module doit utiliser ces conventions, faire relire chaque requête
privée et ajouter ses tests à deux utilisateurs et de relations/concurrence sur
sa vraie base. Les tests fictifs ne prouvent pas des contraintes CRM encore absentes.
Une requête déjà autorisée ne peut pas être annulée rétroactivement après révocation.
