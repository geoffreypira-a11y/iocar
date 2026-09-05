# IO Car — by OWL'S INDUSTRY

## Déploiement sur Vercel

### 1. Installer Vercel CLI
```bash
npm install -g vercel
```

### 2. Se connecter à Vercel
```bash
vercel login
```

### 3. Déployer
```bash
vercel --prod
```

### 4. Variables d'environnement dans Vercel
Dans vercel.com → votre projet → Settings → Environment Variables :
- `SUPABASE_SERVICE_KEY` → clé service_role de Supabase
- `STRIPE_SECRET_KEY` → sk_live_... de Stripe
- `STRIPE_WEBHOOK_SECRET` → whsec_... de Stripe (après création du webhook)
- `STRIPE_PRICE_MONTHLY` → price_... de la formule mensuelle
- `STRIPE_PRICE_ANNUAL` → price_... de la formule annuelle
- `STRIPE_METERED_PRICE_ID` → price_... des recherches de plaque au-delà du quota

Les trois `STRIPE_PRICE_*` doivent appartenir au **même mode** (test ou
production) que `STRIPE_SECRET_KEY`, sans quoi Stripe répond « No such price ».
Changer de tarif se fait ici, sans redéploiement ; les montants affichés dans
l'app vivent eux dans `src/lib/plans.js` et doivent rester alignés.

### 5. Configurer le webhook Stripe
1. stripe.com → Developers → Webhooks → Add endpoint
2. URL : https://iocar.online/api/stripe-webhook
3. Events : customer.subscription.created, customer.subscription.updated,
            customer.subscription.deleted, invoice.payment_failed
4. Copier le "Signing secret" → mettre dans STRIPE_WEBHOOK_SECRET

### 6. Connecter le domaine
vercel.com → votre projet → Settings → Domains → Add → iocar.online
