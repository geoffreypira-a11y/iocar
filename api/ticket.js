// api/ticket.js — endpoint de gestion des tickets support
//
// v8.49.15 — Ajout du chat threadé admin ↔ abonné.
//
// Actions supportées via body.action :
//   • (aucune, ou 'create') → CRÉE un ticket (compat rétro)
//   • 'list'                → liste MES tickets avec compteurs non-lus
//   • 'thread'              → messages d'un ticket
//   • 'reply'               → ajoute un message à un ticket
//   • 'mark_read'           → marque les messages admin d'un ticket comme lus
//
// Sécurité :
//  - Authentification obligatoire (verifyUser → JWT validé)
//  - Rate-limit anti-spam (5/min sur create, 30/min sur reply, illimité sur read)
//  - RLS Supabase : un abonné ne voit QUE ses tickets

import { verifyUser, rateLimit, setCors } from './_lib/auth.js';

const TYPES_VALID = ['incident', 'amelioration', 'question', 'facturation'];
const TYPES_LABELS = {
  incident:     '🔴 Incident technique',
  amelioration: '💡 Idée d\'amélioration',
  question:     '❓ Question / Aide',
  facturation:  '💳 Question de facturation',
};
const MESSAGE_MAX_LENGTH = 5000;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { user, garage, supabase } = auth;
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

    const action = req.body?.action || 'create';

    // ─── LIST : mes tickets ───
    if (action === 'list') {
      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('id, type, message, status, created_at, admin_notes')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return res.status(500).json({ error: 'Erreur lecture tickets' });

      // Compte non-lus (messages admin non lus) par ticket
      const ids = (tickets || []).map(t => t.id);
      let unreadMap = {};
      if (ids.length > 0) {
        const { data: unread } = await supabase
          .from('ticket_messages')
          .select('ticket_id')
          .in('ticket_id', ids)
          .eq('author_type', 'admin')
          .is('read_at', null);
        for (const m of (unread || [])) {
          unreadMap[m.ticket_id] = (unreadMap[m.ticket_id] || 0) + 1;
        }
      }
      const enriched = (tickets || []).map(t => ({ ...t, unread_count: unreadMap[t.id] || 0 }));
      return res.status(200).json({ tickets: enriched });
    }

    // ─── THREAD : messages d'un ticket ───
    if (action === 'thread') {
      const { ticket_id } = req.body || {};
      if (!ticket_id) return res.status(400).json({ error: 'ticket_id manquant' });

      // Vérifie que le ticket appartient à l'user
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('id, user_id, type, message, status, created_at')
        .eq('id', ticket_id)
        .eq('user_id', user.id)
        .single();
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      const { data: messages } = await supabase
        .from('ticket_messages')
        .select('id, author_type, author_name, message, read_at, created_at')
        .eq('ticket_id', ticket_id)
        .order('created_at', { ascending: true });

      return res.status(200).json({ ticket, messages: messages || [] });
    }

    // ─── MARK_READ : marque les messages admin d'un ticket comme lus ───
    if (action === 'mark_read') {
      const { ticket_id } = req.body || {};
      if (!ticket_id) return res.status(400).json({ error: 'ticket_id manquant' });

      // Vérifie que le ticket appartient à l'user (via RLS le update ne passera pas sinon)
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('id')
        .eq('id', ticket_id)
        .eq('user_id', user.id)
        .single();
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      await supabase
        .from('ticket_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('ticket_id', ticket_id)
        .eq('author_type', 'admin')
        .is('read_at', null);

      return res.status(200).json({ ok: true });
    }

    // ─── REPLY : ajoute un message à un ticket ───
    if (action === 'reply') {
      if (!rateLimit(`ticket_reply:${user.id}`, 30)) {
        return res.status(429).json({ error: 'Trop de messages. Réessayez dans une minute.' });
      }
      const { ticket_id, message } = req.body || {};
      if (!ticket_id) return res.status(400).json({ error: 'ticket_id manquant' });
      if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message manquant' });
      const clean = message.trim();
      if (!clean) return res.status(400).json({ error: 'Message vide' });
      if (clean.length > MESSAGE_MAX_LENGTH) {
        return res.status(400).json({ error: `Message trop long (max ${MESSAGE_MAX_LENGTH})` });
      }

      // Vérifie que le ticket appartient à l'user
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('id, user_id, type, status')
        .eq('id', ticket_id)
        .eq('user_id', user.id)
        .single();
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      const { data: inserted, error: insErr } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id,
          author_type: 'subscriber',
          author_user_id: user.id,
          author_name: garage.name || user.email || 'Abonné',
          message: clean
        })
        .select()
        .single();
      if (insErr) return res.status(500).json({ error: 'Échec insertion message' });

      // Email admin (fire-and-forget)
      sendReplyNotificationEmail({
        toAdmin: true,
        ticket, message: clean,
        garage, user,
      });

      return res.status(200).json({ ok: true, message: inserted });
    }

    // ─── CREATE : par défaut, crée un nouveau ticket (compat rétro) ───
    if (!rateLimit(`ticket:${user.id}`, 5)) {
      return res.status(429).json({ error: 'Trop de tickets envoyés. Réessayez dans une minute.' });
    }
    const { type, message } = req.body || {};
    if (!type || !TYPES_VALID.includes(type)) {
      return res.status(400).json({ error: 'Type de ticket invalide' });
    }
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Message manquant' });
    const cleanMessage = message.trim();
    if (!cleanMessage) return res.status(400).json({ error: 'Message vide' });
    if (cleanMessage.length > MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ error: `Message trop long (max ${MESSAGE_MAX_LENGTH})` });
    }

    const { data: ticket, error: insertErr } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user.id,
        garage_id: garage.id,
        type,
        message: cleanMessage,
        status: 'new',
        email_sent: false,
      })
      .select()
      .single();
    if (insertErr) {
      console.error('Erreur insert ticket:', insertErr);
      return res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement' });
    }

    // Email admin (create initial)
    sendCreateNotificationEmail({ ticket, type, message: cleanMessage, garage, user, supabase });

    return res.status(200).json({
      success: true,
      ticket_id: ticket.id,
      message: 'Votre ticket a bien été enregistré. Notre équipe vous répondra rapidement.',
    });

  } catch (e) {
    console.error('ticket:', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ─── EMAILS ────────────────────────────────────────────────
async function sendCreateNotificationEmail({ ticket, type, message, garage, user, supabase }) {
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo   = process.env.SUPPORT_EMAIL_TO   || 'contact@iocar.online';
  const emailFrom = process.env.SUPPORT_EMAIL_FROM || 'IO Car Support <no-reply@iocar.online>';
  if (!resendKey) return;

  try {
    const subject = `[IO Car] ${TYPES_LABELS[type]} — ${garage.name || 'Abonné'}`;
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
        <h2 style="color: #d4a843;">Nouveau ticket de support</h2>
        <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
          <tr><td style="padding: 6px 0; color: #666;">Type :</td><td style="padding: 6px 0;"><strong>${TYPES_LABELS[type]}</strong></td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Concession :</td><td style="padding: 6px 0;">${escapeHtml(garage.name || '—')}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Email :</td><td style="padding: 6px 0;">${escapeHtml(garage.email || user.email || '—')}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">SIRET :</td><td style="padding: 6px 0;">${escapeHtml(garage.siret || '—')}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Date :</td><td style="padding: 6px 0;">${new Date().toLocaleString('fr-FR')}</td></tr>
          <tr><td style="padding: 6px 0; color: #666;">Ticket ID :</td><td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${ticket.id}</td></tr>
        </table>
        <h3 style="color: #d4a843;">Message :</h3>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(message)}</div>
      </div>
    `;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [emailTo], reply_to: garage.email || user.email, subject, html }),
    });
    if (r.ok) {
      await supabase.from('support_tickets').update({ email_sent: true }).eq('id', ticket.id);
    }
  } catch (e) {
    console.error('sendCreateNotificationEmail:', e.message);
  }
}

async function sendReplyNotificationEmail({ toAdmin, ticket, message, garage, user }) {
  const resendKey = process.env.RESEND_API_KEY;
  const emailTo   = toAdmin
    ? (process.env.SUPPORT_EMAIL_TO || 'contact@iocar.online')
    : (garage.email || user.email);
  const emailFrom = process.env.SUPPORT_EMAIL_FROM || 'IO Car Support <no-reply@iocar.online>';
  if (!resendKey || !emailTo) return;

  try {
    const preview = message.slice(0, 200) + (message.length > 200 ? '…' : '');
    const subject = toAdmin
      ? `[IO Car] Nouveau message sur ticket #${String(ticket.id).slice(0, 8)}`
      : `[IO Car] Réponse à votre ticket support`;
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px;">
        <h2 style="color: #d4a843;">${toAdmin ? 'L\'abonné a répondu' : 'Notre équipe vous a répondu'}</h2>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(preview)}</div>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">
          Ticket #${String(ticket.id).slice(0, 8)} · Ouvrez votre dashboard pour répondre.
        </p>
      </div>
    `;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: emailFrom, to: [emailTo], subject, html }),
    });
  } catch (e) {
    console.error('sendReplyNotificationEmail:', e.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
