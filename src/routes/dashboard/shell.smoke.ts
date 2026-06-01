import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[dashboard-shell:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'routes', 'dashboard', 'shell.tsx'), 'utf8');

for (const className of [
  'opencanvas-modal-backdrop',
  'opencanvas-modal',
  'opencanvas-modal-actions',
  'opencanvas-modal-cancel',
  'opencanvas-modal-ok',
  'opencanvas-modal-danger',
]) {
  assert(source.includes(className), `dashboard shell must emit ${className}`);
}

assert(!source.includes('r-modal'), 'dashboard shell must not emit stale r-modal classes');

console.log('[dashboard-shell:smoke] OK');
