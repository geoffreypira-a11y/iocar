import React, { useState } from "react";

/**
 * v8.49.16 — TrialBanner IOCAR
 *
 * Bandeau de rappel des jours d'essai restants.
 * Affiché en haut du Dashboard quand sub_status === "trialing".
 *   • Discret quand il reste > 3 jours
 *   • Alerte orange quand ≤ 3 jours
 *   • Cliquable → ouvre Stripe Checkout direct sur le plan mensuel
 *
 * L'API /api/create-checkout-session existe déjà côté IOCAR et gère
 * la création de session. On lui envoie le priceId mensuel.
 */

// v8.49.16 — Price IDs IOCAR (à synchroniser avec create-checkout-session.js)
// TODO(env): idéalement passer par window.__IOCAR_PRICE_MONTHLY (injecté par Vite)
//            au lieu de codes en dur, mais on garde la valeur cohérente avec l'API.
const PRICE_MONTHLY = "price_1TzfDwGHGXxR2PvGfrExXJRv"; // 34,99 € HT/mois (Stripe: 41,98 TTC)

export function TrialBanner({ garage }) {
  const [loading, setLoading] = useState(false);

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
    try {
      const r = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: PRICE_MONTHLY,
          email: garage.email || "",
        }),
      });
      const j = await r.json();
      if (j?.url) {
        window.location.href = j.url;
      } else {
        alert(j?.error || "Erreur Stripe. Réessayez ou contactez le support.");
      }
    } catch (e) {
      alert("Erreur réseau. Réessayez.");
    }
    setLoading(false);
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
