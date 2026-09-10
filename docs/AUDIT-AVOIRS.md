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

> **Un avoir n'arrive même pas jusqu'à IO BILL tant qu'il n'a pas été
> intégralement remboursé. Quand il y arrive, il ne réduit ni la TVA déclarée ni
> le chiffre d'affaires, et ne part jamais à l'administration. En régime marge,
> il ne porte même pas la TVA qu'il faudrait reprendre. Et son calcul est faux
> dès qu'il y a une carte grise.**

Autrement dit : aujourd'hui, annuler une vente dans IO CAR produit un document
juste pour le client, et rigoureusement aucun effet fiscal.

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

*Et le montant remboursé est lui-même contestable : la carte grise ayant déjà
été payée au Trésor Public, elle n'est pas rendue au client. Voir le correctif.*

Le montant remboursé au client est juste. Mais l'avoir **reprend 83,33 € de TVA
qui n'ont jamais été collectés** — exactement 500 / 6, la TVA fictive sur le
débours. Répété, c'est une minoration de TVA collectée.

**Correctif** — *révisé après retour de l'exploitant, qui a tranché la question
métier : la carte grise n'est pas remboursée au client.* Une fois la carte grise
faite, l'argent est parti au Trésor Public et le véhicule est immatriculé au nom
du client ; il n'y a rien à rendre.

L'avoir doit donc porter sur le **TTC seul** :

```js
const totalTtc = calcOrder(o).ttc;        // 24 180,00 €  (et non .grandTotal)
```

C'est plus simple que de transporter les débours dans l'avoir, et cela suffit à
faire disparaître le défaut : `prix_ht` = 24 180 → HT 20 150, TVA 4 030, soit
exactement la facture d'origine. La « convention IOCAR : un avoir n'a pas de
débours » qu'affiche `mapOrderToCreditNote` devient alors vraie, au lieu d'être
contredite par le montant qu'on lui passe.

Deux conséquences à traiter avec :

- Le libellé de la modale, **« Montant total TTC »**, désigne aujourd'hui le
  total à payer débours compris. Il redeviendra exact.
- `AvoirPartielModal` plafonne la saisie à ce même montant
  (`if (val > totalTtc)`) : le plafond passera de 24 680 à 24 180 €, ce qui est
  la bonne borne.

**Cas restant — tranché : hors application.** Une vente annulée **avant** que la
carte grise ne soit faite : le garage n'a rien avancé et doit rendre les 500 €,
mais en tant que débours, donc **sans TVA**. Un avoir partiel de 500 € leur
appliquerait 83,33 € de TVA.

Décision de l'exploitant : ce cas se règle **manuellement**, par un
remboursement hors facture. C'est cohérent — un débours restitué n'a ni base
taxable ni ligne de facture, il n'a rien à faire dans un avoir. On n'ajoute donc
pas de champ débours sur l'avoir.

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

## A8 — Aucun avoir n'apparaît dans la déclaration de TVA 🔴

**Gravité : élevée. Découvert en répondant à la question « y a-t-il une
différence entre un avoir sur une facture en TVA normale et un sur une facture
en marge ? ».**

La déclaration de TVA d'IO BILL (`src/modules/vat/VatPage.jsx`) et sa
synchronisation (`src/lib/vat-sync.js`) sont construites à partir de **deux
tables seulement** :

```js
const invInPeriod = invoices.filter((i) => filterDate(i.issue_date));
const purInPeriod = purchases.filter((p) => filterDate(p.issue_date));
```

Le mot `credit_notes` n'apparaît **nulle part** dans ces deux fichiers. La TVA
collectée du bloc 1 comme la TVA sur marge du bloc 2 sont sommées sur les
factures, sans jamais rien retrancher.

**Conséquence** : une vente annulée reste déclarée. L'exploitant paie la TVA
d'une vente qui n'a pas eu lieu — l'erreur est à son détriment, mais c'est une
erreur.

---

## A9 — La marge n'est pas la TVA normale : un avoir en marge ne reprend rien 🔴

**Gravité : élevée. C'est la réponse à la question posée.**

