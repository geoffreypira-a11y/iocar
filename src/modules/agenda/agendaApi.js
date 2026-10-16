// ═══════════════════════════════════════════════════════════════
//  AGENDA — accès aux données (PostgREST, comme le reste d'IO CAR)
// ═══════════════════════════════════════════════════════════════
// Module autonome : il ne lit et n'écrit que les tables agenda_*. Les règles
// d'accès de la base limitent chaque garage à ses propres lignes.

// Messages lisibles pour les refus levés par la base (migration_agenda.sql).
function messageErreur(texte, status) {
  const t = String(texte || "");
  if (t.includes("AGENDA_CHEVAUCHEMENT")) return "Ce collaborateur a déjà un rendez-vous sur ce créneau.";
  if (t.includes("AGENDA_ABSENCE")) return "Ce collaborateur est absent sur ce créneau.";
  if (t.includes("Collaborateur inconnu")) return "Ce collaborateur n'existe plus. Rechargez la page.";
  if (status === 401) return "Session expirée : reconnectez-vous.";
  if (status === 404 && t.includes("agenda_")) return "L'agenda n'est pas encore installé sur la base. Contactez le support.";
  return t || `Erreur ${status}`;
}

export function createAgendaApi({ url, apiKey, getToken, garageId }) {
  async function call(path, { method = "GET", body, prefer } = {}, retried = false) {
    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Jeton expiré : l'application sait le renouveler (même filet que les
    // autres écrans), on rejoue une fois.
    if (r.status === 401 && !retried && typeof window !== "undefined"
        && typeof window.__iocarRefreshNow === "function") {
      try {
        const fresh = await window.__iocarRefreshNow();
        if (fresh?.access_token) return call(path, { method, body, prefer }, true);
      } catch (_) { /* on remonte l'erreur d'origine */ }
    }
    if (!r.ok) {
      let txt = "";
      try { const j = await r.json(); txt = j.message || j.error || j.hint || JSON.stringify(j); }
      catch (_) { txt = await r.text().catch(() => ""); }
      throw new Error(messageErreur(txt, r.status));
    }
    if (r.status === 204) return null;
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  const g = `garage_id=eq.${garageId}`;
  const enc = encodeURIComponent;

  return {
    list(table, filter = "", order = "") {
      return call(`${table}?select=*&${g}${filter ? "&" + filter : ""}${order ? "&order=" + order : ""}`);
    },
    async insert(table, values) {
      const rows = await call(table, {
        method: "POST",
        body: Array.isArray(values)
          ? values.map(v => ({ ...v, garage_id: garageId }))
          : { ...values, garage_id: garageId },
        prefer: "return=representation",
      });
      return Array.isArray(values) ? rows : rows?.[0];
    },
    async update(table, id, values) {
      const { id: _i, garage_id: _g, created_at: _c, ...rest } = values;
      const rows = await call(`${table}?id=eq.${enc(id)}&${g}`, {
        method: "PATCH", body: rest, prefer: "return=representation",
      });
      return rows?.[0];
    },
    remove(table, id) {
      return call(`${table}?id=eq.${enc(id)}&${g}`, { method: "DELETE" });
    },
    removeWhere(table, filter) {
      return call(`${table}?${g}&${filter}`, { method: "DELETE" });
    },
    // RDV qui recouvrent la période [debut, fin[.
    appointmentsBetween(debut, fin) {
      return call(`agenda_appointments?select=*&${g}`
        + `&starts_at=lt.${enc(fin.toISOString())}&ends_at=gt.${enc(debut.toISOString())}&order=starts_at`);
    },
    timeOffBetween(debut, fin) {
      return call(`agenda_time_off?select=*&${g}`
        + `&starts_at=lt.${enc(fin.toISOString())}&ends_at=gt.${enc(debut.toISOString())}&order=starts_at`);
    },
    // RDV à venir (pour l'alerte « ce client a déjà un RDV »).
    upcomingAppointments() {
      return call(`agenda_appointments?select=*&${g}`
        + `&starts_at=gt.${enc(new Date().toISOString())}&status=in.(planned,confirmed)&order=starts_at&limit=500`);
    },
  };
}
