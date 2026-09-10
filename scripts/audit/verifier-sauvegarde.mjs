#!/usr/bin/env node
// Vérifie qu'un fichier de sauvegarde IO CAR est exploitable.
//
//   node scripts/audit/verifier-sauvegarde.mjs ~/Téléchargements/iocar_backup_2026-09-10.json
//
// Ne restaure rien, n'écrit rien : il lit et il juge. À passer sur un
// fichier téléchargé depuis l'admin, avant de considérer qu'on est
// couvert. Le plan Supabase gratuit n'offrant aucune sauvegarde
// automatique restaurable, ce fichier est la seule protection —
// autant savoir ce qu'il contient AVANT d'en avoir besoin.

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/audit/verifier-sauvegarde.mjs <fichier.json>');
  process.exit(2);
}

let backup;
try {
  backup = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`❌ Fichier illisible : ${e.message}`);
  process.exit(1);
}

const problemes = [];
const alertes = [];

console.log(`\nFichier   : ${path}`);
console.log(`Version   : ${backup.version || '?'} · ${backup.platform || '?'}`);
console.log(`Daté du   : ${backup.backup_date || '?'} (${backup.backup_type || 'type inconnu'})`);

if (backup.backup_date) {
  const jours = Math.floor((Date.now() - new Date(backup.backup_date)) / 86400000);
  console.log(`Âge       : ${jours} jour(s)`);
  if (jours > 7) problemes.push(`La sauvegarde a ${jours} jours — le cron quotidien ne tourne plus.`);
  else if (jours > 2) alertes.push(`La sauvegarde a ${jours} jours.`);
}

const garages = backup.garages || [];
console.log(`Garages   : ${garages.length}`);
if (garages.length === 0) problemes.push('Aucun garage dans la sauvegarde.');

const total = {};
for (const g of garages) {
  for (const [t, rows] of Object.entries(g.data || {})) {
    total[t] = (total[t] || 0) + (Array.isArray(rows) ? rows.length : 0);
  }
}

console.log('\nContenu :');
for (const t of Object.keys(total).sort()) {
  console.log(`  ${t.padEnd(20)} ${String(total[t]).padStart(6)}`);
}

// ── Les vérifications qui comptent ─────────────────────────────────

// 1. Le livre de police est une obligation légale (art. R.321-3 C. pén.).
//    Un garage qui a vendu des véhicules et n'a aucune entrée est suspect.
for (const g of garages) {
  const lp = (g.data?.livre_police || []).length;
  const ventes = (g.data?.orders || []).filter((o) => o.type === 'facture').length;
  if (ventes > 0 && lp === 0) {
    problemes.push(
      `« ${g.name || g.id} » : ${ventes} facture(s) mais AUCUNE entrée de livre de police. ` +
      `Sa conservation est une obligation légale.`
    );
  }
}

// 2. La ligne `garages` doit être complète, pas un extrait.
for (const g of garages) {
  const champs = Object.keys(g).filter((k) => k !== 'data');
  if (champs.length < 12) {
    problemes.push(
      `« ${g.name || g.id} » n'a que ${champs.length} champs sauvegardés : adresse, mentions ` +
      `légales et paramètres de facturation sont probablement absents.`
    );
    break;
  }
}

// 3. Cohérence : une facture doit pointer un véhicule présent.
let orphelines = 0;
for (const g of garages) {
  const vins = new Set((g.data?.vehicles || []).map((v) => v.id));
  for (const o of g.data?.orders || []) {
    if (o.vehicle_id && !vins.has(o.vehicle_id)) orphelines++;
  }
}
if (orphelines > 0) {
  alertes.push(`${orphelines} commande(s) référencent un véhicule absent de la sauvegarde.`);
}

// 4. Manifeste cohérent avec le contenu réellement présent.
if (backup.manifest) {
  for (const [t, n] of Object.entries(backup.manifest)) {
    if (t === 'garages') continue;
    if ((total[t] || 0) !== n) {
      alertes.push(`Manifeste incohérent pour ${t} : annoncé ${n}, trouvé ${total[t] || 0}.`);
    }
  }
} else {
  alertes.push('Pas de manifeste — sauvegarde antérieure à la version 2.0.');
}

// ── Verdict ────────────────────────────────────────────────────────
console.log('');
for (const a of alertes)  console.log(`⚠️  ${a}`);
for (const p of problemes) console.log(`❌ ${p}`);

if (problemes.length === 0 && alertes.length === 0) {
  console.log('✅ Sauvegarde exploitable — rien à signaler.');
} else if (problemes.length === 0) {
  console.log(`\n✅ Sauvegarde exploitable, ${alertes.length} point(s) de vigilance.`);
} else {
  console.log(`\n❌ Sauvegarde NON exploitable en l'état — ${problemes.length} problème(s).`);
}
process.exit(problemes.length ? 1 : 0);
