// src/canvas/elements/agent-tool-dispatch.smoke.ts
//
// Completeness smoke for AGENT_TOOL_DISPATCH (ADR 0011 Step 2 dec 4).
//
// The mapped-type constraint catches "case missing entirely" at compile
// time — but it does NOT catch "case present but stub" (declares zero
// patchProperties for a non-collection type, parser silently drops fields,
// standaloneTool.tool.name disagrees with the parser registered for it).
// This smoke walks each present dispatch entry and surfaces those gaps as
// a build-time check.
//
// During migration the dispatch is `Partial<AgentToolDispatch>` so an
// entry being absent is "not yet migrated" — not a failure. The cutover PR
// flips the dispatch to a full Record + adds the completeness assertion
// (every `ELEMENT_TYPES` literal has an entry).
//
// Coverage:
//   1. Every key in AGENT_TOOL_DISPATCH is a valid `CanvasElement['type']`.
//   2. Non-`collection` entries declare at least one `patchProperties` key.
//   3. Every `patchProperties` value is a non-empty `JsonSchema` (`type`
//      present; `description` present for fields the LLM needs to be
//      steered on — currently every field has a description).
//   4. `parsePatch({})` returns `{}` — an empty input must not throw and
//      must not invent fields.
//   5. `parsePatch` only emits keys that appear in `patchProperties`
//      (catches "parser reads a field the schema does not advertise" —
//      the LLM would never send it; the field is dead).
//   6. When `standaloneTool` is present, `tool.name`, `tool.description`,
//      and `tool.parameters` are all non-empty strings/objects, and
//      `parse` is a function.

import { AGENT_TOOL_DISPATCH } from './index.js';
import { ELEMENT_TYPES } from '../schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[agent-tool-dispatch:smoke] ${message}`);
}

const dispatchEntries = Object.entries(AGENT_TOOL_DISPATCH);

const validTypeSet = new Set<string>(ELEMENT_TYPES);
for (const [type, spec] of dispatchEntries) {
  assert(
    validTypeSet.has(type),
    `dispatch key "${type}" is not in ELEMENT_TYPES (${ELEMENT_TYPES.join(', ')})`,
  );
  assert(spec !== undefined, `${type}: dispatch entry must be defined when key is present`);

  // (2) patchProperties shape
  const propKeys = Object.keys(spec.patchProperties);
  if (type !== 'collection') {
    assert(
      propKeys.length > 0,
      `${type}: patchProperties must declare at least one field (a stub spec hides the agent surface). Use {} only for "collection".`,
    );
  }

  // (3) Each property is a real JsonSchema
  for (const [propName, schema] of Object.entries(spec.patchProperties)) {
    assert(
      schema !== null && typeof schema === 'object',
      `${type}.patchProperties.${propName}: schema must be an object`,
    );
    assert(
      typeof schema.type === 'string' && schema.type.length > 0,
      `${type}.patchProperties.${propName}: schema.type must be a non-empty string`,
    );
    assert(
      typeof schema.description === 'string' && schema.description.length > 0,
      `${type}.patchProperties.${propName}: schema.description must be a non-empty string (LLM needs steering)`,
    );
  }

  // (4) Empty input yields empty patch with no throws
  let emptyPatch: Record<string, unknown>;
  try {
    emptyPatch = spec.parsePatch({});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[agent-tool-dispatch:smoke] ${type}.parsePatch({}): must not throw on empty input — threw: ${message}`,
    );
  }
  assert(
    emptyPatch !== null && typeof emptyPatch === 'object' && !Array.isArray(emptyPatch),
    `${type}.parsePatch({}): must return a plain object`,
  );
  assert(
    Object.keys(emptyPatch).length === 0,
    `${type}.parsePatch({}): empty input must yield an empty patch — got keys [${Object.keys(emptyPatch).join(', ')}]`,
  );

  // (5) Parser only emits known fields. Probe each declared field with a
  // valid-by-schema value so array/boolean/number branches execute too.
  const probeArgs: Record<string, unknown> = {};
  for (const [propName, schema] of Object.entries(spec.patchProperties)) {
    probeArgs[propName] = probeValueForSchema(propName, schema);
  }
  let probePatch: Record<string, unknown>;
  try {
    probePatch = spec.parsePatch(probeArgs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[agent-tool-dispatch:smoke] ${type}.parsePatch(probeArgs): declared fields must accept schema-shaped probes — threw: ${message}`,
    );
  }
  for (const emittedKey of Object.keys(probePatch)) {
    assert(
      propKeys.includes(emittedKey),
      `${type}.parsePatch: emitted field "${emittedKey}" is not declared in patchProperties — declare it in the schema or stop emitting it`,
    );
  }

  // (6) standaloneTool shape when present
  if (spec.standaloneTool !== undefined) {
    const { tool, parse } = spec.standaloneTool;
    assert(
      typeof tool.name === 'string' && tool.name.length > 0,
      `${type}.standaloneTool.tool.name must be a non-empty string`,
    );
    assert(
      typeof tool.description === 'string' && tool.description.length > 0,
      `${type}.standaloneTool.tool.description must be a non-empty string`,
    );
    assert(
      tool.parameters !== null && typeof tool.parameters === 'object',
      `${type}.standaloneTool.tool.parameters must be a JsonSchema object`,
    );
    assert(typeof parse === 'function', `${type}.standaloneTool.parse must be a function`);
  }
}

function probeValueForSchema(propName: string, schema: { type?: string }): unknown {
  switch (schema.type) {
    case 'array':
      if (propName === 'content') return [{ text: 'probe' }];
      return [];
    case 'boolean':
      return true;
    case 'number':
    case 'integer':
      return 1;
    case 'object':
      return {};
    case 'string':
      if (propName === 'href' || propName === 'url') return 'https://example.com';
      return '__probe__';
    default:
      return '__probe__';
  }
}

// Cutover assertion (ADR 0011 Step 2 PR 4): every ELEMENT_TYPES literal
// must have a dispatch entry. The mapped-type constraint on AgentToolDispatch
// already catches "case missing entirely" at compile time, but this runtime
// check also catches the dispatch literal being typed as
// `Partial<AgentToolDispatch>` (an easy regression if a future migration
// step reintroduces the partial during transition).
const declaredTypes = new Set(Object.keys(AGENT_TOOL_DISPATCH));
for (const t of ELEMENT_TYPES) {
  assert(
    declaredTypes.has(t),
    `ELEMENT_TYPES literal "${t}" has no AGENT_TOOL_DISPATCH entry — every element type must register a spec (collection's spec is intentionally empty).`,
  );
}

console.log(
  `[agent-tool-dispatch:smoke] OK — ${String(dispatchEntries.length)}/${String(ELEMENT_TYPES.length)} dispatch entries verified (all element types registered)`,
);
