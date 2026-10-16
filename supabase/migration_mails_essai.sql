-- ═══════════════════════════════════════════════════════════════
--  IO CAR — MAILS AUTOMATIQUES DE L'ESSAI (2e et 7e jour)
-- ═══════════════════════════════════════════════════════════════
-- 1) Deux colonnes qui notent la date d'envoi de chaque mail : un seul envoi
--    par garage (voir api/_lib/mails-essai.js).
-- 2) Ces colonnes rejoignent les colonnes réservées au serveur : le
--    navigateur d'un abonné ne peut pas les remettre à vide (sinon un onglet
--    Paramètres resté ouvert les renverrait vides et le mail repartirait).
--
-- Rien d'autre n'est modifié. Idempotent : peut être relancé sans risque.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.garages
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_email_sent_at TIMESTAMPTZ;

-- Comptes déjà anciens : marqués comme servis, ils ne recevront pas un mail
-- hors de propos. Restent concernés les inscrits d'hier et d'aujourd'hui
-- (bienvenue) et ceux qui n'ont pas encore dépassé leur 7e jour (avis).
UPDATE public.garages
   SET welcome_email_sent_at = NOW()
 WHERE welcome_email_sent_at IS NULL
   AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') - INTERVAL '1 day') AT TIME ZONE 'Europe/Paris';

UPDATE public.garages
   SET feedback_email_sent_at = NOW()
 WHERE feedback_email_sent_at IS NULL
   AND created_at < (date_trunc('day', NOW() AT TIME ZONE 'Europe/Paris') - INTERVAL '6 days') AT TIME ZONE 'Europe/Paris';

CREATE OR REPLACE FUNCTION public.garages_proteger_colonnes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Seules les requêtes portant le jeton d'un utilisateur sont concernées.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- L'admin garde la main (et ne peut l'être devenu que par le serveur).
  IF public.is_current_user_admin() THEN
    RETURN NEW;
  END IF;

  -- Droits et identité
  NEW.is_admin                := OLD.is_admin;
  NEW.user_id                 := OLD.user_id;
  NEW.created_at              := OLD.created_at;
  -- Abonnement et essai (Stripe, admin)
  NEW.is_active               := OLD.is_active;
  NEW.plan                    := OLD.plan;
  NEW.trial_ends_at           := OLD.trial_ends_at;
  NEW.sub_status              := OLD.sub_status;
  NEW.stripe_customer_id      := OLD.stripe_customer_id;
  NEW.stripe_subscription_id  := OLD.stripe_subscription_id;
  NEW.subscribed_at           := OLD.subscribed_at;
  NEW.payment_failed_at       := OLD.payment_failed_at;
  -- Archivage (admin)
  NEW._archived               := OLD._archived;
  NEW.archive_date            := OLD.archive_date;
  NEW.archive_raison          := OLD.archive_raison;
  -- Liaison IO BILL (pont serveur)
  NEW.iobill_company_id       := OLD.iobill_company_id;
  NEW.iobill_api_token        := OLD.iobill_api_token;
  NEW.iobill_linked_at        := OLD.iobill_linked_at;
  NEW.iobill_email            := OLD.iobill_email;
  -- Compteur de recherches de plaque : tenu par consume_plate_lookup.
  -- Le remettre à zéro depuis le navigateur rendait des recherches gratuites.
  NEW.api_usage               := OLD.api_usage;
  -- Mails automatiques de l'essai : posés par le serveur à l'envoi.
  NEW.welcome_email_sent_at   := OLD.welcome_email_sent_at;
  NEW.feedback_email_sent_at  := OLD.feedback_email_sent_at;

  RETURN NEW;
END;
$$;

-- Vérification : doit renvoyer colonnes = 2 et protegees = true.
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'garages'
      AND column_name IN ('welcome_email_sent_at', 'feedback_email_sent_at')) AS colonnes,
  position('feedback_email_sent_at' IN pg_get_functiondef('public.garages_proteger_colonnes'::regproc)) > 0 AS protegees;
