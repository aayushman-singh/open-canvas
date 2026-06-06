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
  // Prefer DATABASE_URL over HYPERDRIVE. EXPLAIN ANALYZE at Neon clocks the
  // dashboard listing query at 0.18 ms, but the Worker measures ~485 ms per
  // query through the Hyperdrive binding — i.e. Hyperdrive is adding ~485 ms
  // of overhead per call in our config, swamping every other win. Until we
  // figure out why, route around it: if DATABASE_URL is set as a Worker
  // secret, postgres.js connects directly to Neon's pooled endpoint. Falls
  // back to HYPERDRIVE if the secret isn't present.
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.HYPERDRIVE) return env.HYPERDRIVE.connectionString;
  throw new Error(
    'db(): neither DATABASE_URL secret nor HYPERDRIVE binding is set. ' +
      'Run `wrangler secret put DATABASE_URL` with the Neon connection ' +
      'string, or wire HYPERDRIVE in wrangler.toml.',
  );
}

export function db(env: DbEnv) {
  const sql = postgres(resolveConnectionString(env), {
    max: 5,
    fetch_types: false,
    // Tried prepare:true with Hyperdrive — every per-request postgres()
    // client still paid the PREPARE+EXECUTE 2-RTT cycle because Hyperdrive's
    // statement cache isn't surfacing across short-lived TCP connections in
    // our config. Disabling prepare drops it to a single round-trip per
    // query. Per Cloudflare docs this means Hyperdrive can't cache anything,
    // but caching wasn't happening anyway in our measurements.
    prepare: false,
  });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof db>;
