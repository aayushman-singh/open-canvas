import { spawn, spawnSync } from 'node:child_process';

const isWindows = process.platform === 'win32';
const bunCommand = isWindows ? 'bun.cmd' : 'bun';
const wranglerCommand = isWindows ? 'wrangler.cmd' : 'wrangler';
const children = new Set();
let shutdownStarted = false;
let exitCode = 0;

function start(name, command, args, { shell = isWindows } = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell,
  });

  children.add(child);

  child.on('error', (error) => {
    console.error(`[dev] ${name} failed to start`, error);
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
    console.error(`[dev] ${reason}; stopping remaining processes`);
  }

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

process.on('SIGINT', () => beginShutdown(130, 'received SIGINT'));
process.on('SIGTERM', () => beginShutdown(143, 'received SIGTERM'));

const preBuilds = ['editor-client:build:dev', 'dashboard-client:build:dev'];

for (const script of preBuilds) {
  console.log(`[dev] building ${script} (dev mode)…`);
  const buildResult = spawnSync(bunCommand, ['run', script], {
    stdio: 'inherit',
    shell: isWindows,
  });
  if (buildResult.status !== 0) {
    console.error(`[dev] ${script} failed; aborting`);
    process.exit(buildResult.status ?? 1);
  }
}

// Hyperdrive local dev reaches laptop Postgres through Access + tunnel.
// process.execPath is a real binary (e.g. "C:\Program Files\nodejs\node.exe")
// whose path contains spaces — spawn it without a shell so the path isn't
// split on the space. The shell is only needed for the .cmd shims below.
start('db-tunnel', process.execPath, ['scripts/start-db-tunnel.mjs'], { shell: false });

setTimeout(() => {
  if (!shutdownStarted) {
    start('worker', wranglerCommand, ['dev']);
  }
}, 2500);
