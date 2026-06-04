import { spawn, spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const bunCommand = isWindows ? 'bun.cmd' : 'bun';
const wranglerCommand = isWindows ? 'wrangler.cmd' : 'wrangler';
const processes = [
  ['scraper', bunCommand, ['run', '--cwd', 'services/scraper', 'dev']],
  ['worker', wranglerCommand, ['dev']],
];

const children = new Set();
let shutdownStarted = false;
let exitCode = 0;

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: isWindows,
  });

  children.add(child);

  child.on('error', (error) => {
    console.error(`[dev:all] ${name} failed to start`, error);
    beginShutdown(1, `${name} failed to start`);
  });

  child.on('exit', (code, signal) => {
    children.delete(child);
    const childExitCode = typeof code === 'number' ? code : 1;

    if (!shutdownStarted) {
      beginShutdown(childExitCode, `${name} exited with ${signal ?? String(code)}`);
    }

    if (children.size === 0) {
      process.exit(exitCode);
    }
  });

  return child;
}

function beginShutdown(code, reason) {
  if (!shutdownStarted) {
    shutdownStarted = true;
    exitCode = code;
    console.error(`[dev:all] ${reason}; stopping remaining processes`);
  }

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on('SIGINT', () => beginShutdown(130, 'received SIGINT'));
process.on('SIGTERM', () => beginShutdown(143, 'received SIGTERM'));

if (process.argv.includes('--dry-run')) {
  console.log(`[dev:all] editor-client:build:dev (pre-step, sequential)`);
  for (const [name, command, args] of processes) {
    console.log(`[dev:all] ${name}: ${command} ${args.join(' ')}`);
  }
  process.exit(0);
}

// ADR 0015 Phase 3 — wrangler dev serves the editor bundle out of
// ./dist/_assets via the [assets] binding. The bundle must exist before
// wrangler boots, otherwise the editor route returns its shell but the
// `<script src="/_assets/index-<hash>.js">` 404s and the page stays
// blank. Run the dev build (inline sourcemaps, unminified) synchronously
// before spawning anything else.
console.log('[dev:all] building editor-client bundle (dev mode)…');
const buildResult = spawnSync(
  bunCommand,
  ['run', 'editor-client:build:dev'],
  { stdio: 'inherit', shell: isWindows },
);
if (buildResult.status !== 0) {
  console.error('[dev:all] editor-client:build:dev failed; aborting dev:all');
  process.exit(buildResult.status ?? 1);
}

for (const [name, command, args] of processes) {
  start(name, command, args);
}
