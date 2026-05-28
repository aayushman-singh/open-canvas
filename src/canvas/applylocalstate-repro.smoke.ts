// src/canvas/applylocalstate-repro.smoke.ts
//
// Targeted reproduction smoke for N2 — "Unexpected content type in Yjs
// _integrate". The bug fires during canvas editor mutations: most
// Add-component clicks throw and the change reverts. PUT /api/canvas/sites
// returns 200 because the WS path (applyLocalState → y-update) is what
// actually corrupts state.
//
// What this smoke replays:
//   1. Build a Y.Doc from a fixture (mirrors connectCoEdit's local doc).
//   2. Build a second Y.Doc as "server" (mirrors the SiteRoom DO).
//   3. Sync them via step1/step2.
//   4. Mutate the JS state — append a new element to a section — and call
//      applyLocalState. Capture the y-update bytes the doc emits.
//   5. Apply those bytes to the server doc. Confirm both docs project to
//      the same CanvasSiteState.
//   6. Repeat (4-5) N times with DIFFERENT element types so each iteration
//      exercises a different encoder branch.
//
// If applyLocalState produces malformed updates for a specific element
// type, the server's Y.applyUpdate throws here with the exact error the
// dashboard saw. Logical equality after each iteration catches the
// "succeeds but state corrupts" failure mode where decode survives but the
// re-projected JSON drifts.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';

import type {
  ActionElement,
  CanvasElement,
  CanvasSiteState,
  TextElement,
  MediaElement,
  ShapeElement,
} from './schema.js';
import type { EmbedElement } from './elements/embed.js';
import type { NavElement } from './elements/nav.js';
import type { FormElement } from './elements/form.js';
import type { ChartElement } from './elements/chart.js';
import type { CodeElement } from './elements/code.js';
import type { AccordionElement } from './elements/accordion.js';
import type { CarouselElement } from './elements/carousel.js';
import type { TableElement } from './elements/table.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

// Mirrors src/live/co-edit/client.ts:applyLocalState — kept inline so the
// smoke depends on the same cloneYValue + replace-root-keys strategy
// without pulling in the browser-bundled module's WebSocket plumbing.
const LOCAL_ORIGIN = Symbol('co-edit-local');

function cloneYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const out = new Y.Map<unknown>();
    for (const [k, v] of (value as Y.Map<unknown>).entries()) {
      out.set(k, cloneYValue(v));
    }
    return out;
  }
  if (value instanceof Y.Array) {
    const out = new Y.Array<unknown>();
    const src = value as Y.Array<unknown>;
    for (let i = 0; i < src.length; i += 1) {
      out.push([cloneYValue(src.get(i))]);
    }
    return out;
  }
  return value;
}

function applyLocalState(doc: Y.Doc, state: CanvasSiteState): void {
  const transient = encodeYDoc(state);
  doc.transact(() => {
    const root = doc.getMap<unknown>('state');
    for (const key of Array.from(root.keys())) root.delete(key);
    const transientRoot = transient.getMap<unknown>('state');
    for (const [key, value] of transientRoot.entries()) {
      root.set(key, cloneYValue(value));
    }
  }, LOCAL_ORIGIN);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function fail(label: string, err?: unknown): never {
  const detail =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : err === undefined
        ? ''
        : typeof err === 'object' && err !== null
          ? stableStringify(err)
          : err === null
            ? 'null'
            : typeof err === 'string'
              ? err
              : typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint'
                ? String(err)
                : 'unknown thrown value';
  process.stderr.write(`[applylocalstate-repro] FAIL ${label}${detail ? '\n  ' + detail : ''}\n`);
  process.exit(1);
}

function ok(label: string): void {
  process.stdout.write(`[applylocalstate-repro] OK   ${label}\n`);
}

// ----------------------------------------------------------------------------
// Build a starting state from the smallest fixture.
// ----------------------------------------------------------------------------

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(thisDir, 'fixtures', 'home.json');
const initial = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as CanvasSiteState;

// ----------------------------------------------------------------------------
// Set up two docs and bring the server into sync with the client (step1/step2).
// ----------------------------------------------------------------------------

// Mirror the real production flow:
//   - Client hydrates by calling encodeYDoc(initial) → its own clientID + struct tree.
//   - Server (SiteRoom DO) ALSO hydrates by calling encodeYDoc(initial) → a
//     DIFFERENT clientID + a separately-encoded struct tree (the DO read the
//     same JSON from Postgres but built fresh structs).
//   - step1/step2 sync runs; each side ships its updates to the other so
//     both ends end up holding BOTH trees under the same root keys
//     (LWW resolves which "wins" per key).
const client = encodeYDoc(initial);
const server = encodeYDoc(initial);

// Symmetric sync: each side computes the delta against the other's SV and
// applies. Mirrors the y-sync-step1/step2 handshake in
// src/live/co-edit/y-sync.ts.
{
  const clientSV = Y.encodeStateVector(client);
  const serverSV = Y.encodeStateVector(server);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(client, serverSV));
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server, clientSV));
}

