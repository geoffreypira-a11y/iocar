# Audit comparatif IO CAR ↔ IO BILL — factures et avoirs

*10 septembre 2026. IO CAR `fd73086`, IO BILL `9eb1ca4`, après les audits
facturation et avoirs.*

Demande de l'exploitant : **« il ne faut plus que j'aie de trou comme on vient
d'en régler »**. Une relecture de plus n'y suffirait pas — les trous de cette
semaine ont tous été trouvés par ses questions, pas par mes relectures. Cet
audit ajoute donc **deux contrôles mécaniques, versionnés et rejouables**, qui
attrapent la classe de défaut concernée sans dépendre de l'attention de qui que
ce soit.

---

## Verdict

> **Les deux contrôles ont trouvé deux trous de plus, dont un que je venais
> d'introduire. Après correction, aucun champ ne se perd entre les deux
> applications. Reste un défaut de procédure : le schéma SQL du dépôt ne
> reflète pas la base de production.**

---

## 1. Les deux contrôles mécaniques

```bash
node scripts/audit/pont-champs-perdus.mjs
node scripts/audit/pont-colonnes-absentes.mjs
```

### Pourquoi ceux-là

Les trois bugs de septembre étaient **le même bug** :

| | Champ envoyé | Ce qui se passait |
|---|---|---|
| A12 | `vehicle_meta` | jeté — pas dans la liste blanche |
| — | `business_mode` | jeté — colonne inexistante |
| F4 | `payment_terms` (facture) | jeté — pas de colonne |

`invoicePayload` et `creditNotePayload` sont des **listes blanches explicites** :
un champ absent de la liste disparaît sans erreur, sans log, sans rien. Le
premier contrôle compare donc, clé à clé, **ce que le pont envoie** et **ce
qu'IO BILL lit**.

Le second prend l'autre moitié : une colonne oubliée fait échouer
l'insertion **entière** côté PostgREST. Il compare **ce qu'IO BILL écrit** au
**schéma versionné**.

### Ce qu'ils ont trouvé

**B1 — `payment_terms` perdu sur l'avoir.** 🟠
Sur une facture, le champ se range dans `terms`. Pour l'avoir, l'aiguillage
avait été oublié : la phrase « Montant à rembourser au client, ou à valoir sur
une prochaine facture » partait bien du pont et n'arrivait nulle part. Le bloc
**CONDITIONS** ne s'affichait pas sur l'avoir.

**B2 — La colonne `terms` n'existe pas sur `credit_notes`.** 🔴
`terms` existe sur `quotes` et `invoices` depuis `01_schema.sql`, pas sur
`credit_notes`. Le correctif de B1, écrit sans ce contrôle, **aurait cassé tous
les push d'avoir** (PostgREST rejette l'insertion entière sur colonne inconnue).
Le contrôle l'a rattrapé avant livraison. La colonne est ajoutée à la migration.

**B3 — Le schéma du dépôt ne reflète pas la production.** 🟠
Six colonnes d'`invoices` sont écrites par le code et **déclarées nulle part**
dans le dépôt : `vat_regime`, `purchase_price_cents`, `marge_cents`,
`tva_marge_cents`, `debours`, `debour_total_cents`. Elles fonctionnent en
production, donc elles ont été ajoutées à la main dans la console Supabase sans
jamais être versionnées.

Conséquences : un environnement reconstruit depuis le dépôt serait **cassé**, et
le second contrôle rend des faux positifs tant que ce n'est pas rattrapé. À
corriger par une migration de rattrapage — sans effet en production, `ADD COLUMN
IF NOT EXISTS` étant idempotent.

---

## 2. Ce que le pont transmet — état après correction

| | Facture | Avoir |
|---|---|---|
| Champs transmis | 16 | 15 |
| **Lus par IO BILL** | **16** ✅ | **15** ✅ |

`external_id`, `number`, `issue_date`, `status`, `payment_terms`, `client`,
`lines`, `vehicle_meta`, `business_mentions`, `vat_regime`,
`purchase_price_cents`, `marge_cents`, `tva_marge_cents` — communs aux deux.
La facture ajoute `payments`, `totals`, `debours` ; l'avoir ajoute
`source_invoice_number` et `reason`.

L'avoir n'a ni `payments` ni `debours`, et c'est voulu : un avoir ne porte pas
de débours (la carte grise n'est pas remboursée, décision de l'exploitant), et
son remboursement est un fait de trésorerie suivi côté IO CAR.

