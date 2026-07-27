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

      // ─── SUPPRIMER DÉFINITIVEMENT UN GARAGE ─────────────────
      // ⚠ Action irréversible. Supprime :
      //   - toutes les entrées vehicles, orders, clients, livre_police du garage
      //   - la ligne dans la table garages
      //   - l'utilisateur dans auth.users (qui ne pourra plus se connecter)
      //
      // À utiliser uniquement après expiration des durées de conservation
      // légales (LP 5 ans, factures 10 ans) — ou pour des cas exceptionnels
      // (compte de test, doublon, demande RGPD de suppression…).
      case 'delete_garage': {
        const { garageId } = payload || {};
        if (!garageId) return res.status(400).json({ error: 'garageId manquant' });

        // Récupérer le user_id avant suppression pour pouvoir nettoyer auth.users
        const { data: g, error: getErr } = await supabase
          .from('garages').select('user_id').eq('id', garageId).single();
        if (getErr || !g) return res.status(404).json({ error: 'Garage introuvable' });

        // 1. Supprimer toutes les données associées (CASCADE manuel)
        const tables = ['vehicles', 'orders', 'clients', 'livre_police'];
        for (const t of tables) {
          const { error } = await supabase.from(t).delete().eq('garage_id', garageId);
          if (error) {
            console.error(`Erreur suppression ${t}:`, error);
            return res.status(500).json({ error: `Erreur suppression ${t} : ${error.message}` });
          }
        }

        // 2. Supprimer la ligne du garage
        const { error: gErr } = await supabase.from('garages').delete().eq('id', garageId);
        if (gErr) return res.status(500).json({ error: `Erreur suppression garage : ${gErr.message}` });

        // 3. Supprimer le user dans auth.users (best-effort, ne bloque pas si erreur)
        if (g.user_id) {
          try {
            await supabase.auth.admin.deleteUser(g.user_id);
          } catch (authErr) {
            console.error('Erreur suppression auth.users (non bloquant):', authErr);
          }
        }

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

      // ─── TICKETS DE SUPPORT ─────────────────────────────────
      // Liste tous les tickets, joints aux infos garage et user pour affichage.
      // Filtrable par status. Limite 200 par requête (pagination future).
      case 'tickets_list': {
        const { status } = payload || {};
        let query = supabase
          .from('support_tickets')
          .select('*, garages:garage_id(name, email, siret)')
          .order('created_at', { ascending: false })
          .limit(200);
        if (status && ['new', 'in_progress', 'resolved', 'closed'].includes(status)) {
          query = query.eq('status', status);
        }
        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ tickets: data || [] });
      }

      // ─── METTRE À JOUR UN TICKET ────────────────────────────
      // Permet de changer status et admin_notes. Whitelist stricte des champs
      // modifiables (pas de update libre via le payload).
      case 'tickets_update': {
        const { ticketId, status, admin_notes } = payload || {};
        if (!ticketId) return res.status(400).json({ error: 'ticketId manquant' });
        const updates = {};
        if (status !== undefined) {
          if (!['new', 'in_progress', 'resolved', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Statut invalide' });
          }
          updates.status = status;
        }
        if (admin_notes !== undefined) {
          if (typeof admin_notes !== 'string' || admin_notes.length > 5000) {
            return res.status(400).json({ error: 'Notes invalides' });
          }
          updates.admin_notes = admin_notes;
        }
        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ error: 'Aucune mise à jour fournie' });
        }
        const { data, error } = await supabase
          .from('support_tickets')
          .update(updates)
          .eq('id', ticketId)
          .select()
          .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ticket: data });
      }

      // ─── COMPTEUR DE TICKETS NON LUS (pour le badge admin) ──
      case 'tickets_count_new': {
        const { count, error } = await supabase
          .from('support_tickets')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'new');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ count: count || 0 });
      }

      // ─── SUPPRIMER UN TICKET ────────────────────────────────
      // Suppression définitive d'un ticket. Utile pour nettoyer après résolution.
      // RLS de la table autorise déjà DELETE pour les admins, mais on passe via
      // service_role pour cohérence avec les autres endpoints admin.
      case 'tickets_delete': {
        const { ticketId } = payload || {};
        if (!ticketId) return res.status(400).json({ error: 'ticketId manquant' });
        const { error } = await supabase
          .from('support_tickets')
          .delete()
          .eq('id', ticketId);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true });
      }

      // ─── SUPPRIMER TOUS LES TICKETS FERMÉS ──────────────────
      // Action de nettoyage en masse — supprime tous les tickets avec status="closed".
      // Renvoie le nombre de tickets supprimés.
      case 'tickets_purge_closed': {
        const { data, error } = await supabase
          .from('support_tickets')
          .delete()
          .eq('status', 'closed')
          .select('id');
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ deleted: data?.length || 0 });
      }

      // v8.49.15 — CHAT THREADÉ ADMIN ↔ ABONNÉ ────────────────
      case 'tickets_thread': {
        const { ticketId } = payload || {};
        if (!ticketId) return res.status(400).json({ error: 'ticketId manquant' });
        const { data: ticket } = await supabase
          .from('support_tickets')
          .select('id, user_id, type, message, status, created_at')
          .eq('id', ticketId)
          .single();
        if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
        const { data: messages } = await supabase
          .from('ticket_messages')
          .select('id, author_type, author_name, message, read_at, created_at')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true });
        // Marque les messages 'subscriber' comme lus
        const unreadIds = (messages || [])
          .filter(m => m.author_type === 'subscriber' && !m.read_at)
          .map(m => m.id);
        if (unreadIds.length > 0) {
          await supabase
            .from('ticket_messages')
            .update({ read_at: new Date().toISOString() })
            .in('id', unreadIds);
        }
        return res.status(200).json({ ticket, messages: messages || [] });
      }

      case 'tickets_reply': {
        const { ticketId, message } = payload || {};
        if (!ticketId) return res.status(400).json({ error: 'ticketId manquant' });
        if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message manquant' });
        const clean = message.trim();
        if (!clean) return res.status(400).json({ error: 'Message vide' });
        if (clean.length > 5000) return res.status(400).json({ error: 'Message trop long (max 5000)' });

        const { data: ticket } = await supabase
          .from('support_tickets')
          .select('id, user_id, status')
          .eq('id', ticketId)
          .single();
        if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

        const { data: inserted } = await supabase
          .from('ticket_messages')
          .insert({
            ticket_id: ticketId,
            author_type: 'admin',
            author_user_id: user.id,
            author_name: user.email || 'Support IO Car',
            message: clean
          })
          .select()
          .single();

        // Passage auto en 'in_progress' si 'new'
        if (ticket.status === 'new') {
          await supabase
            .from('support_tickets')
            .update({ status: 'in_progress' })
            .eq('id', ticketId);
        }

        // Email abonné (fire-and-forget)
        sendAdminReplyEmailIocar({ ticket, message: clean, supabase }).catch(() => {});

        return res.status(200).json({ ok: true, message: inserted });
      }

      case 'tickets_count_unread_from_subscriber': {
        const { count } = await supabase
          .from('ticket_messages')
          .select('id', { count: 'exact', head: true })
          .eq('author_type', 'subscriber')
          .is('read_at', null);
        return res.status(200).json({ count: count || 0 });
      }

      default:
        return res.status(400).json({ error: 'Action inconnue' });
    }

  } catch (e) {
    console.error('admin endpoint:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ─── v8.49.15 — HELPER EMAIL RÉPONSE ADMIN → ABONNÉ ─────────────
async function sendAdminReplyEmailIocar({ ticket, message, supabase }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  // Récupère l'email de l'abonné via son user_id
  let subscriberEmail = null;
  try {
    const { data: userData } = await supabase.auth.admin.getUserById(ticket.user_id);
    subscriberEmail = userData?.user?.email;
  } catch (e) {
    console.error('[sendAdminReplyEmailIocar] getUserById', e.message);
  }
  if (!subscriberEmail) return;

  const emailFrom = process.env.SUPPORT_EMAIL_FROM || 'IO Car Support <no-reply@iocar.online>';
  const preview = message.slice(0, 200) + (message.length > 200 ? '…' : '');
  const subject = `[IO Car] Réponse à votre ticket support`;
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
      <h2 style="color: #d4a843;">Notre équipe vous a répondu</h2>
      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${esc(preview)}</div>
      <p style="color: #999; font-size: 12px; margin-top: 20px;">
        Ticket #${String(ticket.id).slice(0, 8)} · Ouvrez votre dashboard IO Car pour répondre.
      </p>
    </div>
  `;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [subscriberEmail], subject, html })
    });
  } catch (e) {
    console.error('[sendAdminReplyEmailIocar] send', e.message);
  }
}
