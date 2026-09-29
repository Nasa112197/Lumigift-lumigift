-- Migration: 0008_notifications
-- Issue #153 — User notification center
--
-- Creates the notifications table for storing in-app lifecycle notifications
-- (gift sent, gift unlocked, gift claimed, payment received, etc.) with
-- read state tracking.
--
-- Table: notifications
--   id          — UUID primary key
--   user_id     — FK to users, cascading delete so records are removed when the user account is deleted
--   type        — machine-readable notification type (e.g. 'gift_sent', 'gift_unlocked')
--   message     — human-readable notification body (localised string)
--   read_at     — NULL when unread; set to the timestamp when the user marks it read
--   metadata    — JSONB bag for type-specific data (gift ID, amount, etc.)
--   created_at  — server-side creation timestamp (UTC)

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL,
  message    TEXT        NOT NULL,
  read_at    TIMESTAMPTZ,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup of all notifications for a given user (paginated list)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id, created_at DESC);

-- Partial index — only unread rows — used for the unread count badge query
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(user_id)
  WHERE read_at IS NULL;
