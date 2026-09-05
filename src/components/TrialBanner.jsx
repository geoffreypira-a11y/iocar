import React, { useState } from "react";
import { PlanPicker } from "./PlanPicker.jsx";
import { startCheckout as openStripeCheckout, DEFAULT_PLAN } from "../lib/plans.js";

/**
 * v8.49.16 — TrialBanner IOCAR
 *
 * Bandeau de rappel des jours d'essai restants.
 * Affiché en haut du Dashboard quand sub_status === "trialing".
 *   • Discret quand il reste > 3 jours
 *   • Alerte orange quand ≤ 3 jours
 *   • Choix de la formule (mensuel / annuel) puis Stripe Checkout
 *
 * v8.156 — Le bandeau n'envoyait que le plan mensuel : l'annuel, pourtant
 * moins cher sur l'année, n'était atteignable qu'une fois l'essai expiré.
 * Les formules et l'appel à /api/create-checkout-session vivent maintenant
 * dans lib/plans.js, partagés avec les Paramètres et la page de paywall.
 */

export function TrialBanner({ garage }) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(DEFAULT_PLAN);

  if (!garage || garage.sub_status !== "trialing" || !garage.trial_ends_at) {
    return null;
  }

  const now = Date.now();
  const endTime = new Date(garage.trial_ends_at).getTime();
  const msRemaining = endTime - now;
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / 86400000));

  // Si expiré → on n'affiche pas ce banner (la page paywall prend le relais)
  if (daysRemaining === 0 && msRemaining <= 0) return null;

  const isUrgent = daysRemaining <= 3;

  async function startCheckout() {
    setLoading(true);
    const err = await openStripeCheckout(plan, garage.email);
    if (err) {
      alert(err);
      setLoading(false);
    }
    // Pas de setLoading(false) en cas de succès : la page part sur Stripe.
  }

  return (
    <div
      style={{
        marginBottom: 18,
        padding: "12px 16px",
        background: isUrgent ? "rgba(232,150,61,0.08)" : "rgba(212,168,67,0.06)",
        border: `1px solid ${isUrgent ? "rgba(232,150,61,0.3)" : "rgba(212,168,67,0.25)"}`,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 22 }}>{isUrgent ? "⚠️" : "⏳"}</span>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {daysRemaining === 1
            ? "Dernier jour de votre essai gratuit"
            : `Il vous reste ${daysRemaining} jour${daysRemaining > 1 ? "s" : ""} d'essai gratuit`}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          Souscrivez à IO Car pour continuer à gérer vos véhicules sans limite. IO BILL inclus.
        </div>
      </div>
      <PlanPicker compact value={plan} onChange={setPlan} disabled={loading} />
      <button
        onClick={startCheckout}
        disabled={loading}
        style={{
          padding: "8px 14px",
          background: isUrgent ? "var(--orange, #e8963d)" : "var(--gold, #d4a843)",
          color: "#1a1d22",
          border: 0,
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "..." : "💳 Souscrire maintenant"}
      </button>
    </div>
  );
}

/**
 * Utilitaire : vérifie si le trial est expiré.
 * Utilisé par le gate paywall dans App.jsx pour afficher TrialExpiredPage.
 */
export function isTrialExpired(garage) {
  if (!garage) return false;
  if (garage.sub_status !== "trialing") return false;
  if (!garage.trial_ends_at) return false;
  return new Date(garage.trial_ends_at).getTime() < Date.now();
}

/**
 * Utilitaire : vérifie si le garage a un accès valide.
 * Retourne TRUE quand on NE bloque PAS l'utilisateur :
 *   • sub_status === "active"   → abonné payant, OK
 *   • sub_status === "exempt"   → compte grandfathered, OK
 *   • sub_status === "past_due" → paiement en retard mais accès maintenu
 *                                 (Stripe retry pendant 3 semaines avant "canceled")
 *   • sub_status === "trialing" ET trial_ends_at > now → essai en cours, OK
 *
 * v8.49.17.3 — ANTI-FLASH : si sub_status est null/undefined (garage
 * en cours de chargement, ou vieux compte sans backfill), on retourne
 * TRUE pour ne PAS afficher le paywall pendant le chargement.
 * Les cas de vrai blocage sont EXPLICITES (trialing expiré, canceled).
 *
 * Retourne FALSE (paywall) uniquement quand on doit VRAIMENT bloquer :
 *   • sub_status === "trialing" ET trial_ends_at ≤ now → essai expiré
 *   • sub_status === "canceled" ou "expired"          → abo annulé/fini
 */
export function hasValidAccess(garage) {
  if (!garage) return false;
  const s = garage.sub_status;

  // v8.49.17.3 — sub_status pas encore chargé → accès temporaire OK (anti-flash)
  if (s == null || s === "") return true;

  // Statuts explicitement valides
  if (s === "active" || s === "exempt" || s === "past_due") return true;

  // Trial : valide si non expiré
  if (s === "trialing") {
    if (!garage.trial_ends_at) return true; // pas de deadline = on laisse
    return new Date(garage.trial_ends_at).getTime() >= Date.now();
  }

  // Statuts terminaux explicites : canceled, expired, ou toute autre valeur inconnue
  return false;
}
