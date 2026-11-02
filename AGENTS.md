# AGENTS.md — CANDIDLY

## 1. IDENTITÉ DU PROJET

**Nom :** Candidly  
**Slogan :** Chaque candidature compte.  
**Type :** SaaS — Personal Career CRM  
**Marché initial :** Côte d'Ivoire  
**Ambition :** Plateforme internationale de gestion de carrière  
**Langue initiale :** Français

### 1.1 Vision

Candidly est une plateforme SaaS permettant aux chercheurs d'emploi d'organiser, suivre et optimiser leurs démarches professionnelles.

Candidly n'est pas uniquement un outil de suivi des candidatures.

C'est un **CRM personnel de relations professionnelles**, conçu pour accompagner l'utilisateur depuis l'identification d'une entreprise jusqu'à la décision finale concernant sa candidature.

### 1.2 Objectifs du produit

Permettre aux utilisateurs de :

- Centraliser leurs entreprises cibles.
- Gérer leurs contacts RH et professionnels.
- Suivre leurs candidatures spontanées et leurs réponses aux offres.
- Conserver un historique des interactions.
- Planifier leurs relances.
- Organiser leurs entretiens.
- Gérer leurs documents professionnels.
- Visualiser leur progression grâce à des statistiques.
- Réduire les oublis et améliorer leur organisation.

### 1.3 Public cible

Candidly s'adresse notamment :

- Aux étudiants.
- Aux jeunes diplômés.
- Aux chercheurs d'emploi.
- Aux professionnels en reconversion.
- Aux salariés recherchant de nouvelles opportunités.
- Aux professionnels expérimentés.

Le produit doit rester simple pour un utilisateur débutant, tout en offrant une organisation suffisamment structurée pour des utilisateurs avancés.

---

# 2. PÉRIMÈTRE DU PRODUIT

## 2.1 Phase 1 — Personal CRM (MVP)

La première version comprend :

1. Authentification et gestion du compte.
2. Tableau de bord personnel.
3. Gestion des entreprises.
4. Gestion des contacts professionnels.
5. Gestion des candidatures.
6. Historique des interactions.
7. Gestion des tâches et relances.
8. Calendrier.
9. Gestion des documents.
10. Importation CSV.
11. Statistiques.
12. Abonnements Freemium.
13. Administration minimale.
14. Application web responsive et PWA.

## 2.2 Phase 2 — Smart Career CRM

Évolutions futures :

- Suggestions intelligentes de relances.
- Assistance IA à la rédaction.
- Analyse des candidatures.
- Scoring et recommandations.
- Automatisations avancées.

Ces fonctionnalités ne doivent pas être développées pendant la Phase 1 sans instruction explicite.

## 2.3 Phase 3 — Career Management Platform

Évolutions possibles :

- Gestion complète de carrière.
- Portfolio professionnel.
- Outils avancés de progression professionnelle.
- Intégrations externes.
- Statistiques avancées.

Ces fonctionnalités sont hors périmètre du MVP.

---

# 3. ARCHITECTURE TECHNIQUE

## 3.1 Architecture générale

Candidly repose sur deux applications distinctes :

```text
                 UTILISATEUR
                      |
                      v
             CANDIDLY WEB / PWA
                      |
                      v
                 REST API
                      |
                      v
               CANDIDLY API
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
      PostgreSQL    Redis     Object Storage
```

L'architecture backend est un **monolithe modulaire**.

Ne pas introduire de microservices sans décision architecturale explicite.

## 3.2 Dépôts Git

Deux dépôts indépendants :

```text
candidly-web
candidly-api
```

Chaque dépôt possède :

- Son propre `package.json`.
- Ses dépendances.
- Ses variables d'environnement.
- Ses scripts.
- Son pipeline CI/CD.
- Sa documentation.
- Son fichier `AGENTS.md`.

Ne pas fusionner les deux dépôts.

Ne pas créer de monorepo sans autorisation explicite.

## 3.3 Stack frontend

Technologies retenues :

- Next.js avec App Router.
- React.
- TypeScript.
- Tailwind CSS.
- shadcn/ui.
- React Hook Form.
- Zod.
- PWA.

Le frontend communique avec le backend exclusivement par l'API REST.

Il ne doit jamais accéder directement à PostgreSQL.

## 3.4 Stack backend

Technologies retenues :

