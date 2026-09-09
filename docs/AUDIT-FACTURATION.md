# Audit de la chaîne de facturation IO CAR → IO BILL

*Réalisé le 9 septembre 2026, sur `main` à `39981d5`.*

Deux questions : **la facture IO CAR est-elle conforme ?** et **IO CAR et IO BILL
disent-ils la même chose ?** Le second point compte autant que le premier :
IO CAR imprime le document remis au client, IO BILL produit le Factur-X transmis
à l'administration via la PDP. Si les deux divergent, c'est la facture papier qui
contredira la déclaration.

Méthode : lecture du code des deux côtés (`calcOrder`, `mapOrderToInvoice`,
`computeTotalsFromLines`, `pdf-builder`, `generate-facturx`) puis simulation
numérique de **1 795 140 ventes** aux valeurs qu'un concessionnaire saisit
réellement (prix 3 000 → 90 000 €, remises 0 → 2 000 €, frais 0 → 250 €, carte
grise, régime normal et régime marge), en comparant au centime ce qu'IO CAR
imprime et ce qu'IO BILL enregistre.

---

## Verdict en une ligne

**Ce que paie le client est juste et identique des deux côtés. La ventilation
HT / TVA diverge d'un centime dans 6,7 % des ventes, et c'est IO BILL qui a
raison.**

---

## 1. Ce qui est sain (vérifié, pas supposé)

