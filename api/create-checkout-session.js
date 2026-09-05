// api/create-checkout-session.js
// Crée une session Stripe Checkout côté serveur et renvoie l'URL.
// Avantages :
// - La clé STRIPE_SECRET_KEY reste 100 % serveur
// - On peut ajouter des métadonnées, vérifier l'auth, appliquer des coupons, etc.
// - Compatible tous comptes Stripe (pas besoin de l'option "client-only")
import Stripe from 'stripe';
import { setCors } from './_lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// v8.158 — Les Price IDs viennent des variables d'environnement Vercel, comme
// le price « metered » : un tarif se corrige alors dans le tableau de bord,
// sans redéploiement, et les identifiants de test et de production peuvent
// différer d'un environnement à l'autre — ce qu'un code en dur interdisait.
//
//   STRIPE_PRICE_MONTHLY  price du mensuel
//   STRIPE_PRICE_ANNUAL   price de l'annuel
//
// Les valeurs par défaut ci-dessous gardent l'app fonctionnelle tant que les
// variables ne sont pas renseignées.
const PRICES = {
  monthly: process.env.STRIPE_PRICE_MONTHLY || 'price_1TzfDwGHGXxR2PvGfrExXJRv',
  annual: process.env.STRIPE_PRICE_ANNUAL || 'price_1UCQuhGHGXxR2PvGuqY4w7mJ',
};

// Le client envoie une FORMULE, jamais un price : rien d'arbitraire ne peut
// donc atteindre Stripe. `priceId` reste accepté pour compatibilité, à
// condition de faire partie des prix configurés.
const ALLOWED_PRICES = new Set(Object.values(PRICES));

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { plan, priceId: legacyPriceId, email, successUrl, cancelUrl } = req.body || {};

    // Formule demandée → price configuré. On accepte encore un priceId brut
    // (anciens clients), tant qu'il fait partie des prix configurés.
    let priceId = null;
    if (plan) {
      priceId = PRICES[plan] || null;
      if (!priceId) return res.status(400).json({ error: `Formule inconnue : ${plan}` });
    } else if (legacyPriceId) {
      if (!ALLOWED_PRICES.has(legacyPriceId)) {
        return res.status(400).json({ error: 'priceId non autorisé' });
      }
      priceId = legacyPriceId;
    }

    if (!priceId || !email) {
      return res.status(400).json({ error: 'plan (ou priceId) et email requis' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'email invalide' });
    }

    // Origine de l'app pour les URLs de redirection
    const origin = process.env.APP_ORIGIN || 'https://app.iocar.online';

    // ─── METERED BILLING — Recherches plaque supplémentaires ──────────────
    // On ajoute automatiquement le price metered (0,20 € / unité) à TOUS les
    // abonnements créés. L'abonné ne paiera que ce qu'il consomme au-delà des
    // 10 recherches gratuites/mois (le quota est géré côté serveur dans
    // lookup-plate.js qui envoie un usage record à Stripe via createUsageRecord).
    //
    // Si STRIPE_METERED_PRICE_ID n'est pas défini en env, on ne l'ajoute pas
    // (mode dégradé pour rétrocompatibilité, mais à éviter en production).
    const lineItems = [{ price: priceId, quantity: 1 }];
    const meteredPriceId = process.env.STRIPE_METERED_PRICE_ID;
    if (meteredPriceId) {
      // ⚠ Pas de "quantity" pour un price metered — Stripe exige son absence
      lineItems.push({ price: meteredPriceId });
    } else {
      console.warn('⚠ STRIPE_METERED_PRICE_ID manquant — les recherches au-delà du quota ne seront pas facturées');
    }

    // Création de la session Checkout côté serveur
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: lineItems,
      customer_email: email,
      success_url: successUrl || `${origin}/?subscribed=1`,
      cancel_url:  cancelUrl  || `${origin}/?canceled=1`,
      // Important pour le webhook : on retrouvera l'email côté checkout.session.completed
      metadata: {
        signup_email: email,
      },
      // Locale FR par défaut
      locale: 'fr',
      // Affichage des CGV à cocher — désactivé tant que vous n'avez pas
      // configuré l'URL des CGV dans Stripe Dashboard → Paramètres → Public
      // details. À réactiver plus tard si besoin.
      // consent_collection: {
      //   terms_of_service: 'required',
      // },
      // Autoriser les promotions Stripe si vous en créez plus tard
      allow_promotion_codes: true,
    });

    // On renvoie l'URL — le front fait la redirection
    return res.status(200).json({ url: session.url });

  } catch (e) {
    console.error('create-checkout-session:', e);
    // Stripe renvoie « No such price » quand l'identifiant n'existe pas dans le
    // mode de la clé utilisée : un price créé en test avec une clé live, par
    // exemple. On le dit, plutôt que de laisser un « Erreur serveur » opaque.
    const msg = /no such price/i.test(e?.message || '')
      ? `Tarif introuvable chez Stripe (${e.message}). Vérifiez que le price appartient au même mode (test ou production) que la clé STRIPE_SECRET_KEY.`
      : (e.message || 'Erreur serveur');
    return res.status(500).json({ error: msg });
  }
}
