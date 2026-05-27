// src/components/IobillInvoiceSync.jsx
// ═══════════════════════════════════════════════════════════════════
// Bandeau d'état "🦉 Transmission IO BILL" sur une facture IOCAR.
//
// v8.40.2 — Pilule entièrement cliquable + statut basé sur LIVRÉ
//
// Architecture : IOCAR = source de vérité, IOBILL = lecture seule.
//   1. BC → Facture (auto hook front) : push status='draft'
//   2. Clic "Livré" sur le véhicule (auto hook FleetPage) : update vers status='paid'
//
// Logique d'état :
//   - vehicle.statut === "livré" → côté IOBILL : Transmise (vert)
//   - sinon (même si payé)         → côté IOBILL : En brouillon (orange)
//
// Props :
//   - token    : JWT Supabase IOCAR
//   - order    : ligne `orders`
//   - garage   : ligne `garages`
//   - isLivre  : (optionnel) true si véhicule lié au statut "livré"
//   - onSync   : callback(patch) après sync pour rafraîchir l'order parent
// ═══════════════════════════════════════════════════════════════════
import React, { useState } from "react";

function computeIsPaid(order) {
  if (!order) return false;
  const prixVente = parseFloat(order.prix_ht) || 0;
  const remAmt = parseFloat(order.remise_ttc) || 0;
  const prixApresRemise = prixVente - remAmt;
  const fraisMD = parseFloat(order.frais_mise_dispo) || 0;
  const carteGrise = parseFloat(order.carte_grise) || 0;
  const reprise = order.reprise_active ? (parseFloat(order.reprise_valeur) || 0) : 0;
  const ttc = prixApresRemise + fraisMD + carteGrise - reprise;
  const acompte = order.type === "avoir" ? 0 : (parseFloat(order.acompte_ttc) || 0);
  const paiements = (Array.isArray(order.paiements) ? order.paiements : [])
    .reduce((s, p) => s + (parseFloat(p.montant) || 0), 0);
  const encaisse = acompte + paiements;
  const reste = ttc - encaisse;
  return reste <= 0.01;
}

