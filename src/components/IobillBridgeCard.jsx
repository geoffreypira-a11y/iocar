// src/components/IobillBridgeCard.jsx
// ═══════════════════════════════════════════════════════════════════
// Carte "Mon compte IO BILL inclus" pour la page Paramètres IOCAR.
//
// Fonctionnalités :
//   - Active le compte IOBILL inclus en 1 clic
//   - Modal pour utiliser le MÊME mot de passe qu'IOCAR (recommandé)
//   - Affiche l'état lié + email + date
//   - Toggle "Transmettre automatiquement les factures à IOBILL"
//   - Bouton "Resynchroniser les paramètres" pour pousser une MAJ
//
// Props :
//   - token  : JWT Supabase de l'user IOCAR connecté
//   - garage : ligne `garages` complète (lit iobill_* + iobill_auto_push)
//   - onUpdate : callback(patch) après modif, pour rafraîchir le parent
// ═══════════════════════════════════════════════════════════════════
import React, { useState, useEffect } from "react";

export default function IobillBridgeCard({ token, garage, onUpdate }) {
  const linked = !!garage?.iobill_company_id;
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [autoPush, setAutoPush] = useState(!!garage?.iobill_auto_push);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // v8.176 — Liaison incomplète : company_id enregistré mais jeton absent.
  // Le jeton ne quitte jamais le serveur, seul lui peut nous le dire.
  // Dans cet état la carte s'affichait « lié » et proposait la resynchro,
  // qui répondait « Compte IOBILL non lié » : aucune sortie possible, alors
  // que le pont sait déjà réparer (l'action « link » est idempotente et
  // rejoue la liaison). Il ne manquait que le bouton pour l'atteindre.
  const [aReparer, setAReparer] = useState(false);

  useEffect(() => {
    if (!token || !linked) { setAReparer(false); return; }
    let annule = false;
    (async () => {
      const r = await callBridge("status");
      if (annule || !r.ok) return;          // hors ligne : on ne crie pas au loup
      setAReparer(r.data.linked && !r.data.has_token);
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, linked, garage?.iobill_company_id]);

  async function callBridge(action, body = {}) {
    const r = await fetch("/api/iobill-bridge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      return { ok: false, error: j.error || j.details || `HTTP ${r.status}` };
    }
    return { ok: true, data: j };
  }

  async function doLink(password, reparer = false) {
    setBusy(true); setErr(""); setMsg("");
    const corps = password ? { password } : {};
    if (reparer) corps.repair = true;   // rejoue la liaison même si elle semble complète
    const r = await callBridge("link", corps);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return false; }
    // v8.178 — Une réparation ne touche jamais au mot de passe IO BILL : si le
    // compte utilisateur existait encore, IOBILL refuse de l'écraser (sinon on
    // casserait un compte que l'abonné utilise déjà) ; s'il a été recréé, il
    // l'est sans mot de passe. Dans les deux cas la connexion passe par
    // « Mot de passe oublié », et le dire évite une demi-heure de tâtonnement.
    setMsg(reparer || aReparer
      ? "✅ Liaison IO BILL réparée. Si la connexion à IO BILL échoue, utilisez « Mot de passe oublié » sur app.iobill.online : une réparation ne modifie jamais votre mot de passe."
      : "✅ Compte IO BILL activé !");
    setAReparer(false);
    if (onUpdate) onUpdate({
      iobill_company_id: r.data.iobill_company_id,
      iobill_email: r.data.iobill_email,
      iobill_linked_at: new Date().toISOString()
    });
    setShowActivateModal(false);
    return true;
  }

  async function doSync() {
    setBusy(true); setErr(""); setMsg("");
    const r = await callBridge("sync_company");
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setMsg(`✅ Paramètres synchronisés (${(r.data.updated_fields || []).length} champs)`);
    setTimeout(() => setMsg(""), 3500);
  }

  async function toggleAutoPush(v) {
    setBusy(true); setErr(""); setMsg("");
    const r = await callBridge("set_auto_push", { enabled: v });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setAutoPush(v);
    if (onUpdate) onUpdate({ iobill_auto_push: v });
  }

  // ─── STYLES ─────────────────────────────────────────────────────
  const styles = {
    card: {
      padding: 16, borderRadius: 10,
      border: "1px solid var(--border, rgba(255,255,255,0.08))",
      background: "rgba(212,168,67,0.04)", marginBottom: 16
    },
    title: { fontSize: 16, fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 },
    sub: { fontSize: 12, color: "var(--muted, #8a8d93)", marginBottom: 12, lineHeight: 1.5 },
    btn: {
      padding: "10px 22px", borderRadius: 8, border: 0,
      background: "var(--gold, #d4a843)", color: "#0b0c10",
      fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1
    },
    btnGhost: {
      padding: "8px 14px", borderRadius: 8,
      border: "1px solid var(--border, rgba(255,255,255,0.12))",
      background: "transparent", color: "var(--text)",
      fontSize: 12, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1
    },
    err: { marginTop: 10, padding: 10, borderRadius: 6, background: "rgba(229,73,73,0.08)",
           border: "1px solid rgba(229,73,73,0.3)", color: "var(--red, #e54949)", fontSize: 12 },
    ok: { marginTop: 10, padding: 10, borderRadius: 6, background: "rgba(62,207,122,0.08)",
          border: "1px solid rgba(62,207,122,0.3)", color: "var(--green, #3ecf7a)", fontSize: 12 },
    pill: { display: "inline-block", padding: "2px 8px", borderRadius: 12,
            background: "rgba(62,207,122,0.15)", color: "var(--green, #3ecf7a)",
            fontSize: 10, fontWeight: 700, letterSpacing: 0.3, marginLeft: 8 }
  };

  // ─── RENDU ──────────────────────────────────────────────────────
  if (!linked) {
    return (
      <>
        <div style={styles.card}>
          <div style={styles.title}>🦉 Mon compte IO BILL — inclus dans votre abonnement</div>
          <div style={styles.sub}>
            Votre abonnement IO CAR inclut un compte IO BILL gratuit pour la facturation
            conforme Factur-X (obligatoire dès 2026). Activez-le en un clic : un compte sera
            créé à votre nom avec l'email <strong>{garage?.email || "—"}</strong>.
            Toutes les factures que vous créez dans IO CAR pourront ensuite être transmises
            à IO BILL.
          </div>
          <button style={styles.btn} onClick={() => setShowActivateModal(true)} disabled={busy}>
            ✨ Activer mon compte IO BILL inclus
          </button>
          {err && <div style={styles.err}>❌ {err}</div>}
          {msg && <div style={styles.ok}>{msg}</div>}
        </div>

        {showActivateModal && (
          <ActivateModal
            email={garage?.email || ""}
            onCancel={() => { setShowActivateModal(false); setErr(""); }}
            onActivate={doLink}
            busy={busy}
            error={err}
          />
        )}
      </>
    );
  }

  // Linked
  return (
    <div style={styles.card}>
      <div style={styles.title}>
        🦉 Mon compte IO BILL
        <span style={styles.pill}>ACTIVÉ</span>
      </div>
      <div style={styles.sub}>
        Votre compte IO BILL inclus dans votre abonnement IO CAR est actif.
      </div>

      <div style={{
        padding: 12, borderRadius: 8, fontSize: 12,
        background: "rgba(62,207,122,0.08)", border: "1px solid rgba(62,207,122,0.25)",
        color: "var(--green, #3ecf7a)", marginBottom: 12
      }}>
        ✅ Compte lié à <strong>{garage.iobill_email}</strong>
        {garage.iobill_linked_at && (
          <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>
            · depuis le {new Date(garage.iobill_linked_at).toLocaleDateString("fr-FR")}
          </span>
        )}
      </div>

      {/* Toggle auto-push */}
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        padding: 12, borderRadius: 8, marginBottom: 12,
        border: "1px solid var(--border, rgba(255,255,255,0.08))"
      }}>
        <input
          type="checkbox"
          id="auto_push"
          checked={autoPush}
          onChange={(e) => toggleAutoPush(e.target.checked)}
          disabled={busy}
          style={{ accentColor: "var(--gold)", width: 18, height: 18, marginTop: 2 }}
        />
        <label htmlFor="auto_push" style={{ flex: 1, cursor: "pointer", fontSize: 13 }}>
          <div style={{ fontWeight: 600 }}>
            Transmettre automatiquement les factures à IO BILL
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Dès qu'un bon de commande passe en facture, IO CAR pousse la facture
            à IO BILL au format Factur-X conforme DGFiP. Sinon, vous pourrez le
            faire manuellement via le bouton « Transmettre à IO BILL ».
          </div>
        </label>
      </div>

      {aReparer && (
        <div style={{
          background: "rgba(229,151,60,.10)", border: "1px solid rgba(229,151,60,.35)",
          borderRadius: 8, padding: "12px 14px", marginBottom: 12,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--orange)", marginBottom: 4 }}>
            ⚠️ Liaison incomplète
          </div>
          <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 1.5, marginBottom: 10 }}>
            Le compte est bien rattaché à IO BILL, mais la clé d'accès manque —
            la synchronisation et l'envoi des factures échouent. La réparation
            rejoue la liaison, sans rien perdre de vos données.
          </div>
          <button style={styles.btn} onClick={() => doLink(null, true)} disabled={busy}>
            {busy ? "Réparation..." : "🔧 Réparer la liaison"}
          </button>
        </div>
      )}

      {/* Resync paramètres */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={styles.btnGhost} onClick={doSync} disabled={busy}>
          🔄 Resynchroniser mes paramètres
        </button>
        <a
          href="https://app.iobill.online"
          target="_blank"
          rel="noreferrer"
          style={{ ...styles.btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center" }}
        >
          ↗ Accéder à mon espace IO BILL
        </a>
      </div>

      {/* v8.177 — Une action qui échoue alors que le compte est présenté comme
          lié, c'est presque toujours une liaison morte : la société a été
          supprimée ou suspendue côté IO BILL, et IO CAR n'a aucun moyen de le
          deviner — il a bien son identifiant et sa clé, ils ne désignent plus
          rien. On propose donc la réparation à côté de l'erreur, quelle qu'elle
          soit, plutôt que de laisser l'abonné devant un « Échec » sans issue. */}
      {err && (
        <div style={styles.err}>
          ❌ {err}
          <div style={{ marginTop: 10 }}>
            <button style={styles.btn} onClick={() => doLink(null, true)} disabled={busy}>
              {busy ? "Réparation..." : "🔧 Réparer la liaison"}
            </button>
            <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 6, lineHeight: 1.5 }}>
              Rétablit le lien avec IO BILL. Votre société y est réutilisée si elle
              existe encore, recréée sinon. Vos données IO CAR ne sont pas touchées.
            </div>
          </div>
        </div>
      )}
      {msg && <div style={styles.ok}>{msg}</div>}

      <div style={{ marginTop: 12, fontSize: 11, color: "var(--muted)" }}>
        Identifiants IO BILL : <strong>{garage.iobill_email}</strong>
        {" · "}
        Mot de passe : celui défini à l'activation, s'il l'a été. Sinon — ou après
        une réparation, qui ne le modifie pas — passez par « Mot de passe oublié »
        sur app.iobill.online.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ActivateModal — modale pour demander le mot de passe IOCAR
// (afin de l'utiliser comme MDP du compte IOBILL aussi)
// ═══════════════════════════════════════════════════════════════════
function ActivateModal({ email, onCancel, onActivate, busy, error }) {
  const [password, setPassword] = useState("");
  const [useSamePwd, setUseSamePwd] = useState(true);

  async function submit() {
    if (useSamePwd) {
      if (!password) return;
      await onActivate(password);
    } else {
      await onActivate(null);
    }
  }

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000, padding: 20
  };
  const modal = {
    background: "var(--card-bg, #1a1d22)",
    border: "1px solid var(--border, rgba(255,255,255,0.1))",
    borderRadius: 12, padding: 22, maxWidth: 480, width: "100%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
  };
  const btnPrimary = {
    padding: "10px 22px", borderRadius: 8, border: 0,
    background: "var(--gold, #d4a843)", color: "#0b0c10",
    fontWeight: 700, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1
  };
  const btnSecondary = {
    padding: "10px 18px", borderRadius: 8,
    border: "1px solid var(--border, rgba(255,255,255,0.12))",
    background: "transparent", color: "var(--text)",
    fontSize: 13, cursor: "pointer"
  };

  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          🦉 Activation du compte IO BILL inclus
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 18, lineHeight: 1.5 }}>
          Un compte IO BILL va être créé avec l'email <strong>{email}</strong>.
          <br/><br/>
          Pour vous simplifier la vie, vous pouvez utiliser le <strong>même mot de passe que sur IO CAR</strong>.
        </div>

        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: 12, borderRadius: 8, marginBottom: 14,
          background: "rgba(212,168,67,0.06)",
          border: "1px solid rgba(212,168,67,0.2)"
        }}>
          <input
            type="checkbox"
            id="useSamePwd"
            checked={useSamePwd}
            onChange={(e) => setUseSamePwd(e.target.checked)}
            style={{ accentColor: "var(--gold)", width: 16, height: 16, marginTop: 2 }}
          />
          <label htmlFor="useSamePwd" style={{ flex: 1, cursor: "pointer", fontSize: 13 }}>
            Utiliser le <strong>même mot de passe que sur IO CAR</strong> (recommandé)
          </label>
        </div>

        {useSamePwd && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Retapez votre mot de passe IO CAR pour confirmer :
            </label>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && password) submit(); }}
              placeholder="Mot de passe IO CAR"
              style={{
                width: "100%", padding: "10px 14px", fontSize: 14,
                borderRadius: 8, border: "1px solid var(--border, rgba(255,255,255,0.12))",
                background: "rgba(0,0,0,0.2)", color: "var(--text)"
              }}
            />
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>
              Votre mot de passe n'est ni stocké ni transmis en clair — il sert juste à
              créer votre compte IO BILL avec les mêmes identifiants.
            </div>
          </div>
        )}

        {!useSamePwd && (
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
            ℹ️ Sans mot de passe, vous devrez faire "Mot de passe oublié" sur app.iobill.online
            la première fois que vous souhaiterez accéder à IO BILL séparément.
          </div>
        )}

        {error && (
          <div style={{ padding: 10, borderRadius: 6, marginBottom: 12,
                        background: "rgba(229,73,73,0.08)", border: "1px solid rgba(229,73,73,0.3)",
                        color: "var(--red)", fontSize: 12 }}>
            ❌ {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button style={btnSecondary} onClick={onCancel}>Annuler</button>
          <button
            style={btnPrimary}
            onClick={submit}
            disabled={busy || (useSamePwd && !password)}
          >
            {busy ? "Activation…" : "✨ Activer mon compte"}
          </button>
        </div>
      </div>
    </div>
  );
}
