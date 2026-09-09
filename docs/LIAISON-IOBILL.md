# Liaison IO CAR ↔ IO BILL — mémo de fonctionnement

Ce mémo existe parce qu'un cas réel nous a fait perdre du temps en
septembre 2026 : un compte affichait « lié » en vert dans IO CAR alors que la
synchronisation vers IO BILL échouait, et le bouton « Réparer la liaison »
n'apparaissait nulle part. Le compte de test a été supprimé depuis ; le
raisonnement, lui, reste utile la prochaine fois.

---

## 1. La liaison tient sur deux champs indépendants

Dans la table `garages` (IO CAR) :

| Champ | À quoi il sert |
|---|---|
| `iobill_company_id` | identifiant de la société côté IO BILL |
| `iobill_api_token`  | clé d'accès utilisée par **toutes** les actions du pont |

Les deux sont écrits ensemble par `handleLink` (`api/iobill-bridge.js`), mais
ils sont **lus séparément**, et c'est là que naissent les états bâtards :

- la carte Paramètres affiche « lié » sur `iobill_company_id` (`handleStatus`
  renvoie `linked: !!garage.iobill_company_id`) ;
- chaque action du pont (sync, push, avoirs, statut PDP…) refuse de partir sans
  `iobill_api_token` (`if (!garage.iobill_api_token) return 400`).

D'où les trois états possibles :

| `company_id` | `token` | Ce que voit l'abonné |
|---|---|---|
| ✅ | ✅ | Lié, tout marche — **sauf si la company n'existe plus côté IO BILL** (§3) |
| ✅ | ❌ | « Lié » en vert **mais** toute action échoue → bandeau + bouton « Réparer » |
| ❌ | ❌ | « Compte IO BILL non lié » |

`messageLiaisonManquante()` nomme les deux derniers cas correctement ; il ne
faut pas revenir à un simple « non lié », qui envoyait l'abonné chercher une
case à cocher inexistante.

---

## 2. Supprimer côté IO CAR ≠ supprimer côté IO BILL

C'est **asymétrique**, et volontairement :

- **IO CAR — `delete_garage` / `archive_garage`** (`api/admin.js`) : cascade vers
  IO BILL en **suspension** (`external_toggle_active`, `is_active = false`), pas
  en suppression. Les factures Factur-X doivent rester conservées 10 ans ; on ne
  détruit donc jamais la comptabilité depuis IO CAR.
  → Un relink ultérieur **réactive** la company (branche `existing` de
  `handleLinkAccount` : `if (existing.is_active === false) → is_active: true`).

- **IO BILL — `delete_company`** (`api/admin.js` côté IO BILL) : supprime la
  company, toutes ses tables liées (dont `external_api_keys`, donc le jeton) et,
  en *best-effort*, **l'utilisateur `auth.users`** associé.
  → Là, il ne reste plus rien. Le `company_id` et le `token` gardés par IO CAR
  pointent dans le vide.

**À retenir :** supprimer une société dans l'admin IO BILL casse la liaison d'un
garage IO CAR qui, lui, continue d'afficher « lié ».

---

## 3. Le bouton « Réparer la liaison »

Il rejoue `link` avec `{ repair: true }`, ce qui court-circuite le retour
anticipé `already_linked` de `handleLink`. Côté IO BILL, `link_account` est
idempotent : il réutilise la company existante si elle est là, la recrée sinon,
et rappelle `ensureToken()` dans les deux cas.

Il s'affiche :

- automatiquement, en bandeau, quand `linked && !has_token` (état ✅/❌) ;
- sous **n'importe quelle erreur** du pont, en bouton secondaire — c'est ce
  second chemin qui rattrape le cas « les deux champs sont là mais la company
  n'existe plus », qu'IO CAR ne peut pas deviner sans redemander.

La réparation passe par la même modale que l'activation (`ActivateModal`, avec
`reparation = true`) : le mot de passe IO CAR est vérifié puis transmis, ce qui
permet de **recréer un utilisateur IO BILL avec un mot de passe** après une
suppression complète.

---

## 4. L'angle mort connu (cas du compte de test supprimé)

Enchaînement exact qui produit le problème :

1. Un compte IO CAR est lié → company + utilisateur IO BILL créés avec le mot
   de passe IO CAR.
2. La société est supprimée depuis l'admin IO BILL → company **et**
   `auth.users` détruits.
3. On répare la liaison depuis IO CAR → company **et** utilisateur recréés,
   nouveau jeton, la synchro remarche.
4. Mais : `createAuthUser` n'est appelé avec le mot de passe **que si aucun
   utilisateur ne porte cet e-mail**. Si l'utilisateur a survécu à l'étape 2
   (le `delete` de `auth.users` est *best-effort*), IO BILL le retrouve et
   **ignore volontairement le mot de passe** — commentaire d'origine :
   « User existant : on ne réécrit PAS son MDP (sinon on casserait un user qui
   aurait déjà son compte IO BILL) ».

Résultat possible : la liaison est complète et fonctionnelle côté IO CAR
(company_id + token, la synchro passe → **aucune erreur, donc aucun bouton
« Réparer »**), mais l'abonné ne peut pas se connecter sur `app.iobill.online`.

**Correctif :** « Mot de passe oublié » sur `app.iobill.online`. Le compte est
créé avec `email_confirm: true`, le lien de réinitialisation arrive donc bien.

Ce n'est pas un bug à coder : c'est un état transitoire que la réparation (§3)
empêche désormais d'atteindre dans le flux normal. On ne l'a rencontré qu'en
supprimant une société directement dans l'admin IO BILL, ce qui reste une
opération d'administration exceptionnelle.

---

## 5. Réflexes de diagnostic

Quand un abonné dit « ça ne marche plus alors que ça marchait » :

1. Regarder l'état des deux champs (`iobill_company_id`, `iobill_api_token`) —
   pas seulement la pastille verte de la carte.
2. Vérifier dans l'admin IO BILL que la company existe **et** est active : une
   suspension (abonnement Stripe résilié, garage archivé) donne les mêmes
   symptômes qu'une suppression.
3. Si le doute persiste, « Réparer la liaison » est sans danger : l'appel est
   idempotent, il ne duplique jamais une company ni ne perd de factures.
4. Un abonné qui accède à IO CAR mais pas à `app.iobill.online` relève du §4,
   pas du pont.
