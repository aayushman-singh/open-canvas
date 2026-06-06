// Database client factory. Production (the deployed Cloudflare Worker)
// connects through the Hyperdrive binding — postgres.js opens a TCP
// Postgres connection that Hyperdrive routes to Neon via its globally-warm
// pool, caching prepared statements colo-side so subsequent queries skip
// most of the ~240ms Neon RTT we used to pay per request.
//
// Smokes, migrations, and any caller running outside the Worker runtime
// pass DATABASE_URL instead — same postgres.js driver, just dialled
// straight at the database with no Hyperdrive in front. That keeps the
// integration smokes and drizzle-kit migration tooling working without a
// second dialect.
//
// The two paths share the drizzle/postgres-js dialect so query types and
// SQL behaviour are identical regardless of which env shape called in.
//
// CRITICAL: the postgres() client is memoised in module scope so the
// connection pool + prepared-statement cache survive across requests in
// the same Worker isolate. Creating a fresh client per request (the naive
// `db(env)` shape) opens a new TLS connection every time, defeats
// Hyperdrive's whole reason for existing, and measured 2x SLOWER than
// the @neondatabase/serverless HTTP driver we replaced. Module-scope
// memoisation makes Hyperdrive's pool work as designed.

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type DbEnv = {
  /** Cloudflare Hyperdrive binding from wrangler.toml. Preferred in prod. */
  HYPERDRIVE?: Hyperdrive;
  /** Raw Postgres connection string. Used by smokes + migration tooling. */
  DATABASE_URL?: string;
};

function resolveConnectionString(env: DbEnv): string {
  if (env.HYPERDRIVE) return env.HYPERDRIVE.connectionString;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  throw new Error(
    'db(): neither HYPERDRIVE binding nor DATABASE_URL is set. ' +
      'Wire HYPERDRIVE in wrangler.toml for the Worker, or pass DATABASE_URL ' +
      'for smokes / migrations.',
  );
}

export function db(env: DbEnv) {
  const sql = postgres(resolveConnectionString(env), {
    max: 5,
    fetch_types: false,
    prepare: true,
  });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof db>;
