# Migrations

La première migration métier est `20261103000100_user_email_verification`.
Elle crée uniquement `User` et `EmailVerificationToken`. Les UUID sont générés
par Prisma ; les dates sont des instants PostgreSQL `TIMESTAMPTZ(3)`.

- Email normalisé trim/lower, index unique `User_email_key` : les inscriptions
  concurrentes ne créent pas deux comptes.
- Contrainte SQL `User_email_normalized_check` : refuse une écriture non normalisée,
  même hors API. Cette contrainte SQL personnalisée doit être préservée dans les
  migrations futures ; Prisma ne représente pas les CHECK dans le schéma.
- Index unique sur l'empreinte du token ; index userId/consumedAt et demandes en attente.
- Clé étrangère du token vers User, cascade uniquement sur ses tokens de vérification :
  ces secrets dérivés n'ont aucune utilité après suppression de leur compte.
- Aucun champ de mot de passe ou token brut. Les deux marqueurs de demande sur User
  servent à la reprise durable et au cooldown de renvoi.

Avant toute application, contrôler l'hôte, le port et la base sans afficher les
identifiants, inspecter le SQL, vérifier qu'il s'agit d'une base locale de
développement/test et sauvegarder toute donnée à conserver. Ensuite :

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npx prisma migrate status
```

La CI applique la migration à son service PostgreSQL éphémère avant les tests
d'intégration. Aucune migration de production n'est autorisée par ce ticket.
Aucun reset, `db push`, suppression de volume ou table existante n'est nécessaire.

## Sessions — CAND-007

`20261103000200_sessions` crée uniquement Session et SessionRefreshToken, leurs
index et clés étrangères. Aucun DROP, reset, changement de colonne ou mise à
jour de User/EmailVerificationToken. La première migration reste inchangée.

Session : id UUID, userId UUID, refreshTokenHash SHA-256 unique, expiresAt,
revokedAt nullable, createdAt, updatedAt. Index userId/revokedAt et expiresAt.
SessionRefreshToken : tokenHash SHA-256 primaire, sessionId UUID, consumedAt ;
index sessionId pour l'historique et la détection de réutilisation.

Les relations User → Session → empreintes consommées utilisent une cascade
limitée aux données d'authentification devenues inutiles avec le compte/session.
Aucun historique CRM n'est concerné. Le guard exige simultanément sid et sub,
session active et email vérifié. Les empreintes consommées sont conservées
pour détecter tout rejeu jusqu'à suppression de la session ; aucun nettoyage
automatique destructif n'est introduit.

La rotation et le logout utilisent le même verrou de ligne Session. Le résultat
« réutilisation » est renvoyé après commit de la révocation ; lever une exception
dans la transaction annulerait cette protection. Voir l'ADR 0002.

## Profil et récupération — CAND-008

`20261104000100_user_preferences_password_reset` ajoute :

- UserPreference, clé primaire userId UUID et FK unique vers User, locale fr,
  timezone Africa/Abidjan, createdAt et updatedAt.
- PasswordResetToken, id UUID, userId UUID, empreinte SHA-256 unique, expiresAt,
  consumedAt nullable, createdAt ; index userId/consumedAt.
- Deux marqueurs User nullables pour la demande durable et son cooldown,
  avec index sur passwordResetRequestedAt.

La migration initialise les préférences des comptes déjà présents via INSERT
avec ON CONFLICT DO NOTHING. Elle ne réécrit aucun profil, hash, email, session
ou token existant. Les migrations CAND-006/007 restent inchangées. Les nouvelles
relations utilisent une cascade limitée aux préférences/tokens privés devenus
inutiles après suppression du compte, sans historique CRM.

Vérification locale : appliquer d'abord les deux migrations précédentes à une
base dédiée vide, créer un compte fictif, appliquer CAND-008, puis constater que
prénom/hash sont préservés et que les préférences fr/Africa/Abidjan existent.
Le compte de vérification a ensuite été retiré, sans reset ni purge globale.
