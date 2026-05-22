// src/wishlist-smoke.ts
//
// Phase 0 scaffold — runs every per-feature smoke serially via Bun.spawnSync.
// Exits non-zero on the first failure, with a clear marker of which smoke
// failed. The 23-entry chain via `&&` is fragile on Windows / package.json,
// so we use a small Bun script instead.
//
// Each entry below mirrors a `"<name>:smoke"` script in package.json. The
// list is appended to as Wave agents replace stubs with real smokes; the
// shape of each entry stays the same so adding/removing is a one-line edit.
//
// This file is part of the Phase 0 frozen surface: Wave agents may add new
// SMOKES entries but must not change the runner itself.

interface SmokeEntry {
  name: string;
  script: string;
}

// The 23 per-feature smokes from the Phase 0 plan master index. Pre-existing
// repo smokes (canvas, canvas-agent, section-import, review) stay separate —
// the main thread / pre-existing test workflow runs those alongside this
// chain. Once a wave agent replaces its stub with a real smoke, the entry
// below stays unchanged (script name + dir path stayed the same).
const SMOKES: SmokeEntry[] = [
  // Phase 0 — Yjs projection contract consumed by #3 (version history) and
  // #4 (co-edit). Runs first so any drift in the projection module trips the
  // chain before downstream feature smokes that depend on it execute.
  { name: 'yjs-projection', script: 'yjs-projection:smoke' },
  // Phase 0 — asset pipeline (#2). Owner-rooted upload, content-hash read,
  // confirm-cascade delete. Runs early because every wave-1 agent that
  // touches media consumes this contract.
  { name: 'assets', script: 'assets:smoke' },
  { name: 'responsive', script: 'responsive:smoke' },
  { name: 'version', script: 'version:smoke' },
  { name: 'coedit', script: 'coedit:smoke' },
  { name: 'customdomain', script: 'customdomain:smoke' },
  { name: 'og', script: 'og:smoke' },
  { name: 'forms', script: 'forms:smoke' },
  { name: 'embed', script: 'embed:smoke' },
  { name: 'password', script: 'password:smoke' },
  { name: 'themes', script: 'themes:smoke' },
  { name: 'charts', script: 'charts:smoke' },
  { name: 'fonts', script: 'fonts:smoke' },
  { name: 'search', script: 'search:smoke' },
  { name: 'symbols', script: 'symbols:smoke' },
  { name: 'a11y', script: 'a11y:smoke' },
  { name: 'interactive', script: 'interactive:smoke' },
  { name: 'code', script: 'code:smoke' },
  { name: 'seo', script: 'seo:smoke' },
  { name: 'sitemap', script: 'sitemap:smoke' },
  { name: 'nav', script: 'nav:smoke' },
  { name: 'visitor-mode', script: 'visitor-mode:smoke' },
  { name: 'chat', script: 'chat:smoke' },
  { name: 'translate', script: 'translate:smoke' },
  { name: 'i18n', script: 'i18n:smoke' },
];

// Resolve bun executable. On Windows `bun.cmd` is the dispatcher; the runtime
// itself (already executing this script) lives at `Bun.argv0`. Spawning the
// CLI shim by name lets the script work whether invoked via `bun run` or
// `bun.cmd run`. We use node's `child_process.spawnSync` rather than
// `Bun.spawnSync` to keep the type surface portable (no @types/bun
// dependency required).
import { spawnSync } from 'node:child_process';

const bunCli = process.platform === 'win32' ? 'bun.cmd' : 'bun';

const startedAt = Date.now();
for (const entry of SMOKES) {
  process.stdout.write(`[wishlist:smoke] running ${entry.script}\n`);
  // `shell: true` is needed on Windows so the `.cmd` shim resolves.
  const proc = spawnSync(bunCli, ['run', entry.script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (proc.status !== 0) {
    process.stderr.write(
      `[wishlist:smoke] FAILED at ${entry.script} (exit ${String(proc.status)})\n`,
    );
    // Fail-fast: the brief says exit non-zero on first failure.
    process.exit(1);
  }
}

const elapsedMs = Date.now() - startedAt;
process.stdout.write(
  `[wishlist:smoke] OK — ${String(SMOKES.length)} smokes passed in ${String(elapsedMs)}ms\n`,
);