// Observer on the client mirrors what connectCoEdit's docObserver does:
// every local-origin update is "sent over the wire". We apply it to the
// server immediately. Track decode errors so we can report which iteration
// (and which element type) tripped them.
let lastEmittedUpdate: Uint8Array | null = null;
let lastEmittedOrigin: unknown = null;
client.on('update', (update: Uint8Array, origin: unknown) => {
  lastEmittedUpdate = update;
  lastEmittedOrigin = origin;
});

function flushToServer(label: string): void {
  if (lastEmittedUpdate === null) fail(`${label}: no update was emitted`);
  if (lastEmittedOrigin !== LOCAL_ORIGIN) {
    fail(`${label}: update origin was ${String(lastEmittedOrigin)} (expected LOCAL_ORIGIN)`);
  }
  try {
    Y.applyUpdate(server, lastEmittedUpdate);
  } catch (err) {
    fail(`${label}: server Y.applyUpdate threw (update size ${String(lastEmittedUpdate.length)})`, err);
  }
  lastEmittedUpdate = null;
  lastEmittedOrigin = null;
}

// ----------------------------------------------------------------------------
// Element factories — one per encoder branch in yjs-projection.ts. Each
// produces a minimally-valid element of the named type that the "Add
// component" sidebar would build.
// ----------------------------------------------------------------------------

