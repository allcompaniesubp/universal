-- Rollback for 0001_phase1_core.sql.
--
-- WARNING: this destroys all Phase 1 data, including user accounts, business
-- profiles and audit history. Take a backup first. It exists so that a
-- deployment can be reversed deliberately, not as a routine operation.
--
-- Run with:  psql "$DATABASE_URL" -f db/rollback/0001_phase1_core_down.sql

BEGIN;

DROP TRIGGER IF EXISTS businesses_set_updated_at ON businesses;
DROP TRIGGER IF EXISTS users_set_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS verification_records;
DROP TABLE IF EXISTS businesses;
DROP TABLE IF EXISTS email_verification_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

DELETE FROM schema_migrations WHERE version = '0001_phase1_core';

COMMIT;
