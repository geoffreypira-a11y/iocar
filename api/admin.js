// api/admin.js — endpoints admin sécurisés
// Route selon req.body.action : list | export | backup | toggle_active | set_plan | update_rapidapi
// Tout passe par la clé service_role côté serveur après vérification is_admin.
import { verifyUser, setCors } from './_lib/auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Authentification + vérification admin (côté serveur, pas front !)
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { garage, supabase } = auth;
    if (!garage || garage.is_admin !== true) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const { action, payload } = req.body || {};

    switch (action) {

      // ─── LISTE DE TOUS LES GARAGES ──────────────────────────
      case 'list': {
        const { data, error } = await supabase
          .from('garages')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ garages: data });
      }

      // ─── DONNÉES D'UN GARAGE SPÉCIFIQUE ─────────────────────
      case 'garage_data': {
        const { garageId } = payload || {};
        if (!garageId) return res.status(400).json({ error: 'garageId manquant' });
        const tables = ['vehicles', 'orders', 'clients', 'livre_police'];
        const data = {};
        for (const t of tables) {
          const { data: rows } = await supabase
            .from(t).select('*').eq('garage_id', garageId).order('created_at', { ascending: false });
          data[t] = rows || [];
        }
        return res.status(200).json({ data });
      }

      // ─── SUPPRIMER UNE ENTRÉE (admin uniquement) ────────────
      case 'delete_entry': {
        const { table, id } = payload || {};
        const allowed = ['vehicles', 'orders', 'clients', 'livre_police'];
        if (!allowed.includes(table) || !id) {
          return res.status(400).json({ error: 'Paramètres invalides' });
        }
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── TOGGLE is_active ───────────────────────────────────
      case 'toggle_active': {
        const { garageId, value } = payload || {};
        if (!garageId || typeof value !== 'boolean') {
          return res.status(400).json({ error: 'Paramètres invalides' });
        }
        const { error } = await supabase
          .from('garages')
          .update({ is_active: value, updated_at: new Date().toISOString() })
          .eq('id', garageId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── ARCHIVER UN GARAGE ─────────────────────────────────
      // L'utilisateur ne peut plus se connecter, mais ses données
      // sont conservées (LP 5 ans, factures 10 ans).
      case 'archive_garage': {
        const { garageId, raison } = payload || {};
        if (!garageId) return res.status(400).json({ error: 'garageId manquant' });
        const { error } = await supabase
          .from('garages')
          .update({
            _archived: true,
            is_active: false,
            archive_date: new Date().toISOString(),
            archive_raison: raison || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', garageId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── DÉSARCHIVER UN GARAGE ──────────────────────────────
      // Pour réactiver un compte client qui revient.
      case 'unarchive_garage': {
        const { garageId } = payload || {};
        if (!garageId) return res.status(400).json({ error: 'garageId manquant' });
        const { error } = await supabase
          .from('garages')
          .update({
            _archived: false,
            // is_active reste à false : le client doit se réabonner via Stripe Portal
            archive_date: null,
            archive_raison: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', garageId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── CHANGER LE PLAN ────────────────────────────────────
      case 'set_plan': {
        const { garageId, plan } = payload || {};
        const allowed = ['monthly', 'annual', 'starter', 'pro', 'trial'];
        if (!garageId || !allowed.includes(plan)) {
          return res.status(400).json({ error: 'Paramètres invalides' });
        }
        const { error } = await supabase
          .from('garages')
          .update({ plan, updated_at: new Date().toISOString() })
          .eq('id', garageId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── MODIFIER LA CLÉ RapidAPI D'UN GARAGE ───────────────
      case 'update_rapidapi': {
        const { garageId, rapidapi_key } = payload || {};
        if (!garageId) return res.status(400).json({ error: 'garageId manquant' });
        const { error } = await supabase
          .from('garages')
          .update({ rapidapi_key: rapidapi_key || null, updated_at: new Date().toISOString() })
          .eq('id', garageId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ─── EXPORT COMPLET (JSON) ──────────────────────────────
      case 'export_all': {
        const tables = ['vehicles', 'orders', 'clients', 'livre_police'];
        const { data: garages } = await supabase
          .from('garages').select('*').order('created_at', { ascending: true });

        const backup = {
          version: '1.0',
          exported_at: new Date().toISOString(),
          total_garages: garages?.length || 0,
          garages: [],
        };

        for (const g of garages || []) {
          const gData = { ...g, data: {} };
          for (const t of tables) {
            const { data: rows } = await supabase
              .from(t).select('*').eq('garage_id', g.id).order('created_at', { ascending: true });
            gData.data[t] = rows || [];
          }
          backup.garages.push(gData);
        }

        // NB : dans un vrai environnement prod, stream en réponse pour les gros volumes
        return res.status(200).json(backup);
      }

      // ─── BACKUP → STORAGE PRIVÉ ─────────────────────────────
      case 'backup_save': {
        const tables = ['vehicles', 'orders', 'clients', 'livre_police'];
        const { data: garages } = await supabase.from('garages').select('*');

        const backup = {
          version: '1.0',
          backup_date: new Date().toISOString(),
          backup_type: 'manual',
          total_garages: garages?.length || 0,
          garages: [],
        };

        for (const g of garages || []) {
          const gData = {
            id: g.id, name: g.name, email: g.email,
            siret: g.siret, plan: g.plan, is_active: g.is_active,
            created_at: g.created_at, data: {}
          };
          for (const t of tables) {
            const { data: rows } = await supabase
              .from(t).select('*').eq('garage_id', g.id).order('created_at', { ascending: true });
            gData.data[t] = rows || [];
          }
          backup.garages.push(gData);
        }

        const json = JSON.stringify(backup);
        const filename = `backup_${new Date().toISOString().slice(0,10)}.json`;

        // Upload dans le bucket 'backups' (privé, aucun user n'y a accès — seul service_role)
        const { error: upErr } = await supabase.storage
          .from('backups')
          .upload(filename, json, {
            contentType: 'application/json',
            upsert: true,
          });

        if (upErr) return res.status(500).json({ error: upErr.message });

        // Upload aussi en 'backup_latest.json' pour le check rapide
        await supabase.storage
          .from('backups')
          .upload('backup_latest.json', json, {
            contentType: 'application/json',
            upsert: true,
          });

        return res.status(200).json({
          ok: true,
          filename,
          total_garages: backup.total_garages,
          size_kb: Math.round(json.length / 1024),
        });
      }

      // ─── TÉLÉCHARGER LE DERNIER BACKUP ──────────────────────
      case 'backup_download': {
        const { data: file, error: dlErr } = await supabase.storage
          .from('backups')
          .download('backup_latest.json');
        if (dlErr) return res.status(404).json({ error: 'Aucun backup trouvé' });
        const text = await file.text();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="iocar_backup_${new Date().toISOString().slice(0,10)}.json"`);
        return res.status(200).send(text);
      }

      // ─── INFOS DU DERNIER BACKUP ────────────────────────────
      case 'backup_info': {
        const { data: files } = await supabase.storage
          .from('backups')
          .list('', { limit: 100 });
        const latest = files?.find(f => f.name === 'backup_latest.json');
        return res.status(200).json({ backup: latest || null });
      }

      default:
        return res.status(400).json({ error: 'Action inconnue' });
    }

  } catch (e) {
    console.error('admin endpoint:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