---

## 3. Le document, bloc par bloc

| Bloc | Facture IO CAR | Facture IO BILL | Avoir IO CAR | Avoir IO BILL |
|---|---|---|---|---|
| Titre et numéro | ✅ | ✅ | ✅ | ✅ |
| Date | ✅ | ✅ | ✅ | ✅ |
| Facture d'origine | — | — | ✅ en-tête | ✅ en-tête |
| Émetteur (SIRET, TVA) | ✅ | ✅ | ✅ | ✅ |
| Client (adresse complète) | ✅ | ✅ | ✅ | ✅ |
| Bloc véhicule | ✅ | ✅ | ✅ | ✅ |
| Désignation des lignes | identique | identique | identique | identique |
| Cascade des totaux | identique | identique | identique | identique |
| Mention art. 297 A | ✅ | ✅ | ✅ | ✅ |
| Débours | ✅ | ✅ | s.o. | s.o. |
| Mention de déduction | — | — | ✅ | ✅ |
| Conditions de règlement | ✅ | ✅ | ✅ | ✅ |
| Motif | s.o. | s.o. | ✅ | ✅ |
| Garantie / reprise | ✅ | ✅ | ✅ | — |
| Filigrane, charte | propre à chacun | | | |

**Différences assumées** : la charte graphique, la disposition du pied de page,
et les blocs garantie/reprise que seul IO CAR affiche sur un avoir. Tout ce qui
est chiffré, référencé ou obligatoire est identique.

---

## 4. Les agrégats fiscaux

| | Factures | Avoirs déduits |
|---|---|---|
| IO CAR — TVA collectée | ✅ | ✅ (signe négatif via `calcOrder`) |
| IO CAR — débours refacturés | ✅ | ✅ |
| IO BILL — déclaration, TVA visible | ✅ | ✅ |
| IO BILL — déclaration, TVA sur marge | ✅ | ✅ |
| IO BILL — ventilation par taux | ✅ | ✅ |
| IO BILL — CA mensuel | ✅ | ✅ |
| IO BILL — CA par client | ✅ | ✅ |

**Point d'attention non corrigé** : `ClientsListPage` calcule un **encours** par
client (`total_ttc − paid`) sur les seules factures. Un avoir non encore
remboursé est une dette envers le client ; il n'y figure pas. C'est un
indicateur de trésorerie, pas un agrégat fiscal — signalé, pas corrigé.

---

## 5. La transmission

| | Facture | Avoir |
|---|---|---|
| Génération Factur-X | ✅ | ✅ |
| TypeCode | 380 | 381 |
| Référence facture d'origine (BT-25) | s.o. | ✅ numéro |
| Régime marge (`VATEX-EU-F`) | ✅ | ✅ |
| Envoi Plateforme Agréée | ✅ | ✅ (depuis A2) |
| Auto-transmission après génération | ✅ | ❌ manuelle |

**Jamais éprouvé de bout en bout** : la transmission d'un avoir n'avait jamais
fonctionné, il n'existe donc aucun historique auquel la comparer. À surveiller
au premier avoir réel.

---

## 6. Ce qui reste ouvert

| | Sujet | Pourquoi |
|---|---|---|
| 🔴 | **B3 — versionner les 6 colonnes d'`invoices`** | un environnement neuf serait cassé |
| 🟠 | Transmission d'un avoir non éprouvée en réel | aucun historique |
| 🟡 | Un seul avoir par facture | le plafond de reprise de marge est calculé avoir par avoir |
| 🟡 | Encours client sans les avoirs | indicateur de trésorerie |
| 🟡 | F5 — adresse de livraison | gelé jusqu'à la fonctionnalité livraison |
| 🟡 | Auto-transmission des avoirs | volontairement manuelle pour l'instant |

---

## 7. Comment s'en servir

Les deux contrôles sont dans `scripts/audit/`. Ils ne dépendent d'aucune base,
ne lisent que le code, et tournent en une seconde. À rejouer **à chaque fois
qu'un champ est ajouté au pont** — c'est exactement là que les trous
apparaissent.

Ils ne remplacent pas une relecture : ils couvrent une classe de défaut précise,
celle qui nous a coûté trois bugs cette semaine. Le reste — un calcul faux, une
mention absente, un déclencheur oublié comme A10 — demande toujours de lire le
code.
