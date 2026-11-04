# Audit des dépendances — CAND-010, 2026-11-04

Commandes réellement exécutées : `npm audit --json` et `npm audit --omit=dev --json`.
Audit complet : **12 alertes modérées**, aucune haute/critique. Production : **0**.
Il s'agit de l'instantané du registre, pas d'une certification. Les sorties brutes
sont temporaires ; cette synthèse ne contient aucun secret ou identifiant de registre.

## Cause et exposition

Les 12 entrées sont liées à la même chaîne de métavulnérabilités de l'outillage,
pas 12 failles indépendantes. minimatch 10.2.6 est installé par Nest CLI 12.0.11,
ESLint 10.14.0/config-array et typescript-eslint 8.72.1. Il n'est pas dans le
runtime de production installé avec omit=dev. Aucune entrée HTTP n'est transmise
par ce backend à minimatch. L'exposition reste les motifs/globs de fichiers de
l'outillage et du code/contenu non fiable analysé en développement/CI ; protéger
les runners et ne pas exécuter des configurations non fiables avec des secrets.

[GHSA-g3hv-75wg-m249 / CVE-2026-118764](https://github.com/advisories/GHSA-g3hv-75wg-m249)
décrit une amplification de motifs glob avec optimizationLevel >= 2 dans la
version analysée, pouvant consommer CPU/mémoire. Le registre signale les versions
<11.0.1 ; la version corrigée annoncée est **11.0.1**. Les plages des parents
installés utilisent la génération 10 ; forcer 11 par override serait un changement
majeur transitive non vérifié. Aucun override ou audit fix n'est appliqué.

## Entrées installées concernées

| Dépendance                             | Version verrouillée | Sévérité npm |
| -------------------------------------- | ------------------- | ------------ |
| `@eslint-community/eslint-utils`       | `4.10.1`            | moderate     |
| `@eslint/config-array`                 | `0.23.5`            | moderate     |
| `@eslint/js`                           | `10.0.1`            | moderate     |
| `@nestjs/cli`                          | `12.0.11`           | moderate     |
| `@typescript-eslint/eslint-plugin`     | `8.72.1`            | moderate     |
| `@typescript-eslint/parser`            | `8.72.1`            | moderate     |
| `@typescript-eslint/type-utils`        | `8.72.1`            | moderate     |
| `@typescript-eslint/typescript-estree` | `8.72.1`            | moderate     |
| `@typescript-eslint/utils`             | `8.72.1`            | moderate     |
| `eslint`                               | `10.14.0`           | moderate     |
| `minimatch`                            | `10.2.6`            | moderate     |
| `typescript-eslint`                    | `8.72.1`            | moderate     |

## Correctifs et limites

Privilégier une future version compatible des parents qui adopte le correctif,
ou une mise à niveau planifiée et explicitement validée avec lint/build/tests.
Les suggestions automatiques de npm incluent des rétrogradations non compatibles
avec la stack retenue (ESLint 4, Nest CLI 11, anciens typescript-eslint) ; elles
ne sont pas une solution appliquée ici. Le seul correctif minimatch annoncé
passe de la génération 10 à 11, hors autorisation de mise à jour majeure.

Aucune version de dépendance directe/transitive n'a changé dans CAND-010,
aucune nouvelle bibliothèque et aucun audit fix --force. Le nouveau script de
maintenance est le seul changement de package.json. Conserver la surveillance
et recontrôler les versions/correctifs avant production ; l'audit CI informatif
existant reste non bloquant, les validations de qualité restent bloquantes.
