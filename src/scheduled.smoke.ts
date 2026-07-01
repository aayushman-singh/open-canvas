import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url).href), 'utf8');
}

const wrangler = readSource('../wrangler.toml');
const scheduled = readSource('./scheduled.ts');

assert(
  !wrangler.includes('*/5 * * * *'),
  'wrangler.toml must not deploy the custom-domain polling cron',
);
assert(
  !scheduled.includes("from './custom-domain/cron'"),
  'scheduled.ts must not import the custom-domain cron dispatcher',
);
assert(
  scheduled.includes("event.cron === '0 3 * * *'"),
  'scheduled.ts should keep the notification retention cron',
);

console.log('[scheduled:smoke] OK');
