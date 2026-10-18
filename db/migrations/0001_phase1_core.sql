-- Phase 1 core schema: identity, business profiles, verification, audit.
--
-- Notes for operators:
--   * gen_random_uuid() is built into PostgreSQL 13+ and Neon, so no extension is required.
--   * Emails are stored lower-cased and uniquely indexed rather than using citext,
--     to avoid depending on an extension being installed on the target database.
--   * Nothing in this schema stores payment card data. Phase 6 must add a provider
--     token reference, never a PAN or CVV.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text        NOT NULL,
  password_hash      text        NOT NULL,
  full_name          text        NOT NULL,
  role               text        NOT NULL DEFAULT 'member',
  email_verified_at  timestamptz,
  failed_login_count integer     NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  disabled_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_role_valid CHECK (role IN ('member', 'moderator', 'admin')),
  CONSTRAINT users_email_shape CHECK (position('@' IN email) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- ---------------------------------------------------------------------------
-- Sessions
--
-- Only a SHA-256 hash of the session token is stored, so a database read does
-- not yield a usable cookie value.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id           text PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text,
  ip_hash      text
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Email verification tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          text PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Businesses
--
-- One row per business profile. `owner_user_id` is the single source of truth for
-- edit permission; ownership is never taken from client input.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS businesses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  ubp_id            text        NOT NULL,
  slug              text        NOT NULL,
  display_name      text        NOT NULL,
  legal_name        text,
  tagline           text,
  description       text,
  category          text,
  country_code      char(2),
  region            text,
  city              text,
  website_url       text,
  contact_email     text,
  contact_phone     text,
  logo_url          text,
  banner_url        text,
  languages         text[]      NOT NULL DEFAULT '{}',
  status            text        NOT NULL DEFAULT 'draft',
  show_email_publicly boolean   NOT NULL DEFAULT false,
  show_phone_publicly boolean   NOT NULL DEFAULT false,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT businesses_status_valid
    CHECK (status IN ('draft', 'published', 'unpublished', 'suspended')),
  CONSTRAINT businesses_ubp_id_shape CHECK (ubp_id ~ '^UBP-[0-9A-Z]{8}$'),
  CONSTRAINT businesses_slug_shape CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  CONSTRAINT businesses_display_name_len CHECK (char_length(display_name) BETWEEN 2 AND 120),
  CONSTRAINT businesses_country_shape CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT businesses_contact_email_shape
    CHECK (contact_email IS NULL OR position('@' IN contact_email) > 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS businesses_ubp_id_key ON businesses (ubp_id);
CREATE UNIQUE INDEX IF NOT EXISTS businesses_slug_key ON businesses (slug);
CREATE INDEX IF NOT EXISTS businesses_owner_idx ON businesses (owner_user_id);
CREATE INDEX IF NOT EXISTS businesses_status_idx ON businesses (status);
CREATE INDEX IF NOT EXISTS businesses_category_idx ON businesses (category);
CREATE INDEX IF NOT EXISTS businesses_country_idx ON businesses (country_code);

-- A user may own several businesses; a slug collision must be resolvable by the
-- owner choosing another slug, so no per-owner uniqueness is imposed here.

-- ---------------------------------------------------------------------------
-- Verification records
--
-- A verification level is only ever written after the corresponding check has
-- actually been performed. There is no code path that sets a level because a
-- payment was made. Every row records who or what performed the check.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid        NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
  level              text        NOT NULL,
  status             text        NOT NULL,
  scope              text,
  method             text,
  source             text,
  source_reference   text,
  checked_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz,
  checked_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  checked_by_system  text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_level_valid CHECK (level IN (
    'profile_created',
    'email_verified',
    'contact_verified',
    'documents_reviewed',
    'registry_checked',
    'ubp_member'
  )),
  CONSTRAINT verification_status_valid CHECK (status IN (
    'pending', 'verified', 'rejected', 'expired', 'revoked'
  )),
  -- A check must be attributable to a user or an automated system.
  CONSTRAINT verification_attribution_present CHECK (
    checked_by_user_id IS NOT NULL OR checked_by_system IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS verification_records_business_idx
  ON verification_records (business_id, level, checked_at DESC);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action        text        NOT NULL,
  entity_type   text        NOT NULL,
  entity_id     text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip_hash       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS businesses_set_updated_at ON businesses;
CREATE TRIGGER businesses_set_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
