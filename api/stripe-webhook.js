// ═══════════════════════════════════════════════════════════════
// Webhook Stripe → Supabase
// Déployé automatiquement sur Vercel dans /api/stripe-webhook
// URL publique : https://iocar.online/api/stripe-webhook
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://lnukqnopmlvaqxbdwhst.supabase.co";
// ⚠️ Mettre la SERVICE ROLE KEY ici (pas la anon key) — variable d'environnement Vercel
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  // Vérification signature Stripe
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature invalide:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Traitement des événements Stripe
  switch (event.type) {

    // ── Abonnement créé ou réactivé ─────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const email = await getEmailFromCustomer(stripe, sub.customer);
      if (!email) break;

      const isActive = sub.status === "active" || sub.status === "trialing";
      const plan = sub.items.data[0]?.price?.recurring?.interval === "year" ? "annual" : "monthly";

      await updateGarage(email, { is_active: isActive, plan, stripe_customer_id: sub.customer });
      console.log(`✅ Garage ${email} → is_active=${isActive}, plan=${plan}`);
      break;
    }

    // ── Abonnement annulé / impayé ───────────────────────────
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const obj = event.data.object;
      const customerId = obj.customer;
      const email = await getEmailFromCustomer(stripe, customerId);
      if (!email) break;

      await updateGarage(email, { is_active: false });
      console.log(`⛔ Garage ${email} → suspendu`);
      break;
    }
  }

  res.status(200).json({ received: true });
}

// ── Helpers ─────────────────────────────────────────────────────
async function getEmailFromCustomer(stripe, customerId) {
  try {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.email || null;
  } catch(e) {
    return null;
  }
}

async function updateGarage(email, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/garages?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) console.error("Supabase update failed:", await res.text());
}

// Vercel: lire le body brut pour la vérification Stripe
export const config = { api: { bodyParser: false } };
