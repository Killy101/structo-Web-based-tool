-- schema.sql
-- Complete DDL for the structo backend database.
-- Run this manually: psql -U postgres -d mydb -f schema.sql

-- ── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE role_enum        AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');                                                       EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE status_enum      AS ENUM ('ACTIVE', 'INACTIVE');                                                                      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE task_status_enum AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'SUBMITTED', 'APPROVED', 'REJECTED');                 EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE assignment_status AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');                                                    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE brd_format_enum  AS ENUM ('NEW', 'OLD');                                                                              EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE brd_status_enum  AS ENUM ('DRAFT', 'PAUSED', 'COMPLETED', 'APPROVED', 'ON_HOLD');                                     EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── user_roles ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_roles (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  slug       TEXT        NOT NULL UNIQUE,
  features   TEXT[]      NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
  
-- ── teams ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id         SERIAL      PRIMARY KEY,
  name       TEXT        NOT NULL UNIQUE,
  slug       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL        PRIMARY KEY,
  user_id             TEXT          NOT NULL UNIQUE,
  password            TEXT          NOT NULL,
  email               TEXT          UNIQUE,
  first_name          TEXT,
  last_name           TEXT,
  role                role_enum     NOT NULL DEFAULT 'USER',
  status              status_enum   NOT NULL DEFAULT 'ACTIVE',
  last_login_at       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by_id       INT           REFERENCES users (id),
  team_id             INT           REFERENCES teams (id),
  user_role_id        INT           REFERENCES user_roles (id)
);

-- ── password_history ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_history (
  id         SERIAL      PRIMARY KEY,
  user_id    INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  hash       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user_created ON password_history (user_id, created_at);

-- ── user_logs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_logs (
  id         SERIAL      PRIMARY KEY,
  user_id    INT         NOT NULL REFERENCES users (id),
  action     TEXT        NOT NULL,
  details    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── notifications ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL      PRIMARY KEY,
  user_id    INT         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);

-- ── file_uploads ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_uploads (
  id             SERIAL           PRIMARY KEY,
  original_name  TEXT             NOT NULL,
  file_type      TEXT             NOT NULL,
  file_size      INT              NOT NULL,
  storage_path   TEXT             NOT NULL,
  status         task_status_enum NOT NULL DEFAULT 'PENDING',
  uploaded_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  submitted_at   TIMESTAMPTZ,
  uploaded_by_id INT              NOT NULL REFERENCES users (id)
);

-- ── file_outputs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS file_outputs (
  id           SERIAL      PRIMARY KEY,
  upload_id    INT         NOT NULL UNIQUE REFERENCES file_uploads (id),
  filename     TEXT        NOT NULL,
  storage_path TEXT        NOT NULL,
  file_size    INT         NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── validations ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS validations (
  id              SERIAL      PRIMARY KEY,
  upload_id       INT         NOT NULL UNIQUE REFERENCES file_uploads (id),
  validated_by_id INT         NOT NULL REFERENCES users (id),
  status          TEXT        NOT NULL,
  remarks         TEXT,
  validated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── task_assignments ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_assignments (
  id            SERIAL          PRIMARY KEY,
  title         TEXT            NOT NULL,
  description   TEXT,
  status        assignment_status NOT NULL DEFAULT 'PENDING',
  percentage    INT             NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  due_date      TIMESTAMPTZ,
  team_id       INT             NOT NULL REFERENCES teams (id),
  created_by_id INT             NOT NULL REFERENCES users (id),
  brd_file_id   INT             REFERENCES file_uploads (id)
);

-- ── task_assignees ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_assignees (
  id            SERIAL      PRIMARY KEY,
  assignment_id INT         NOT NULL REFERENCES task_assignments (id) ON DELETE CASCADE,
  user_id       INT         NOT NULL REFERENCES users (id),
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assignment_id, user_id)
);

-- ── task_comments ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_comments (
  id            SERIAL      PRIMARY KEY,
  assignment_id INT         NOT NULL REFERENCES task_assignments (id) ON DELETE CASCADE,
  author_id     INT         NOT NULL REFERENCES users (id),
  body          TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── brds ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brds (
  brd_id        TEXT           NOT NULL PRIMARY KEY,
  title         TEXT           NOT NULL,
  format        brd_format_enum NOT NULL DEFAULT 'NEW',
  status        brd_status_enum NOT NULL DEFAULT 'DRAFT',
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  created_by_id INT            NOT NULL REFERENCES users (id),
  upload_id     INT            UNIQUE REFERENCES file_uploads (id)
);

-- ── brd_sections ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brd_sections (
  id              SERIAL      PRIMARY KEY,
  brd_id          TEXT        NOT NULL UNIQUE REFERENCES brds (brd_id) ON DELETE CASCADE,
  scope           JSONB,
  metadata        JSONB,
  toc             JSONB,
  citations       JSONB,
  content_profile JSONB,
  brd_config      JSONB,
  innod_metajson  JSONB,
  simple_metajson JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── brd_cell_images ──────────────────────────────────────────────────────────
-- image_data stores the raw binary bytes (BYTEA).
-- No more Supabase storage paths.

CREATE TABLE IF NOT EXISTS brd_cell_images (
  id           SERIAL      PRIMARY KEY,
  brd_id       TEXT        NOT NULL REFERENCES brd_sections (brd_id) ON DELETE CASCADE,
  table_index  INT         NOT NULL,
  row_index    INT         NOT NULL,
  col_index    INT         NOT NULL,
  rid          TEXT        NOT NULL,
  media_name   TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL,
  cell_text    TEXT        NOT NULL DEFAULT '',
  section      TEXT        NOT NULL DEFAULT 'unknown',
  field_label  TEXT        NOT NULL DEFAULT '',
  image_data   BYTEA,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brd_id, table_index, row_index, col_index, rid)
);

CREATE INDEX IF NOT EXISTS idx_brd_cell_images_brd_id         ON brd_cell_images (brd_id);
CREATE INDEX IF NOT EXISTS idx_brd_cell_images_brd_id_section ON brd_cell_images (brd_id, section);

-- ── brd_versions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brd_versions (
  id              SERIAL      PRIMARY KEY,
  brd_id          TEXT        NOT NULL REFERENCES brds (brd_id) ON DELETE CASCADE,
  version_num     INT         NOT NULL,
  label           TEXT        NOT NULL,
  saved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scope           JSONB,
  metadata        JSONB,
  toc             JSONB,
  citations       JSONB,
  content_profile JSONB,
  brd_config      JSONB,
  UNIQUE (brd_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_brd_versions_brd_id ON brd_versions (brd_id);

-- ── app_settings ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  id         SERIAL      PRIMARY KEY,
  key        TEXT        NOT NULL UNIQUE,
  value      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
