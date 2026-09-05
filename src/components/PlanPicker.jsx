import React from "react";
import { PLAN_LIST } from "../lib/plans.js";

/**
 * Choix de la formule d'abonnement — mensuel ou annuel.
 *
 * Deux présentations pour deux emplacements :
 *   • compact : une paire de pastilles, pour le bandeau d'essai qui est une
 *     bande fine et déjà chargée en texte ;
 *   • normale : deux cartes avec prix et badge, pour les Paramètres.
 */
export function PlanPicker({ value, onChange, compact = false, disabled = false }) {
  if (compact) {
    return (
      <div style={{ display: "flex", gap: 6 }}>
        {PLAN_LIST.map(p => {
          const on = value === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => !disabled && onChange(p.key)}
              disabled={disabled}
              title={p.badge ? `${p.price} ${p.period} · ${p.badge}` : `${p.price} ${p.period}`}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: `1px solid ${on ? "var(--gold, #d4a843)" : "var(--border2, rgba(255,255,255,0.12))"}`,
                background: on ? "rgba(212,168,67,0.15)" : "transparent",
                color: on ? "var(--gold, #d4a843)" : "var(--muted, #8b8b99)",
                fontSize: 11,
                fontWeight: 600,
                cursor: disabled ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {p.label} · {p.price}
              {p.badge && <span style={{ marginLeft: 5, color: "var(--green, #3ecf7a)", fontWeight: 700 }}>{p.badge}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
      {PLAN_LIST.map(p => {
        const on = value === p.key;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => !disabled && onChange(p.key)}
            disabled={disabled}
            style={{
              position: "relative",
              padding: "14px 10px",
              borderRadius: 10,
              textAlign: "center",
              border: `1px solid ${on ? "var(--gold, #d4a843)" : "var(--border2, rgba(255,255,255,0.12))"}`,
              background: on ? "rgba(212,168,67,0.10)" : "var(--card2, #1a1d22)",
              color: "inherit",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {p.badge && (
              <div style={{
                position: "absolute", top: -9, left: "50%", transform: "translateX(-50%)",
                background: "var(--green, #3ecf7a)", color: "#fff", fontSize: 9, fontWeight: 700,
                padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap",
              }}>{p.badge}</div>
            )}
            <div style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 12, color: on ? "var(--gold, #d4a843)" : "var(--muted2, #b9b9c6)" }}>{p.label}</div>
            <div style={{ fontFamily: "Syne", fontWeight: 800, fontSize: 18, marginTop: 2 }}>{p.price}</div>
            <div style={{ fontSize: 10, color: "var(--muted, #8b8b99)", marginTop: 1 }}>{p.period}</div>
          </button>
        );
      })}
    </div>
  );
}
