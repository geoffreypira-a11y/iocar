// ═══════════════════════════════════════════════════════════════════
// Colonnes écrites par IO BILL mais absentes du schéma versionné
//
// L'autre moitié du même problème : une colonne oubliée fait échouer
// l'insertion ENTIÈRE côté PostgREST. C'est ce contrôle qui a rattrapé
// l'ajout de `terms` sur credit_notes, où la colonne n'existait pas.
//
//   node scripts/audit/pont-colonnes-absentes.mjs
//
// ⚠️ Il compare au SQL DU DÉPÔT. Des colonnes ajoutées à la main dans la
// console Supabase et jamais versionnées ressortiront en faux positifs :
// c'est un défaut à corriger, pas un bruit à ignorer.
// ═══════════════════════════════════════════════════════════════════
import fs from "node:fs";
const IOCAR = process.env.IOCAR_PATH || new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const IOBILL = process.env.IOBILL_PATH || IOCAR.replace(/[^/]+$/, "iobill");
const nettoyer = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
function clesPayload(src, nom) {
  const i = src.indexOf(`const ${nom} = {`);
  if (i < 0) throw new Error("payload introuvable : " + nom);
  let prof = 0, cles = [];
  for (let k = i + `const ${nom} = `.length; k < src.length; k++) {
    const ch = src[k];
    if (ch === "{" || ch === "[") { prof++; continue; }
    if (ch === "}" || ch === "]") { prof--; if (prof === 0) break; continue; }
    if (prof === 1) {
      const m = src.slice(k).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*([:,}])/);
      if (m && (src[k - 1] === "," || src[k - 1] === "{" || src[k - 1] === "\n")) { cles.push(m[1]); k += m[0].length - 2; }
    }
  }
  return [...new Set(cles)];
}
const iobill = nettoyer(fs.readFileSync(IOBILL + "/api/public.js", "utf8"));
const sqlDir = IOBILL + "/supabase/";
const sql = fs.readdirSync(sqlDir).filter(f => f.endsWith(".sql")).map(f => fs.readFileSync(sqlDir + f, "utf8")).join("\n")
  + fs.readdirSync(IOBILL + "/sql/").map(f => fs.readFileSync(IOBILL + "/sql/" + f, "utf8")).join("\n");

// Colonnes déclarées pour une table : CREATE TABLE + ALTER TABLE ... ADD COLUMN
function colonnes(table) {
  const set = new Set();
  const create = sql.match(new RegExp(`CREATE TABLE[^;]*?public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`));
  if (create) for (const l of create[1].split("\n")) {
    const m = l.match(/^\s*([a-z_][a-z0-9_]*)\s+[A-Z]/); if (m) set.add(m[1]);
  }
  const re = new RegExp(`ALTER TABLE\\s+public\\.${table}([\\s\\S]*?);`, "g");
  for (const a of sql.matchAll(re))
    for (const m of a[1].matchAll(/ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/g)) set.add(m[1]);
  return set;
}
let ko = 0;
for (const [titre, payload, table] of [
  ["FACTURE", "invoicePayload", "invoices"],
  ["AVOIR", "creditNotePayload", "credit_notes"],
]) {
  const cles = clesPayload(iobill, payload);
  const cols = colonnes(table);
  const absentes = cles.filter(k => !cols.has(k));
  console.log(`\n═══ ${titre} — ${cles.length} colonnes écrites dans ${table} ═══`);
  if (absentes.length) { ko += absentes.length; console.log(`  ❌ COLONNES ABSENTES DU SCHÉMA : ${absentes.join(", ")}`); }
  else console.log(`  ✅ toutes existent`);
}
console.log(`\n${ko === 0 ? "✅ Aucune écriture vers une colonne inexistante." : `❌ ${ko} écriture(s) impossibles.`}`);
