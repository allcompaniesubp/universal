/**
 * Migration runner.
 *
 * Applies every .sql file in db/migrations in filename order, inside a
 * transaction per file, and records the applied version in schema_migrations.
 * Re-running is safe: an already-applied file is skipped.
 *
 * Rollback: this project's migrations are additive and written with
 * IF NOT EXISTS. To roll back Phase 1 entirely, run the statements in
 * db/rollback/0001_phase1_core_down.sql. See README.md for the full procedure.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

function connectionString(): string {
  const explicit = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!explicit) {
    throw new Error('Set DATABASE_URL (or MIGRATION_DATABASE_URL) before running migrations.');
  }
  return explicit;
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
    if (files.length === 0) {
      console.log('[migrate] No migration files found.');
      return;
    }

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const already = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [
        version,
      ]);
      if (already.rowCount && already.rowCount > 0) {
        console.log(`[migrate] Skipping ${version} (already applied).`);
        continue;
      }

      const sql = await readFile(join(migrationsDir, file), 'utf8');
      console.log(`[migrate] Applying ${version}...`);

      // Each migration runs in its own transaction so a failure leaves the
      // database on the previous, working version.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`[migrate] Applied ${version}.`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${version} failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    console.log('[migrate] All migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
