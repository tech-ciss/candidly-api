# ADR 0001 — Reprise durable des demandes de vérification

Statut : retenu pour CAND-006, 2026-11-03.

## Contexte

L'inscription doit résister à une panne email, sans token brut en base et sans
fournisseur ou infrastructure supplémentaire. PostgreSQL est la source de vérité.

## Décision

Persister une demande de vérification sur User dans la même écriture que le
compte. Un traitement borné dans le processus NestJS prépare un nouveau token
à chaque tentative et conserve uniquement son empreinte. Le même verrou User
sérialise envoi et vérification. L'échec du transport annule la transaction et
conserve la demande. Le redémarrage reprend les demandes persistantes.

## Options et conséquences

Un simple appel email après création peut perdre une demande lors d'un arrêt.
Une outbox contenant le lien en clair violerait la règle de stockage des tokens.
Une outbox chiffrée, BullMQ et la gestion de clés ajouteraient une complexité
inutile au transport local de ce ticket. Le marqueur est une spécialisation
minimale de demande durable, sans bus d'événements ni microservice.

L'atomicité base/transport externe n'est pas garantie : des messages invalides
ou multiples sont possibles lors d'un arrêt entre écriture et commit, mais la
demande reste récupérable. Le token est à usage unique et l'état utilisateur
reste cohérent. Le transport local ne délivre aucun email ; sa consultation
est réservée au développement. Un futur fournisseur devra réévaluer les retries,
les timeouts et l'idempotence. Voir les limites dans l'architecture auth.
