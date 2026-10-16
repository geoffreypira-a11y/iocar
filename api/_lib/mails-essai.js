// IO CAR — Mails automatiques pendant l'essai
// ═══════════════════════════════════════════════════════════════════
// Appelé une fois par jour, le matin, par api/backup-cron.js
// (?job=mails-essai). Deux mails, un seul envoi chacun par garage :
//   • 2e jour  — bienvenue, proposition d'aide         (welcome_email_sent_at)
//   • 7e jour  — demande d'avis, prolongation possible (feedback_email_sent_at)
// Le jour d'inscription est le 1er jour, en heure de Paris.
//
// Si la tâche n'a pas tourné un matin, le mail part le lendemain : on
// rattrape jusqu'à RATTRAPAGE_JOURS jours de retard, pas plus, pour ne pas
// écrire à des comptes inscrits avant la mise en place de ces mails.
//
// Seuls les garages encore en essai sont concernés (pas les abonnés, les
// exemptés, les archivés ni l'admin). Les dates d'envoi sont protégées par
// le déclencheur garages_proteger_colonnes : le navigateur ne peut pas les
// remettre à vide.

import { getServiceClient } from './auth.js';

const TELEPHONE = '06 03 05 10 06';
const EMAIL_CONTACT = 'contact@iocar.online';
const RATTRAPAGE_JOURS = 3;
const JOUR_MS = 86400 * 1000;

// Minuit (heure de Paris) du jour courant, en instant UTC.
function debutDuJourParis(maintenant = new Date()) {
  const jour = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(maintenant); // AAAA-MM-JJ
  const minuitUtc = new Date(`${jour}T00:00:00Z`);
  // Décalage de Paris à cet instant (+1 h l'hiver, +2 h l'été).
  const heureParis = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23',
  }).format(minuitUtc));
  return new Date(minuitUtc.getTime() - heureParis * 3600 * 1000);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const PIED_CONTACT_HTML = `
  <strong><a href="tel:+33603051006" style="color: #222; text-decoration: none;">${TELEPHONE}</a></strong>
  ou à nous écrire à
  <strong><a href="mailto:${EMAIL_CONTACT}" style="color: #d4a843;">${EMAIL_CONTACT}</a></strong>`;

function salutation(nomGarage) {
  const nom = (nomGarage || '').trim();
  return nom ? `Bonjour ${nom},` : 'Bonjour,';
}

function miseEnPage(titre, paragraphesHtml) {
  return `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 600px; color: #222; line-height: 1.6;">
      <h2 style="color: #d4a843; margin-bottom: 4px;">${titre}</h2>
      ${paragraphesHtml.map(p => `<p>${p}</p>`).join('\n      ')}
      <p style="margin-top: 24px;">Bonne journée,<br /><strong>L'équipe IO Car</strong></p>
    </div>
  `;
}

const DERNIER_JOUR = 'C\'est votre dernier jour d\'essai !';

const MAILS = {
  bienvenue: {
    colonne: 'welcome_email_sent_at',
    jour: 2,
    contenu({ name }) {
      const salut = salutation(name);
      return {
        subject: 'Bienvenue sur IO Car — besoin d\'un coup de main ?',
        html: miseEnPage('Bienvenue sur IO Car !', [
          escapeHtml(salut),
          'Vous venez de commencer votre essai d\'IO Car, et toute l\'équipe vous souhaite la bienvenue !',
          `Pour bien démarrer, n'hésitez pas à nous appeler au ${PIED_CONTACT_HTML}. Nous pouvons vous aider à configurer votre compte, vous montrer comment créer votre premier bon de commande ou votre première facture, ou répondre à toutes vos questions sur l'application.`,
          'Vous pouvez aussi simplement répondre à ce mail.',
        ]),
        text: [
          salut, '',
          'Vous venez de commencer votre essai d\'IO Car, et toute l\'équipe vous souhaite la bienvenue !', '',
          `Pour bien démarrer, n'hésitez pas à nous appeler au ${TELEPHONE} ou à nous écrire à ${EMAIL_CONTACT}. Nous pouvons vous aider à configurer votre compte, vous montrer comment créer votre premier bon de commande ou votre première facture, ou répondre à toutes vos questions sur l'application.`, '',
          'Vous pouvez aussi simplement répondre à ce mail.', '',
          'Bonne journée,', 'L\'équipe IO Car',
        ].join('\n'),
      };
    },
  },
  avis: {
    colonne: 'feedback_email_sent_at',
    jour: 7,
    contenu({ name, trial_ends_at }, maintenant) {
      const salut = salutation(name);
      // « Dernier jour » seulement si l'essai se termine au plus tard demain
      // (l'essai de 7 jours expire le 8e jour à l'heure d'inscription) : un
      // essai déjà prolongé par l'admin n'est pas concerné.
      const fin = trial_ends_at ? new Date(trial_ends_at).getTime() : null;
      const finDemain = debutDuJourParis(maintenant).getTime() + 2 * JOUR_MS;
      const dernierJour = fin !== null && fin <= finDemain;
      const intro = (dernierJour ? `${DERNIER_JOUR} ` : '')
        + 'Voilà une semaine que vous essayez IO Car. Votre retour est très important pour nous : ce qui vous plaît, ce qui vous manque, ce que nous pourrions améliorer. Il suffit de répondre à ce mail, quelques lignes nous aident déjà beaucoup.';
      return {
        subject: dernierJour
          ? 'Dernier jour d\'essai — votre avis sur IO Car compte pour nous'
          : 'Votre avis sur IO Car compte pour nous',
        html: miseEnPage('Une semaine avec IO Car', [
          escapeHtml(salut),
          dernierJour ? intro.replace(DERNIER_JOUR, `<strong>${DERNIER_JOUR}</strong>`) : intro,
          'Vous avez besoin de <strong>quelques jours d\'essai supplémentaires</strong> pour bien prendre l\'application en main ? Dites-le-nous simplement, nous prolongerons votre essai.',
          `Et bien sûr, pour toute aide ou tout renseignement, n'hésitez pas à nous appeler au ${PIED_CONTACT_HTML}.`,
        ]),
        text: [
          salut, '',
          intro, '',
          'Vous avez besoin de quelques jours d\'essai supplémentaires pour bien prendre l\'application en main ? Dites-le-nous simplement, nous prolongerons votre essai.', '',
          `Et bien sûr, pour toute aide ou tout renseignement, n'hésitez pas à nous appeler au ${TELEPHONE} ou à nous écrire à ${EMAIL_CONTACT}.`, '',
          'Bonne journée,', 'L\'équipe IO Car',
        ].join('\n'),
      };
    },
  },
};

