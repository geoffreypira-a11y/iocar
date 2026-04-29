// api/customer-portal.js
// Crée une session Stripe Customer Portal et renvoie l'URL.
// Le portail Stripe permet au client de :
// - Mettre à jour son moyen de paiement (CB expirée, fonds insuffisants…)
// - Annuler son abonnement
// - Voir et télécharger ses factures
// - Se réabonner après annulation
import Stripe from 'stripe';
import { verifyUser, setCors } from './_lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Authentification
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { garage } = auth;
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

    // 2. Vérifier qu'on a un stripe_customer_id (l'utilisateur a au moins fait un paiement)
    if (!garage.stripe_customer_id) {
      return res.status(400).json({
        error: "Aucun abonnement Stripe associé. Veuillez d'abord souscrire un abonnement.",
      });
    }

    // 3. URL de retour : si le client revient depuis le portail, il atterrit ici.
    const origin = process.env.APP_ORIGIN || 'https://app.iocar.online';
    const returnUrl = `${origin}/?portal_return=1`;

    // 4. Créer la session portail
    const session = await stripe.billingPortal.sessions.create({
      customer: garage.stripe_customer_id,
      return_url: returnUrl,
    });

    return res.status(200).json({ url: session.url });

  } catch (e) {
    console.error('customer-portal:', e);
    // Cas spécial : le portail Stripe n'est pas configuré côté Stripe Dashboard
    if (e.message && e.message.includes('No configuration provided')) {
      return res.status(503).json({
        error: "Le portail client Stripe n'est pas encore activé. L'admin doit le configurer dans le Dashboard Stripe (Settings → Billing → Customer portal).",
      });
    }
    return res.status(500).json({ error: e.message || 'Erreur serveur' });
  }
}
