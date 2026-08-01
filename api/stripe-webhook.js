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

        // v8.49.17 — On récupère le garage_id pour la cascade IOBILL
        const { data: g, error } = await supabase
          .from('garages')
          .update({
            is_active:  active,
            sub_status: sub.status,
          })
          .eq('stripe_customer_id', sub.customer)
          .select('id, iobill_company_id')
          .single();

        if (error) console.error('Update garage (subscription):', error);

        // v8.49.17 — Cascade IOBILL : suspend si résiliation/annulation
        // (fire-and-forget, ne bloque pas la réponse au webhook Stripe)
        if (g?.iobill_company_id) {
          cascadeToggleIobillFromWebhook(g.id, active).catch(e =>
            console.warn('[stripe cascade IOBILL]', e.message)
          );
        }
        break;
      }

      // ─── Échec de paiement (CB refusée au renouvellement) ───
      // Politique : on suspend immédiatement l'accès (même comportement
      // qu'une annulation). L'utilisateur doit mettre sa CB à jour via
      // le Stripe Portal pour réactiver son accès. Stripe enverra
      // ensuite invoice.payment_succeeded qui remettra is_active=true.
      case 'invoice.payment_failed': {
        const inv = event.data.object;
        const { error } = await supabase
          .from('garages')
          .update({
            is_active:         false,
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

// v8.49.17 — Helper cascade IOBILL depuis le webhook Stripe
// Appelle directement l'API IOBILL external_toggle_active (pas via bridge
// pour éviter un chaînage d'auth). Fire-and-forget.
async function cascadeToggleIobillFromWebhook(garageId, isActive) {
  const IOBILL_API_URL = process.env.IOBILL_API_URL || 'https://app.iobill.online/api/public';
  const IOBILL_EXTERNAL_SECRET = process.env.IOBILL_EXTERNAL_SECRET;
  if (!IOBILL_EXTERNAL_SECRET) {
    throw new Error('IOBILL_EXTERNAL_SECRET non configuré côté serveur');
  }
  const r = await fetch(`${IOBILL_API_URL}?op=external`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-External-Secret': IOBILL_EXTERNAL_SECRET
    },
    body: JSON.stringify({
      action: 'external_toggle_active',
      source_app: 'iocar',
      external_ref: garageId,
      is_active: isActive
    })
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`IOBILL ${r.status}: ${err?.error || 'unknown'}`);
  }
  console.log('[stripe->iobill cascade] OK', { garageId, isActive });
}
