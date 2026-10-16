-- ═══════════════════════════════════════════════════════════════
--  IO CAR — AGENDA DES RENDEZ-VOUS (module autonome)
-- ═══════════════════════════════════════════════════════════════
-- Agenda du gestionnaire VO et de son équipe. Module indépendant du reste
-- d'IO CAR : aucun lien avec la flotte, les factures, le CRM ou le livre de
-- police.
--
-- Ce script ne fait QUE créer : cinq tables préfixées agenda_, leurs index,
-- leurs règles d'accès et un garde-fou anti-chevauchement. Aucune table
-- existante n'est modifiée. L'activation par garage vit dans
-- garages.ui_prefs.agenda_enabled (colonne jsonb déjà présente) : rien à
-- ajouter à la table garages.
--
-- Idempotent : peut être relancé sans risque (IF NOT EXISTS, DROP … IF EXISTS
-- avant chaque policy et trigger).
-- ═══════════════════════════════════════════════════════════════

-- ─── 1) TABLES ─────────────────────────────────────────────────

-- Collaborateurs (pas de compte de connexion : une simple liste, avec couleur).
CREATE TABLE IF NOT EXISTS public.agenda_staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id   UUID NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#d4a843',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Horaires hebdomadaires d'un collaborateur (0 = lundi … 6 = dimanche).
-- Pas de ligne pour un jour = jour non travaillé.
CREATE TABLE IF NOT EXISTS public.agenda_schedules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id    UUID NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  staff_id     UUID NOT NULL REFERENCES public.agenda_staff(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  break_start  TIME,
  break_end    TIME,
  -- created_at : la sauvegarde quotidienne trie chaque table sur cette colonne.
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_schedules_heures CHECK (end_time > start_time),
  CONSTRAINT agenda_schedules_un_par_jour UNIQUE (staff_id, day_of_week)
);

-- Absences et créneaux bloqués (congé, formation, rendez-vous perso…).
CREATE TABLE IF NOT EXISTS public.agenda_time_off (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id   UUID NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  staff_id    UUID NOT NULL REFERENCES public.agenda_staff(id) ON DELETE CASCADE,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_time_off_periode CHECK (ends_at > starts_at)
);

-- Types de RDV du garage (essai, livraison…), modifiables et supprimables.
CREATE TABLE IF NOT EXISTS public.agenda_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id         UUID NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  color             TEXT NOT NULL DEFAULT '#d4a843',
  duration_minutes  INT NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 720),
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rendez-vous. Le type est recopié (libellé + couleur) : supprimer un type
-- de la liste ne touche pas aux RDV déjà pris.
CREATE TABLE IF NOT EXISTS public.agenda_appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  garage_id     UUID NOT NULL REFERENCES public.garages(id) ON DELETE CASCADE,
  staff_id      UUID REFERENCES public.agenda_staff(id) ON DELETE SET NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  type_label    TEXT,
  type_color    TEXT,
  client_name   TEXT,
  client_phone  TEXT,
  vehicle       TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned','confirmed','arrived','done','canceled','no_show')),
  canceled_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_appointments_periode CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_agenda_staff_garage      ON public.agenda_staff(garage_id);
CREATE INDEX IF NOT EXISTS idx_agenda_schedules_garage  ON public.agenda_schedules(garage_id);
CREATE INDEX IF NOT EXISTS idx_agenda_time_off_garage   ON public.agenda_time_off(garage_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_agenda_types_garage      ON public.agenda_types(garage_id);
CREATE INDEX IF NOT EXISTS idx_agenda_appts_garage      ON public.agenda_appointments(garage_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_agenda_appts_staff       ON public.agenda_appointments(staff_id, starts_at);

-- ─── 2) RÈGLES D'ACCÈS (même règle que vehicles / orders / clients) ───
-- Chaque garage ne voit et ne modifie que ses lignes ; l'admin voit tout.

ALTER TABLE public.agenda_staff        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_time_off     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_appointments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agenda_staff','agenda_schedules','agenda_time_off','agenda_types','agenda_appointments']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_own', t);
    EXECUTE format($p$
      CREATE POLICY %I ON public.%I
        FOR ALL
        USING (
          garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
          OR public.is_current_user_admin()
        )
        WITH CHECK (
          garage_id IN (SELECT id FROM public.garages WHERE user_id = auth.uid())
          OR public.is_current_user_admin()
        )
    $p$, t || '_own', t);
  END LOOP;
END $$;

-- ─── 3) GARDE-FOUS ─────────────────────────────────────────────

-- Un collaborateur référencé doit appartenir au même garage que la ligne.
CREATE OR REPLACE FUNCTION public.agenda_check_staff_garage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agenda_staff s
     WHERE s.id = NEW.staff_id AND s.garage_id = NEW.garage_id
  ) THEN
    RAISE EXCEPTION 'Collaborateur inconnu pour ce garage';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_schedules_staff_garage ON public.agenda_schedules;
CREATE TRIGGER agenda_schedules_staff_garage
  BEFORE INSERT OR UPDATE ON public.agenda_schedules
  FOR EACH ROW EXECUTE FUNCTION public.agenda_check_staff_garage();

DROP TRIGGER IF EXISTS agenda_time_off_staff_garage ON public.agenda_time_off;
CREATE TRIGGER agenda_time_off_staff_garage
  BEFORE INSERT OR UPDATE ON public.agenda_time_off
  FOR EACH ROW EXECUTE FUNCTION public.agenda_check_staff_garage();

-- Pas deux RDV en même temps pour un même collaborateur, ni de RDV pendant
-- une de ses absences. Les RDV annulés ou « absent » ne bloquent rien.
-- Dernier rempart : l'application vérifie déjà avant d'enregistrer.
CREATE OR REPLACE FUNCTION public.agenda_check_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.staff_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agenda_staff s
     WHERE s.id = NEW.staff_id AND s.garage_id = NEW.garage_id
  ) THEN
    RAISE EXCEPTION 'Collaborateur inconnu pour ce garage';
  END IF;

  NEW.updated_at := NOW();

  IF NEW.staff_id IS NULL OR NEW.status IN ('canceled', 'no_show') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_appointments a
     WHERE a.staff_id = NEW.staff_id
       AND a.id <> NEW.id
       AND a.status NOT IN ('canceled', 'no_show')
       AND a.starts_at < NEW.ends_at
       AND a.ends_at   > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'AGENDA_CHEVAUCHEMENT: ce collaborateur a déjà un rendez-vous sur ce créneau';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_time_off o
     WHERE o.staff_id = NEW.staff_id
       AND o.starts_at < NEW.ends_at
       AND o.ends_at   > NEW.starts_at
  ) THEN
    RAISE EXCEPTION 'AGENDA_ABSENCE: ce collaborateur est absent sur ce créneau';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_appointments_check ON public.agenda_appointments;
CREATE TRIGGER agenda_appointments_check
  BEFORE INSERT OR UPDATE ON public.agenda_appointments
  FOR EACH ROW EXECUTE FUNCTION public.agenda_check_appointment();