| # | Point | Constat |
|---|---|---|
| ✅ | **Montant payé par le client** | `TOTAL TTC` et `TOTAL À PAYER` : **0 écart sur 1 795 140 ventes simulées** aux montants ronds. (Nuance apportée après coup : sur des montants au centime — frais à 99,99 € par exemple — le TTC pouvait lui aussi diverger d'un centime. Voir F1, dont le correctif supprime ce cas.) |
| ✅ | **Base taxable nette de remise** | Le pont envoie la ligne véhicule déjà remisée : la base imposable est nette des réductions (art. 267 II 1° CGI). La remise ne figure pas dans le XML, elle n'a pas à y figurer. |
| ✅ | **Régime de la marge en Factur-X** | `CategoryCode` = `E`, `ExemptionReasonCode` = `VATEX-EU-F`, texte « Régime particulier - Biens d'occasion (art. 297 A du CGI) ». C'est exactement le codage attendu par EN 16931. |
| ✅ | **Mention marge lisible** | Présente sur le PDF IO BILL comme sur le document IO CAR depuis la PR #37, dans des termes équivalents. |
| ✅ | **Frais de mise à disposition en régime marge** | Ils restent taxables au taux normal, et IO BILL n'escamote le bloc HT/TVA que si la facture ne contient **aucune** ligne taxable (`isMargeTva = isMargin && !hasTaxableLine`). Une facture marge + frais affiche donc bien la TVA des frais. |
| ✅ | **Carte grise en débours** | Hors base TVA des deux côtés, avec le bon fondement (art. 267 II 2° CGI), et ajoutée au total à payer. |
| ✅ | **Reprise** | Portée en règlement en nature et non en réduction de prix — conforme à l'art. 266-1-a (tout ce qui est reçu en contrepartie), et évite le rejet PDP sur BR-27 (ligne à montant négatif). |
| ✅ | **Numérotation** | Séries distinctes et chronologiques (`BC-`, `VEH-`, `AV-VEH-`), admises par l'art. 242 nonies A + BOI-TVA-DECLA-30-20-20-10 §120. |
| ✅ | **Mentions 2026** | 3 des 4 nouvelles mentions sont là : SIREN du client, catégorie de l'opération, option TVA sur les débits. (La 4ᵉ : voir F5.) |

---

## 2. Ce qui ne va pas

### F1 — HT et TVA divergent d'un centime dans 6,7 % des ventes

**Gravité : moyenne. À corriger.**

IO CAR divise le TTC **global** une seule fois :

```js
ht = montantTTC_soumis / (1 + tvaPct / 100);   // src/App.jsx, calcOrder
tva = montantTTC_soumis - ht;
```

Le pont et IO BILL convertissent **ligne par ligne**, en arrondissant chaque
ligne au centime :

```js
unit_price_ht_cents = Math.round(ttcToHt(baseApresRem) * 100);  // iobill-bridge.js
lineHt  = Math.round(qty * up * (1 - discPct / 100));           // public.js
lineVat = Math.round(lineHt * vatRate / 100);
```

Deux chemins d'arrondi différents, donc deux résultats.

**Exemple reproductible** — véhicule 3 000 €, remise 500 €, frais 199 € :

| | HT | TVA | TTC |
|---|---|---|---|
| Facture IO CAR (imprimée, remise au client) | 2 249,17 € | 449,83 € | 2 699,00 € |
| Facture IO BILL (Factur-X, transmise à la PDP) | 2 249,16 € | **449,84 €** | 2 699,00 € |

Le client paie bien 2 699,00 € dans les deux cas. Mais la TVA collectée
déclarée n'est pas celle écrite sur le document qu'il détient.

**Qui a raison : IO BILL.** EN 16931 construit la facture à partir des lignes
(BR-CO-10 : le total HT est la somme des montants nets de ligne). La division
globale d'IO CAR est le raccourci qui dérive.

**Correctif recommandé** — qu'IO CAR calcule ses totaux à partir des mêmes
lignes arrondies que le pont, au lieu de diviser le TTC global. Vérifié par
simulation : cela aligne HT et TVA dans **100 %** des cas, et le `TOTAL TTC`
continue d'égaler le prix négocié dans **100 %** des ventes réalistes testées.

> ⚠️ Ne pas « corriger » en changeant IO BILL : c'est lui qui produit le
> Factur-X, et sa méthode est celle qu'impose la norme.

### F2 — La cascade du document ne se soustrait pas exactement

**Gravité : faible (visuel), mais gênante. Même cause que F1.**

Sur le même exemple, le document IO CAR imprime :

```
Sous-total HT      2 665,83 €
Remise accordée    - 416,67 €
Total HT net       2 249,17 €     ← 2 665,83 - 416,67 = 2 249,16
```

La soustraction affichée est fausse d'un centime. De même, la somme de la
colonne « Total HT » du tableau (2 083,33 + 165,83 = 2 249,16) ne fait pas le
« Total HT net » annoncé.

Ce défaut **préexistait** à la PR #37 — la somme des lignes ne faisait déjà pas
le « Montant HT ». La PR l'a simplement rendu visible en affichant une seconde
opération à l'écran. Le correctif de F1 le fait disparaître mécaniquement.

### F3 — IO CAR et IO BILL ne présentent plus la remise de la même façon

**Gravité : faible (présentation). Introduite par la PR #37.**

| | Ligne véhicule | Bloc remise |
|---|---|---|
| IO CAR (depuis PR #37) | 20 825,00 € HT (**avant** remise) | `Sous-total HT` → `Remise accordée - 825,00 €` (HT) → `Total HT net` |
| IO BILL (inchangé) | 20 000,00 € HT (**après** remise) | `Sous-total TTC avant remise` → `Remise accordée - 990,00 €` (TTC) |

Les totaux restent identiques (au centime de F1 près) : ce n'est pas un
problème de montant, c'est deux documents qui racontent la même vente
différemment. Le code IO BILL le dit lui-même — `pdf-builder.js` porte encore le
commentaire « même présentation que la facture IOCAR », qui n'est plus vrai.

**Deux options :**

1. **Aligner IO BILL sur IO CAR** — transmettre la remise en HT
   (`remise_ht_cents`) en plus du TTC, et reprendre la cascade dans
   `pdf-builder.js`. La ligne véhicule resterait cependant nette de remise côté
   IO BILL, sauf à transmettre aussi un prix brut d'affichage.
   ⚠️ Ne **jamais** changer le prix des lignes envoyées au pont : c'est lui qui
   fixe la base taxable du Factur-X. Un prix brut ne peut voyager que comme
   donnée d'affichage.
2. **Assumer la différence** — les deux documents sont justes et portent les
   mêmes totaux ; seule la mise en forme diffère.

À trancher selon ce que voit le client : s'il reçoit les deux PDF, l'option 1
s'impose.

### F4 — Date limite de règlement absente

**Gravité : moyenne. Mention obligatoire.**

L'art. 242 nonies A 9° du CGI impose « la date à laquelle le règlement doit
intervenir ». Elle n'apparaît :

- ni sur le document IO CAR (le bloc « Conditions de règlement » donne les
  pénalités et l'indemnité de 40 €, mais aucune date) ;
- ni sur le PDF IO BILL, qui sait pourtant l'afficher (`if (docType ===
  "invoice" && doc.due_date)`) mais ne la reçoit jamais : le pont n'envoie
  pas de `due_date` ;
- ni dans le Factur-X, où `DueDateDateTime` est conditionné au même champ. Seul
  subsiste le texte « Paiement à réception de la facture » — une condition, pas
  une date.

**Piège à connaître** : IO CAR possède bien un champ `date_echeance`, mais il
est **affiché comme « Livraison le : »** sur le document. Il sert de date de
livraison, pas d'échéance. Le mapper tel quel sur `due_date` transmettrait une
date de livraison comme date limite de paiement. Il faut deux champs distincts.

Accessoirement, `ActualDeliverySupplyChainEvent` (BT-72, date de livraison) se
rabat aujourd'hui sur la date de facture faute de `delivery_date` transmis,
alors qu'IO CAR connaît la vraie date.

### F5 — Adresse de livraison des biens : à trancher avec l'expert-comptable

**Gravité : à déterminer. Ne rien coder avant confirmation.**

Des quatre nouvelles mentions imposées par la facturation électronique, trois
sont en place. La quatrième — **l'adresse de livraison des biens lorsqu'elle
diffère de l'adresse du client** — n'existe nulle part : ni sur le document
IO CAR, ni dans le payload du pont, ni dans le XML (`ShipToTradeParty` est
absent de `generate-facturx.js`).

Pour une voiture retirée à la concession, l'adresse de livraison est celle du
garage — donc, par construction, différente de celle du client. La mention
serait alors due sur la quasi-totalité des ventes.

C'est une lecture, pas une certitude : **à confirmer auprès d'un
expert-comptable avant tout développement.** Si elle est confirmée, le chantier
touche les deux applications (champ, document, payload, XML).

---

## 3. Ordre de traitement suggéré

1. **F1 + F2** — un seul correctif dans `calcOrder`, aucun impact sur IO BILL ni
   sur le Factur-X, aligne les deux applications à 100 %.
2. **F4** — ajouter une vraie date d'échéance (distincte de `date_echeance`),
   l'afficher, la transmettre ; au passage envoyer `delivery_date`.
3. **F5** — question à poser avant d'écrire une ligne de code.
4. **F3** — décision de présentation, sans urgence fiscale.

---

## 4. Ce que cet audit ne couvre pas

- Le cycle PDP (SUPER PDP) au-delà de la génération du Factur-X : aucun
  validateur EN 16931 n'est disponible dans l'environnement de test, les
  factures poussées jusqu'ici sont des factures de sandbox.
- Les avoirs au-delà du calcul des totaux (le signe est cohérent des deux
  côtés, mais le cycle d'annulation n'a pas été rejoué).
- La TVA sur marge globalisée (la marge est calculée vente par vente).
- Les ventes intracommunautaires et l'autoliquidation.

---

## 5. Suites données (9 septembre 2026)

Décisions prises avec l'exploitant et corrections apportées le jour même.

### F1 + F2 — corrigés

`calcOrder` calcule désormais ses totaux **ligne par ligne, en centimes**,
exactement comme `mapOrderToInvoice` puis `computeTotalsFromLines`. La remise HT
et le prix brut du véhicule sont **déduits** de ces mêmes montants au lieu d'être
recalculés à part, ce qui garantit que les soustractions imprimées tombent
juste.

Revérifié sur **2 824 380 ventes simulées** (régimes normal et marge, taux 20 /
10 / 5,5 %, prix ronds et au centime) :

| Propriété | Résultat |
|---|---|
| colonne « Total HT » = Sous-total HT | ✅ 0 échec |
| Sous-total HT − Remise = Total HT net | ✅ 0 échec |
| HT + TVA = TOTAL TTC (BR-CO-15) | ✅ 0 échec |
| **IO CAR == IO BILL** (HT, TVA, TTC) | ✅ **0 échec** |

**Contrepartie assumée.** Puisque le `TOTAL TTC` vaut maintenant HT + TVA (comme
l'impose BR-CO-15 et comme le calcule IO BILL), il peut s'écarter d'**un centime
au maximum** du prix négocié + frais. Mesuré :

| Saisie | Fréquence de l'écart |
|---|---|
| **TVA 20 %, montants en euros entiers** | **0 sur 9 961 110 ventes** |
| Taux 10 % ou 5,5 %, montants ronds | 2,4 % |
| Montants comportant des centimes | 6 à 13 % |

Autrement dit : **jamais** dans le cas d'usage réel (véhicules à 20 %, prix en
euros). Et dans les cas où l'écart apparaît, c'est la valeur qu'IO BILL
transmettait déjà — IO CAR était le seul à afficher autre chose.

### F3 — arbitré en faveur d'IO CAR

La cascade IO CAR est la bonne : la remise se lit en HT **avant** la TVA, là où
IO BILL affichait « Sous-total TTC avant remise », c'est-à-dire du TTC au milieu
d'un bloc HT.

Le pont transmet désormais `veh_ht_brut_cents` et `remise_ht_cents` dans
`vehicle_meta`. **Purement documentaire** : `lines` continue de porter le prix
NET, seul à fixer la base taxable du Factur-X — ces deux montants ne doivent
jamais entrer dans un calcul de total.

➡️ Reste à faire **côté IO BILL** : reprendre la cascade dans `pdf-builder.js`
en consommant ces deux champs.

### F4 — requalifié, puis corrigé à moitié

L'exploitant ne livre le véhicule qu'une fois encaissé : le règlement intervient
au plus tard à la remise du véhicule. Ce n'est donc **pas une échéance à
calculer** mais une **condition** — un texte, pas une date. D'où :

- ✅ la mention « Paiement comptant, au plus tard à la remise du véhicule. »
  s'affiche désormais en tête des conditions de règlement du document IO CAR,
  toujours, et avant le texte libre qu'un concessionnaire a pu réécrire ;
- ✅ le pont l'envoie en `payment_terms` ;
- ⚠️ **mais IO BILL ne la persiste pas** : `invoicePayload` est une liste
  blanche explicite, et il n'existe pas de colonne `payment_terms` (seulement
  `payment_terms_days`, un nombre). Le champ est donc ignoré, et
  `generate-facturx.js` continue d'écrire son propre défaut « Paiement à
  réception de la facture ».

➡️ Reste à faire **côté IO BILL** : persister `payment_terms` et le servir au
générateur Factur-X, pour que les deux documents portent la même phrase.

`order.date_echeance` n'a **pas** été touché : il reste la date de livraison
affichée « Livraison le : ». Ne jamais le mapper sur `due_date`.

### F5 — gelé

Le client ne livre pas aujourd'hui ; le jour où il livrera, ce sera une
prestation facturée (frais de livraison). La mention d'adresse de livraison sera
traitée avec cette fonctionnalité, pas avant. La question de fond — une voiture
retirée à la concession est-elle « livrée à une adresse différente de celle du
client » au sens des mentions 2026 ? — reste à poser à l'expert-comptable.

### Limite connue, hors périmètre

Sur un **avoir**, le tableau imprime des lignes positives tandis que les totaux
sont négatifs. Incohérence antérieure à cet audit, non corrigée ici : elle
touche la présentation des avoirs, pas les montants (le signe est cohérent des
deux côtés du pont).
