# IO Car — Déploiement sécurisé v1.1

Ce document contient **toutes les étapes à suivre dans l'ordre** pour mettre en ligne la version corrigée de l'application.

Compter environ **1h30** pour tout exécuter si vous avez déjà un compte Vercel et Supabase.

---

## ✅ Ce qui a été corrigé

| # | Point | Statut |
|---|---|---|
| 1 | Politiques RLS Supabase sur toutes les tables | ✅ `supabase/migration_securite.sql` |
| 2 | Statut admin lu depuis la DB (`is_admin`), plus d'email hardcodé | ✅ App.jsx |
| 3 | Webhook Stripe complet (checkout + renouvellement + annulation) | ✅ `api/stripe-webhook.js` |
| 4 | Clé RapidAPI déplacée côté serveur, plus jamais exposée au front | ✅ `api/lookup-plate.js` |
| 5 | Code admin "RAPIDAPI" en clair supprimé | ✅ App.jsx |
| 6 | Bucket `backups` strictement privé (service_role uniquement) | ✅ SQL |
| 7 | Endpoint `/api/admin` pour toutes les opérations admin (plus de clé anon avec droits admin côté front) | ✅ `api/admin.js` |
| 8 | Rate-limit sur les endpoints sensibles | ✅ `api/_lib/auth.js` |
| 9 | Upload logos/signatures vers Supabase Storage (buckets `logos`, `signatures`) | ✅ `api/upload-image.js` |
| 10 | Fonction atomique `consume_plate_lookup` — quota non contournable | ✅ SQL |
| 11 | Fonction `purge_livre_police_expired` pour la purge RGPD 5 ans | ✅ SQL |

---

## 🚀 Étapes de déploiement (dans l'ordre strict)

### 1. Préparer les variables d'environnement

Dans Vercel → Project Settings → Environment Variables, ajouter :

| Variable | Valeur | Où la trouver |
|---|---|---|
| `SUPABASE_URL` | `https://lnukqnopmlvaqxbdwhst.supabase.co` | Dashboard Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (clé service_role) | Dashboard Supabase → Project Settings → API → **service_role** (à garder secrète) |
| `STRIPE_SECRET_KEY` | `sk_live_...` | Dashboard Stripe → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Voir étape 4 ci-dessous |
| `RAPIDAPI_KEY` | votre clé RapidAPI | Dashboard RapidAPI → mes applications (générez-en une **nouvelle**, l'ancienne est compromise) |
| `APP_ORIGIN` | `https://votre-domaine.vercel.app` (ou votre domaine custom) | Pour CORS |

⚠️ **La clé RapidAPI actuellement dans votre code (`9a05...`) doit être révoquée immédiatement** sur RapidAPI et remplacée par une nouvelle clé stockée **uniquement** dans cette variable d'environnement Vercel.

### 2. Exécuter la migration SQL Supabase

1. Ouvrir Supabase → **SQL Editor** → **New query**
2. Ouvrir le fichier `supabase/migration_securite.sql`
3. **Important** : modifier la ligne qui marque votre compte admin avant de coller :
   ```sql
   UPDATE public.garages SET is_admin = TRUE WHERE email = 'johnyjoowls@gmail.com';
   ```
   Remplacer par votre vrai email si différent.
4. Copier TOUT le contenu du fichier et coller dans SQL Editor
5. Cliquer **Run**
6. Vérifier en fin de script qu'aucune erreur rouge n'est apparue

### 3. Vérifier la configuration RLS et Storage

Toujours dans SQL Editor, exécuter ces 4 requêtes de vérification :

```sql
-- A) Toutes les tables doivent avoir rowsecurity = true
SELECT schemaname, tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('garages','vehicles','orders','clients','livre_police');

-- B) Au moins une policy par table
SELECT tablename, COUNT(*) AS nb_policies
  FROM pg_policies
 WHERE schemaname = 'public'
 GROUP BY tablename;

-- C) Votre compte est bien admin
SELECT email, is_admin FROM public.garages WHERE is_admin = TRUE;

-- D) Les buckets existent et sont privés
SELECT id, public, file_size_limit FROM storage.buckets
 WHERE id IN ('logos','signatures','backups');
```

Résultats attendus :
- A) toutes à `true`
- B) chaque table `garages/vehicles/orders/clients/livre_police` avec ≥ 1 policy
- C) votre ligne avec `is_admin = true`
- D) 3 lignes, toutes avec `public = false`

### 4. Configurer le webhook Stripe

1. Déployer d'abord l'app sur Vercel (prochaine étape) pour obtenir l'URL.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**
3. URL : `https://votre-domaine.vercel.app/api/stripe-webhook`
4. Événements à sélectionner :
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
5. Récupérer le **Signing secret** (`whsec_...`) et le coller dans la variable Vercel `STRIPE_WEBHOOK_SECRET`
6. Redéployer Vercel pour que la variable soit prise en compte

### 5. Déployer sur Vercel

```bash
# Depuis le dossier décompressé
npm install         # installe @supabase/supabase-js et stripe en plus des deps existantes
npm run build       # test de build local
```

Puis push sur votre repo Git lié à Vercel, ou déployer via CLI :

```bash
vercel --prod
```

### 6. Tests post-déploiement

À faire **avant** d'annoncer l'app à des clients :

#### Test A — RLS fonctionnelle
1. Créer un compte test `test1@iocar.fr`
2. Créer un autre compte test `test2@iocar.fr`
3. Depuis `test1`, ouvrir la console navigateur et tenter :
   ```js
   fetch("https://lnukqnopmlvaqxbdwhst.supabase.co/rest/v1/clients", {
     headers: {
       apikey: "VOTRE_CLE_ANON",
       Authorization: "Bearer VOTRE_TOKEN_TEST1"
     }
   }).then(r => r.json()).then(console.log)
   ```
