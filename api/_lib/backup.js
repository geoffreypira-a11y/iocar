// IO CAR — Sauvegarde des données
// ═══════════════════════════════════════════════════════════════════
// Module partagé par deux appelants :
//   • api/admin.js action `backup_save` — déclenchement manuel par l'admin
//   • api/backup-cron.js               — déclenchement quotidien par Vercel
//
// Le plan Supabase gratuit n'offre AUCUNE sauvegarde automatique
// restaurable. Ces fichiers sont donc la seule protection des données —
// dont le LIVRE DE POLICE, dont la conservation est une obligation
// légale (art. R.321-3 du Code pénal).
//
// Rotation plutôt qu'écrasement : un fichier daté par jour, les 30
// derniers conservés. Une sauvegarde qui écrase ne protège que des
// pannes remarquées sous 24 h — or une perte silencieuse se découvre des
// jours plus tard, quand la bonne copie a déjà été remplacée par l'état
// abîmé.

import { getServiceClient } from './auth.js';

export const KEEP_DAYS = 30;

// Tables rattachées à un garage.
// `support_tickets` et `ticket_messages` s'ajoutent aux quatre d'origine :
// ce ne sont pas des pièces comptables, mais rien ne justifiait de les
// perdre.
export const GARAGE_TABLES = [
  'vehicles',
  'orders',
  'clients',
  'livre_police',
  'support_tickets',
  'ticket_messages',
];

/**
 * Construit l'objet de sauvegarde complet.
 *
 * Une table absente ou en erreur renvoie [] plutôt que de faire échouer
 * la sauvegarde — mais le manifeste enregistre le compte réel, pour
 * qu'une table vide se voie au lieu de passer inaperçue.
 */
export async function buildBackup(supabase, backupType = 'manual') {
  const { data: garages } = await supabase
    .from('garages').select('*').order('created_at', { ascending: true });

  const manifest = {};
  const bump = (t, n) => { manifest[t] = (manifest[t] || 0) + n; };

  const backup = {
    version: '2.0',
    platform: 'iocar',
    backup_date: new Date().toISOString(),
    backup_type: backupType,
    total_garages: garages?.length || 0,
    garages: [],
    manifest: {},
  };

  for (const g of garages || []) {
    // La ligne `garages` est copiée EN ENTIER. Elle ne l'était qu'en sept
    // champs : adresse, mentions légales, conditions de règlement, clé
    // RapidAPI et paramètres de facturation étaient perdus à la
    // restauration — la concession repartait sans son identité.
    const gData = { ...g, data: {} };

    // Les tables d'un garage sont lues EN PARALLÈLE : en série, le
    // nombre d'allers-retours approcherait le plafond de 60 s du plan
    // Hobby. Les garages restent traités l'un après l'autre, ce qui
    // borne le nombre de requêtes simultanées.
    const lots = await Promise.all(
      GARAGE_TABLES.map(async (t) => {
        const { data: rows } = await supabase
          .from(t).select('*').eq('garage_id', g.id).order('created_at', { ascending: true });
        return [t, rows || []];
      })
    );
    for (const [t, rows] of lots) {
      gData.data[t] = rows;
      bump(t, rows.length);
    }
    backup.garages.push(gData);
  }

  bump('garages', garages?.length || 0);
  backup.manifest = manifest;
  return backup;
}

/**
 * Supprime les sauvegardes datées de plus de KEEP_DAYS jours.
 * `backup_latest.json` n'est jamais touché.
 */
export async function purgeOldBackups(supabase, keepDays = KEEP_DAYS) {
  const { data: files } = await supabase.storage.from('backups').list('', { limit: 1000 });
  const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString().slice(0, 10);
  const doomed = (files || [])
    .map((f) => f.name)
    .filter((name) => {
      const m = /^backup_(\d{4}-\d{2}-\d{2})/.exec(name || '');
      return m && m[1] < cutoff;
    });

  if (doomed.length === 0) return [];
  const { error } = await supabase.storage.from('backups').remove(doomed);
  return error ? [] : doomed;
}

/**
 * Construit, dépose et fait tourner la sauvegarde.
 * Écrit le fichier daté du jour (conservé KEEP_DAYS jours) et
 * `backup_latest.json` (écrasé à chaque passage, pour l'affichage et le
 * téléchargement rapide).
 */
export async function saveBackup(backupType = 'manual') {
  const supabase = getServiceClient();
  const backup = await buildBackup(supabase, backupType);
  const json = JSON.stringify(backup);
  const filename = `backup_${new Date().toISOString().slice(0, 10)}.json`;

  const { error: upErr } = await supabase.storage
    .from('backups')
    .upload(filename, json, { contentType: 'application/json', upsert: true });
  if (upErr) throw new Error(upErr.message);

  await supabase.storage
    .from('backups')
    .upload('backup_latest.json', json, { contentType: 'application/json', upsert: true });

  const purged = await purgeOldBackups(supabase);

  return {
    ok: true,
    filename,
    backup_type: backupType,
    total_garages: backup.total_garages,
    size_kb: Math.round(json.length / 1024),
    manifest: backup.manifest,
    purged: purged.length,
  };
}
