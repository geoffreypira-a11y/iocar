// ═══════════════════════════════════════════════════════════════
// API : Reporter une utilisation de plaque à Stripe (metered billing)
// Appelé depuis le frontend quand un utilisateur dépasse 10 plaques/mois
// URL : /api/report-plate-usage
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://lnukqnopmlvaqxbdwhst.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const STRIPE_SECRET_KEY    = process.env.STRIPE_SECRET_KEY;

// Price ID du produit "Plaques supplémentaires IO Car" (tarification à l'usage)
const METERED_PRICE_ID = "price_1TOKbsGHGXxR2PvG9WUmsPjj";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { garageId, quantity = 1 } = req.body || {};
  if (!garageId) return res.status(400).json({ error: "garageId requis" });

  try {
    // 1. Récupérer le garage depuis Supabase
    const garageRes = await fetch(
      `${SUPABASE_URL}/rest/v1/garages?id=eq.${garageId}&select=email,stripe_customer_id`,
      { headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const garages = await garageRes.json();
    const garage = garages?.[0];
    if (!garage) return res.status(404).json({ error: "Garage introuvable" });

    // 2. Trouver ou créer le subscription item Stripe pour ce garage
    const stripe = require("stripe")(STRIPE_SECRET_KEY);
    const customerId = garage.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: "Pas de customer Stripe" });

    // Récupérer les subscriptions du customer
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
    const sub = subs.data[0];
    if (!sub) return res.status(400).json({ error: "Pas d'abonnement actif" });

    // Chercher ou ajouter l'item metered dans la subscription
    let meteredItem = sub.items.data.find(i => i.price.id === METERED_PRICE_ID);
    if (!meteredItem) {
      // Ajouter le produit metered à la subscription existante
      const updatedSub = await stripe.subscriptions.update(sub.id, {
        items: [{ price: METERED_PRICE_ID }],
        proration_behavior: "none",
      });
      meteredItem = updatedSub.items.data.find(i => i.price.id === METERED_PRICE_ID);
    }

    // 3. Reporter l'usage à Stripe
    await stripe.subscriptionItems.createUsageRecord(meteredItem.id, {
      quantity,
      timestamp: Math.floor(Date.now() / 1000),
      action: "increment",
    });

    console.log(`📊 Garage ${garage.email} → +${quantity} plaque(s) reportée(s) à Stripe`);
    res.status(200).json({ success: true, quantity });

  } catch(err) {
    console.error("Erreur report-plate-usage:", err.message);
    res.status(500).json({ error: err.message });
  }
}
