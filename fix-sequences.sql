-- Fix PostgreSQL SERIAL sequence out-of-sync issues
-- This script resets all sequences to match their table max IDs
-- Run this if you get "duplicate key value violates unique constraint" errors

BEGIN;

-- Log current state
DO $$
DECLARE
  v_seq_name text;
  v_table_name text;
  v_max_id int;
  v_current_seq int;
BEGIN
  RAISE NOTICE '====== SEQUENCE AUDIT REPORT ======';
  FOR v_seq_name, v_table_name, v_max_id, v_current_seq IN
    SELECT 
      s.sequencename,
      SUBSTRING(s.sequencename FROM 1 FOR LENGTH(s.sequencename) - 8) as table_name,
      (SELECT COALESCE(MAX(id), 0) FROM pg_class WHERE relname = SUBSTRING(s.sequencename FROM 1 FOR LENGTH(s.sequencename) - 8)),
      s.last_value
    FROM pg_sequences s
    WHERE s.schemaname = 'public'
    ORDER BY s.sequencename
  LOOP
    IF v_current_seq < v_max_id THEN
      RAISE NOTICE 'MISMATCH: % - Max ID: %, Current Seq: %', v_seq_name, v_max_id, v_current_seq;
    ELSE
      RAISE NOTICE 'OK: % - Max ID: %, Current Seq: %', v_seq_name, v_max_id, v_current_seq;
    END IF;
  END LOOP;
END
$$;

-- Fix all sequences
SELECT setval('app_settings_id_seq', COALESCE((SELECT MAX(id) FROM app_settings), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='app_settings_id_seq');
SELECT setval('brd_cell_images_id_seq', COALESCE((SELECT MAX(id) FROM brd_cell_images), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='brd_cell_images_id_seq');
SELECT setval('brd_sections_id_seq', COALESCE((SELECT MAX(id) FROM brd_sections), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='brd_sections_id_seq');
SELECT setval('brd_versions_id_seq', COALESCE((SELECT MAX(id) FROM brd_versions), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='brd_versions_id_seq');
SELECT setval('file_outputs_id_seq', COALESCE((SELECT MAX(id) FROM file_outputs), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='file_outputs_id_seq');
SELECT setval('file_uploads_id_seq', COALESCE((SELECT MAX(id) FROM file_uploads), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='file_uploads_id_seq');
SELECT setval('notifications_id_seq', COALESCE((SELECT MAX(id) FROM notifications), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='notifications_id_seq');
SELECT setval('password_history_id_seq', COALESCE((SELECT MAX(id) FROM password_history), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='password_history_id_seq');
SELECT setval('task_assignees_id_seq', COALESCE((SELECT MAX(id) FROM task_assignees), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='task_assignees_id_seq');
SELECT setval('task_assignments_id_seq', COALESCE((SELECT MAX(id) FROM task_assignments), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='task_assignments_id_seq');
SELECT setval('task_comments_id_seq', COALESCE((SELECT MAX(id) FROM task_comments), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='task_comments_id_seq');
SELECT setval('teams_id_seq', COALESCE((SELECT MAX(id) FROM teams), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='teams_id_seq');
SELECT setval('user_logs_id_seq', COALESCE((SELECT MAX(id) FROM user_logs), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='user_logs_id_seq');
SELECT setval('user_roles_id_seq', COALESCE((SELECT MAX(id) FROM user_roles), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='user_roles_id_seq');
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='users_id_seq');
SELECT setval('validations_id_seq', COALESCE((SELECT MAX(id) FROM validations), 0)) WHERE EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename='validations_id_seq');

RAISE NOTICE 'All sequences have been reset to match their table max IDs.';

COMMIT;