- Node.js.
- NestJS.
- TypeScript.
- PostgreSQL.
- Prisma ORM.
- Redis.
- BullMQ.
- Swagger / OpenAPI.
- JWT.
- Argon2id.

## 3.5 Infrastructure

Architecture cible :

- Docker.
- Docker Compose pour le développement.
- Nginx.
- HTTPS.
- PostgreSQL.
- Redis.
- Stockage objet compatible S3.
- GitHub Actions.

Les environnements doivent être séparés :

```text
development
staging
production
```

Ne jamais utiliser une base de données de production pour les tests.

---

# 4. ORGANISATION DU FRONTEND

Structure cible :

```text
src/
├── app/
│   ├── (public)/
│   ├── (auth)/
│   └── (dashboard)/
│
├── components/
│   ├── ui/
│   ├── layout/
│   ├── forms/
│   └── shared/
│
├── features/
│   ├── auth/
│   ├── applications/
│   ├── companies/
│   ├── contacts/
│   ├── actions/
│   ├── documents/
│   └── dashboard/
│
├── hooks/
├── lib/
│   ├── api/
│   ├── auth/
│   ├── validations/
│   └── utils/
│
└── types/
```

Cette structure représente la cible architecturale.

Ne pas créer tous les dossiers artificiellement dès le premier ticket.

Créer les modules progressivement selon les besoins.

## 4.1 Règles frontend

- Utiliser TypeScript strict.
- Éviter `any`.
- Favoriser les composants réutilisables.
- Séparer la logique métier de la présentation.
- Centraliser les appels API.
- Centraliser les schémas de validation.
- Prévoir les états `loading`, `empty`, `error` et `success`.
- Respecter l'accessibilité.
- Prévoir les interfaces responsive.
- Éviter les dépendances inutiles.
- Ne pas exposer de secrets côté client.

## 4.2 Règles PWA

La PWA doit permettre l'installation sur les appareils compatibles.

Cependant :

- Ne pas mettre en cache les tokens.
- Ne pas mettre en cache les réponses API privées.
- Ne pas stocker les données sensibles dans le service worker.
- Ne pas promettre de fonctionnalités hors ligne non implémentées.
- Limiter initialement le cache aux ressources statiques et publiques.

---

# 5. ORGANISATION DU BACKEND

Structure cible :

```text
src/
├── common/
├── config/
├── database/
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── companies/
│   ├── contacts/
│   ├── applications/
│   ├── interactions/
│   ├── actions/
│   ├── calendar/
│   ├── documents/
│   ├── imports/
│   ├── dashboard/
│   ├── analytics/
│   ├── notifications/
│   ├── billing/
│   ├── admin/
│   └── audit/
│
├── integrations/
│   ├── email/
│   ├── storage/
│   └── payments/
│
└── workers/
    ├── notifications/
    └── imports/
```

Chaque module métier doit respecter une séparation claire des responsabilités.

Exemple :

```text
applications/
├── dto/
├── applications.controller.ts
├── applications.service.ts
├── applications.repository.ts
└── applications.module.ts
```

La structure exacte peut évoluer si cela apporte une amélioration justifiée.

## 5.1 Règles backend

- Les contrôleurs gèrent les entrées HTTP.
- Les services portent la logique métier.
- Les repositories encapsulent les accès complexes aux données.
- Les DTO valident les entrées.
- Les guards protègent les ressources.
- Les erreurs doivent être explicites.
- Les opérations critiques doivent être transactionnelles.
- Les requêtes doivent être paginées lorsque nécessaire.
- Les ressources privées doivent être filtrées par propriétaire.

Ne pas placer de logique métier importante directement dans les contrôleurs.

---

# 6. CONVENTIONS DE DÉVELOPPEMENT

## 6.1 Langage

Tout le code est écrit en TypeScript.

Les identifiants techniques utilisent l'anglais :

```typescript
applicationStatus
companyId
contactId
createdAt
updatedAt
```

Les commentaires peuvent être rédigés en français ou en anglais, mais doivent rester cohérents et utiles.

Les messages destinés aux utilisateurs sont initialement en français.

## 6.2 Nommage

Utiliser :

- `camelCase` pour les variables et fonctions.
- `PascalCase` pour les classes, interfaces et composants React.
- `UPPER_SNAKE_CASE` pour les constantes globales et valeurs d'énumération.
- `kebab-case` pour les noms de fichiers lorsque cela correspond aux conventions du framework.