function mkText(id: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 320, h: 80, z: 0 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}
function mkMedia(id: string): MediaElement {
  return {
    id,
    type: 'media',
    box: { x: 0, y: 0, w: 320, h: 240, z: 0 },
    mediaKind: 'image',
    assetId: '__placeholder__',
    alt: '',
    fit: 'cover',
  };
}
function mkAction(id: string): ActionElement {
  return {
    id,
    type: 'action',
    box: { x: 0, y: 0, w: 160, h: 48, z: 0 },
    label: 'Click',
    href: { type: 'external', url: 'mailto:hello@example.com' },
    variant: 'solid',
  };
}
function mkShape(id: string): ShapeElement {
  return {
    id,
    type: 'shape',
    box: { x: 0, y: 0, w: 200, h: 200, z: 0 },
    variant: 'rect',
  };
}
function mkEmbed(id: string): EmbedElement {
  return {
    id,
    type: 'embed',
    box: { x: 0, y: 0, w: 480, h: 320, z: 0 },
    url: 'https://example.com',
  };
}
function mkNav(id: string): NavElement {
  return {
    id,
    type: 'nav',
    box: { x: 0, y: 0, w: 1200, h: 72, z: 0 },
    links: [{ label: 'Home', href: '/', kind: 'internal' }],
    layout: 'left-right',
    sticky: false,
  };
}
function mkForm(id: string): FormElement {
  return {
    id,
    type: 'form',
    box: { x: 0, y: 0, w: 480, h: 300, z: 0 },
    fields: [{ id: 'name', label: 'Name', kind: 'text', required: true }],
    submitLabel: 'Send',
    successMessage: 'Thanks',
  };
}
function mkChart(id: string): ChartElement {
  return {
    id,
    type: 'chart',
    box: { x: 0, y: 0, w: 480, h: 320, z: 0 },
    kind: 'bar',
    series: [{ label: 'A', values: [1, 2, 3] }],
    categories: ['Q1', 'Q2', 'Q3'],
    showLegend: true,
  };
}
function mkCode(id: string): CodeElement {
  return {
    id,
    type: 'code',
    box: { x: 0, y: 0, w: 480, h: 240, z: 0 },
    language: 'javascript',
    source: 'console.log("hi");',
    showLineNumbers: true,
  };
}
function mkAccordion(id: string): AccordionElement {
  return {
    id,
    type: 'accordion',
    box: { x: 0, y: 0, w: 480, h: 320, z: 0 },
    items: [{ id: 'a', title: 'Q', body: [{ text: 'A' }] }],
    allowMultipleOpen: false,
  };
}
function mkCarousel(id: string): CarouselElement {
  return {
    id,
    type: 'carousel',
    box: { x: 0, y: 0, w: 800, h: 400, z: 0 },
    slides: [{ id: 's1', assetId: '__placeholder__', caption: 'Hello' }],
    showArrows: true,
    showDots: true,
  };
}
function mkTable(id: string): TableElement {
  return {
    id,
    type: 'table',
    box: { x: 0, y: 0, w: 600, h: 300, z: 0 },
    columns: [{ id: 'c1', header: 'A' }],
    rows: [{ id: 'r1', cells: { c1: 'v' } }],
    zebra: false,
    collapseOnPhone: false,
  };
}

const factories: Array<{ name: string; build: (id: string) => CanvasElement }> = [
  { name: 'text', build: mkText },
  { name: 'media', build: mkMedia },
  { name: 'action', build: mkAction },
  { name: 'shape', build: mkShape },
  { name: 'embed', build: mkEmbed },
  { name: 'nav', build: mkNav },
  { name: 'form', build: mkForm },
  { name: 'chart', build: mkChart },
  { name: 'code', build: mkCode },
  { name: 'accordion', build: mkAccordion },
  { name: 'carousel', build: mkCarousel },
  { name: 'table', build: mkTable },
];

// ----------------------------------------------------------------------------
// Replay loop: 12 element types × 2 passes = 24 "Add component" cycles.
// ----------------------------------------------------------------------------

const liveState: CanvasSiteState = JSON.parse(JSON.stringify(initial)) as CanvasSiteState;
const firstPage = liveState.pages[0];
const firstSection = firstPage?.sections[0];
if (!firstPage || !firstSection) {
  fail('fixture has no page[0].section[0] to append into');
}

let iter = 0;
for (let pass = 0; pass < 2; pass += 1) {
  for (const factory of factories) {
    iter += 1;
    const id = `repro-${factory.name}-p${String(pass)}-${String(iter)}`;
    firstSection.elements.push(factory.build(id));

    try {
      applyLocalState(client, liveState);
    } catch (err) {
      fail(`#${String(iter)} applyLocalState(${factory.name}) threw`, err);
    }

    flushToServer(`#${String(iter)} flushToServer(${factory.name})`);

    // Did both docs project the same JSON?
    const clientJson = stableStringify(decodeYDoc(client));
    const serverJson = stableStringify(decodeYDoc(server));
    if (clientJson !== serverJson) {
      fail(
        `#${String(iter)} ${factory.name}: client/server projections diverged after applyLocalState`,
      );
    }
    if (clientJson !== stableStringify(liveState)) {
      fail(`#${String(iter)} ${factory.name}: client projection drifted from JS source state`);
    }
  }
}

ok(`24 add-component cycles applied through applyLocalState; client/server doc parity preserved`);
process.stdout.write('[applylocalstate-repro] OK\n');
