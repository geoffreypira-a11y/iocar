-- ═══════════════════════════════════════════════════════════════════
-- IO CAR — Migration "Pont IOBILL" v1.0 + v1.1 (auto_push)
-- À exécuter dans Supabase Studio IOCAR (projet lnukqnopmlvaqxbdwhst).
-- ═══════════════════════════════════════════════════════════════════

-- ── Lien garage ↔ compte IOBILL ─────────────────────────────
ALTER TABLE public.garages
  ADD COLUMN IF NOT EXISTS iobill_company_id UUID,
  ADD COLUMN IF NOT EXISTS iobill_api_token  TEXT,
  ADD COLUMN IF NOT EXISTS iobill_linked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS iobill_email      TEXT,
  -- v1.1 : transmission automatique des factures
  ADD COLUMN IF NOT EXISTS iobill_auto_push  BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_garages_iobill_company
  ON public.garages(iobill_company_id)
  WHERE iobill_company_id IS NOT NULL;

COMMENT ON COLUMN public.garages.iobill_company_id IS
  'companies.id côté IOBILL (autre projet Supabase). Lien établi lors de l''activation.';
COMMENT ON COLUMN public.garages.iobill_api_token IS
  'Token API IOBILL utilisé par les endpoints IOCAR pour pousser des factures.';
COMMENT ON COLUMN public.garages.iobill_auto_push IS
  'Si TRUE, transmet automatiquement chaque facture à IOBILL dès passage en type=facture.';

-- ── Suivi des factures poussées vers IOBILL ─────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS iobill_invoice_id UUID,
  ADD COLUMN IF NOT EXISTS iobill_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS iobill_pdf_url TEXT,
  ADD COLUMN IF NOT EXISTS iobill_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS iobill_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_iobill_synced
  ON public.orders(iobill_synced_at)
  WHERE iobill_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.orders.iobill_invoice_id IS
  'invoices.id côté IOBILL une fois la facture poussée. NULL = pas encore synchronisée.';
COMMENT ON COLUMN public.orders.iobill_sync_error IS
  'Dernier message d''erreur en cas d''échec de push. NULL = OK.';

-- FIN migration IOCAR Pont IOBILL