Respecter les conventions officielles de NestJS, Next.js et Prisma.

## 6.3 Qualité

Le code doit être :

- Lisible.
- Maintenable.
- Typé.
- Modulaire.
- Testable.
- Documenté lorsque nécessaire.

Éviter :

- Les fonctions inutilement longues.
- La duplication de logique métier.
- Les abstractions prématurées.
- Les dépendances non justifiées.
- Les valeurs codées en dur qui devraient être configurables.

---

# 7. MODÈLE MÉTIER

## 7.1 Entités principales

Le domaine comprend notamment :

```text
User
UserPreference
Session
Company
Contact
Application
ApplicationContact
ApplicationStatusHistory
Interaction
ActionItem
CalendarEvent
Document
DocumentVersion
ApplicationDocument
ImportJob
NotificationPreference
Plan
Subscription
AuditLog
```

Ces entités constituent une cible fonctionnelle.

Ne pas créer l'intégralité du schéma avant le ticket correspondant.

## 7.2 Relations fondamentales

Un utilisateur possède ses propres données.

Une entreprise peut avoir :

- Plusieurs contacts.
- Plusieurs candidatures.

Une candidature :

- Appartient à un utilisateur.
- Est associée à une entreprise.
- Peut avoir plusieurs contacts.
- Possède un statut.
- Peut avoir plusieurs interactions.
- Peut avoir plusieurs actions.
- Conserve son historique.

Un contact appartient à une entreprise du portefeuille de l'utilisateur.

Une même entreprise peut recevoir plusieurs candidatures du même utilisateur.

## 7.3 Statuts des candidatures

Statuts prévus :

```text
DRAFT
READY
SENT
WAITING
INTERVIEW
OFFER_RECEIVED
ACCEPTED
REJECTED
NO_RESPONSE
WITHDRAWN
```

Correspondances françaises :

```text
DRAFT          → À préparer
READY          → Prête
SENT           → Envoyée
WAITING        → En attente
INTERVIEW      → Entretien
OFFER_RECEIVED → Offre reçue
ACCEPTED       → Acceptée
REJECTED       → Refusée
NO_RESPONSE    → Sans réponse
WITHDRAWN      → Retirée
```

Les changements de statut doivent être historisés.

Ne jamais modifier silencieusement l'historique.

Le statut `NO_RESPONSE` ne doit pas être appliqué automatiquement dans le MVP.

## 7.4 Statut et prochaine action

Le statut d'une candidature est distinct de sa prochaine action.

Exemple :

```text
Statut : En attente

Prochaine action :
Relancer le recruteur le 09/11/2026
```

Ne pas fusionner ces deux concepts.

## 7.5 Historique des interactions

Les interactions peuvent représenter :

- Un email envoyé.
- Un email reçu.
- Un appel.
- Un message LinkedIn.
- Un message WhatsApp.
- Un entretien.
- Une rencontre.
- Une note personnelle.

Les interactions doivent être horodatées.

Il faut distinguer les événements créés manuellement des événements générés par le système.

---

# 8. SÉCURITÉ ET ISOLATION DES DONNÉES

La sécurité est une priorité absolue.

Candidly est un SaaS multi-utilisateur.

Chaque utilisateur doit accéder exclusivement à ses propres données.

## 8.1 Ownership

Toutes les ressources privées doivent être protégées par des vérifications d'appartenance.

Exemple :

```typescript
const application = await prisma.application.findFirst({
  where: {
    id: applicationId,
    userId: authenticatedUserId,
  },
});
```

Ne jamais faire confiance à un `userId` fourni par le frontend pour déterminer le propriétaire d'une ressource.

L'identité du propriétaire doit provenir du contexte d'authentification validé par le backend.

## 8.2 Vérification des relations

Lorsqu'une candidature est associée à un contact, vérifier :

1. Que la candidature appartient à l'utilisateur.
2. Que le contact appartient à l'utilisateur.
3. Que le contact appartient à l'entreprise concernée.

Ne jamais supposer que deux identifiants fournis par le frontend sont compatibles.

## 8.3 Authentification

Règles :

- Hash des mots de passe avec Argon2id.
- Access token JWT de courte durée.
- Refresh token renouvelable par rotation.
- Révocation des sessions.
- Refresh token transmis via cookie sécurisé `HttpOnly`.
- Access token conservé en mémoire côté frontend.
- Ne pas stocker les tokens dans `localStorage`.

