-- Migration: notification preferences and consent
-- Issue #71: Implement notification preferences and consent

-- ─── Enum types ───────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE notification_channel AS ENUM ('sms', 'email', 'push');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE notification_category AS ENUM ('security', 'lifecycle', 'marketing');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Preferences table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT        NOT NULL,
  channel         notification_channel  NOT NULL,
  category        notification_category NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_user_channel_category UNIQUE (user_id, channel, category)
);

-- Index for fast per-user look-ups
CREATE INDEX IF NOT EXISTS idx_notif_prefs_user_id
  ON user_notification_preferences (user_id);

-- Automatically update updated_at on row modification
CREATE OR REPLACE FUNCTION set_notif_prefs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_prefs_updated_at ON user_notification_preferences;
CREATE TRIGGER trg_notif_prefs_updated_at
  BEFORE UPDATE ON user_notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_notif_prefs_updated_at();

-- ─── Seed default rows for existing users ─────────────────────────────────────
-- Inserts the recommended defaults (security + lifecycle ON for all channels,
-- marketing OFF) for any users that do not yet have preference rows.
-- New users should have defaults inserted at registration time via the service.

INSERT INTO user_notification_preferences (user_id, channel, category, enabled)
SELECT
  u.id,
  ch.channel,
  cat.category,
  CASE
    WHEN cat.category = 'marketing' THEN FALSE
    ELSE TRUE
  END AS enabled
FROM
  users u
  CROSS JOIN (VALUES ('sms'::notification_channel), ('email'::notification_channel), ('push'::notification_channel)) AS ch (channel)
  CROSS JOIN (VALUES ('security'::notification_category), ('lifecycle'::notification_category), ('marketing'::notification_category)) AS cat (category)
ON CONFLICT (user_id, channel, category) DO NOTHING;

-- ─── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON TABLE user_notification_preferences IS
  'Per-user opt-in / opt-out settings for each notification channel × category combination. '
  'Security category rows cannot be disabled via the application layer (enforced by service).';

COMMENT ON COLUMN user_notification_preferences.user_id IS
  'References users.id — not a FK to stay schema-compatible with the existing text PK.';

COMMENT ON COLUMN user_notification_preferences.channel IS
  'Delivery channel: sms | email | push';

COMMENT ON COLUMN user_notification_preferences.category IS
  'Message category: security (mandatory) | lifecycle | marketing';

COMMENT ON COLUMN user_notification_preferences.enabled IS
  'Whether this channel + category combination is active for the user. '
  'Security rows are always treated as enabled by the application regardless of this value.';
