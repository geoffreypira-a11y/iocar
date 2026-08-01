import React, { useState } from "react";

/**
 * v8.49.16 — TrialExpiredPage IOCAR
 *
 * Écran de blocage plein écran quand l'essai gratuit est expiré.
 * Affichée quand : sub_status === "trialing" && trial_ends_at < now
 *
 * L'utilisateur ne peut accéder qu'à :
 *   • S'abonner (Stripe Checkout mensuel ou annuel)
 *   • Se déconnecter
 *
 * Les données restent intactes en DB et redeviennent éditables dès la
 * souscription effective (webhook Stripe met à jour sub_status=active).
 */

// v8.49.16 — Price IDs IOCAR (à synchroniser avec create-checkout-session.js)
const PRICE_MONTHLY = "price_1TQx0FGHGXxR2PvGSH36mGP3"; // 34,90 € HT/mois
const PRICE_YEARLY  = "price_1TQx1cGHGXxR2PvGpO3iWLS4"; // 349 € HT/an

export function TrialExpiredPage({ garage, onSignOut }) {
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("monthly");

  async function startCheckout() {
    setLoading(true);
    try {
      const priceId = selectedPlan === "yearly" ? PRICE_YEARLY : PRICE_MONTHLY;
      const r = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId,
          email: garage?.email || "",
        }),
      });
      const j = await r.json();
      if (j?.url) {
        window.location.href = j.url;
      } else {
        alert(j?.error || "Erreur lors de la création du checkout Stripe");
        setLoading(false);
      }
    } catch (e) {
      alert("Erreur réseau : " + (e?.message || "inconnue"));
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg, #0e0f12)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        maxWidth: 560,
        width: "100%",
        background: "var(--card, #1a1d22)",
        border: "1px solid var(--border, rgba(255,255,255,0.08))",
        borderRadius: 14,
        padding: 32,
        textAlign: "center",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontSize: 60, marginBottom: 14 }}>⏰</div>

        <h1 style={{
          fontSize: 26,
          margin: "0 0 10px 0",
          color: "var(--text)",
          fontFamily: "Syne",
        }}>
          Votre essai gratuit est terminé
        </h1>

        <p style={{
          color: "var(--muted)",
          fontSize: 14,
          lineHeight: 1.6,
          marginBottom: 24,
        }}>
          Vos 7 jours d'essai gratuit sont écoulés.<br />
          Souscrivez à IO Car pour continuer à gérer vos véhicules,
          documents et clients sans limite. <strong style={{ color: "var(--gold)" }}>IO BILL inclus.</strong>
        </p>

        <div style={{
          padding: 14,
          background: "rgba(212,168,67,0.06)",
          border: "1px solid rgba(212,168,67,0.2)",
          borderRadius: 8,
          marginBottom: 24,
          fontSize: 12,
          color: "var(--muted2)",
          lineHeight: 1.5,
          textAlign: "left",
        }}>
          ✓ <strong>Vos données sont conservées</strong> — véhicules, factures, clients, livre de police restent en base.<br />
          ✓ <strong>Réactivation immédiate</strong> dès la souscription.<br />
          ✓ <strong>IO BILL inclus</strong> — accès complet à la facturation Factur-X.
        </div>

        {/* Sélection plan */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <PlanCard
            label="Mensuel"
            price="34,90 €"
            unit="HT/mois"
            selected={selectedPlan === "monthly"}
            onClick={() => setSelectedPlan("monthly")}
          />
          <PlanCard
            label="Annuel"
            price="349 €"
            unit="HT/an"
            badge="2 mois offerts"
            selected={selectedPlan === "yearly"}
            onClick={() => setSelectedPlan("yearly")}
          />
        </div>

        {/* CTA */}
        <button
          onClick={startCheckout}
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px 20px",
            background: "var(--gold, #d4a843)",
            color: "#1a1d22",
            border: 0,
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1,
            transition: "all 0.15s",
          }}
        >
          {loading ? "Redirection vers Stripe…" : "💳 Souscrire maintenant"}
        </button>

        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
          Paiement sécurisé Stripe · Annulez à tout moment
        </div>

        <div style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: "1px solid var(--border, rgba(255,255,255,0.06))",
          display: "flex",
          justifyContent: "center",
          gap: 18,
          fontSize: 12,
        }}>
          <a href="mailto:contact@iocar.online" style={{ color: "var(--muted)", textDecoration: "none" }}>
            Une question ?
          </a>
          <span style={{ color: "var(--muted)" }}>·</span>
          <button
            onClick={onSignOut}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--muted)",
              fontSize: 12,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanCard({ label, price, unit, badge, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: 14,
        background: selected ? "rgba(212,168,67,0.12)" : "transparent",
        border: `1px solid ${selected ? "var(--gold, #d4a843)" : "var(--border, rgba(255,255,255,0.08))"}`,
        borderRadius: 10,
        cursor: "pointer",
        color: "var(--text)",
        textAlign: "center",
        position: "relative",
        transition: "all 0.15s",
      }}
    >
      {badge && (
        <span style={{
          position: "absolute",
          top: -8,
          right: -8,
          background: "var(--green, #3ecf7a)",
          color: "#0e0f12",
          padding: "2px 8px",
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 600,
        }}>
          {badge}
        </span>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: selected ? "var(--gold, #d4a843)" : "var(--text)" }}>
        {price}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{unit}</div>
    </button>
  );
}
