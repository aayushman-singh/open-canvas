// src/canvas/elements/sidebar-dispatch.smoke.ts
//
// Completeness smoke for SIDEBAR_DISPATCH (ADR 0011 Step 3 dec 4).
//
// The mapped-type constraint catches "case missing entirely" at compile
// time (once the dispatch tightens from Partial<SidebarDispatch> to a full
// Record at the PR 4 cutover). This smoke catches the failure modes the
// type system cannot see:
//
//   1. Two specs declare the same `key` (e.g. someone copy-pastes
//      `key: "text"` into a new spec). Sidebar grid + canvas-client would
//      both call the wrong factory.
//   2. A spec names a `factoryName` that has no JS factory in canvas-client's
//      SIDEBAR_FACTORIES registry. The runtime would throw on first click.
//   3. A toolbar entry has a label but no tip, or vice versa. The toolbar
//      would render without an accessible tooltip.
//   4. The dispatch has element types not in `ELEMENT_TYPES` (refactor lag).
//
// During PRs 2-3 the dispatch is partial — entries are missing for
// not-yet-migrated types. The smoke skips the "every ELEMENT_TYPES literal
// has an entry" check until PR 4 flips the type and adds the cutover
// assertion.

import { SIDEBAR_DISPATCH } from './index.js';
import { ELEMENT_TYPES } from '../schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[sidebar-dispatch:smoke] ${message}`);
}

// Mirrors SIDEBAR_FACTORIES inside canvas-client.ts. Update when a new
// factory ships there. The smoke catches drift before the runtime throw.
const REGISTERED_FACTORIES = [
  'text',
  'image',
  'video',
  'action',
  'shape',
  'container',
  'chart',
  'form',
  'embed',
  'code',
  'accordion',
  'carousel',
  'table',
  'nav',
  'tabs',
  'flow-container',
] as const;

const validTypeSet = new Set<string>(ELEMENT_TYPES);
const seenKeys = new Set<string>();

const dispatchEntries = Object.entries(SIDEBAR_DISPATCH);

for (const [type, spec] of dispatchEntries) {
  assert(
    validTypeSet.has(type),
    `dispatch key "${type}" is not in ELEMENT_TYPES (${ELEMENT_TYPES.join(', ')})`,
  );
  assert(spec !== undefined, `${type}: dispatch entry must be defined when key is present`);
  assert(Array.isArray(spec.commands), `${type}.commands must be an array`);

  for (let i = 0; i < spec.commands.length; i++) {
    const cmd = spec.commands[i];
    const where = `${type}.commands[${String(i)}]`;
    assert(cmd !== undefined, `${where} must be defined`);

    assert(
      typeof cmd.key === 'string' && cmd.key.length > 0,
      `${where}.key must be a non-empty string`,
    );
    assert(
      !seenKeys.has(cmd.key),
      `${where}.key "${cmd.key}" is also declared by another spec — keys must be unique across the dispatch`,
    );
    seenKeys.add(cmd.key);

    assert(
      typeof cmd.sidebarLabel === 'string' && cmd.sidebarLabel.length > 0,
      `${where}.sidebarLabel must be a non-empty string`,
    );
    assert(
      typeof cmd.sidebarTip === 'string' && cmd.sidebarTip.length > 0,
      `${where}.sidebarTip must be a non-empty string`,
    );

    if (cmd.toolbarLabel !== undefined) {
      assert(cmd.toolbarLabel.length > 0, `${where}.toolbarLabel must be non-empty when present`);
      assert(
        typeof cmd.toolbarTip === 'string' && cmd.toolbarTip.length > 0,
        `${where}.toolbarTip must accompany toolbarLabel`,
      );
    } else {
      assert(
        cmd.toolbarTip === undefined,
        `${where}.toolbarTip is set but toolbarLabel is absent — set both or neither`,
      );
    }

    assert(
      typeof cmd.factoryName === 'string' && cmd.factoryName.length > 0,
      `${where}.factoryName must be a non-empty string`,
    );
    assert(
      (REGISTERED_FACTORIES as readonly string[]).includes(cmd.factoryName),
      `${where}.factoryName "${cmd.factoryName}" is not in REGISTERED_FACTORIES — register the JS factory in canvas-client.ts SIDEBAR_FACTORIES before referencing it from a spec`,
    );
  }
}

// Cutover assertion (PR 4): every ELEMENT_TYPES literal must have an entry.
// Until then, the dispatch is partial; we report progress instead.
const total = ELEMENT_TYPES.length;
const migrated = dispatchEntries.length;
if (migrated === total) {
  for (const t of ELEMENT_TYPES) {
    assert(
      Object.hasOwn(SIDEBAR_DISPATCH, t),
      `ELEMENT_TYPES literal "${t}" has no SIDEBAR_DISPATCH entry`,
    );
  }
  console.log(
    `[sidebar-dispatch:smoke] OK — ${String(migrated)}/${String(total)} dispatch entries verified, ${String(seenKeys.size)} unique sidebar keys`,
  );
} else {
  console.log(
    `[sidebar-dispatch:smoke] OK — ${String(migrated)}/${String(total)} dispatch entries verified (migration in progress), ${String(seenKeys.size)} unique sidebar keys so far`,
  );
}
