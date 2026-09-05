// ═══════════════════════════════════════════════════════════════════
// Formules d'abonnement IO Car
//
// v8.158 — Ce fichier ne décrit plus que ce qui s'affiche : libellé, prix,
// badge. Les Price IDs Stripe vivent dans les variables d'environnement lues
// par api/create-checkout-session.js (STRIPE_PRICE_MONTHLY,
// STRIPE_PRICE_ANNUAL) ; le navigateur envoie une formule, le serveur choisit
// le price. Un tarif se corrige donc dans Vercel, sans redéploiement, et rien
// d'arbitraire ne peut atteindre Stripe.
//
// ⚠ Les montants ci-dessous sont ceux annoncés au client : ils doivent
// correspondre aux prix Stripe configurés.
// ═══════════════════════════════════════════════════════════════════

export const PLANS = {
  monthly: {
    key: "monthly",
    label: "Mensuel",
    price: "34,99 €",
    unit: "HT/mois",
    period: "/ mois HT",
    badge: null,
  },
  annual: {
    key: "annual",
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
        plan: plan.key,
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
