// Database client factory. Production, local development, smokes, migrations,
// and scripts all connect through DATABASE_URL. The URL should point at the
// Neon Postgres database that owns Open Canvas state.
//
// Cloudflare Workers bind socket/WebSocket I/O to the request that created it.
// A module-scope Postgres client works in Node, but in Workers it eventually
// reuses a prior request's Writable and fails with:
// "Cannot perform I/O on behalf of a different request."
//
// Keep the Drizzle handle request-scoped instead: reused within one request,
// closed before that request scope exits, and never shared across requests.

import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

export type DbEnv = {
  /** Neon Postgres connection string. Required in every runtime. */
  DATABASE_URL?: string;
};

function resolveConnectionString(env: DbEnv): string {
  const value = env.DATABASE_URL;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('DATABASE_URL is required for database access.');
  }
  return value;
}

type Database = ReturnType<typeof drizzle<typeof schema>>;

type ScopedClient = {
  database: Database;
  pool: Pool;
};

type DbScope = {
  clients: Map<string, ScopedClient>;
};

const dbScope = new AsyncLocalStorage<DbScope>();

async function closeScope(scope: DbScope): Promise<void> {
  const clients = [...scope.clients.values()];
  await Promise.all(clients.map(({ pool }) => pool.end()));
}

export async function runWithDbRequestScope<T>(fn: () => T | Promise<T>): Promise<T> {
  const scope: DbScope = { clients: new Map() };
  return await dbScope.run(scope, async () => {
    try {
      return await fn();
    } finally {
      await closeScope(scope);
    }
  });
}

function createClient(connectionString: string): ScopedClient {
  const pool = new Pool({
    connectionString,
    max: 5,
    allowExitOnIdle: true,
  });
  const database = drizzle({ client: pool, schema });
  return { database, pool };
}

export function db(env: DbEnv) {
  const connectionString = resolveConnectionString(env);
  const scope = dbScope.getStore();
  if (scope === undefined) {
    return createClient(connectionString).database;
  }

  const existing = scope.clients.get(connectionString);
  if (existing) return existing.database;

  const client = createClient(connectionString);
  scope.clients.set(connectionString, client);
  return client.database;
}

export type Db = ReturnType<typeof db>;
