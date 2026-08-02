-- 060: WhatsApp (WATI) messaging — own the message ledger.
--
-- Migration 055 dropped `whatsapp_sessions` when WhatsApp/WATI was removed
-- (admin PR #179). This reintroduces WhatsApp deliberately and on a different
-- footing: the previous build derived everything from WATI at read time —
-- "joined" status came from contact custom params (attribute_2 / joined /
-- join_status) and "last message" was scraped per-contact from getMessages on
-- every page render. Nothing was persisted, so nothing could be analysed and
-- a WATI outage meant an empty dashboard.
--
-- Here WATI is the transport only. Every message in and out is a row in
-- whatsapp_messages, and per-contact rollups (what did we last send them, did
-- it land, when did they last reply) are DENORMALISED COLUMNS maintained by
-- trigger — never read back from WATI contact attributes.
--
-- Apply with:
--   DATABASE_URL=postgres://... node scripts/run-migration.mjs migrations/060_whatsapp_messaging.sql
-- Target: PORTAL project (customers/orders), not the stock project.

-- ─────────────────────────────────────────────────────────────────────────
-- Broadcasts
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name    text        NOT NULL,
  broadcast_name   text        NOT NULL,
  audience_filter  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  status           text        NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','sending','completed','cancelled')),
  total_targeted   integer     NOT NULL DEFAULT 0,
  count_sent       integer     NOT NULL DEFAULT 0,
  count_delivered  integer     NOT NULL DEFAULT 0,
  count_read       integer     NOT NULL DEFAULT 0,
  count_failed     integer     NOT NULL DEFAULT 0,
  count_replied    integer     NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────────────────
-- Contacts — our mirror. Source of truth for messaging history.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  phone                    text PRIMARY KEY,      -- normalised digits, no '+' (see api/_phone.js)
  wa_name                  text,
  customer_id              uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  business_type            text,
  -- Broadcast eligibility is driven by the customer's own opt-in, NOT by a
  -- WATI custom param. Mirrored from customers.accept_whatsapp by api/wa-sync.
  accept_whatsapp          boolean     NOT NULL DEFAULT false,
  opted_in_at              timestamptz,
  allow_broadcast          boolean     NOT NULL DEFAULT true,   -- WATI-side block (STOP / invalid)
  contact_status           text        NOT NULL DEFAULT 'UNKNOWN',
  is_team                  boolean     NOT NULL DEFAULT false,  -- fulfilment team numbers never receive broadcasts

  first_seen_at            timestamptz NOT NULL DEFAULT now(),

  -- ── "what was last sent to them", tracked meticulously ──
  last_outbound_at         timestamptz,
  last_outbound_template   text,
  last_outbound_body       text,
  last_outbound_status     text,        -- queued|sent|delivered|read|failed
  last_outbound_message_id bigint,
  last_outbound_broadcast  uuid REFERENCES public.whatsapp_broadcasts(id) ON DELETE SET NULL,

  -- ── inbound side ──
  last_inbound_at          timestamptz,
  last_inbound_preview     text,
  -- WhatsApp's 24h customer-service window. Free-form replies are only legal
  -- while now() < session_expires_at; outside it only approved templates send.
  session_expires_at       timestamptz,
  unread_count             integer     NOT NULL DEFAULT 0,

  inbound_count            integer     NOT NULL DEFAULT 0,
  outbound_count           integer     NOT NULL DEFAULT 0,

  wati_synced_at           timestamptz,
  raw                      jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_contacts_customer_idx    ON public.whatsapp_contacts (customer_id);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_inbound_idx     ON public.whatsapp_contacts (last_inbound_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS whatsapp_contacts_unread_idx      ON public.whatsapp_contacts (unread_count) WHERE unread_count > 0;
CREATE INDEX IF NOT EXISTS whatsapp_contacts_broadcastable_idx
  ON public.whatsapp_contacts (business_type)
  WHERE accept_whatsapp AND allow_broadcast AND NOT is_team;

-- ─────────────────────────────────────────────────────────────────────────
-- Messages — the ledger. One row per message, forever.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id             bigserial PRIMARY KEY,
  phone          text        NOT NULL,
  direction      text        NOT NULL CHECK (direction IN ('in','out')),
  wa_message_id  text,
  body           text,
  message_type   text        NOT NULL DEFAULT 'text',
  template_name  text,
  broadcast_id   uuid REFERENCES public.whatsapp_broadcasts(id) ON DELETE SET NULL,
  -- Outbound ladder: queued → sent → delivered → read (or failed).
  -- Inbound rows are created as 'received' and never move.
  status         text        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  error          text,
  sent_by        text,        -- admin email for manual replies; null for broadcasts/inbound
  queued_at      timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  delivered_at   timestamptz,
  read_at        timestamptz,
  failed_at      timestamptz,
  raw            jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: WATI retries webhooks, and a retried delivery event must not
-- create a second row. Partial index because queued rows have no id yet.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wa_id_key
  ON public.whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_thread_idx    ON public.whatsapp_messages (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_broadcast_idx ON public.whatsapp_messages (broadcast_id) WHERE broadcast_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_messages_queue_idx     ON public.whatsapp_messages (queued_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx   ON public.whatsapp_messages (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Raw webhook audit — nothing is ever lost to a mis-parse.
-- Because the WATI payload shapes were coded from docs rather than observed
-- traffic, this table is what lets us replay and re-parse after a fix.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_events (
  id            bigserial PRIMARY KEY,
  event_key     text,            -- provider event id when present; used for dedupe
  event_type    text,
  phone         text,
  payload       jsonb NOT NULL,
  handled       boolean NOT NULL DEFAULT false,
  handler_error text,
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_webhook_events_key_idx
  ON public.whatsapp_webhook_events (event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_webhook_events_unhandled_idx
  ON public.whatsapp_webhook_events (received_at) WHERE NOT handled;

-- ─────────────────────────────────────────────────────────────────────────
-- Status ladder — a late-arriving 'sent' webhook must never demote a row
-- that already reached 'read'. Out-of-order delivery is normal.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_status_rank(s text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'queued'   THEN 0
    WHEN 'sent'     THEN 1
    WHEN 'delivered' THEN 2
    WHEN 'read'     THEN 3
    WHEN 'failed'   THEN 4   -- terminal, set explicitly
    WHEN 'received' THEN 5   -- inbound, never transitions
    ELSE -1
  END;
$$;

-- Applies a status event to an outbound message without ever moving backwards.
-- Returns the message row id, or NULL when the message is unknown.
CREATE OR REPLACE FUNCTION public.wa_apply_status(
  p_wa_message_id text,
  p_status        text,
  p_at            timestamptz DEFAULT now(),
  p_error         text DEFAULT NULL
)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_id  bigint;
  v_cur text;
BEGIN
  SELECT id, status INTO v_id, v_cur
    FROM public.whatsapp_messages
   WHERE wa_message_id = p_wa_message_id
   FOR UPDATE;

  IF v_id IS NULL THEN RETURN NULL; END IF;

  -- 'failed' is terminal and always wins; otherwise only move up the ladder.
  IF p_status <> 'failed' AND v_cur = 'failed' THEN RETURN v_id; END IF;
  IF p_status <> 'failed'
     AND public.wa_status_rank(p_status) <= public.wa_status_rank(v_cur) THEN
    RETURN v_id;
  END IF;

  UPDATE public.whatsapp_messages
     SET status       = p_status,
         error        = COALESCE(p_error, error),
         sent_at      = CASE WHEN p_status = 'sent'      THEN COALESCE(sent_at, p_at)      ELSE sent_at END,
         delivered_at = CASE WHEN p_status = 'delivered' THEN COALESCE(delivered_at, p_at) ELSE delivered_at END,
         read_at      = CASE WHEN p_status = 'read'      THEN COALESCE(read_at, p_at)      ELSE read_at END,
         failed_at    = CASE WHEN p_status = 'failed'    THEN COALESCE(failed_at, p_at)    ELSE failed_at END
   WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Contact + broadcast rollups, maintained from the ledger.
-- This is the mechanism that replaces WATI contact attributes.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_sync_rollups()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Ensure a contact row exists for any phone we have traffic with.
  INSERT INTO public.whatsapp_contacts (phone) VALUES (NEW.phone)
  ON CONFLICT (phone) DO NOTHING;

  IF NEW.direction = 'in' THEN
    IF TG_OP = 'INSERT' THEN
      UPDATE public.whatsapp_contacts
         SET last_inbound_at    = NEW.created_at,
             last_inbound_preview = left(COALESCE(NEW.body, ''), 200),
             -- inbound reopens the 24h customer-service window
             session_expires_at = NEW.created_at + interval '24 hours',
             unread_count       = unread_count + 1,
             inbound_count      = inbound_count + 1,
             updated_at         = now()
       WHERE phone = NEW.phone;

      -- A reply attributed to the broadcast that last touched this contact.
      UPDATE public.whatsapp_broadcasts b
         SET count_replied = b.count_replied + 1
        FROM public.whatsapp_contacts c
       WHERE c.phone = NEW.phone
         AND b.id = c.last_outbound_broadcast
         AND c.last_outbound_at > now() - interval '7 days';
    END IF;
    RETURN NEW;
  END IF;

  -- Outbound: keep the contact's "last sent" mirror current.
  IF TG_OP = 'INSERT' THEN
    UPDATE public.whatsapp_contacts
       SET last_outbound_at        = NEW.created_at,
           last_outbound_template  = NEW.template_name,
           last_outbound_body      = left(COALESCE(NEW.body, ''), 500),
           last_outbound_status    = NEW.status,
           last_outbound_message_id = NEW.id,
           last_outbound_broadcast = NEW.broadcast_id,
           outbound_count          = outbound_count + 1,
           updated_at              = now()
     WHERE phone = NEW.phone;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.whatsapp_contacts
       SET last_outbound_status = NEW.status,
           updated_at           = now()
     WHERE phone = NEW.phone
       AND last_outbound_message_id = NEW.id;

    -- Broadcast counters move only on genuine forward transitions, so a
    -- webhook replay can't inflate the numbers.
    IF NEW.broadcast_id IS NOT NULL THEN
      UPDATE public.whatsapp_broadcasts
         SET count_sent      = count_sent      + (CASE WHEN NEW.status = 'sent'      THEN 1 ELSE 0 END),
             count_delivered = count_delivered + (CASE WHEN NEW.status = 'delivered' THEN 1 ELSE 0 END),
             count_read      = count_read      + (CASE WHEN NEW.status = 'read'      THEN 1 ELSE 0 END),
             count_failed    = count_failed    + (CASE WHEN NEW.status = 'failed'    THEN 1 ELSE 0 END)
       WHERE id = NEW.broadcast_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wa_sync_rollups_ins ON public.whatsapp_messages;
CREATE TRIGGER wa_sync_rollups_ins
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_sync_rollups();

DROP TRIGGER IF EXISTS wa_sync_rollups_upd ON public.whatsapp_messages;
CREATE TRIGGER wa_sync_rollups_upd
  AFTER UPDATE OF status ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.wa_sync_rollups();

-- ─────────────────────────────────────────────────────────────────────────
-- Broadcast audience — resolved in SQL so the composer's preview count and
-- the worker's actual send list can never disagree.
-- Opt-in gate: customers.accept_whatsapp only (product decision, POPIA).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wa_broadcast_audience(
  p_business_types text[] DEFAULT NULL,
  p_search         text   DEFAULT NULL
)
RETURNS TABLE (phone text, wa_name text, customer_id uuid, business_type text)
LANGUAGE sql STABLE AS $$
  SELECT c.phone, c.wa_name, c.customer_id, c.business_type
    FROM public.whatsapp_contacts c
   WHERE c.accept_whatsapp
     AND c.allow_broadcast
     AND NOT c.is_team
     AND c.contact_status <> 'INVALID'
     AND (p_business_types IS NULL
          OR cardinality(p_business_types) = 0
          OR lower(c.business_type) = ANY (SELECT lower(x) FROM unnest(p_business_types) AS x))
     AND (p_search IS NULL OR p_search = ''
          OR c.phone ILIKE '%' || p_search || '%'
          OR COALESCE(c.wa_name, '') ILIKE '%' || p_search || '%');
$$;

-- RLS: these tables are written only by the service-role admin API. Enable RLS
-- with no permissive policy so a leaked anon/publishable key reads nothing —
-- the portal's other tables rely on the service key bypassing RLS, and message
-- content is customer PII that must not follow that pattern.
ALTER TABLE public.whatsapp_contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_broadcasts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhook_events ENABLE ROW LEVEL SECURITY;
