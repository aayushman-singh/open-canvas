import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
// Open Canvas Access TCP client for db.aayushman.dev. Port 15433 is
// deliberate — 15432 on this machine is reserved for another project's
// pg.aayushman.dev tunnel; binding OC there silently proxies to the
// wrong Postgres.
const tunnelHost = 'db.aayushman.dev';
const localPort = 15_433;
const cloudflaredCommand = isWindows
  ? 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe'
  : 'cloudflared';

function readDevVar(name) {
  const line = readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .find((row) => row.startsWith(`${name}=`));
  if (!line) {
    throw new Error(`[db:tunnel] ${name} is missing from .dev.vars`);
  }
  return line.slice(name.length + 1).trim();
}

const clientId = readDevVar('ACCESS_CLIENT_ID');
const clientSecret = readDevVar('ACCESS_CLIENT_SECRET');

const child = spawn(
  cloudflaredCommand,
  [
    'access',
    'tcp',
    '--hostname',
    tunnelHost,
    '--url',
    `127.0.0.1:${localPort}`,
    '--service-token-id',
    clientId,
    '--service-token-secret',
    clientSecret,
  ],
  { stdio: 'inherit' },
);

child.on('error', (error) => {
  console.error('[db:tunnel] failed to start cloudflared', error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(0);
    return;
  }
  process.exit(code ?? 1);
});

process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());

console.log(
  `[db:tunnel] ${tunnelHost} → 127.0.0.1:${localPort} (Ctrl+C to stop)`,
);
