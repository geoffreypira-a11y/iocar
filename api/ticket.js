// api/ticket.js — endpoint de création de tickets de support
//
// Sécurité :
//  - Authentification obligatoire (verifyUser → JWT validé par Supabase)
//  - Rate-limit anti-spam : 5 tickets / minute / utilisateur
//  - Validation stricte du type (whitelist) et de la longueur du message
//  - Écriture en BD via service_role MAIS avec user_id forcé à auth.uid()
//    (impossible pour un abonné de créer un ticket au nom d'un autre)
//  - Email Resend optionnel : si Resend down ou clé absente, le ticket
//    reste enregistré en BD (pas de perte). L'admin verra dans son dashboard.
//
// Variables d'env requises :
//  - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (déjà configurées)
//  - RESEND_API_KEY (optionnel — sans elle, pas d'email mais ticket OK)
//  - SUPPORT_EMAIL_TO (optionnel — par défaut "contact@iocar.online")
//  - SUPPORT_EMAIL_FROM (optionnel — par défaut "no-reply@iocar.online")

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
    // 1. Authentification
    const auth = await verifyUser(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { user, garage, supabase } = auth;
    if (!garage) return res.status(403).json({ error: 'Garage introuvable' });

    // 2. Rate-limit anti-spam : 5 tickets/minute par user
    if (!rateLimit(`ticket:${user.id}`, 5)) {
      return res.status(429).json({ error: 'Trop de tickets envoyés. Réessayez dans une minute.' });
    }

    // 3. Validation du payload
    const { type, message } = req.body || {};

    if (!type || !TYPES_VALID.includes(type)) {
      return res.status(400).json({ error: 'Type de ticket invalide' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message manquant' });
    }
    const cleanMessage = message.trim();
    if (cleanMessage.length === 0) {
      return res.status(400).json({ error: 'Message vide' });
    }
    if (cleanMessage.length > MESSAGE_MAX_LENGTH) {
      return res.status(400).json({ error: `Message trop long (max ${MESSAGE_MAX_LENGTH} caractères)` });
    }

    // 4. Insertion en BD
    //    user_id et garage_id sont FORCÉS depuis le JWT — un abonné ne peut pas
    //    créer un ticket au nom d'un autre, même en bidouillant la requête.
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

    // 5. Envoi email via Resend (best-effort, n'invalide pas le ticket si échec)
    const resendKey = process.env.RESEND_API_KEY;
    const emailTo   = process.env.SUPPORT_EMAIL_TO   || 'contact@iocar.online';
    const emailFrom = process.env.SUPPORT_EMAIL_FROM || 'IO Car Support <no-reply@iocar.online>';

    if (resendKey) {
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
            <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${escapeHtml(cleanMessage)}</div>
            <p style="color: #999; font-size: 11px; margin-top: 30px;">
              Pour répondre, contactez directement l'abonné par email.
              Vous pouvez aussi gérer ce ticket depuis votre dashboard admin IO Car.
            </p>
          </div>
        `;

        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [emailTo],
            reply_to: garage.email || user.email,
            subject,
            html,
          }),
        });

        if (resendRes.ok) {
          // Email envoyé avec succès → on flag le ticket
          await supabase
            .from('support_tickets')
            .update({ email_sent: true })
            .eq('id', ticket.id);
        } else {
          const errText = await resendRes.text();
          console.error('Resend error:', resendRes.status, errText);
          await supabase
            .from('support_tickets')
            .update({ email_error: `${resendRes.status}: ${errText.slice(0, 500)}` })
            .eq('id', ticket.id);
        }
      } catch (mailErr) {
        // L'email a échoué mais le ticket est sauvegardé : on log et on passe.
        console.error('Erreur envoi email (non bloquant):', mailErr.message);
        await supabase
          .from('support_tickets')
          .update({ email_error: mailErr.message?.slice(0, 500) })
          .eq('id', ticket.id);
      }
    }

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

// Échappement HTML pour éviter toute injection dans l'email
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
