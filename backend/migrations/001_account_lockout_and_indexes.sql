-- Migration: Account lockout columns and performance indexes
-- Run this against existing databases that were created before these schema changes.

-- Add account lockout columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_locked_until  TIMESTAMPTZ;

-- Add performance indexes for login lookups
CREATE INDEX IF NOT EXISTS idx_users_user_id_lower ON users (LOWER(user_id));
CREATE INDEX IF NOT EXISTS idx_users_id            ON users (id);
CREATE INDEX IF NOT EXISTS idx_users_role_status   ON users (role, status);
CREATE INDEX IF NOT EXISTS idx_users_team_id_role  ON users (team_id, role);
CREATE INDEX IF NOT EXISTS idx_users_email_lower   ON users (LOWER(email));
