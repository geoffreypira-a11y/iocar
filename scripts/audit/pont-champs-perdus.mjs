// ═══════════════════════════════════════════════════════════════════
// Champs transmis par le pont mais jamais lus par IO BILL
//
// Trois bugs de septembre 2026 étaient le même : le pont envoyait un champ,
// `invoicePayload` / `creditNotePayload` étant des listes blanches, IO BILL le
// jetait en silence — payment_terms, vehicle_meta, business_mode. Rien ne
// plantait, la donnée disparaissait simplement.
//
//   node scripts/audit/pont-champs-perdus.mjs
//
// Suppose iobill cloné à côté (../iobill), surchargeable par IOBILL_PATH.
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
const IOCAR = process.env.IOCAR_PATH || new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const IOBILL = process.env.IOBILL_PATH || IOCAR.replace(/[^/]+$/, "iobill");

// Neutralise commentaires et chaînes : sans ça, un mot dans un commentaire
// ou un `${...}` de template passe pour une clé.
function nettoyer(src) {
  let out = "", i = 0, n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") { const j = src.indexOf("*/", i + 2); out += " ".repeat((j < 0 ? n : j + 2) - i); i = j < 0 ? n : j + 2; continue; }
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); out += " ".repeat((j < 0 ? n : j) - i); i = j < 0 ? n : j; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      out += " ".repeat(Math.min(j + 1, n) - i); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

function clesRetour(srcBrut, nomFonction) {
  const src = nettoyer(srcBrut);
  const i = src.indexOf(`function ${nomFonction}(`);
  if (i < 0) throw new Error("fonction introuvable : " + nomFonction);
  const j = src.indexOf("\nfunction ", i + 10);
  const corps = src.slice(i, j < 0 ? src.length : j);
  const r = corps.lastIndexOf("\n  return {");
  const debut = r + "\n  return ".length;
  let prof = 0, cles = [];
  for (let k = debut; k < corps.length; k++) {
    const ch = corps[k];
    if (ch === "{" || ch === "[") { prof++; continue; }
    if (ch === "}" || ch === "]") { prof--; if (prof === 0) break; continue; }
    if (prof === 1) {
      // `cle: valeur` ET la forme abrégée `cle,` — sans quoi lines, payments et
      // les montants de marge, tous écrits en abrégé, passeraient inaperçus.
      const m = corps.slice(k).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*([:,}])/);
      if (m && (corps[k - 1] === "," || corps[k - 1] === "{" || corps[k - 1] === "\n")) {
        cles.push(m[1]); k += m[0].length - 2;
      }
    }
  }
  return [...new Set(cles)];
}
const clesLues = (srcBrut, v) =>
  [...new Set([...nettoyer(srcBrut).matchAll(new RegExp(`\\b${v}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))].map(m => m[1]))];

const pont = fs.readFileSync(IOCAR + "/api/iobill-bridge.js", "utf8");
const iobill = fs.readFileSync(IOBILL + "/api/public.js", "utf8");
const schema = ["01_schema.sql","migration_v8_14_credit_notes.sql","migration_v8_38_mode_garage.sql"]
  .map(f => { try { return fs.readFileSync(IOBILL + "/supabase/" + f, "utf8"); } catch { return ""; } }).join("\n")
  + fs.readFileSync(IOBILL + "/sql/2026-09-09-avoirs-fiscal.sql", "utf8");

let total = 0;
for (const [titre, fnPont, varIobill] of [
  ["FACTURE", "mapOrderToInvoice", "invoice"],
  ["AVOIR", "mapOrderToCreditNote", "credit_note"],
]) {
  const envoye = clesRetour(pont, fnPont);
  const lu = clesLues(iobill, varIobill);
  const perdus = envoye.filter(k => !lu.includes(k));
  console.log(`\n═══ ${titre} — ${envoye.length} champs transmis ═══`);
  console.log(`  ${envoye.join(", ")}`);
  if (perdus.length) { total += perdus.length; console.log(`\n  ❌ JAMAIS LUS PAR IOBILL : ${perdus.join(", ")}`); }
  else console.log(`\n  ✅ tous lus`);
}
console.log(`\n${total === 0 ? "✅ Aucun champ perdu entre le pont et IOBILL." : `❌ ${total} champ(s) perdus.`}`);