Les modalités exactes de gestion des cookies, du CSRF et des domaines doivent être définies avant l'implémentation de l'authentification.

## 8.4 Protection API

Prévoir :

- Validation systématique des DTO.
- Rate limiting.
- CORS restrictif.
- En-têtes HTTP de sécurité.
- Gestion centralisée des erreurs.
- Journalisation des événements sensibles.
- Protection contre les accès inter-utilisateurs.

Ne jamais exposer les mots de passe, tokens ou secrets dans les logs.

## 8.5 Données sensibles

Interdictions :

- Commit de fichiers `.env` réels.
- Commit de clés API.
- Commit de secrets JWT.
- Commit de mots de passe.
- Commit de données personnelles réelles.
- Utilisation de données de production dans les tests.

Utiliser des données fictives pour les fixtures et seeds.

---

# 9. BASE DE DONNÉES ET PRISMA

## 9.1 Base de données

SGBD : PostgreSQL.

ORM : Prisma.

## 9.2 Règles de migration

Toute modification du schéma doit être accompagnée d'une migration adaptée.

Les migrations doivent être :

- Traçables.
- Reproductibles.
- Vérifiables.
- Compatibles avec les données existantes lorsque nécessaire.

Ne jamais utiliser une commande de réinitialisation destructrice sur une base partagée ou de production.

Interdiction sans autorisation explicite :

```bash
prisma migrate reset
```

sur toute base contenant des données à conserver.

Ne pas utiliser `prisma db push` comme mécanisme de déploiement du schéma en production.

Les migrations de production nécessitent une sauvegarde préalable vérifiée et une autorisation explicite.

## 9.3 Intégrité

Utiliser les contraintes adaptées :

- Clés étrangères.
- Unicité.
- Index.
- Contraintes métier.
- Transactions.

Les suppressions en cascade doivent être justifiées.

Ne jamais supprimer silencieusement l'historique d'une candidature lors de la suppression d'une entreprise.

Préférer l'archivage lorsque la conservation de l'historique est nécessaire.

---

# 10. API REST

## 10.1 Versionnement

Préfixe API :

```text
/api/v1
```

## 10.2 Documentation

Les endpoints doivent être documentés avec Swagger/OpenAPI.

## 10.3 Réponses

Adopter une convention cohérente pour :

- Les réponses réussies.
- Les erreurs.
- La pagination.
- Les filtres.
- Le tri.

Éviter les formats de réponse différents entre modules sans justification.

## 10.4 Validation

Les données entrantes doivent être validées côté backend.

La validation frontend améliore l'expérience utilisateur, mais ne remplace jamais la validation serveur.

---

# 11. DOCUMENTS ET FICHIERS

Les documents professionnels peuvent inclure :

- CV.
- Lettres de motivation.
- Portfolio.
- Autres documents liés aux candidatures.

## 11.1 Stockage

Utiliser un stockage objet privé compatible S3.

Ne pas rendre les documents accessibles publiquement.

Prévoir des URLs signées de durée limitée pour les téléchargements autorisés.

## 11.2 Versionnement

Les documents doivent préserver les versions utilisées pour les candidatures.

Exemple :

```text
CV — Version 1
    |
    +-- Candidature A

CV — Version 2
    |
    +-- Candidature B
```

La création d'une nouvelle version ne doit pas modifier le document historiquement associé à une candidature précédente.

Ne pas remplacer silencieusement un fichier déjà utilisé.

---

# 12. RELANCES ET NOTIFICATIONS

## 12.1 Principe

Candidly rappelle à l'utilisateur ses actions professionnelles.

Dans le MVP, Candidly n'envoie pas automatiquement de messages aux recruteurs.

## 12.2 Traitements asynchrones

Utiliser :

- Redis.
- BullMQ.

Pour les traitements appropriés :

- Rappels.
- Notifications.
- Emails transactionnels.
- Imports CSV.

## 12.3 Fiabilité

Les traitements doivent être conçus pour :

- Éviter les doublons.
- Supporter les tentatives de reprise.
- Gérer les échecs.
- Être idempotents lorsque nécessaire.
- Reprendre correctement après un redémarrage.

PostgreSQL reste la source de vérité métier.

Avant d'envoyer un rappel, vérifier que l'action existe toujours et qu'elle nécessite encore une notification.

## 12.4 Dates