4. Le résultat doit contenir **uniquement les clients de test1**, jamais ceux de test2.

#### Test B — Lookup plate sécurisé
1. Ouvrir les DevTools → onglet Network
2. Utiliser la fonction "Identifier la plaque" dans l'app
3. Vérifier qu'**aucune requête ne sort vers `rapidapi.com`** depuis le front
4. Vous devez voir uniquement un appel à `/api/lookup-plate`

#### Test C — Webhook Stripe
1. Faire un paiement test avec la carte `4242 4242 4242 4242`
2. Vérifier dans Stripe Dashboard → Webhooks → votre endpoint → Events : une ligne verte (200 OK)
3. Dans Supabase SQL Editor : `SELECT email, is_active, stripe_subscription_id FROM garages WHERE email = 'votre-email-test';`
4. Les 3 colonnes doivent être remplies.

#### Test D — Admin verrouillé
1. Depuis un compte non-admin, tenter dans la console :
   ```js
   fetch("/api/admin", {
     method: "POST",
     headers: { "Content-Type": "application/json", "Authorization": "Bearer TOKEN_NON_ADMIN" },
     body: JSON.stringify({ action: "list" })
   }).then(r => r.json()).then(console.log)
   ```
2. Réponse attendue : `{ error: "Accès refusé" }` (status 403)

#### Test E — Upload logo va bien dans Storage
1. Depuis les paramètres, uploader un logo
2. Vérifier dans Supabase → Storage → bucket `logos` qu'un fichier `garage_<votre-id>/logo.png` est présent
3. Essayer d'accéder à l'URL publique : doit retourner 400/403 (bucket privé)

### 7. Stripe — configurer le metered billing (optionnel mais conseillé)

Pour que les 0,20 €/recherche au-delà des 10 gratuites soient vraiment facturés :

1. Stripe Dashboard → Products → votre produit "IO Car Mensuel"
2. Ajouter un **deuxième prix** de type "Metered" à 0,20 € par unité
3. Lors de la création d'un abonnement (ou en mettant à jour les abonnements existants), inclure les 2 line items :
   - `price_1TODbBGHGXxR2PvGx242HQBI` (fixe)
   - votre nouveau `price_...` (metered)
4. Le code `lookup-plate.js` détecte automatiquement le line item metered et y reporte l'usage.

### 8. Monitoring

Dans Supabase Dashboard :
1. **Usage** : surveiller DB size, egress, MAU
2. **Logs** : activer Postgres logs pour tracer les accès suspects
3. **Database** → **Alerts** : configurer une alerte à 80 % de chaque quota

Dans Stripe :
1. **Developers → Webhooks → votre endpoint** : vérifier régulièrement que tous les events passent en 200 OK

### 9. Compléter la conformité RGPD (à faire dans la semaine)

- Ajouter des pages `/cgu`, `/confidentialite`, `/mentions-legales` accessibles depuis le footer
- Signer le **DPA Supabase** : https://supabase.com/legal/dpa
- Signer le **DPA Stripe** (automatique à l'activation)
- Vérifier que votre projet Supabase est en région **UE** (ex: Frankfurt, Paris)
- Tenir un registre des traitements (modèle CNIL)

### 10. Purge RGPD — Livre de Police 5 ans

Tous les mois, lancer manuellement dans SQL Editor :
```sql
SELECT public.purge_livre_police_expired();
```

Ou automatiser via un cron Vercel (plan Pro Vercel requis).

---

## 📁 Nouveaux fichiers

```
api/
├── _lib/
│   └── auth.js              # utilitaires : verifyUser, rateLimit, service client
├── admin.js                 # toutes les opérations admin (sécurisé par is_admin DB)
├── lookup-plate.js          # appel RapidAPI côté serveur + quota atomique
├── upload-image.js          # upload logos/signatures vers Storage privé
├── get-image-url.js         # génère une URL signée pour afficher une image
└── stripe-webhook.js        # ⚠ remplace l'ancienne version qui ne faisait rien

supabase/
└── migration_securite.sql   # À exécuter UNE FOIS dans Supabase SQL Editor
```

## 📝 Fichiers modifiés

- `package.json` : ajout des dépendances `stripe` et `@supabase/supabase-js`
- `vercel.json` : config headers de sécurité + functions
- `src/App.jsx` : suppression clé RapidAPI hardcodée, admin basé sur DB, upload Storage, endpoints admin sécurisés

## 🗑 Fichiers supprimés

- `api/backup-cron.js` : remplacé par `api/admin.js` (action `backup_save`)
- `api/report-plate-usage.js` : intégré dans `api/lookup-plate.js` (plus de surface d'attaque séparée)

---

## ❓ En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| "Accès refusé" en tant qu'admin | `is_admin` pas à TRUE en DB | Relancer l'UPDATE de l'étape 2 avec votre email |
| Webhook Stripe en rouge | Mauvais secret | Re-vérifier `STRIPE_WEBHOOK_SECRET` dans Vercel, redéployer |
| "Erreur serveur" au login | Variables env manquantes | Vérifier toutes les variables Vercel listées étape 1 |
| Logo ne s'upload pas | Buckets Storage absents | Ré-exécuter la section 3 du SQL migration |
| RLS bloque vos propres données | Policy trop stricte | Dans Supabase SQL Editor : `SELECT * FROM pg_policies WHERE schemaname='public';` et relire les policies |

---

**Dernière mise à jour :** avril 2026
