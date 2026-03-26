-- Run this in pgAdmin (connected to Windows PostgreSQL 18, mydb)
-- It generates INSERT statements for the snake_case tables in Docker.
-- Steps:
--   1. Open pgAdmin → connect to Windows PG18 → Query Tool
--   2. Paste and run this script
--   3. Copy ALL output rows (the ?column? column)
--   4. Save as migration_data.sql
--   5. Run: docker compose exec -T db psql -U postgres -d mydb < migration_data.sql

-- user_roles (from "UserRole")
SELECT 'INSERT INTO user_roles (id, name, slug, features, created_at, updated_at) VALUES (' ||
  id || ', ' ||
  quote_literal(name) || ', ' ||
  quote_literal(slug) || ', ' ||
  quote_literal(features::text) || '::text[], ' ||
  quote_literal(createdat) || '::timestamptz, ' ||
  quote_literal(updatedat) || '::timestamptz) ON CONFLICT (id) DO NOTHING;'
FROM "UserRole"

UNION ALL

-- teams (from "Team")
SELECT 'INSERT INTO teams (id, name, slug, created_at, updated_at) VALUES (' ||
  id || ', ' ||
  quote_literal(name) || ', ' ||
  quote_literal(slug) || ', ' ||
  quote_literal(createdat) || '::timestamptz, ' ||
  quote_literal(updatedat) || '::timestamptz) ON CONFLICT (id) DO NOTHING;'
FROM "Team"

UNION ALL

-- users (from "User")
SELECT 'INSERT INTO users (id, user_id, password, email, first_name, last_name, role, status, last_login_at, password_changed_at, created_at, updated_at, created_by_id, team_id, user_role_id) VALUES (' ||
  id || ', ' ||
  quote_literal(userid) || ', ' ||
  quote_literal(password) || ', ' ||
  COALESCE(quote_literal(email), 'NULL') || ', ' ||
  COALESCE(quote_literal(firstname), 'NULL') || ', ' ||
  COALESCE(quote_literal(lastname), 'NULL') || ', ' ||
  quote_literal(role) || '::role_enum, ' ||
  quote_literal(status) || '::status_enum, ' ||
  COALESCE(quote_literal(lastloginat), 'NULL') || '::timestamptz, ' ||
  COALESCE(quote_literal(passwordchangedat), 'NULL') || '::timestamptz, ' ||
  quote_literal(createdat) || '::timestamptz, ' ||
  quote_literal(updatedat) || '::timestamptz, ' ||
  COALESCE(createdbyid::text, 'NULL') || ', ' ||
  COALESCE(teamid::text, 'NULL') || ', ' ||
  COALESCE(userroleid::text, 'NULL') ||
  ') ON CONFLICT (id) DO NOTHING;'
FROM "User"

UNION ALL

-- brds (from "Brd") — maps createdbyid → user_id
SELECT 'INSERT INTO brds (id, brd_id, title, format, status, created_at, updated_at, deleted_at, user_id) VALUES (' ||
  id || ', ' ||
  quote_literal(brdid) || ', ' ||
  quote_literal(title) || ', ' ||
  quote_literal(format) || '::brd_format_enum, ' ||
  quote_literal(status) || '::brd_status_enum, ' ||
  quote_literal(createdat) || '::timestamptz, ' ||
  quote_literal(updatedat) || '::timestamptz, ' ||
  COALESCE(quote_literal(deletedat), 'NULL') || '::timestamptz, ' ||
  COALESCE(createdbyid::text, 'NULL') ||
  ') ON CONFLICT (id) DO NOTHING;'
FROM "Brd"

UNION ALL

-- password_history (from "PasswordHistory") — column is "hash" not "passwordhash"
SELECT 'INSERT INTO password_history (id, user_id, password_hash, created_at) VALUES (' ||
  id || ', ' ||
  userid || ', ' ||
  quote_literal(hash) || ', ' ||
  quote_literal(createdat) || '::timestamptz) ON CONFLICT (id) DO NOTHING;'
FROM "PasswordHistory"

UNION ALL

-- user_logs (from "UserLog") — column is "details" not "description"
SELECT 'INSERT INTO user_logs (id, action, description, created_at, user_id) VALUES (' ||
  id || ', ' ||
  quote_literal(action) || ', ' ||
  COALESCE(quote_literal(details), 'NULL') || ', ' ||
  quote_literal(createdat) || '::timestamptz, ' ||
  COALESCE(userid::text, 'NULL') ||
  ') ON CONFLICT (id) DO NOTHING;'
FROM "UserLog";
