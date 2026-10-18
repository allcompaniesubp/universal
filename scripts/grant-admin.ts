/**
 * Grants or revokes the administrator role.
 *
 * This is the only supported way to create an administrator. There is no
 * default password, no seeded admin account, and no code path that reads an
 * administrator role from a request. The operator runs this deliberately against
 * the database, and the change is written to the audit log.
 *
 * Usage:
 *   npm run grant:admin -- --email owner@example.com
 *   npm run grant:admin -- --email owner@example.com --role moderator
 *   npm run grant:admin -- --email owner@example.com --role member   (revoke)
 */

import { Client } from 'pg';

function parseArgs(argv: string[]): { email: string; role: string } {
  let email = '';
  let role = 'admin';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--email') email = argv[i + 1] ?? '';
    if (arg === '--role') role = argv[i + 1] ?? 'admin';
  }
  if (!email) {
    throw new Error('Usage: npm run grant:admin -- --email <address> [--role admin|moderator|member]');
  }
  if (!['admin', 'moderator', 'member'].includes(role)) {
    throw new Error('Role must be one of: admin, moderator, member');
  }
  return { email: email.trim().toLowerCase(), role };
}

async function main(): Promise<void> {
  const { email, role } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{ id: string; role: string }>(
      `UPDATE users SET role = $2 WHERE email = $1 RETURNING id, role`,
      [email, role],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`No account exists with the email address ${email}. Register first, then re-run.`);
    }

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES (NULL, 'user.role_changed', 'user', $1, $2::jsonb)`,
      [row.id, JSON.stringify({ email, role, changedVia: 'grant-admin script' })],
    );

    console.log(`[grant-admin] ${email} now has role "${row.role}".`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[grant-admin] Failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