Stocker les instants en UTC.

Afficher les dates et heures selon le fuseau horaire de l'utilisateur.

---

# 13. FREEMIUM ET ABONNEMENTS

Candidly adopte un modèle SaaS Freemium.

Le système devra permettre :

- Un plan gratuit.
- Des plans payants.
- Des limites configurables.
- La gestion des abonnements.
- L'évolution des offres.

## 13.1 Règles

Les limites doivent être appliquées côté backend.

Un dépassement de quota ne doit jamais entraîner la suppression automatique des données existantes.

## 13.2 Décisions non finalisées

Les éléments suivants restent à valider :

- Prix définitifs.
- Quotas.
- Prestataire de paiement.
- Modalités d'essai.
- Politique de renouvellement.
- Politique de conservation des données.

Ne pas inventer ces décisions.

Ne pas intégrer un prestataire de paiement sans validation explicite.

---

# 14. DESIGN SYSTEM ET UX

## 14.1 Identité visuelle

Palette initiale :

```text
Primary Navy:  #172554
Primary Blue:  #3B82F6
Success Green: #10B981
Background:    #F8FAFC
```

Typographie principale :

```text
Inter
```

## 14.2 Principes UX

L'interface doit être :

- Professionnelle.
- Moderne.
- Accessible.
- Simple à comprendre.
- Rapide.
- Responsive.
- Cohérente.

Le produit doit conserver une logique CRM sans devenir complexe à utiliser.

## 14.3 États d'interface

Prévoir systématiquement :

```text
Loading
Empty
Error
Success
```

Les erreurs doivent être compréhensibles par l'utilisateur.

Éviter les messages techniques bruts dans l'interface.

---

# 15. TESTS ET VALIDATION

## 15.1 Principe

Chaque fonctionnalité doit être vérifiée avant d'être considérée comme terminée.

## 15.2 Tests backend

Prévoir :

- Tests unitaires.
- Tests d'intégration.
- Tests des règles métier.
- Tests de validation.
- Tests d'autorisation.
- Tests d'isolation des données.

## 15.3 Tests frontend

Prévoir :

- Tests des composants critiques.
- Tests des formulaires.
- Tests des états d'interface.
- Tests des parcours utilisateur importants.

## 15.4 Tests de sécurité prioritaires

Tester notamment :

- L'accès à une candidature appartenant à un autre utilisateur.
- L'accès à une entreprise appartenant à un autre utilisateur.
- L'association d'un contact non autorisé.
- Le téléchargement d'un document privé.
- La modification d'une ressource sans autorisation.
- L'utilisation d'une session révoquée.

## 15.5 Commandes de validation

Lorsque les scripts correspondants existent, exécuter :

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Ne pas inventer un résultat de test.

Si une commande n'existe pas encore, le signaler explicitement.

Si une commande échoue, communiquer l'erreur et sa cause probable.

Ne jamais présenter une implémentation non vérifiée comme entièrement validée.

---

# 16. GIT ET GESTION DES MODIFICATIONS

## 16.1 Règles générales

- Respecter les modifications existantes.
- Ne pas écraser le travail d'un autre développeur.
- Ne pas modifier des fichiers hors périmètre sans justification.
- Ne pas effectuer de refactoring massif non demandé.
- Ne pas ajouter de dépendance sans expliquer son utilité.
- Ne pas supprimer de fichiers sans vérifier leur rôle.
- Ne pas modifier l'architecture sans autorisation.

## 16.2 Commits

Utiliser des messages explicites.

Convention recommandée :

```text
feat: add company creation endpoint
fix: prevent cross-user application access
refactor: simplify application service
test: add application ownership tests
docs: update API documentation
chore: configure eslint
```

## 16.3 Déploiement

Ne jamais :

- Déployer en production sans autorisation.
- Exécuter une migration de production sans autorisation.
- Modifier les secrets de production.
- Supprimer des données de production.
- Désactiver des contrôles de sécurité pour contourner une erreur.

---

# 17. MÉTHODE DE TRAVAIL AVEC CODEX

Candidly est développé progressivement à travers des tickets d'implémentation.

Chaque ticket définit un périmètre précis.

## 17.1 Avant de coder

Codex doit :

1. Lire ce fichier `AGENTS.md`.
2. Comprendre le ticket demandé.
3. Examiner les fichiers existants concernés.
4. Identifier les dépendances et contraintes.
5. Vérifier les conventions déjà utilisées.
6. Identifier les risques.
7. Présenter brièvement son plan d'implémentation.

