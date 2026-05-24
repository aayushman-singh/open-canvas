import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[film-reel:smoke] ${message}`);
}

const source = readFileSync(join(process.cwd(), 'src', 'editor', 'canvas-client.ts'), 'utf8');

assert(
  source.includes('function pointInsideRect('),
  'section drag target detection must use an explicit viewport-rect bounds check',
);
assert(
  source.includes('if (!pointInsideRect(clientX, clientY, rootRect)) return null;'),
  'section drags released outside the canvas must not produce an implicit canvas drop target',
);
assert(
  !source.includes('if (target.zone === "canvas") { dropLine.hidden = true; return; }'),
  'canvas-to-reel no-op drops must hide the insertion line in both canvas and reel zones',
);

console.log('[film-reel:smoke] OK');
