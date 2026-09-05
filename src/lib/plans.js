// ═══════════════════════════════════════════════════════════════════
// Formules d'abonnement IO Car
//
// Les price IDs doivent rester alignés avec la whitelist ALLOWED_PRICES de
// api/create-checkout-session.js : le serveur refuse tout autre identifiant.
// Ils étaient jusqu'ici recopiés dans trois fichiers ; ils vivent ici.
// ═══════════════════════════════════════════════════════════════════

export const PLANS = {
  monthly: {
    key: "monthly",
    priceId: "price_1TzfDwGHGXxR2PvGfrExXJRv", // 34,99 € HT / mois (41,98 TTC)
    label: "Mensuel",
    price: "34,99 €",
    unit: "HT/mois",
    period: "/ mois HT",
    badge: null,
  },
  annual: {
    key: "annual",
    priceId: "price_1TzfEnGHGXxR2PvGOrZaiAxA", // 349,90 € HT / an (419,88 TTC)
    label: "Annuel",
    price: "349,90 €",
    unit: "HT/an",
    period: "/ an HT",
    badge: "2 mois offerts",
  },
};

export const PLAN_LIST = [PLANS.monthly, PLANS.annual];

export const DEFAULT_PLAN = "monthly";

/**
 * Ouvre Stripe Checkout pour la formule choisie.
 * Redirige la page en cas de succès ; renvoie sinon un message d'erreur
 * à afficher, pour que l'appelant décide de sa présentation.
 */
export async function startCheckout(planKey, email) {
  const plan = PLANS[planKey] || PLANS[DEFAULT_PLAN];
  try {
    const r = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceId: plan.priceId,
        email: email || "",
        successUrl: window.location.origin + "/?subscribed=1",
        cancelUrl: window.location.origin + "/?canceled=1",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (j?.url) {
      window.location.href = j.url;
      return null;
    }
    return j?.error || "Erreur Stripe. Réessayez ou contactez le support.";
  } catch (e) {
    return "Erreur réseau. Réessayez.";
  }
}