Oui, il y a une différence, et elle est structurelle.

Reprenons la même vente, une fois dans chaque régime — véhicule vendu 24 000 €
après remise, acheté 20 000 €, frais 180 € :

| | TVA normale | Régime marge |
|---|---|---|
| TVA due sur la vente | 4 030,00 € (visible) | 30,00 € (frais) **+ 666,67 €** (marge) |
| Ce que l'avoir porte | HT 20 150 · **TVA 4 030** | HT 24 180 · **TVA 0** |
| Ce qu'il faudrait reprendre | 4 030,00 € | 696,67 € |

Deux causes distinctes :

1. **`mapOrderToCreditNote` construit une ligne unique** au taux
   `avecTva ? tva_pct : 0`. En marge, toute la ligne passe à 0 % — y compris la
   part correspondant aux frais de mise à disposition, qui portaient pourtant
   30 € de TVA bien réelle.
2. **Les données de marge ne sont pas transmises.** `mapOrderToInvoice` envoie
   `purchase_price_cents`, `marge_cents` et `tva_marge_cents` ; son homologue
   `mapOrderToCreditNote` n'envoie rien de tel, et la table `credit_notes` n'a
   pas ces colonnes. La TVA sur marge de la vente annulée — 666,67 € ici — reste
   déclarée à jamais.

**Le point important pour l'ordre des travaux** : corriger A8 (faire lire les
avoirs par la déclaration) suffirait pour le régime normal, puisque l'avoir y
porte déjà la bonne TVA. **En marge, cela ne suffirait pas** : il n'y aurait
rien à soustraire, l'avoir portant zéro. Les deux corrections vont ensemble.

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

# Second passage — 9 septembre 2026

*Déclenché par l'exploitant : « il me semble que l'avoir laisse du chiffre
d'affaires et une TVA reste due ». Il avait raison, et la cause était en amont
de tout ce qui précède.*

## A10 — L'avoir n'atteignait IO BILL que si un remboursement total était saisi 🔴

**Gravité : élevée. Cause racine du symptôme décrit.**

`pushCreditNoteToIobill` n'a qu'**un seul appelant** dans toute l'application :

```js
{payment && <PaymentModal order={payment} onSave={o => {
  if (o.type === "avoir" && o.facture_origine) {
    …
    if (reste <= 0.01) pushCreditNoteToIobill(o, 'finalize');
  }
}} />}
```

Créer un avoir ne poussait donc **rien**. Il fallait ouvrir la modale de
paiement sur l'avoir et y saisir le remboursement intégral pour qu'il existe
côté IO BILL. Un avoir créé puis laissé tel quel — le cas courant, et le seul
tant que le client n'a pas été remboursé — n'y arrivait jamais : la vente
annulée restait déclarée, avec sa TVA et son chiffre d'affaires.

Aucune des corrections A8/A9 ne pouvait compenser cela : la déclaration lisait
bien `credit_notes`, mais il n'y avait aucune ligne à lire.

Le mode `'draft'` prévu « à la création » par le commentaire du pont n'avait
d'ailleurs jamais été branché non plus.

**Correctif** : l'avoir part à IO BILL **dès sa création**, en `issued`. Un
nouveau mode `'issue'` émet sans exiger le remboursement — l'effet fiscal d'un
avoir tient à son émission, pas au mouvement d'argent : la TVA se récupère dès
lors que la facture a été rectifiée (art. 272-1 du CGI). Le remboursement est un
fait de trésorerie, distinct, et le chemin `'finalize'` existant reste en place.

## A11 — Le client de l'avoir était amputé 🟠

`mapOrderToInvoice` et `mapOrderToCreditNote` construisaient chacun leur payload
client, et celui de l'avoir avait divergé :

| | Facture | Avoir |
|---|---|---|
| Adresse | `address_line1` + `postal_code` + `city` | tout concaténé dans `address_line1` |
| Code postal / ville | ✅ | **`null` / `null`** |
| N° TVA intra | ✅ | absent |
| Personne de contact | ✅ | absent |
| Société détectée par | `type === "company"` **ou** SIREN | SIREN seul |

