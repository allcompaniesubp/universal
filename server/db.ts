/**
 * PostgreSQL access.
 *
 * A single small pool is shared per process. On Vercel each serverless instance
 * gets its own pool, so the pool size is deliberately tiny and the connection
 * string is expected to point at a pooled endpoint (Neon's "-pooler" host) to
 * avoid exhausting server-side connections.
 *
 * The same driver is used in development, tests and production so that the code
 * paths exercised by the test suite are the ones that run in production.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { getConfig } from './config.ts';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.isProduction ? 4 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    // An idle client erroring must not take the process down.
    pool.on('error', () => {});
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs `fn` inside a transaction, rolling back on any thrown error.
 * Used wherever a write spans more than one table (for example creating a
 * business plus its first verification record plus an audit entry).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback failures are secondary to the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Test helper: closes the pool so a new DATABASE_URL can take effect. */
export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
