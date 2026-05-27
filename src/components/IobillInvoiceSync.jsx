// src/components/IobillInvoiceSync.jsx
// ═══════════════════════════════════════════════════════════════════
// Bandeau d'état "🦉 Transmission IO BILL" sur une facture IOCAR.
//
// v8.40 — REFONTE COLLAPSIBLE :
// Par défaut affiche une PILULE COMPACTE (statut + click pour expand).
// Au clic, déploie le détail complet (date, n°, PDF, re-transmettre…).
// Re-clic sur la pilule → re-replie.
//
// Architecture : IOCAR = source de vérité, IOBILL = lecture seule.
//   1. BC → Facture (auto hook front) : push status='draft'
//   2. Clic "Livré" (auto hook FleetPage) : update vers status='paid'
//
// Props :
//   - token  : JWT Supabase IOCAR
//   - order  : ligne `orders`
//   - garage : ligne `garages`
//   - isPaid : (optionnel) si true, le bouton pousse direct en paid
//   - onSync : callback(patch) après sync pour rafraîchir l'order parent
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

export default function IobillInvoiceSync({ token, order, garage, isPaid, onSync }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  const linked = !!garage?.iobill_company_id;
  const synced = !!order?.iobill_invoice_id && !order?.iobill_sync_error;
  const hasError = !!order?.iobill_sync_error;
  const orderIsPaid = (typeof isPaid === "boolean") ? isPaid : computeIsPaid(order);

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
        padding: "4px 10px", borderRadius: 999,
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
    pillBg = "rgba(229,73,73,0.10)";
    pillBorder = "rgba(229,73,73,0.35)";
    pillColor = "var(--red, #e54949)";
    pillLabel = "Échec transmission";
    pillIcon = "❌";
  } else if (!synced) {
    pillBg = "rgba(212,168,67,0.10)";
    pillBorder = "rgba(212,168,67,0.30)";
    pillColor = "var(--gold, #d4a843)";
    pillLabel = "Non transmise";
    pillIcon = "🦉";
  } else if (!orderIsPaid) {
    // Brouillon
    pillBg = "rgba(229,151,60,0.10)";
    pillBorder = "rgba(229,151,60,0.30)";
    pillColor = "var(--orange, #e5973c)";
    pillLabel = "En brouillon";
    pillIcon = "📝";
  } else {
    // Transmise et payée
    pillBg = "rgba(62,207,122,0.10)";
    pillBorder = "rgba(62,207,122,0.30)";
    pillColor = "var(--green, #3ecf7a)";
    pillLabel = "Transmise";
    pillIcon = "✅";
  }

  // ─── Mode compacté (pilule cliquable) ─────────────────────────
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        title="Cliquer pour voir le détail"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 12px", borderRadius: 999,
          background: pillBg,
          border: `1px solid ${pillBorder}`,
          color: pillColor,
          fontSize: 11, fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit"
        }}
      >
        <span>{pillIcon}</span>
        <span>{pillLabel}</span>
        <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>▾</span>
      </button>
    );
  }

  // ─── Mode déployé (détail complet) ────────────────────────────
  return (
    <div style={{
      padding: "10px 14px",
      borderRadius: 8,
      background: pillBg,
      border: `1px solid ${pillBorder}`,
      fontSize: 12,
      maxWidth: 320,
      display: "flex", flexDirection: "column", gap: 8
    }}>
      {/* Header avec bouton replier */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: pillColor, fontWeight: 600 }}>
          {pillIcon} {pillLabel === "Transmise" ? "Transmise à IO BILL" :
                     pillLabel === "En brouillon" ? "En brouillon IO BILL" :
                     pillLabel === "Échec transmission" ? "Échec transmission" :
                     "Non transmise"}
        </span>
        <button
          onClick={() => setExpanded(false)}
          title="Replier"
          style={{
            marginLeft: "auto",
            background: "transparent", border: 0, cursor: "pointer",
            color: "var(--muted)", fontSize: 11, padding: "2px 6px"
          }}
        >
          ▴
        </button>
      </div>

      {/* Détails selon état */}
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
          {order.iobill_pdf_url ? (
            <a
              href={order.iobill_pdf_url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--gold, #d4a843)",
                textDecoration: "underline",
                marginTop: 2
              }}
            >
              Voir le PDF Factur-X ↗
            </a>
          ) : (orderIsPaid && (
            <div style={{ marginTop: 2 }}>⏳ PDF Factur-X en génération</div>
          ))}
        </div>
      )}

      {!synced && !hasError && (
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          Cette facture n'a pas encore été transmise à IO BILL.
        </div>
      )}

      {/* Action */}
      <button
        onClick={orderIsPaid ? markPaid : pushDraft}
        disabled={busy}
        style={{
          padding: "6px 12px", borderRadius: 6,
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
         orderIsPaid ? "🔄 Re-transmettre" :
         "Forcer émission"}
      </button>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 11 }}>❌ {error}</div>
      )}
    </div>
  );
}