Le même client apparaissait donc complet sur la facture et amputé sur l'avoir,
jusque dans le Factur-X (BT-52 / BT-53 vides).

**Correctif** : un seul `buildClientPayload(order)`, partagé. La divergence ne
peut plus se reformer.

## A12 — L'avoir IO BILL n'avait ni véhicule ni mentions 🟠

**C'est la « différence d'architecture » constatée par l'exploitant.**

`mapOrderToCreditNote` ne transmettait ni `vehicle_meta`, ni
`business_mentions`, ni `payment_terms` — tout ce que la facture envoie depuis
toujours. Le PDF de l'avoir sortait donc sans bloc véhicule, sans plaque, sans
référence au livre de police, là où le document IO CAR les affiche.

Deux documents pour une même vente n'avaient ni la même architecture ni les
mêmes références.

**Correctif** : les trois sont transmis.

## A13 — Le tableau de bord IO BILL ignorait les avoirs 🟠

`DashboardCharts.jsx` construit le CA mensuel et le CA par client sur
`invoices` seulement. Après une vente annulée, le chiffre d'affaires affiché ne
baissait jamais, et le client concerné restait en tête du classement.

**Correctif** : les avoirs émis se déduisent des deux graphiques.

## A14 — L'avoir n'avait pas de motif, et héritait des notes de la facture 🟠

Le pont lisait `order.motif_avoir` :

```js
reason: sanitizeString(order.motif_avoir) || sanitizeString(order.notes) || null,
```

…mais ce champ n'existait **dans aucun formulaire**. Le motif retombait donc
sur `order.notes`, que le clone emportait depuis la facture : les conditions de
garantie et le délai de livraison s'imprimaient comme **motif de l'avoir**, sur
le PDF IOBILL comme dans le Factur-X.

Le sujet compte surtout pour l'**avoir partiel**, qui est un geste commercial :
un avoir de 1 000 € au milieu d'une vente à 24 180 € ne s'explique pas sans son
motif.

**Correctif** : la modale d'avoir partiel demande un motif, obligatoire — il est
imprimé sur le document IO CAR, transmis à IO BILL et porté dans le Factur-X.
L'avoir total reçoit le motif qui se déduit (« Annulation de la facture … ») et
garde son parcours en deux clics. Dans les deux cas les notes de la facture ne
sont plus reprises.

## A15 — Motifs proposés, et référence de la facture toujours visible 🟡

Deux demandes de l'exploitant après coup, toutes deux justes.

**Motifs proposés.** Ressaisir un motif à chaque geste commercial est une perte
de temps et une source d'incohérence. La modale propose désormais des amorces
en un clic, dans cet ordre :

1. les **désignations de la facture** — « Remise sur Peugeot 208 (AA-123-BB) »,
   « Frais de mise à disposition », « Carte grise » — puisque le geste porte sur
   l'une d'elles neuf fois sur dix, et qu'elles ne s'affichent que si la facture
   les contient ;
2. les cas courants — geste commercial, remise en état à la charge du client,
   annulation partielle, erreur de facturation.

Toutes restent modifiables : ce sont des amorces, pas une liste fermée.

**Référence de la facture.** Elle ne figurait, sur le document IO CAR, que dans
le bandeau des mentions en pied de page — en corps 10, gris. Le PDF IO BILL, lui,
la porte en en-tête depuis A4. Les deux documents s'alignent : la facture
d'origine s'affiche maintenant **en en-tête de l'avoir IO CAR**, sous le numéro
et la date, en gras.

Elle figure donc, sur chaque document, à trois endroits qui se répondent :
l'en-tête, la désignation de la ligne (« Avoir sur VEH-2026-0107 — … ») et le
bandeau des mentions. Elle voyage aussi dans le Factur-X (BT-25, cf. A3). Le
bloc « Motif » ne la répète pas : quatre rappels sur un A4, c'était un de trop.

## A16 — Les conditions de règlement d'une facture sur un avoir 🟡

