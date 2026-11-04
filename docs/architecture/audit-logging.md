# Logs structurés et audit — CAND-010

## Journaux applicatifs et corrélation

Chaque entrée serveur est une ligne JSON : timestamp UTC ISO, level, service
candidly-api, module, event et requestId si une requête est active. http.completed
ajoute method, route template enregistré, statusCode et durationMs monotone.
http.error ajoute statut et corrélation, sans erreur brute. Les requêtes inconnues
utilisent route=unmatched, jamais le path/query fourni par le client.

StructuredLogger remplace le logger Nest du processus serveur. Ses arguments
arbitraires (message, objet, exception, stack, contexte inconnu) sont ignorés ;
il ne les sérialise pas. Les modules/événements et champs permis sont explicitement
listés. Les parsers, guards et filtre partagent le même request ID serveur ;
aucun identifiant client n'est repris. Une requête HTTP a au plus un log de fin,
avec un log d'erreur supplémentaire pour les 5xx. Les lectures ne créent aucun audit.

Aucun corps, Authorization, Cookie, Set-Cookie, email brut, IP, clé, token,
hash de mot de passe, chaîne de connexion ou stack dans ces logs. Les messages
framework textuels sont volontairement remplacés par framework.message + module/niveau.
Le démarrage échoué expose application.bootstrap_failed, sans exception brute.
La sortie JSON de maintenance est un résultat de commande (cutoff/compteurs),
pas un dump de données. Les tests peuvent désactiver le logger Nest ; les tests
dédiés vérifient le logger structuré et les sorties HTTP sans secrets.

Exemple synthétique :

```json
{
  "timestamp": "2026-11-04T00:00:00.000Z",
  "level": "info",
  "service": "candidly-api",
  "module": "Http",
  "event": "http.completed",
  "requestId": "e8147ea9-472f-4f86-a3b1-5b3054a30719",
  "statusCode": 200,
  "durationMs": 12.3,
  "method": "POST",
  "route": "/api/v1/auth/login"
}
```

## Modèle AuditLog

id UUID ; actorUserId nullable ; eventType limité par le code ; outcome enum
SUCCESS/FAILURE ; targetType USER/SESSION nullable ; targetId UUID nullable ;
requestId UUID nullable ; createdAt timestamptz UTC ; metadata JSON contrôlé.
Index actor/date, événement/date et requestId. La FK actorUserId utilise SET NULL
à la suppression du compte : le journal est conservé. targetId reste un UUID
historique sans FK ; ce n'est pas une anonymisation complète et la politique
juridique de rétention reste à valider. Aucune route de lecture/admin de l'audit.

Metadata accepte uniquement reason parmi invalid_credentials/refresh_reuse/
email_unverified et sessionsCount entier non négatif. Tout champ inconnu est
refusé, y compris email, password, token et détails d'exception. L'outcome est
calculé d'après le type d'événement, pas fourni librement. La validation précède
l'écriture, les valeurs invalides ne sont pas recopiées dans l'erreur.

## Événements effectivement branchés

| Événement        | Outcome | Moment / identité                                                                     |
| ---------------- | ------- | ------------------------------------------------------------------------------------- |
| REGISTER         | SUCCESS | Nouvelle inscription réellement créée ; acteur null, cible User                       |
| EMAIL_VERIFIED   | SUCCESS | Token accepté et compte vérifié ; acteur null, cible User                             |
| LOGIN            | SUCCESS | Session persistée ; acteur User, cible Session                                        |
| LOGIN_FAILURE    | FAILURE | DTO login valide mais identifiants/email non confirmé refusés ; anonyme, sans cible   |
| LOGOUT           | SUCCESS | Première révocation effective par cookie ; acteur User, cible Session                 |
| REFRESH_REUSE    | FAILURE | Empreinte consommée détectée ; acteur de la session, cible Session                    |
| PASSWORD_CHANGED | SUCCESS | Hash remplacé avec ancien password vérifié ; acteur/cible User                        |
| PASSWORD_RESET   | SUCCESS | Token reset consommé ; acteur null, cible User                                        |
| SESSIONS_REVOKED | SUCCESS | Avec logout/rejeu/email devenu non vérifié/changement/reset ; compteur de révocations |

Les doublons d'inscription gardent la réponse générique mais ne créent pas un
nouvel événement REGISTER. Logout absent/invalide/déjà révoqué reste 204 sans
volume inutile. Tous les échecs de login pertinents partagent exactement le même
type, reason et absence d'acteur/cible, quelle que soit l'existence du compte.
Les échecs de DTO, le rate limit et les lectures sont visibles dans les logs HTTP,
pas dans un audit par tentative sans borne. Rotation refresh normale non auditée
comme événement séparé pour limiter le volume ; le rejeu est audité.

## Atomicité et indisponibilité

Les succès et le rejeu critique sont écrits dans la **même transaction** que
leurs mutations métier : inscription, vérification, session créée, logout,
révocation, changement/reset. Échec audit : rollback complet, 500 normalisé et
log audit.unavailable corrélé. Pas de succès annoncé si l'audit critique manque.
Une collision de création utilisateur ne masque pas une erreur d'audit survenue
après création. Les hash, tokens et sessions restent cohérents après rollback.

Les échecs de login utilisent une écriture séparée best effort. Une panne d'audit
conserve le même 401 générique, émet audit.unavailable sans exception brute et
peut perdre cet événement. Si la base elle-même est indisponible avant vérification
des identifiants, le traitement échoue comme dépendance, sans simuler un login valide.
Pas de queue/retry hors transaction ni promesse exactement une fois. Un client
qui ne reçoit pas la réponse après commit peut réessayer et produire un autre
événement métier ; les idempotences de tokens/logout existantes restent actives.

La FK audit vers User implique un ordre de verrouillage commun User → Session,
y compris refresh/logout, pour éviter une inversion avec changement/reset lors
de l'insertion d'audit. Les tokens restent verrouillés après User comme auparavant.
Cet ordre est testé par les scénarios concurrents existants, sans changer les seuils.

Aucun audit n'est supprimé par la maintenance. L'échec de journaux secondaires
stdout n'est pas transformé en mutation métier partielle ; l'absence de collecte
externe fiable reste un risque d'exploitation. Avant production, prévoir droits
DB minimaux, export/collecte, alertes, surveillance du volume et sauvegardes vérifiées.
