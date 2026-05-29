// src/canvas/elements/agent-tool-spec.ts
//
// Per-element agent-tool spec (ADR 0011 Step 2 dec 2).
//
// The cross-element `updateElement` and `addElement` LLM tools used to
// declare every per-type field inline in `src/agent/canvas-tools.ts` under
// "X elements only" comments, and the matching parser used to inspect every
// per-type field inline in `collectElementPatch` in `src/agent/tool-parsers.ts`.
// That fan-out is the same drift the inspector dispatch closed in Step 1:
// adding a new element type meant editing two giant files in lockstep.
//
// One spec per element type ships with two halves:
//
//   * `patchProperties` — JSON-Schema fragments contributed to the
//     `updateElement` and `addElement` tool unions. Keys are the LLM-facing
//     field names (e.g. `fontSize`, `kind`). Descriptions still call out
//     the contract loudly so the model cannot drift into wrong shapes.
//   * `parsePatch` — Loud parser for this element type's per-type fields.
//     Throws on malformed input; the caller prefixes errors with the tool
//     name. Returns the element-typed slice of the patch; shared fields
//     (box, motion, elementStyle, responsive) are owned by `canvas-tools.ts`
//     and merged on top.
//
// `standaloneTool` is the optional second slot: top-level LLM tools that
// only target one element type (`rewriteText` for text, `replaceMedia` for
// media). Element files own them so the spec stays the one home for "what
// the agent can do to this element type."
//
// `CanvasAgentOp` is imported as a type only — runtime cycles between this
// directory and `agent/canvas-ops.ts` (which imports `canvas/schema.ts`,
// which type-imports element files) are erased by TypeScript's `import type`.

import type { JsonSchema, LlmTool } from '../../agent/llm.js';
import type { CanvasAgentOp } from '../../agent/canvas-ops.js';

export type AgentToolParseResult = { ok: true; op: CanvasAgentOp } | { ok: false; error: string };

export interface AgentToolSpec {
  /**
   * Per-element JSON-Schema field fragments for `updateElement` /
   * `addElement`. Empty record means the type contributes no per-type
   * fields (used by `collection` — its agent surface is shared fields only).
   */
  patchProperties: Record<string, JsonSchema>;

  /**
   * Parse this element's per-type fields out of the raw tool-call args.
   * Inspect only fields named in `patchProperties`. Throw on malformed
   * input — the caller prefixes the error with the tool name.
   *
   * Returns the element-typed slice of the patch. Shared fields are merged
   * on top by `canvas-tools.ts`.
   *
   * Declared as a function-typed property (not a method) so the smoke can
   * destructure it safely without tripping `@typescript-eslint/unbound-method`.
   */
  parsePatch: (args: Record<string, unknown>) => Record<string, unknown>;

  /**
   * Optional standalone LLM tool that targets only this element type.
   * Currently used by `text` (`rewriteText`) and `media` (`replaceMedia`).
   * When present, `canvas-tools.ts` exposes `tool` in `CANVAS_AGENT_TOOLS`
   * and routes `translateToolCall` for `tool.name` through `parse`.
   */
  standaloneTool?: {
    tool: LlmTool;
    parse: (args: unknown) => AgentToolParseResult;
  };
}