Introduit par la correction F4 de l'audit facturation, puis recopié tel quel
sur l'avoir : **« Paiement comptant, au plus tard à la remise du véhicule. »**
figurait sur un document où c'est le garage qui doit, et où aucun véhicule ne
change de mains.

Les conditions libres du garage sont du même ordre : pénalités de retard et
indemnité forfaitaire de recouvrement de 40 € n'ont aucun sens sur un avoir.

**Correctif** : sur un avoir, les deux documents portent
**« Montant à rembourser au client, ou à valoir sur une prochaine facture. »**
— et le bloc de conditions libres du garage ne s'affiche pas. Le régime de TVA,
lui, reste annoncé dans le bandeau des mentions au-dessus, où il figurait déjà.

## A17 — Les montants positifs d'un avoir se lisaient mal 🟡

Un avoir porte des montants **positifs**. Ce n'est pas un choix de mise en
forme : la PDP rejette les lignes à montant négatif (EN 16931, **BR-27**) — le
même motif qui avait fait sortir la reprise des lignes de facture en v8.150. Le
sens de l'opération est donc porté ailleurs : le titre **AVOIR**, la ligne
**« Total à déduire »**, et le **TypeCode 381** du Factur-X.

Reste que « TVA 20 % — 166,67 € » sans signe se lit mal quand on n'a pas ce
contexte : le lecteur croit devoir cette TVA au lieu de la récupérer.
L'exploitant lui-même y a buté ; le client aussi y buterait.

**Correctif** : une phrase, sous le bloc des totaux, dans les mêmes termes sur
les deux documents —

> *Les montants ci-dessus viennent en déduction de la facture VEH-2026-0107.*

Aucun montant, aucun calcul, aucune donnée transmise n'est touché. Vérifié que
les factures — IO CAR comme IO BILL, natives comme issues du pont — sont
inchangées.

## Avoir partiel : ce que ça produit

Geste commercial de 1 000 € sur une vente de 24 180 € TTC, marge d'origine
4 000 € :

| | Régime normal | Régime marge |
|---|---|---|
| HT de l'avoir | 833,33 € | 1 000,00 € |
| TVA visible reprise | 166,67 € | 0,00 € |
| TVA sur marge reprise | — | **166,67 €** |

En marge, la marge tombe de 4 000 € à 3 000 € : 666,67 € de TVA due avant,
500,00 € après — soit 166,67 € repris, ce que porte exactement l'avoir.

**Limite en vigueur** : IO CAR n'autorise **qu'un seul avoir par facture** (le
bouton disparaît dès qu'il en existe un). Un second geste commercial sur la
même vente n'est donc pas possible aujourd'hui. C'est aussi ce qui protège le
plafond de reprise de marge, calculé avoir par avoir.

## Ce qui, en revanche, était déjà juste

Le tableau de bord **IO CAR** compte correctement : `tvaCollectee` et
`debourRefacture` somment `calcOrder(o)` sur les factures **et** les avoirs,
dont le signe est négatif. Le symptôme ne venait donc pas de là — c'est bien
côté IO BILL que tout se perdait, faute d'avoir reçu l'avoir (A10).

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
| 1 | **A8 + A9** — l'avoir doit réduire la TVA déclarée, marge comprise | IO BILL (déclaration) + IO CAR (mapping marge) |
| 2 | **A1** — TVA sur les débours (avoir sur le TTC seul) | IO CAR (création) |
| 3 | **A2** — transmission des avoirs | IO BILL (adapter PA + 2 boutons) |
| 4 | **A3** — BT-25, numéro au lieu de l'UUID | IO BILL (+ 1 champ transmis) |
| 5 | **A4 + A5** — facture d'origine et régime marge sur le PDF | IO BILL |
| 6 | **A6** — fermer l'endpoint aux avoirs | IO CAR |
| 7 | **A7** — libellés | les deux |

A8, A9, A1 et A2 ont une conséquence fiscale directe. A8 et A9 passent devant
A2 : un avoir transmis mais absent de la déclaration reste faux là où ça compte,
tandis qu'un avoir juste mais non transmis est au moins comptabilisé
correctement.