export default function IobillInvoiceSync({ token, order, garage, isLivre, onSync }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const linked = !!garage?.iobill_company_id;
  const synced = !!order?.iobill_invoice_id && !order?.iobill_sync_error;
  const hasError = !!order?.iobill_sync_error;
  const orderIsPaid = computeIsPaid(order);
  // v8.40.2 — Le statut "Transmise" dépend de "livré", PAS du paiement
  const reallyLivre = (typeof isLivre === "boolean") ? isLivre : false;

  if (order?.type !== "facture" && order?.type !== "avoir") return null;

  async function callBridge(action) {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/iobill-bridge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, order_id: order.id })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        setError(j.error || j.details || `HTTP ${r.status}`);
        setBusy(false);
        return null;
      }
      if (onSync) onSync({
        iobill_invoice_id: j.invoice_id || order.iobill_invoice_id,
        iobill_invoice_number: j.invoice_number,
        iobill_pdf_url: j.pdf_url,
        iobill_synced_at: new Date().toISOString(),
        iobill_sync_error: null
      });
      setBusy(false);
      return j;
    } catch (e) {
      setError(String(e.message || e));
      setBusy(false);
      return null;
    }
  }

  async function pushDraft() { await callBridge("push_invoice_draft"); }
  async function markPaid()  { await callBridge("mark_invoice_paid"); }

  // ─── Pas lié : pilule grise ──────────────────────────────────
  if (!linked) {
    return (
      <a href="/parametres" style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 12px", borderRadius: 999,
        background: "rgba(255,255,255,0.04)",
        border: "1px dashed rgba(255,255,255,0.15)",
        fontSize: 11, color: "var(--muted)",
        textDecoration: "none", cursor: "pointer"
      }} title="Activer le pont IO BILL dans Paramètres">
        🦉 IO BILL non activé
      </a>
    );
  }

  // ─── Détermine l'état actuel pour la pilule ──────────────────
  let pillBg, pillBorder, pillColor, pillLabel, pillIcon;
  if (hasError) {
    pillBg = "rgba(229,73,73,0.12)";
    pillBorder = "rgba(229,73,73,0.40)";
    pillColor = "var(--red, #e54949)";
    pillLabel = "Échec transmission";
    pillIcon = "❌";
  } else if (!synced) {
    pillBg = "rgba(212,168,67,0.12)";
    pillBorder = "rgba(212,168,67,0.40)";
    pillColor = "var(--gold, #d4a843)";
    pillLabel = "Non transmise";
    pillIcon = "🦉";
  } else if (!reallyLivre) {
    // Synchro OK mais véhicule pas encore livré → toujours en brouillon
    pillBg = "rgba(229,151,60,0.12)";
    pillBorder = "rgba(229,151,60,0.40)";
    pillColor = "var(--orange, #e5973c)";
    pillLabel = "En brouillon";
    pillIcon = "📝";
  } else {
    // Synchro OK et véhicule livré → transmise et finalisée
    pillBg = "rgba(62,207,122,0.12)";
    pillBorder = "rgba(62,207,122,0.40)";
    pillColor = "var(--green, #3ecf7a)";
    pillLabel = "Transmise";
    pillIcon = "✅";
  }

  // ─── Mode compacté (pilule cliquable EN ENTIER) ──────────────
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Cliquer pour voir le détail"
        style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "6px 14px", borderRadius: 999,
          background: hovered ? pillBg.replace("0.12", "0.20") : pillBg,
          border: `1px solid ${pillBorder}`,
          color: pillColor,
          fontSize: 12, fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "background 0.15s, transform 0.1s",
          transform: hovered ? "scale(1.02)" : "scale(1)",
          boxShadow: hovered ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
          // Important : tous ces éléments enfants ne bloquent pas le click
          userSelect: "none"
        }}
      >
        <span style={{ pointerEvents: "none" }}>{pillIcon}</span>
        <span style={{ pointerEvents: "none" }}>{pillLabel}</span>
        <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2, pointerEvents: "none" }}>▾</span>
      </button>
    );
  }

  // ─── Mode déployé (détail complet) ────────────────────────────
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 8,
      background: pillBg,
      border: `1px solid ${pillBorder}`,
      fontSize: 12,
      maxWidth: 340,
      display: "flex", flexDirection: "column", gap: 10
    }}>
      {/* Header cliquable pour replier */}
      <div
        onClick={() => setExpanded(false)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          cursor: "pointer",
          userSelect: "none"
        }}
        title="Replier"
      >
        <span style={{ color: pillColor, fontWeight: 600 }}>
          {pillIcon} {pillLabel === "Transmise" ? "Transmise à IO BILL" :
                     pillLabel === "En brouillon" ? "En brouillon IO BILL" :
                     pillLabel === "Échec transmission" ? "Échec transmission" :
                     "Non transmise"}
        </span>
        <span style={{
          marginLeft: "auto",
          color: "var(--muted)", fontSize: 12,
          opacity: 0.7
        }}>▴</span>
      </div>

      {hasError && (
        <div style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4 }}>
          {order.iobill_sync_error}
        </div>
      )}

      {synced && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--muted)" }}>
          {order.iobill_synced_at && (
            <div>
              · {new Date(order.iobill_synced_at).toLocaleString("fr-FR", {
                  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                })}
            </div>
          )}
          {order.iobill_invoice_number && (
            <div>· N° {order.iobill_invoice_number}</div>
          )}
          {!reallyLivre && (
            <div style={{ marginTop: 4, fontStyle: "italic" }}>
              ⏳ Sera finalisée au passage « 🚗 Livré » du véhicule
            </div>
          )}
          {order.iobill_pdf_url ? (
            <a
              href={order.iobill_pdf_url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--gold, #d4a843)",
                textDecoration: "underline",
                marginTop: 4
              }}
              onClick={(e) => e.stopPropagation()}
            >
              Voir le PDF Factur-X ↗
            </a>
          ) : (reallyLivre && (
            <div style={{ marginTop: 2 }}>⏳ PDF Factur-X en génération</div>
          ))}
        </div>
      )}

      {!synced && !hasError && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Cette facture n'a pas encore été transmise à IO BILL.
        </div>
      )}

      {/* Bouton action */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          // Si véhicule pas encore livré : on push juste en draft (ou re-draft)
          // Si véhicule livré : on push en paid
          reallyLivre ? markPaid() : pushDraft();
        }}
        disabled={busy}
        style={{
          padding: "7px 14px", borderRadius: 6,
          border: "1px solid var(--border, rgba(255,255,255,0.15))",
          background: hasError || !synced ? "var(--gold, #d4a843)" : "transparent",
          color: hasError || !synced ? "#0b0c10" : "var(--muted)",
          fontSize: 11, fontWeight: 600,
          cursor: busy ? "wait" : "pointer",
          alignSelf: "flex-start"
        }}
      >
        {busy ? "⏳ …" :
         hasError ? "🔁 Réessayer" :
         !synced ? "🦉 Transmettre" :
         reallyLivre ? "🔄 Re-transmettre" :
         "🔄 Re-transmettre brouillon"}
      </button>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 11 }}>❌ {error}</div>
      )}
    </div>
  );
}