export async function envoyerMailsEssai({ maintenant = new Date(), dryRun = false } = {}) {
  const resultat = {};
  for (const [cle, mail] of Object.entries(MAILS)) {
    resultat[cle] = await envoyerUnMail(mail, { maintenant, dryRun });
  }
  return resultat;
}

async function envoyerUnMail(mail, { maintenant, dryRun }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey && !dryRun) throw new Error('RESEND_API_KEY manquante');
  const emailFrom = process.env.WELCOME_EMAIL_FROM
    || process.env.SUPPORT_EMAIL_FROM
    || 'IO Car <no-reply@iocar.online>';

  const supabase = getServiceClient();
  // Inscrit le jour J (1er jour) → le N-ième jour est J + N − 1. On écrit
  // donc aux garages inscrits avant (aujourd'hui − N + 2), avec rattrapage.
  const aujourdhui = debutDuJourParis(maintenant);
  const finFenetre = new Date(aujourdhui.getTime() - (mail.jour - 2) * JOUR_MS);
  const debutFenetre = new Date(finFenetre.getTime() - (RATTRAPAGE_JOURS + 1) * JOUR_MS);

  const { data: garages, error } = await supabase
    .from('garages')
    .select('id, name, email, plan, sub_status, is_admin, _archived, created_at, trial_ends_at')
    .eq('plan', 'trial')
    .is(mail.colonne, null)
    .lt('created_at', finFenetre.toISOString())
    .gte('created_at', debutFenetre.toISOString());
  if (error) throw new Error(`Lecture des garages : ${error.message}`);

  const cibles = (garages || []).filter(g =>
    g.email && !g.is_admin && g._archived !== true
    && (!g.sub_status || g.sub_status === 'trialing'));

  const resultat = { candidats: cibles.length, envoyes: [], echecs: [] };
  for (const g of cibles) {
    if (dryRun) { resultat.envoyes.push(g.email); continue; }
    // On réserve l'envoi AVANT d'expédier : la date n'est posée que si elle
    // est encore vide, donc deux exécutions simultanées n'écrivent qu'une fois.
    const { data: reserve, error: errReserve } = await supabase.from('garages')
      .update({ [mail.colonne]: new Date().toISOString() })
      .eq('id', g.id).is(mail.colonne, null)
      .select('id');
    if (errReserve) { resultat.echecs.push({ email: g.email, detail: errReserve.message }); continue; }
    if (!reserve?.length) continue;

    const liberer = () => supabase.from('garages')
      .update({ [mail.colonne]: null }).eq('id', g.id);
    const { subject, html, text } = mail.contenu(g, maintenant);
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: emailFrom, to: [g.email], reply_to: EMAIL_CONTACT, subject, html, text }),
      });
      if (!r.ok) {
        // Échec : on libère, le mail repartira le lendemain.
        await liberer();
        resultat.echecs.push({ email: g.email, status: r.status, detail: (await r.text()).slice(0, 200) });
        continue;
      }
      resultat.envoyes.push(g.email);
    } catch (e) {
      await liberer();
      resultat.echecs.push({ email: g.email, detail: e?.message });
    }
  }
  return resultat;
}

export const _test = { debutDuJourParis, MAILS };
