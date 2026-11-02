# Conventions de développement

Lire [AGENTS.md](../../AGENTS.md) avant toute modification : ce fichier conserve
les règles permanentes du projet.

## Nommage

Le futur code sera écrit en TypeScript strict avec des identifiants anglais :
`camelCase` pour variables et fonctions, `PascalCase` pour classes, interfaces
et composants React, `UPPER_SNAKE_CASE` pour constantes globales et valeurs
d'énumération. Utiliser `kebab-case` pour les fichiers lorsque les conventions
du framework le permettent. Les messages utilisateur sont initialement en français.
Les fichiers utilisent UTF-8, LF et deux espaces d'indentation.

## Tickets et branches

Traiter un ticket à la fois : lire son périmètre, examiner l'existant, présenter
un bref plan, implémenter uniquement les changements nécessaires, vérifier puis
soumettre à validation. Préserver les modifications existantes. Ne pas commencer
le ticket suivant avant validation.

`main` doit rester stable. Créer les branches de travail depuis `main` :

- `feature/CAND-XXX-description` pour les évolutions.
- `fix/CAND-XXX-description` pour les corrections.

Les deux dépôts ont des historiques indépendants. Un ticket transversal doit
identifier les changements et revues nécessaires dans chacun.

## Commits

Utiliser Conventional Commits, avec des messages explicites :

```text
feat: add application management
fix: prevent unauthorized document access
docs: initialize project documentation
chore: configure repository
test: add ownership validation tests
```

## Revue et validation

Présenter une demande de revue liée au ticket : problème traité, changements,
commandes réellement exécutées et résultats, impacts de sécurité, décisions et
limitations. Le reviewer vérifie le périmètre, les conventions, la documentation,
l'absence de secrets et, lorsque pertinent, les autorisations et l'isolation
des données. Corriger les observations avant intégration à `main`.

Pour CAND-001, contrôler les fichiers attendus, les règles d'exclusion, la cohérence
des configurations, puis exécuter `git status` et `git diff --check` dans chaque
dépôt. Les nouveaux fichiers non suivis doivent aussi être inspectés :
`git diff --check` seul ne les vérifie pas.

Les scripts npm de lint, typecheck, test et build n'existent pas encore : ne pas
les exécuter ni annoncer leur réussite. Après l'initialisation des applications,
exécuter les scripts disponibles et les tests pertinents, y compris les contrôles
d'autorisation et d'isolation pour toute fonctionnalité concernée.

## Configuration et sécurité

Node.js 24 LTS est la ligne commune déclarée dans `.nvmrc`. Avec nvm disponible,
`nvm install` puis `nvm use` sélectionnent la dernière version corrective 24.x.
Vérifier les versions exactes des frameworks et leur compatibilité lors de leur
installation dans les tickets suivants.

`.env.example` contient uniquement des exemples locaux. Les fichiers `.env` et
leurs variantes sont ignorés ; ne jamais y substituer des secrets dans le fichier
exemple. Les variables publiques du frontend sont visibles dans le navigateur.
Les variables d'authentification, stockage et intégrations seront définies dans
leurs tickets respectifs.

Aucun distant, protection GitHub ou pipeline n'est configuré par CAND-001.
Leur mise en place sera traitée séparément ; tout push exige une autorisation
explicite. Ne pas déployer ni exécuter de migration en production sans autorisation.
