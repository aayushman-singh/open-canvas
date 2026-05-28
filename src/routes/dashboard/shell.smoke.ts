import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[dashboard-shell:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'routes', 'dashboard', 'shell.tsx'), 'utf8');

for (const className of [
  'rev01-modal-backdrop',
  'rev01-modal',
  'rev01-modal-actions',
  'rev01-modal-cancel',
  'rev01-modal-ok',
  'rev01-modal-danger',
]) {
  assert(source.includes(className), `dashboard shell must emit ${className}`);
}

assert(!source.includes('r-modal'), 'dashboard shell must not emit stale r-modal classes');

console.log('[dashboard-shell:smoke] OK');
