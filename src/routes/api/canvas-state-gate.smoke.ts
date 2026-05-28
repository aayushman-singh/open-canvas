// src/routes/api/canvas-state-gate.smoke.ts
//
// Source-level smoke for the canvas write boundary. The route is DB-backed, so
// this keeps the invariant cheap to check: any endpoint that writes a partial
// editableState must route through persistEditableState, which runs the full
// canvas validator before touching the database.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const here = dirname(fileURLToPath(import.meta.url));
const canvasSource = readFileSync(join(here, 'canvas.ts'), 'utf8');

function routeBody(routeMarker: string): string {
  const start = canvasSource.indexOf(routeMarker);
  assert(start >= 0, `expected canvas.ts to contain route marker ${routeMarker}`);
  const nextRoute = canvasSource.indexOf('\ncanvasApi.', start + routeMarker.length);
  return nextRoute >= 0 ? canvasSource.slice(start, nextRoute) : canvasSource.slice(start);
}

const configRoute = routeBody("canvasApi.patch('/sites/:siteId/config'");
assert(
  configRoute.includes('persistEditableState('),
  'config patch route must validate the full editableState via persistEditableState before writing',
);
assert(
  !configRoute.includes('editableState: next,'),
  'config patch route must not write editableState directly after a partial patch',
);

const styleKitRoute = routeBody("canvasApi.post('/sites/:siteId/style-kit'");
assert(
  styleKitRoute.includes('persistEditableState('),
  'style-kit route must validate the full editableState via persistEditableState before writing',
);
assert(
  !styleKitRoute.includes('editableState: nextState,'),
  'style-kit route must not write editableState directly after a partial patch',
);

console.log('[canvas-state-gate:smoke] OK');
