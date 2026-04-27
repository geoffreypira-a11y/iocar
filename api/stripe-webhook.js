// api/stripe-webhook.js — webhook Stripe complet
// Traite checkout + mises à jour + échecs de paiement.
import Stripe from 'stripe';
import { getServiceClient } from './_lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function buffer(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature invalide:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  const supabase = getServiceClient();

  try {
    switch (event.type) {

      // ─── Paiement initial réussi ────────────────────────────
      case 'checkout.session.completed': {
        const s = event.data.object;
        const email = s.customer_details?.email || s.customer_email;
        if (!email) break;

        // Détection du plan par montant (24,99 € HT mensuel vs 274,89 € annuel)
        const plan = (s.amount_total || 0) > 10000 ? 'annual' : 'monthly';

        const { error } = await supabase
          .from('garages')
          .update({
            is_active:              true,
            stripe_customer_id:     s.customer,
            stripe_subscription_id: s.subscription,
            plan,
            sub_status:             'active',
            subscribed_at:          new Date().toISOString(),
            payment_failed_at:      null,
          })
          .eq('email', email);

        if (error) console.error('Update garage (checkout):', error);
        break;
      }

      // ─── Modifications d'abonnement (upgrade, downgrade, cancel) ─
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const active = sub.status === 'active' || sub.status === 'trialing';

        const { error } = await supabase
          .from('garages')
          .update({
            is_active:  active,
            sub_status: sub.status,
          })
          .eq('stripe_customer_id', sub.customer);

        if (error) console.error('Update garage (subscription):', error);
        break;
      }

      // ─── Échec de paiement (CB refusée au renouvellement) ───
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const { error } = await supabase
          .from('garages')
          .update({
            payment_failed_at: new Date().toISOString(),
            sub_status:        'past_due',
          })
          .eq('stripe_customer_id', inv.customer);

        if (error) console.error('Update garage (payment_failed):', error);
        break;
      }

      // ─── Paiement de renouvellement réussi ──────────────────
      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        const { error } = await supabase
          .from('garages')
          .update({
            is_active:         true,
            payment_failed_at: null,
            sub_status:        'active',
          })
          .eq('stripe_customer_id', inv.customer);

        if (error) console.error('Update garage (payment_succeeded):', error);
        break;
      }

      default:
        // On ignore les autres événements
        break;
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    // On retourne 200 malgré l'erreur pour éviter que Stripe re-essaie indéfiniment
    // sur un bug logique de notre côté. Les erreurs sont loggées.
  }

  res.status(200).json({ received: true });
}
