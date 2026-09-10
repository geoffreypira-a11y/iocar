# Audit de la chaîne facture & avoir — IO CAR ↔ IO BILL ↔ PDP

*Repris depuis le début le 10 septembre 2026, sur le code fusionné :
IO CAR `b680d0e`, IO BILL `888ac0d`.*

Ce document remplace la lecture des trois audits menés cette semaine. Ils
restent en annexe pour le détail et pour les décisions prises en cours de
route :

- [`AUDIT-FACTURATION.md`](AUDIT-FACTURATION.md) — la facture (F1 → F5)
- [`AUDIT-AVOIRS.md`](AUDIT-AVOIRS.md) — l'avoir (A1 → A17)
- [`AUDIT-COMPARATIF.md`](AUDIT-COMPARATIF.md) — la comparaison des deux
  applications et les contrôles mécaniques (B1 → B3)

---

## Verdict

> **La chaîne est fiscalement juste : ce que paie le client, ce qui est
> déclaré et ce qui est transmis concordent, factures et avoirs, dans les deux
> régimes de TVA. Deux réserves subsistent — la transmission d'un avoir n'a
> jamais été éprouvée en réel, et la chaîne d'inaltérabilité vient d'être
> réparée par une migration qu'il faut exécuter.**

Cette reprise a trouvé **un défaut de plus**, dans une zone qu'aucun des trois
audits précédents n'avait ouverte : la chaîne de hachage anti-fraude.

---

## C1 — La chaîne d'inaltérabilité ne couvrait pas les avoirs 🔴

**Trouvé lors de cette reprise. Migration à exécuter.**

IO BILL chaîne ses documents par hachage SHA-256 (`content_hash`,
`previous_hash`), calculé par deux déclencheurs Postgres. Ils étaient posés en
**`BEFORE UPDATE` seulement** :

```sql
CREATE TRIGGER trg_creditnotes_hash_chain
BEFORE UPDATE ON public.credit_notes   -- ← jamais à l'INSERT
```

Un document **créé directement dans son statut définitif**, et jamais mis à jour
ensuite, ne les déclenchait donc jamais.

| | Chaîné ? |
|---|---|
| Facture, parcours nominal (`draft` → `issued`) | ✅ l'UPDATE déclenche |
| Facture poussée directement en `paid` (chemin de repli) | ❌ |
| **Tous les avoirs** | ❌ |

Les avoirs sont insérés en `issued` dès leur création depuis la correction A10 :
**aucun n'aurait jamais été chaîné**. Le PDF sait pourtant afficher
« Hash de chaîne : … » — la ligne ne serait simplement jamais sortie.

**Correctif** (`sql/2026-09-10-chaine-hash-insert.sql`) : les déclencheurs
passent en `BEFORE INSERT OR UPDATE`, les fonctions gèrent `TG_OP = 'INSERT'`
(où référencer `OLD` lève une erreur), et la condition porte sur « sortir de
brouillon » plutôt que sur le seul statut `issued` — une facture insérée en
`paid` est tout aussi définitive. L'immuabilité est préservée : le hachage n'a
lieu que si `content_hash` est encore vide, jamais de recalcul.

---

## Où en est chaque maillon

### 1. Le calcul

| | État |
|---|---|
| Totaux calculés ligne par ligne, comme la norme l'impose (BR-CO-10) | ✅ |
| `HT + TVA = TTC` (BR-CO-15) | ✅ |
| Somme des lignes = sous-total affiché | ✅ |
| `Sous-total − Remise = Total HT net` | ✅ |
| **IO CAR et IO BILL annoncent les mêmes montants** | ✅ |

Vérifié sur **2 824 380 ventes simulées** (deux régimes, taux 20 / 10 / 5,5 %,
montants ronds et au centime) : zéro écart sur chacune de ces cinq propriétés.

Contrepartie assumée : le TOTAL TTC valant `HT + TVA`, il peut s'écarter d'un
centime du prix négocié. Mesuré à **0 sur 9 961 110 ventes** à 20 % en euros
entiers — jamais dans le cas d'usage réel.

### 2. La base taxable

| | État |
|---|---|
| Base nette des remises (art. 267 II 1°) | ✅ |
| Carte grise en débours, hors base TVA (art. 267 II 2°) | ✅ |
| Reprise en règlement en nature, pas en réduction de prix (art. 266-1-a) | ✅ |
| Frais de mise à disposition taxables même en régime marge | ✅ |
| TVA sur marge calculée et déclarée (art. 297 A) | ✅ |
| TVA sur marge jamais mentionnée sur le document (art. 297 E) | ✅ |

