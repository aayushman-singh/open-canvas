// src/routes/dashboard/a11y-report.smoke.ts
//
// Pins dashboard accessibility copy to the current publish contract:
// findings are advisory after cd16102; publish no longer blocks on them.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[a11y-report:smoke] ${message}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'a11y-report.tsx'), 'utf8');

assert(
  !source.includes('blocking publish'),
  'a11y report must not claim findings block publish after the publish gate was removed',
);
assert(
  !source.includes('Publish is unblocked'),
  'a11y report must not describe publish as blocked/unblocked after the gate was removed',
);
assert(
  source.includes('Ready to review') &&
    source.includes('No accessibility issues detected on this site.'),
  'a11y report must keep a clear clean-state message without publish-gate language',
);

console.log('[a11y-report:smoke] OK');