Si une décision produit importante manque, demander une clarification au lieu d'inventer une règle métier.

## 17.2 Pendant l'implémentation

Codex doit :

- Respecter strictement le ticket.
- Modifier uniquement les fichiers nécessaires.
- Préserver les fonctionnalités existantes.
- Maintenir la compatibilité avec l'architecture.
- Ajouter les validations nécessaires.
- Respecter les règles de sécurité.
- Ajouter ou adapter les tests pertinents.

Ne pas développer une fonctionnalité future simplement parce qu'elle apparaît dans la vision produit.

## 17.3 Après l'implémentation

Codex doit fournir :

### A. Résumé

Expliquer ce qui a été réalisé.

### B. Fichiers

Lister les fichiers créés et modifiés.

### C. Validation

Indiquer les commandes réellement exécutées et leurs résultats.

### D. Sécurité

Signaler les contrôles de sécurité ajoutés ou modifiés.

### E. Limitations

Identifier les problèmes non résolus.

### F. Décisions

Signaler les décisions techniques prises et leur justification.

### G. Prochaine étape

Indiquer si le ticket est prêt pour validation.

Ne pas commencer automatiquement le ticket suivant.

---

# 18. GESTION DES DÉPENDANCES

Avant d'installer une bibliothèque :

1. Vérifier si le besoin est déjà couvert.
2. Vérifier sa compatibilité avec la stack.
3. Évaluer sa maintenance.
4. Évaluer son impact sur la sécurité.
5. Justifier son ajout.

Éviter les dépendances expérimentales lorsque des alternatives stables existent.

Ne pas mettre à jour massivement les dépendances dans un ticket sans rapport.

---

# 19. DÉCISIONS ARCHITECTURALES

Les décisions structurantes doivent être documentées.

Utiliser, lorsque nécessaire, des Architecture Decision Records :

```text
docs/adr/
```

Exemple :

```text
docs/adr/0001-use-prisma.md
```

Une décision architecturale importante doit expliquer :

- Le contexte.
- Les options envisagées.
- La décision retenue.
- Les conséquences.
- Les compromis.

---

# 20. FONCTIONNALITÉS EXPLICITEMENT HORS PÉRIMÈTRE DU MVP

Ne pas implémenter sans instruction explicite :

- Assistant IA.
- Scoring IA.
- Envoi automatique de candidatures.
- Envoi automatique de messages aux recruteurs.
- Synchronisation automatique Gmail ou Outlook.
- Application mobile native.
- Extension navigateur.
- Importation XLSX.
- Scraping de plateformes d'emploi.
- Microservices.
- Automatisations complexes.
- Fonctionnalités de carrière de Phase 3.

---

# 21. DEFINITION OF DONE

Un ticket est terminé uniquement si :

- [ ] Le périmètre demandé est respecté.
- [ ] Les critères d'acceptation sont satisfaits.
- [ ] Le code respecte les conventions.
- [ ] Les validations nécessaires sont présentes.
- [ ] Les règles de sécurité applicables sont respectées.
- [ ] Les tests pertinents sont ajoutés ou adaptés.
- [ ] Les vérifications disponibles ont été exécutées.
- [ ] Aucune régression connue n'est introduite.
- [ ] Aucun secret n'a été ajouté au dépôt.
- [ ] La documentation concernée est à jour.
- [ ] Les limitations éventuelles sont signalées.
- [ ] Le rapport final d'implémentation est fourni.

Si un critère ne peut pas être vérifié, le ticket doit être présenté comme partiellement validé, avec une explication.

---

# 22. RÈGLE FINALE

**La priorité de Candidly est de construire un produit fiable, sécurisé, maintenable et évolutif.**

La vitesse de développement ne doit pas compromettre :

1. La sécurité.
2. L'intégrité des données.
3. La cohérence métier.
4. La maintenabilité.
5. L'expérience utilisateur.

**Codex doit exécuter le ticket demandé, et uniquement ce ticket.**

Toute modification importante de l'architecture ou du périmètre doit être explicitement autorisée.

En cas de conflit entre ce fichier et un ticket, ne pas contourner silencieusement une règle de sécurité ou une décision architecturale : signaler le conflit et demander une clarification.

**Fin du fichier AGENTS.md — Candidly.**
