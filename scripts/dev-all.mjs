import { spawn } from 'node:child_process';

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
  for (const [name, command, args] of processes) {
    console.log(`[dev:all] ${name}: ${command} ${args.join(' ')}`);
  }
  process.exit(0);
}

for (const [name, command, args] of processes) {
  start(name, command, args);
}
