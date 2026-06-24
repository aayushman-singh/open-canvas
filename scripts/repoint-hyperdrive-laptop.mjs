// Point the production Hyperdrive binding at the laptop Postgres ingress
// (db.aayushman.dev + Cloudflare Access). Run after rotating the laptop DB
// password or Access service-token credentials:
//
//   bun run db:hyperdrive:repoint
//
// Reads ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET, and DATABASE_URL from
// .dev.vars. DATABASE_URL must be the laptop/appdb connection (user +
// password); host/port are ignored — Hyperdrive always targets
// db.aayushman.dev:5432.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const HYPERDRIVE_ID = 'fb8eba4bcc154ba196f1d55a8510dd0a';
const TUNNEL_HOST = 'db.aayushman.dev';
const DATABASE_NAME = 'appdb';

const isWindows = process.platform === 'win32';
const wranglerCommand = isWindows ? 'wrangler.cmd' : 'wrangler';

function readDevVar(name) {
  const line = readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .find((row) => row.startsWith(`${name}=`));
  if (!line) {
    throw new Error(`[db:hyperdrive:repoint] ${name} is missing from .dev.vars`);
  }
  return line.slice(name.length + 1).trim();
}

const clientId = readDevVar('ACCESS_CLIENT_ID');
const clientSecret = readDevVar('ACCESS_CLIENT_SECRET');
const databaseUrl = readDevVar('DATABASE_URL');

let parsed;
try {
  parsed = new URL(databaseUrl);
} catch (error) {
  throw new Error(`[db:hyperdrive:repoint] DATABASE_URL is not a valid URL`, { cause: error });
}

const user = decodeURIComponent(parsed.username);
const password = decodeURIComponent(parsed.password);
if (!user || !password) {
  throw new Error('[db:hyperdrive:repoint] DATABASE_URL must include username and password');
}

console.log(
  `[db:hyperdrive:repoint] updating ${HYPERDRIVE_ID} → ${TUNNEL_HOST}/${DATABASE_NAME} (user ${user})`,
);

const result = spawnSync(
  wranglerCommand,
  [
    'hyperdrive',
    'update',
    HYPERDRIVE_ID,
    '--origin-host',
    TUNNEL_HOST,
    '--database',
    DATABASE_NAME,
    '--origin-user',
    user,
    '--origin-password',
    password,
    '--access-client-id',
    clientId,
    '--access-client-secret',
    clientSecret,
  ],
  { stdio: 'inherit', shell: isWindows, windowsHide: true },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('[db:hyperdrive:repoint] done');
