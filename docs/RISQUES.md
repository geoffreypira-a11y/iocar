# Risques réels — une page

*10 septembre 2026. Volontairement court : les trois audits détaillés sont à
côté. Celui-ci répond à une seule question — **qu'est-ce qui peut nuire à un
abonné en production aujourd'hui ?***

Contexte : **un abonné réel**, qui vend des véhicules, facture, encaisse et
transmet. Aucun avoir émis à ce jour.

---

## Ce que fait l'abonné, tous les jours

```
véhicule → livre de police → bon de commande → facture → encaissement
                                                  ↓
                                          IO BILL → Factur-X → PDP
```

C'est ce chemin qu'il faut regarder en priorité. Le reste est du code qui existe
mais que personne n'emprunte encore.

---

## Risques classés

| | Risque | Impact réel | Probabilité | État |
|---|---|---|---|---|
| 1 | **Premier avoir réel** — transmission jamais éprouvée | Avoir non transmis à l'administration | Certaine le jour où il en fait un | ⚠️ à surveiller |
| 2 | **Adresse de livraison** (mention 2026) | Non-conformité si l'obligation s'applique | Inconnue — question ouverte | ⚠️ avis comptable |
| 3 | Chaîne de hachage sur documents insérés en statut final | Inaltérabilité incomplète | Était certaine sur les avoirs | ✅ corrigé (migration) |
| 4 | Écart d'un centime HT/TVA entre les deux documents | Facture ≠ déclaration | Était 6,7 % des ventes | ✅ corrigé |
| 5 | Avoir ne réduisant ni TVA ni CA | TVA payée sur une vente annulée | Était certaine | ✅ corrigé |
| 6 | IO BILL indisponible au moment d'un push | Aucun — voir ci-dessous | Occasionnelle | ✅ couvert |
| 7 | Plusieurs avoirs sur une même facture | Reprise de marge fausse | Impossible aujourd'hui (bridé) | ✅ bridé |
| 8 | Suppression d'une facture | Rupture de numérotation | Bloquée hors mode admin | ✅ bridé |

---

## Zones ouvertes après coup

**Isolation entre garages — close, propre.** RLS active sur les 52 tables des
deux bases, au moins une politique sur chacune, et les règles filtrent bien par
`auth.uid()`. Une seule faiblesse, de portée intra-ticket : la politique
`ticket_messages_update_read` autorise l'abonné à modifier **n'importe quelle
colonne** d'un message de son propre ticket — la RLS travaille à la ligne, pas
à la colonne. Il pourrait réécrire une réponse de l'admin. Aucune fuite entre
garages. Correctif en deux lignes de privilèges (`GRANT UPDATE (read_at)`), la
seule colonne que le code met à jour.

**Encaissements — justes.** Vérifié sur 864 combinaisons (acompte, reprise,
paiements multiples, débours) : IO CAR et IO BILL comptent le **même encaissé**,
zéro écart. La reprise est bien portée en règlement et non en réduction de prix.

Un seul défaut, de libellé mais sur un document client : la facture portait
« Valeur de reprise **déduite du total** » dans son bloc reprise, alors que le
bloc des totaux du même document porte « Reprise véhicule (règlement en
nature) » **après** le TOTAL TTC. Depuis la v8.154 la reprise n'est pas une
réduction de prix — la base imposable reste le prix entier (art. 266-1-a du
CGI). Écrire « déduite du total » laissait entendre une TVA calculée sur un
prix diminué. Corrigé des deux côtés, document et champ de saisie.

## Ce qui est solide, et mérite d'être dit

**La facture ordinaire.** Le chemin réellement emprunté est ressorti de l'audit
avec trois points seulement, tous corrigés ou documentés. Pour une application
de facturation électronique française, c'est un bon résultat.

**La résilience du pont.** Le document est écrit dans la base IO CAR **avant**
tout appel à IO BILL. Si IO BILL est indisponible, l'abonné garde sa facture,
voit une pastille d'erreur portant le message exact, et relance d'un clic
(`smartPush`). Rien ne se perd, rien ne se duplique — les push sont idempotents
par `external_id`.

**Les points fiscaux difficiles sont traités**, et peu d'outils les traitent :
le régime de la marge codé en `VATEX-EU-F` dans le Factur-X, les débours hors
base TVA, la reprise portée en règlement en nature plutôt qu'en ligne négative,
la TVA sur marge déclarée séparément puisque non transmise par la PDP.

**L'intégrité est outillée** : numérotation par séries, immuabilité après
émission, anti-dépassement du total des avoirs, chaîne de hachage.

---

## Les trois choses à faire, dans l'ordre

1. **Exécuter `sql/2026-09-10-chaine-hash-insert.sql`** (dépôt IO BILL), puis
   merger et déployer.
2. **Faire un avoir réel de bout en bout** — c'est le seul test qui reste, et il
   ne peut pas être fait ailleurs qu'en production. Vérifier trois choses : il
   arrive dans IO BILL, la TVA du mois baisse, la transmission PDP aboutit.
3. **Montrer une facture et un avoir imprimés à un expert-comptable.** Dix
   minutes, et un avis qui engage quelqu'un dont c'est le métier — notamment sur
   l'adresse de livraison (risque n° 2).

---

## Quand arrêter d'auditer

Maintenant. Les zones sont énumérées et couvertes : calcul, base taxable,
mentions, transmission, intégrité, cohérence des deux applications. La dernière
passe complète n'a rendu qu'un point, dans la dernière zone inexplorée.

Ce qui reste ne se trouve pas en relisant du code : cela se trouve **en
l'utilisant**. Le meilleur investissement n'est plus un audit, c'est le premier
avoir réel et l'avis d'un comptable.
