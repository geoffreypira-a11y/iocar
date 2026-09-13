# Sauvegardes — IO CAR

## Pourquoi ça compte ici plus qu'ailleurs

Le projet Supabase est sur le **plan gratuit**, qui n'offre aucune sauvegarde
automatique restaurable. Il n'y a donc pas de filet en dessous : les fichiers
décrits ici sont la **seule** protection des données — dont le **livre de
police**, dont la conservation est une obligation légale (art. R.321-3 du Code
pénal).

## Comment ça marche

Deux déclencheurs, un seul et même code (`api/_lib/backup.js`) :

| Déclencheur | Chemin | Authentification |
|---|---|---|
| Cron quotidien, 3h | `api/backup-cron.js` | header `x-vercel-cron`, ou `Bearer CRON_SECRET` |
| Bouton admin | `api/admin.js` → `backup_save` | jeton d'un admin connecté |

Le cron ne pouvait pas passer par l'action admin : celle-ci exige `verifyUser()`,
donc une session — qu'un cron n'a pas. C'était la raison d'être de
`api/backup-cron.js`, qui avait été vidé de son contenu sans être supprimé.

Chaque passage écrit **deux** objets dans le bucket privé `backups` :

- `backup_AAAA-MM-JJ.json` — l'historique, **conservé 30 jours** ;
- `backup_latest.json` — écrasé à chaque fois, pour l'affichage et le bouton
  « Télécharger ».

## ⚠️ Le plafond de 12 fonctions

Le plan Hobby de Vercel refuse un déploiement au-delà de **12 fonctions
serverless**, et l'échec est global — il emporte le site entier, pas seulement
la route ajoutée. IO BILL en a fait les frais le 10/09/2026.

Le projet est passé à **11 sur 12** : `api/backup-cron.js` a été réutilisé plutôt
que remplacé, et la copie périmée `api/api/create-checkout-session.js` a été
supprimée (voir plus bas). Il reste donc une place.

Pour en gagner d'autres : fusionner deux routes derrière un paramètre `action`,
comme le fait déjà `api/admin.js`. Les fichiers préfixés par `_` (comme
`api/_lib/`) ne comptent pas.

## Rotation, pas écrasement

Les fichiers datés de plus de 30 jours sont purgés à chaque passage. On ne se
contente **pas** d'écraser, et c'est délibéré : une sauvegarde qui écrase ne
protège que des pannes remarquées sous 24 h. Une perte silencieuse — une ligne
effacée, un champ vidé par un bug — se découvre des jours plus tard, quand la
bonne copie a déjà été remplacée par l'état abîmé.

## Ce qui est sauvegardé

La ligne `garages` **en entier** (elle ne l'était qu'en sept champs : adresse,
mentions légales, conditions de règlement et paramètres de facturation étaient
perdus), puis par garage : `vehicles`, `orders`, `clients`, `livre_police`,
`support_tickets`, `ticket_messages`.

Chaque sauvegarde embarque un **manifeste** (nombre de lignes par table), affiché
après un enregistrement manuel. Une table qui repart à zéro se voit, au lieu de
passer inaperçue.

### Pas encore couvert

Les buckets `logos` et `signatures` : seules les lignes de base sont sauvegardées.
Ces images restent réuploadables par le concessionnaire, l'enjeu est faible.

## Vérifier une sauvegarde

```bash
node scripts/audit/verifier-sauvegarde.mjs ~/Téléchargements/iocar_backup_AAAA-MM-JJ.json
```

Il ne restaure rien : il lit et il juge. Il refuse un fichier où un garage a des
factures sans aucune entrée de livre de police, où la ligne `garages` n'est
qu'un extrait, ou qui a plus de 7 jours (signe que le cron ne tourne plus). Il
signale aussi les commandes pointant un véhicule absent et les manifestes
incohérents.

Code retour 0 = exploitable, 1 = non exploitable.

## Le point qui reste ouvert

Les sauvegardes sont dans le bucket `backups` **du même projet Supabase que les
données qu'elles protègent**. Si le projet est perdu, les copies partent avec.
Il faut une copie hors site — téléchargement mensuel avec le bouton existant.

Décision non prise à ce jour.

## Historique

Avant septembre 2026 : sauvegarde **manuelle uniquement**, 4 tables, ligne
`garages` en extrait. `api/backup-cron.js` existait mais ne faisait rien —
il vérifiait le secret, écrivait une ligne de log et renvoyait `ok`. Aucune
tâche cron n'était d'ailleurs déclarée dans `vercel.json`. La dernière
sauvegarde réelle datait du 01/08/2026 — 40 jours.
