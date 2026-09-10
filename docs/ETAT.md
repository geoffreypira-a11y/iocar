# État des lieux — 10 septembre 2026

*Une page pour savoir où on en est, sans relire la conversation.*

---

## Les deux applications, les deux bases

Chaque application a **sa propre base Supabase**. Rien n'est partagé : elles
communiquent par le pont HTTP (`api/iobill-bridge.js` côté IO CAR).

| | **IO CAR** | **IO BILL** |
|---|---|---|
| Ce qu'elle fait | vend des véhicules | facture et déclare |
| Ses tables | `garages`, `vehicles`, `orders`, `clients`, `livre_police` | `invoices`, `credit_notes`, `purchases`, `vat_returns`, `companies`… |
| Ce qu'elle produit | le document remis au client, les CERFA, le livre de police | le Factur-X transmis à la PDP, la déclaration de TVA |

**Règle simple** : tout ce qui touche à la **facture, l'avoir, la TVA, les
achats** vit dans IO BILL. Tout ce qui touche au **véhicule, au registre, au
client du garage** vit dans IO CAR.

---

## Code — tout est déployé

| Dépôt | `main` | En attente |
|---|---|---|
| IO CAR | `d889936` | **rien** |
| IO BILL | `1286e4b` | **rien** |

---

## SQL — tout est passé

| Base | Migration | État |
|---|---|---|
| IO BILL | Avoirs : régime, marge, véhicule, mentions (9 colonnes) | ✅ |
| IO BILL | Rattrapage des 6 colonnes d'`invoices` non versionnées | ✅ |
| IO BILL | Chaîne de hachage étendue à l'INSERT | ✅ *(vérifié : `1,1,1,1`)* |
| IO BILL | Idempotence de l'inbox (`provider_message_id`) | ✅ |
| IO CAR | Purge du livre de police corrigée | ✅ |

**Aucun SQL en attente.**

---

## Ce qui a été audité, et ce qui a été trouvé

| Zone | Verdict |
|---|---|
| Facture — calcul et présentation | 5 propriétés vérifiées sur 2 824 380 ventes, 0 écart |
| Avoir — calcul, déclaration, transmission | 17 défauts, tous corrigés |
| Cohérence IO CAR ↔ IO BILL | 16/16 et 15/15 champs transmis et lus |
| Isolation entre garages | 52 tables, RLS partout, politiques correctes |
| Encaissements | 864 combinaisons, 0 écart entre les deux applications |
| CERFA | champs mesurés, aucun risque de troncature |
| Purge RGPD | 3 erreurs sur une opération irréversible, corrigées |
| Stripe | signature irréprochable, 2 défauts de cycle corrigés |
| Réception des achats | signature solide, rejeu fermé |

---

## Ce qui reste ouvert — et ce n'est pas du code

| | Sujet | Ce qu'il faut |
|---|---|---|
| 1 | **Premier avoir réel** | le faire, et vérifier trois choses : il arrive dans IO BILL, la TVA du mois baisse, la transmission PDP aboutit |
| 2 | **Adresse de livraison** (mention 2026) | avis d'un expert-comptable |
| 3 | `ticket_messages` modifiable colonne par colonne | 2 lignes de `GRANT`, gravité faible, intra-ticket |
| 4 | Politique de coupure Stripe | tranchée : coupure au 2ᵉ échec ✅ |

---

## Zones jamais ouvertes

Par ordre de risque, si l'envie revient un jour :

1. **Module cabinet** (`firm_*`, 12 tables) — un expert-comptable accède aux
   données d'un garage. Partage entre locataires : vérifier qu'un lien révoqué
   coupe vraiment l'accès.
2. **Sauvegardes** (`api/backup-cron.js`) — personne n'a vérifié qu'elles
   tournent ni qu'elles sont restaurables. Même profil que la purge RGPD : on
   le découvre quand il est trop tard.
3. **Exports comptables** — ce que l'abonné remet à son comptable.

Le reste (devis, Yousign, notifications, lookup plaque) est du confort : une
erreur y coûte de l'agacement, pas de l'argent ni de la conformité.

---

## Les contrôles rejouables

```bash
node scripts/audit/pont-champs-perdus.mjs      # ✅ 16/16 et 15/15
node scripts/audit/pont-colonnes-absentes.mjs  # ✅ aucune écriture impossible
```

À relancer à chaque champ ajouté au pont : c'est là que les trous
apparaissent.