### 3. L'avoir

| | État |
|---|---|
| Part à IO BILL dès sa création | ✅ (A10) |
| Reprend exactement la TVA de la vente annulée | ✅ |
| Reprend la TVA sur marge | ✅ |
| N'applique pas de TVA aux débours | ✅ (A1) |
| Réduit la TVA déclarée et le chiffre d'affaires | ✅ (A8/A9/A13) |
| Porte un motif, et la référence de la facture | ✅ (A14/A15) |
| Montants positifs, comme l'exige BR-27 | ✅ (A17) |

### 4. Les mentions obligatoires

| | Facture | Avoir |
|---|---|---|
| Identité, SIRET, TVA, adresse des deux parties | ✅ | ✅ |
| Numéro, date, désignation, quantité, prix unitaire | ✅ | ✅ |
| Ventilation de la TVA par taux | ✅ | ✅ |
| Date à laquelle le règlement doit intervenir | ✅ | s.o. — mention adaptée |
| Pénalités de retard, indemnité de 40 € | ✅ | volontairement absentes |
| Régime particulier — Biens d'occasion (marge) | ✅ | ✅ |
| Référence de la facture d'origine | s.o. | ✅ ×3 + BT-25 |
| Catégorie de l'opération, option TVA sur les débits, SIREN client | ✅ | ✅ |
| **Adresse de livraison** (nouveauté 2026) | ❌ **F5** | ❌ **F5** |

### 5. La transmission

| | Facture | Avoir |
|---|---|---|
| Factur-X généré, TypeCode | ✅ 380 | ✅ 381 |
| Référence de la facture corrigée (BT-25) | s.o. | ✅ numéro |
| Exonération marge (`VATEX-EU-F`) | ✅ | ✅ |
| Envoi Plateforme Agréée | ✅ | ✅ (A2) |
| Auto-transmission après génération | ✅ | ❌ manuelle |
| **Éprouvé de bout en bout en production** | ✅ | ❌ **jamais** |

### 6. L'intégrité

| | État |
|---|---|
| Séries de numérotation distinctes et chronologiques | ✅ |
| Suppression d'une facture bloquée dans l'interface | ✅ |
| Suppression d'un avoir émis bloquée, avec rappel de l'art. 242 nonies A | ✅ |
| Immuabilité après émission (`protect_issued_invoice`) | ✅ |
| Anti-dépassement du total des avoirs (`check_credit_note_total`) | ✅ |
| **Chaîne de hachage** | ⚠️ **après migration C1** |

---

## Les contrôles rejouables

```bash
node scripts/audit/pont-champs-perdus.mjs      # ✅ 16/16 et 15/15
node scripts/audit/pont-colonnes-absentes.mjs  # ✅ aucune écriture impossible
```

À relancer **à chaque champ ajouté au pont** : c'est là que les trous
apparaissent. Trois bugs de cette semaine étaient le même — un champ envoyé,
jeté en silence par une liste blanche.

Ils ne couvrent qu'une classe de défaut. Un calcul faux, une mention absente, un
déclencheur oublié (A10) ou un trigger mal posé (C1) demandent de lire le code.

---

## Ce qui reste ouvert

| | Sujet | Ce qu'il faut |
|---|---|---|
| 🔴 | **C1 — chaîne de hachage** | exécuter `sql/2026-09-10-chaine-hash-insert.sql` |
| 🟠 | Transmission d'un avoir jamais éprouvée | surveiller le premier avoir réel |
| 🟠 | **F5 — adresse de livraison** | question à l'expert-comptable, puis chantier à deux côtés |
| 🟡 | Un seul avoir par facture | plafonner la reprise de marge sur le cumul avant d'en autoriser plusieurs |
| 🟡 | Encours client sans les avoirs | indicateur de trésorerie, pas fiscal |
| 🟡 | Suppression de facture possible en mode admin | échappatoire volontaire, à connaître |
| 🟡 | Auto-transmission des avoirs | manuelle par prudence |

---

## Ce que cet audit ne couvre pas

- Le comportement réel de la PDP au-delà de la génération du Factur-X : aucun
  validateur EN 16931 n'est disponible dans l'environnement de test.
- Les factures et avoirs créés **nativement dans IO BILL**, hors pont : seuls
  leur PDF, leur XML et leurs agrégats ont été lus.
- La TVA sur marge globalisée — la marge est calculée vente par vente.
- Les ventes intracommunautaires et l'autoliquidation.
- Les devis et bons de commande, hors périmètre fiscal (correctement exclus des
  agrégats).
