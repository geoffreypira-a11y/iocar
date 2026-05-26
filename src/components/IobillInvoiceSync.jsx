// src/components/IobillInvoiceSync.jsx
// ═══════════════════════════════════════════════════════════════════
// Bandeau d'état "🦉 Transmission IO BILL" sur l'écran d'une facture IOCAR.
//
// Architecture (v8.37) : IOCAR est SOURCE de vérité, IOBILL est lecture seule.
//   1. BC → Facture (auto via hook front App.jsx) : push en status='draft'
//   2. Clic "Livré" (auto via hook FleetPage) : update vers status='paid'
//
// Ce composant ne déclenche RIEN automatiquement. Il affiche l'état actuel
// (synchronisé ou pas, draft ou paid, erreur ou OK), et propose un bouton
// "Réessayer" pour les cas où la sync auto a échoué.
//
// Props :
//   - token  : JWT Supabase IOCAR
//   - order  : ligne `orders`
//   - garage : ligne `garages`
//   - isPaid : (optionnel) si true, le bouton pousse direct en paid
//   - onSync : callback(patch) après sync pour rafraîchir l'order parent
// ═══════════════════════════════════════════════════════════════════
import React, { useState } from "react";

// Réplique frontend de calcOrder côté backend
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

  const linked = !!garage?.iobill_company_id;
  const synced = !!order?.iobill_invoice_id && !order?.iobill_sync_error;
  const hasError = !!order?.iobill_sync_error;
  const orderIsPaid = (typeof isPaid === "boolean") ? isPaid : computeIsPaid(order);

  // Ne s'affiche que pour factures/avoirs (pas les BC)
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

  // ─── Pas lié ───────────────────────────────────────────────────
  if (!linked) {
    return (
      <div style={{
        padding: "8px 12px", borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
        border: "1px dashed rgba(255,255,255,0.15)",
        fontSize: 11, color: "var(--muted)",
        display: "inline-flex", alignItems: "center", gap: 6
      }}>
        🦉 IO BILL non activé.
        <a href="/parametres" style={{ color: "var(--gold)", textDecoration: "underline" }}>
          L'activer ici
        </a>
      </div>
    );
  }

  // ─── Erreur de sync précédente ────────────────────────────────
  if (hasError) {
    return (
      <div style={{
        padding: "10px 12px", borderRadius: 8,
        background: "rgba(229,73,73,0.08)",
        border: "1px solid rgba(229,73,73,0.25)",
        fontSize: 12
      }}>
        <div style={{ color: "var(--red, #e54949)", fontWeight: 600, marginBottom: 4 }}>
          ❌ Échec de transmission à IO BILL
        </div>
        <div style={{ color: "var(--muted)", fontSize: 11, marginBottom: 8 }}>
          {order.iobill_sync_error}
        </div>
        <button
          onClick={orderIsPaid ? markPaid : pushDraft}
          disabled={busy}
          style={{
            padding: "6px 14px", borderRadius: 6, border: 0,
            background: "var(--gold, #d4a843)", color: "#0b0c10",
            fontWeight: 700, fontSize: 11, cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.6 : 1
          }}
        >
          {busy ? "Réessai…" : "🔁 Réessayer la transmission"}
        </button>
        {error && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 6 }}>❌ {error}</div>}
      </div>
    );
  }

  // ─── Synchronisée ──────────────────────────────────────────────
  if (synced) {
    // Heuristique : si l'order IOCAR est payé et synchronisé, côté IOBILL c'est aussi paid
    const isPaidOnIobill = orderIsPaid;

    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: "8px 12px", borderRadius: 8,
        background: isPaidOnIobill ? "rgba(62,207,122,0.08)" : "rgba(212,168,67,0.06)",
        border: "1px solid " + (isPaidOnIobill ? "rgba(62,207,122,0.25)" : "rgba(212,168,67,0.25)"),
        fontSize: 12
      }}>
        <span style={{
          color: isPaidOnIobill ? "var(--green, #3ecf7a)" : "var(--gold, #d4a843)",
          fontWeight: 600
        }}>
          {isPaidOnIobill ? "✅ Transmise à IO BILL" : "📝 En brouillon IO BILL"}
        </span>
        {!isPaidOnIobill && (
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            (sera émise au passage « 🚗 Livré »)
          </span>
        )}
        {order.iobill_synced_at && (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            · {new Date(order.iobill_synced_at).toLocaleString("fr-FR", {
                day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
              })}
          </span>
        )}
        {order.iobill_invoice_number && (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            · N° {order.iobill_invoice_number}
          </span>
        )}
        {order.iobill_pdf_url && (
          <a
            href={order.iobill_pdf_url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--gold, #d4a843)",
              fontSize: 11,
              textDecoration: "underline"
            }}
          >
            Voir le PDF Factur-X ↗
          </a>
        )}
        {isPaidOnIobill && !order.iobill_pdf_url && (
          <span style={{ color: "var(--muted)", fontSize: 11 }}>
            ⏳ PDF Factur-X en génération
          </span>
        )}
        <button
          onClick={isPaidOnIobill ? markPaid : (orderIsPaid ? markPaid : pushDraft)}
          disabled={busy}
          style={{
            marginLeft: "auto",
            padding: "4px 10px", borderRadius: 6,
            border: "1px solid var(--border, rgba(255,255,255,0.15))",
            background: "transparent", color: "var(--muted)",
            fontSize: 10, cursor: busy ? "wait" : "pointer"
          }}
          title={isPaidOnIobill
            ? "Renvoyer la facture (en cas de modification)"
            : "Forcer le passage en payée (utile si le hook auto a échoué)"
          }
        >
          {busy ? "…" : (isPaidOnIobill ? "🔄 Re-transmettre" : "Forcer émission")}
        </button>
        {error && (
          <div style={{ width: "100%", color: "var(--red)", fontSize: 11, marginTop: 4 }}>
            ❌ {error}
          </div>
        )}
      </div>
    );
  }

  // ─── Pas encore synchronisée ──────────────────────────────────
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={orderIsPaid ? markPaid : pushDraft}
        disabled={busy}
        style={{
          padding: "8px 16px", borderRadius: 8,
          border: 0, background: "var(--gold, #d4a843)", color: "#0b0c10",
          fontWeight: 700, fontSize: 12, cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.6 : 1,
          display: "inline-flex", alignItems: "center", gap: 6
        }}
        title={orderIsPaid
          ? "Transmettre la facture en statut PAYÉE à IOBILL"
          : "Transmettre la facture en BROUILLON à IOBILL (sera finalisée au Livré)"
        }
      >
        {busy
          ? "⏳ Transmission…"
          : (orderIsPaid ? "🦉 Transmettre à IO BILL" : "🦉 Transmettre en brouillon")
        }
      </button>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>
        {orderIsPaid
          ? "→ La facture sera marquée comme payée dans IO BILL"
          : "→ Mode brouillon en attendant le passage « Livré »"
        }
      </div>
      {error && (
        <div style={{
          padding: "6px 10px", borderRadius: 6, marginTop: 4,
          background: "rgba(229,73,73,0.08)", border: "1px solid rgba(229,73,73,0.3)",
          color: "var(--red)", fontSize: 11
        }}>
          ❌ {error}
        </div>
      )}
    </div>
  );
}
