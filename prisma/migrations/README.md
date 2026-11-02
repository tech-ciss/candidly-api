# Migrations

Le schéma initial ne contient aucun modèle métier. Ne pas ajouter de migration
vide, de table fictive ou de DDL sans besoin technique. La première migration
utile sera créée avec le premier changement réel du schéma :
`npm run prisma:migrate:dev -- --name description` sur une base locale dédiée.
Les migrations SQL futures doivent être suivies par Git.

Vérification CAND-003 avec Prisma 7.10.1 :
`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
renvoie `-- This is an empty migration.` Le client est néanmoins générable
sans modèle ; cette limitation concerne seulement la migration initiale utile.
