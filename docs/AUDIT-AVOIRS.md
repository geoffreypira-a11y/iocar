# Audit des avoirs — IO CAR ↔ IO BILL ↔ PDP

*Réalisé le 9 septembre 2026. IO CAR `10f72ee`, IO BILL `a3b598b`.*

Trois questions : **le calcul est-il juste ?**, **les deux documents sont-ils
alignés ?**, **l'avoir part-il à l'administration ?**

Méthode : lecture du cycle complet — création de l'avoir dans IO CAR
(`AvoirChoiceModal` / `AvoirPartielModal`), `calcOrder`, `mapOrderToCreditNote`,
`handlePushCreditNote` des deux côtés, `pdf-builder.js`, `generate-facturx.js`,
l'adapter Plateforme Agréée `pa-actions.js` et les deux pages d'interface qui
proposent la transmission — puis génération d'un vrai PDF d'avoir.

---

## Verdict

> **Le calcul de l'avoir est faux dès qu'il y a une carte grise, et aucun avoir
> ne peut être transmis à l'administration : le bouton existe, il tombe sur un
> endpoint désactivé qui répond 410.**

---

## A1 — L'avoir applique la TVA sur les débours 🔴

**Gravité : élevée. Erreur de TVA en votre défaveur… ou en votre faveur, ce qui
est pire.**

À la création de l'avoir (`OrdersPage`, bouton ↩️) :

```js
const totalTtc = calcOrder(o).grandTotal;   // = TTC + débours (carte grise)
```

puis ce total entre entier dans le champ prix du nouvel avoir, tandis que les
débours sont remis à zéro :

```js
prix_ht: String(Number(avoirChoice.totalTtc).toFixed(2)),
carte_grise: "0",
```

La carte grise est un **débours** (art. 267 II 2° CGI) : hors base TVA. En la
versant dans le prix de vente, l'avoir la rend taxable.

**Exemple — facture 24 990 € remise 990 €, frais 180 €, carte grise 500 € :**

| | Facture d'origine | Avoir total |
|---|---|---|
| HT | 20 150,00 € | 20 566,67 € |
| **TVA** | **4 030,00 €** | **4 113,33 €** |
| TTC | 24 180,00 € | 24 680,00 € |
| Débours | 500,00 € | — (absorbé dans le prix) |
| À payer / à rembourser | 24 680,00 € | 24 680,00 € |

Le montant remboursé au client est juste. Mais l'avoir **reprend 83,33 € de TVA
qui n'ont jamais été collectés** — exactement 500 / 6, la TVA fictive sur le
débours. Répété, c'est une minoration de TVA collectée.

**Correctif** : l'avoir doit reprendre la structure de la facture, pas un
montant global — `prix_ht` = le TTC (24 180) et `carte_grise` conservée (500).
Le total à rembourser reste 24 680 €, mais la TVA reprise redevient 4 030 €.
`mapOrderToCreditNote` devra alors transmettre les débours, qu'il ignore
aujourd'hui.

---

## A2 — Aucun avoir ne peut être transmis à l'administration 🔴

**Gravité : élevée. Fonctionnalité annoncée, jamais opérationnelle.**

Les deux boutons « 🏛️ Transmettre » d'IO BILL — `CreditNotesListPage.jsx:47` et
`CreditNoteEditorPage.jsx:446` — appellent :

```js
fetch("/api/generate-facturx", { body: JSON.stringify({
  document_type: "credit_note", document_id: cn.id, transmit_pdp: true }) })
```

Or ce chemin a été **neutralisé en v8.47.1** :

```js
if (transmitPdp) {
  return json(res, 410, { error: "Le chemin de transmission PDP historique est désactivé. …" });
}
```

L'utilisateur voit donc « Transmission… » puis une erreur, à chaque fois.

Et il n'existe **aucun chemin de remplacement** : la transmission réelle passe
par `paSendInvoice`, qui ne lit que la table `invoices` :

```js
const inv = await sbAdmin.selectOne("invoices", "id=eq." + payload.invoice_id);
```

Le déclenchement automatique après génération est lui aussi réservé aux
factures :

```js
if (body.auto_transmit_after_generation === true && documentType === "invoice") { … }
```

**Conséquence** : un avoir peut être créé dans IO CAR, poussé dans IO BILL, son
PDF et son XML générés — mais il ne quitte jamais IO BILL. Côté administration,
la facture d'origine reste transmise sans son annulation.

**Correctif** : étendre l'adapter Plateforme Agréée aux avoirs (`pa_send` sur la
table `credit_notes`), puis rebrancher les deux boutons dessus. Tant que ce
n'est pas fait, mieux vaut masquer les boutons que laisser l'abonné croire que
la transmission a lieu.

---

## A3 — Le Factur-X référence la facture d'origine par un UUID 🔴

**Gravité : élevée. Conformité EN 16931.**

`generate-facturx.js` :

```js
// Astuce : on met l'id pour traçabilité (la facture sera retrouvée côté DGFiP via num).
billingRefBlock = `<ram:BillingReferencedDocument><ram:IssuerAssignedID>${x(doc.invoice_id)}</ram:IssuerAssignedID></ram:BillingReferencedDocument>`;
```

`IssuerAssignedID` porte donc `3f2a1c88-0b5e-4f77-…`, l'identifiant technique
interne d'IO BILL, là où BT-25 attend **le numéro de la facture d'origine**
(`VEH-2026-0107`). Cet UUID n'a aucun sens pour le destinataire ni pour
l'administration, et le commentaire du code reconnaît lui-même l'approximation.

