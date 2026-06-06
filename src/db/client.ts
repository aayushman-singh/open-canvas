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

import postgres, { type Sql } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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

type Schema = typeof schema;
type DrizzleClient = PostgresJsDatabase<Schema>;

let cachedConnectionString: string | null = null;
let cachedClient: Sql | null = null;
let cachedDrizzle: DrizzleClient | null = null;

function makeClient(connectionString: string): { sql: Sql; database: DrizzleClient } {
  const sql = postgres(connectionString, {
    // Workers cap concurrent external connections per request — postgres.js
    // shares the underlying socket pool across queries within one isolate,
    // but a request that fans out queries should still stay under this cap.
    max: 5,
    // We don't use Postgres array types anywhere in this schema, so skip
    // the pg_type round-trip postgres.js otherwise runs on first use to
    // resolve OID → JS converters.
    fetch_types: false,
    // Hyperdrive caches prepared statements globally when this is true.
    // Disabling it for a generator that emits `sql.unsafe(...)` calls would
    // negate the cache; drizzle's parameterised query builder is compatible.
    prepare: true,
  });
  const database = drizzle(sql, { schema });
  return { sql, database };
}

export function db(env: DbEnv): DrizzleClient {
  const connectionString = resolveConnectionString(env);
  if (cachedDrizzle && cachedConnectionString === connectionString) {
    return cachedDrizzle;
  }
  // Connection string changed (smoke → prod swap mid-process is unusual but
  // not impossible — e.g. an integration test reusing this module). Drop the
  // old client so its socket pool is GC'd.
  if (cachedClient && cachedConnectionString !== connectionString) {
    // Fire-and-forget; we don't await because the caller of db() shouldn't
    // pay for the previous pool's teardown.
    void cachedClient.end({ timeout: 5 }).catch(() => undefined);
  }
  const { sql, database } = makeClient(connectionString);
  cachedConnectionString = connectionString;
  cachedClient = sql;
  cachedDrizzle = database;
  return database;
}

export type Db = ReturnType<typeof db>;
