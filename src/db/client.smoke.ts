import { strict as assert } from 'node:assert';
import { db, runWithDbRequestScope } from './client';

function assertThrowsMissing(env: Record<string, unknown>, label: string): void {
  assert.throws(
    () => db(env),
    /DATABASE_URL is required/,
    `${label} should throw when DATABASE_URL is unavailable`,
  );
}

assertThrowsMissing({}, 'empty env');
assertThrowsMissing({ DATABASE_URL: '' }, 'empty DATABASE_URL');
assertThrowsMissing(
  {
    HYPERDRIVE: {
      connectionString: 'postgresql://hyperdrive.example.invalid/appdb',
    },
  },
  'Hyperdrive-only env',
);

const env = { DATABASE_URL: 'postgresql://user:pass@db.example.invalid/app?sslmode=require' };
const [first, second] = await runWithDbRequestScope(() => [db(env), db(env)] as const);
assert.equal(first, second, 'db() should reuse the Drizzle client inside one request scope');

const next = await runWithDbRequestScope(() => db(env));
assert.notEqual(first, next, 'db() must not reuse socket-backed clients across request scopes');

console.log('[db-client:smoke] OK');