**Correctif** : stocker le numéro de la facture source sur l'avoir — il est
pourtant connu au moment du push, `handlePushCreditNote` fait déjà le lookup
`sourceInvoice` — et l'écrire ici. Ajouter au passage `FormattedIssueDateTime`
(BT-26), sa date.

---

## A4 — Le PDF de l'avoir ne référence pas la facture d'origine 🟠

**Gravité : moyenne. Mention obligatoire.**

PDF d'avoir réellement généré pendant l'audit :

```
                                                    AVOIR
                                        N° AV-VEH-2026-0001
                                                Date : 09/09/2026

 Désignation                                    Qté  Unité    P.U. HT   TVA      Total HT
 Avoir sur VEH-2026-0107 - dddd dddd (BB888BB)   1     u   20 566,67 €  20%   20 566,67 €
                                                          Total HT           20 566,67 €
                                          TVA 20%                              4 113,33 €
                                                          Total à déduire  - 24 680,00 €
Motif : Annulation de la vente
```

« VEH-2026-0107 » n'apparaît que **dans le libellé de la ligne**, et seulement
parce qu'IO CAR l'y a mis. `pdf-builder.js` ne contient aucune référence à la
facture source : un avoir créé nativement dans IO BILL, ou un avoir IO CAR sans
`facture_origine`, sortirait sans cette mention.

Le document IO CAR, lui, l'affiche correctement : « 📎 Facture d'origine :
VEH-2026-0107 » dans le bandeau des mentions.

---

## A5 — Le régime de la marge est perdu sur l'avoir 🟠

**Gravité : moyenne.**

Deux effets :

1. **La mention art. 297 A disparaît.** `credit_notes` ne stocke pas de
   `vat_regime`, alors que `invoices` le fait. Le PDF calcule
   `isMargin = doc.vat_regime === "margin_297a" || company.vat_regime === …` :
   sur un avoir, le premier terme est toujours `undefined`.
2. **La TVA des frais n'est jamais reprise.** `mapOrderToCreditNote` construit
   **une seule ligne** au taux `avecTva ? tva_pct : 0`. Sur une vente en marge,
   toute la ligne passe à 0 % — y compris la part correspondant aux frais de
   mise à disposition, qui portaient bien 30 € de TVA sur la facture.

---

## A6 — `mark_invoice_paid` accepte un avoir et le traiterait comme une facture 🟡

**Gravité : latente. Non atteignable depuis l'interface aujourd'hui.**

```js
if (order.type !== 'facture' && order.type !== 'avoir') {
  return res.status(400).json({ error: 'Seules les factures peuvent être marquées payées' });
}
```

Le garde-fou laisse passer les avoirs, alors que le message dit l'inverse. Deux
issues, toutes deux fausses :

- **Cas 1** (`order.iobill_invoice_id` renseigné) : appelle
  `update_invoice_status` avec l'`external_id` de l'avoir — IO BILL le cherchera
  dans la table `invoices`, où il n'est pas.
- **Cas 2** : pousse l'avoir via `push_invoice` avec `mapOrderToInvoice`, dont
  les montants sont multipliés par `sign = -1` → **une facture à lignes
  négatives**, exactement ce que la PDP rejette (BR-27) et que la v8.150 avait
  corrigé pour la reprise.

Le seul appelant actuel filtre sur `linkedOrder.type === 'facture'`, donc rien
ne casse aujourd'hui. Mais l'endpoint est ouvert.

---

## A7 — Présentation : deux documents qui divergent 🟡

| | IO CAR | IO BILL |
|---|---|---|
| Libellé de la ligne | **« VENTE VÉHICULE — … »** sur un avoir | « Avoir sur VEH-… » |
| Total | `TOTAL TTC` **−24 680,00 €** | `Total à déduire` **− 24 680,00 €** |
| Facture d'origine | bandeau des mentions ✅ | libellé de ligne seulement |
| Lignes | positives, totaux négatifs | positives, total préfixé « - » |

Les montants concordent en valeur absolue. Le défaut le plus visible est le
libellé « VENTE VÉHICULE » en tête d'un document intitulé AVOIR : la ligne est
codée en dur dans `PrintDoc`, sans distinction de type.

---

## Ce que cet audit ne couvre pas

- Les avoirs créés **nativement dans IO BILL** (hors pont IO CAR) : seuls leur
  PDF et leur XML ont été lus, pas leur cycle de saisie.
- Le comportement réel de la PDP face à un avoir — la transmission n'étant pas
  branchée, rien n'a pu être éprouvé de bout en bout.
- Les avoirs partiels au-delà du calcul : `AvoirPartielModal` alimente le même
  champ `prix_ht`, donc A1 s'applique dès que le montant saisi inclut la carte
  grise.

---

## Ordre de traitement suggéré

| | Sujet | Portée |
|---|---|---|
| 1 | **A1** — TVA sur les débours | IO CAR (création + mapping) |
| 2 | **A2** — transmission des avoirs | IO BILL (adapter PA + 2 boutons) |
| 3 | **A3** — BT-25, numéro au lieu de l'UUID | IO BILL (+ 1 champ transmis) |
| 4 | **A4 + A5** — facture d'origine et régime marge sur le PDF | IO BILL |
| 5 | **A6** — fermer l'endpoint aux avoirs | IO CAR |
| 6 | **A7** — libellés | les deux |

A1 et A2 sont les deux seuls à conséquence fiscale directe.
