import React, { useState } from "react";
import { cleanSiren, isSirenSearchable, lookupEntreprise } from "../lib/siren.js";

/**
 * Champ « SIRET (14) ou SIREN (9) » avec son bouton de recherche.
 *
 * L'appelant garde la maîtrise du remplissage : on lui rend les données de
 * l'annuaire via `onResult`, à lui de décider ce qu'il écrase et ce qu'il
 * respecte. Le composant ne connaît aucun formulaire en particulier.
 *
 * @param {string}   value     numéro saisi
 * @param {Function} onChange  (numéro nettoyé) => void
 * @param {Function} onResult  (données annuaire) => void — voir lib/siren.js
 * @param {string}   label     libellé du champ
 * @param {boolean}  full      occupe toute la largeur de la grille
 */
export function SirenLookup({ value, onChange, onResult, label = "SIRET (14) ou SIREN (9)", full = false }) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState(null); // { type: "ok"|"err", text }
  const ready = isSirenSearchable(value);

  const run = async () => {
    setLoading(true);
    setNote(null);
    const res = await lookupEntreprise(value);
    setLoading(false);
    if (!res.ok) {
      setNote({ type: "err", text: res.error });
      return;
    }
    onResult(res.data);
    setNote({
      type: "ok",
      text: res.data.ferme
        ? `${res.data.raison_sociale} — ⚠ établissement fermé au registre`
        : `${res.data.raison_sociale} — informations récupérées`,
    });
  };

  return (
    <div className={full ? "form-group full" : "form-group"}>
      <label className="form-label">{label}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="form-input"
          value={value || ""}
          onChange={e => { onChange(cleanSiren(e.target.value)); setNote(null); }}
          placeholder="9 ou 14 chiffres"
          style={{ flex: 1, fontFamily: "DM Mono" }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={run}
          disabled={loading || !ready}
          title={ready ? "Récupérer la raison sociale et l'adresse depuis l'annuaire des entreprises" : "Saisissez 9 ou 14 chiffres"}
          style={{ whiteSpace: "nowrap" }}
        >
          {loading ? "⏳..." : "🔍 Récupérer"}
        </button>
      </div>
      {note && (
        <div style={{ fontSize: 11, marginTop: 4, color: note.type === "ok" ? "var(--green, #3ecf7a)" : "#e0605e" }}>
          {note.text}
        </div>
      )}
      {!note && value && !ready && (
        <div style={{ fontSize: 11, marginTop: 4, color: "var(--orange)" }}>
          ⚠️ {cleanSiren(value).length} chiffre{cleanSiren(value).length > 1 ? "s" : ""} — il en faut 9 (SIREN) ou 14 (SIRET)
        </div>
      )}
    </div>
  );
}
