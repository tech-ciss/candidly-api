# Entreprises — CAND-011

## Modèle et unicité

Company appartient à User par userId obligatoire et immuable dans l’API. UUID,
name (150), normalizedName interne, industry/country/city (100), website (2048),
address (255), description (2000), notes (5000), dates timestamptz(3) UTC,
status ACTIVE/ARCHIVED et archivedAt nullable. Aucun contact/candidature fictif.
La FK User est RESTRICT : aucune suppression implicite du portefeuille lors d’une
suppression de compte. Un futur effacement de compte demandera une politique dédiée.

Migration additive `20261106000100_companies`, sans changement des anciennes.
Contrainte unique PostgreSQL (userId, normalizedName), archives comprises. Deux
utilisateurs peuvent saisir le même nom. Les créations/modifications concurrentes
reposent sur cette contrainte, pas sur un précontrôle ; collision = 409 normalisé.
Index composites propriétaire/statut/tri/id pour name, createdAt, updatedAt.
CHECK SQL impose ACTIVE + archivedAt null ou ARCHIVED + archivedAt renseigné.

Le nom d’affichage est normalisé NFC, trim et espaces Unicode consécutifs réduits
à un espace ASCII. La clé applique ensuite toLowerCase Unicode de Node, puis NFC.
Aucun retrait d’accents, de ponctuation ou normalisation de compatibilité NFKC.
Pas de case folding linguistique complet : ß et ss restent distincts. normalizedName
est TEXT car les minuscules Unicode peuvent augmenter la longueur (İ → i + point).
La contrainte compare la clé normalisée sans collation insensible aux accents.

## Routes privées /api/v1/companies

| Méthode | Route        | Succès                                                 |
| ------- | ------------ | ------------------------------------------------------ |
| POST    | /            | 201 Company                                            |
| GET     | /            | 200 { data, meta: { page, limit, total, totalPages } } |
| GET     | /:id         | 200 Company, archives incluses                         |
| PATCH   | /:id         | 200 Company                                            |
| POST    | /:id/archive | 200 Company                                            |
| POST    | /:id/restore | 200 Company                                            |
| DELETE  | /:id         | 204 sans corps                                         |

JWT/session existants obligatoires (401), UUID invalide/DTO invalide = 400 ;
ressource absente ou étrangère = même 404 ; doublon/relations bloquantes = 409.
Les réponses sélectionnent seulement les champs métier et dates, jamais userId
ou normalizedName. Cache-Control no-store. Swagger documente DTO, exemples,
paramètres et réponses, et reste désactivé en production comme auparavant.

POST/PATCH acceptent name, industry, website, country, city, address, description,
notes. Aucun propriétaire, identifiant, statut ou date fournis par le client.
Name obligatoire à la création ; PATCH vide refusé. Les champs facultatifs peuvent
être omis (inchangés en PATCH) ou null (effacés). Une chaîne facultative vide après
trim est refusée. Les objets, types incorrects, champs inconnus et name null sont
refusés. Archive/restauration/suppression refusent également un corps non vide. Website : URL absolue HTTP/HTTPS seulement, sans requête réseau du serveur.
La limite globale existante de corps HTTP 16 KiB reste applicable, même si une
combinaison de champs ou de caractères multioctets atteint leurs limites métier.

## Liste et concurrence

Page 1 par défaut, maximum 1 000 000 ; limit 20 par défaut, 1–100. Entiers décimaux
stricts sans exposant/signe/espace. Statut ACTIVE par défaut, ARCHIVED explicite.
Search borné à 150, recherche partielle insensible à la casse sur name/industry/city.
Les caractères LIKE %, _ et antislash sont échappés : recherche littérale.
Industry/country/city : égalité insensible à la casse, bornée à 100. Trim des filtres.
SortBy name/createdAt/updatedAt, sortOrder asc/desc ; défaut name asc ; id départage
les égalités dans le même sens. Tri texte selon collation PostgreSQL de la base.

findMany et count utilisent le même ownerWhere et une transaction RepeatableRead :
données et total cohérents dans chaque réponse pendant les modifications. La
pagination par offset ne garantit pas un instantané entre deux requêtes distinctes.
Les recherches contains peuvent scanner le portefeuille ; pas d’extension trigram
ou de recherche plein texte ajoutée. Profiler avant un volume important.

## Isolation, archive et suppression

JwtAuthGuard → CurrentActor → service → repository. Chaque création utilise
requireActor(actor).userId, chaque lecture/mutation un ownedIdWhere, chaque liste
et count un ownerWhere externe aux OR. Pas de lecture globale suivie d’écriture
sans portée. Les données d’écriture sont explicitement sélectionnées, sans spread
d’un DTO sur les champs système. Aucun transfert de propriétaire exposé.

Archive/restauration utilisent une écriture conditionnelle sous propriétaire et
statut attendu. Une répétition retourne la ligne existante sans toucher aux dates
ni écrire un nouvel audit. Concurrence identique : une seule transition/audit.
Une transition inverse concurrente peut naturellement changer l’état après réponse.
PATCH reste autorisé sur archive. DELETE est définitif, y compris pour une archive ;
un second DELETE retourne 404 (une suppression effective et un audit).

Aujourd’hui aucune relation métier ne bloque DELETE. Les futurs modules devront
ajouter des FK RESTRICT (éventuellement composites avec userId/companyId) et une
règle explicite 409 ou une opération métier encadrée. Jamais CASCADE vers contacts,
candidatures ou historique, ni suppression silencieuse. Résoudre chaque relation
sous le même acteur dans la transaction ; propriété et entreprise doivent coïncider.
Aucun verrou global. Une future suppression de compte devra revoir l’ordre des
verrous User/Company et l’effacement explicite des données, avec tests concurrents.

## Audit

COMPANY_CREATED/UPDATED/ARCHIVED/RESTORED/DELETED : SUCCESS, actorUserId authentifié,
targetType COMPANY, targetId UUID historique, requestId serveur, metadata {}.
Aucun nom, URL, secteur, notes, valeur avant/après ni corps HTTP dans le journal.
Mutation et audit dans une transaction : panne audit = rollback et 500 normalisé.
La suppression conserve l’audit sans FK cible. Les lectures, collisions/404 et
transitions sans effet n’ajoutent pas d’audit ; logs HTTP structurés existants.
PATCH accepté produit un événement même si les valeurs envoyées sont identiques.
Aucune route de lecture du journal, rôle administrateur ou nouvelle dépendance.
