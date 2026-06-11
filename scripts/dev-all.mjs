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

// Both browser bundles ship from ./dist/_assets via the [assets] binding
// and must be built before wrangler boots (see the build note below).
const preBuilds = ['editor-client:build:dev', 'dashboard-client:build:dev'];

if (process.argv.includes('--dry-run')) {
  console.log(`[dev:all] ${preBuilds.join(', ')} (pre-step, sequential)`);
  for (const [name, command, args] of processes) {
    console.log(`[dev:all] ${name}: ${command} ${args.join(' ')}`);
  }
  process.exit(0);
}

// ADR 0015 Phase 3 / ADR 0021 — wrangler dev serves the editor AND
// dashboard bundles out of ./dist/_assets via the [assets] binding. Each
// bundle must exist before wrangler boots, otherwise the route returns
// its shell but the `<script src="/_assets/<bundle>-<hash>.js">` 404s and
// the page's client never mounts — e.g. the site-settings delete button
// (and every other dashboard-client control) silently does nothing. Run
// the dev builds (inline sourcemaps, unminified) synchronously before
// spawning anything else.
//
// NOTE: these are one-shot builds, not watchers. Editing any file under
// src/editor-client/ or src/dashboard-client/ (or their transitive deps,
// e.g. src/canvas/style-kits.ts + src/ui/theme.ts for editor CSS) requires
// a manual rebuild:
//   bun run editor-client:build:dev   # or dashboard-client:build:dev
// then a browser reload. Wrangler dev DOES NOT watch the bundle source.
// If a bundle source goes stale during a long dev session, the symptom is
// "my edit isn't taking effect" — re-run the matching build.
for (const script of preBuilds) {
  console.log(`[dev:all] building ${script} (dev mode)…`);
  const buildResult = spawnSync(bunCommand, ['run', script], {
    stdio: 'inherit',
    shell: isWindows,
  });
  if (buildResult.status !== 0) {
    console.error(`[dev:all] ${script} failed; aborting dev:all`);
    process.exit(buildResult.status ?? 1);
  }
}
console.log(
  '[dev:all] note: one-shot builds. Re-run the matching *:build:dev after editing',
);
console.log(
  '[dev:all]       src/editor-client/ or src/dashboard-client/, then reload the browser.',
);

for (const [name, command, args] of processes) {
  start(name, command, args);
}
