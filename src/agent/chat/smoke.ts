// src/agent/chat/smoke.ts
//
// Smoke for the chat orchestrator. Exercises:
//
//   1. Mock LLM returns a 2-turn conversation calling `query_site` then
//      `propose_op` (rewriteText). Smoke asserts SSE events emit in the
//      correct order: tool-call → tool-result → tool-call → op-preview → done.
//   2. Session persistence: messages array grows across calls; same sessionId
//      returns the same history.
//   3. Token budget: query_site output capped at QUERY_SITE_TOKEN_CAP.
//   4. Op preview NOT applied automatically (state unchanged).
//
// All paths run without GEMINI_API_KEY / DATABASE_URL — the mock LlmAdapter
// + InMemorySessionStore stand in.

import { applyCanvasAgentOp } from '../canvas-ops.js';
import type { LlmAdapter, LlmChunk, LlmMessage, ChatWithToolsOptions } from '../llm.js';
import type { EditableSite, SectionRecipeId } from '../../canvas/schema.js';
import { SECTION_RECIPE_IDS } from '../../canvas/schema.js';
import { createSectionFromRecipe, type RecipeFactoryInput } from '../../canvas/recipes.js';
import { validateEditableSite } from '../../canvas/validate.js';

import { CHAT_DEFAULT_MODEL, runChatTurn, type OrchestratorContext } from './orchestrator.js';
import {
  InMemorySessionStore,
  QUERY_SITE_TOKEN_CAP,
  estimateTokens,
  type ChatMessage,
  type ChatSessionState,
} from './session.js';
import { BufferedStreamWriter, type ChatStreamEvent } from './stream.js';
import { buildQuerySiteSummary } from './tools.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  CHAT_DEFAULT_MODEL === 'gemini-3-pro-preview',
  `CHAT_DEFAULT_MODEL must use the official Gemini model code, got ${CHAT_DEFAULT_MODEL}`,
);

// ---------------------------------------------------------------------------
// Fixture site state — single page, hero-split + feature-grid.
// ---------------------------------------------------------------------------

function buildFixtureState(): EditableSite {
  const recipeInput: RecipeFactoryInput = {
    brief: 'A bright product launch.',
    styleKit: 'charcoal',
    assetIds: {},
  };
  const hero = createSectionFromRecipe('hero-split', recipeInput);
  const features = createSectionFromRecipe('feature-grid', recipeInput);
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'home',
        title: 'Smoke',
        width: 1440,
        sections: [hero, features],
      },
    ],
  };
}

function buildLargeState(): EditableSite {
  const recipeInput: RecipeFactoryInput = {
    brief: 'A bright product launch with a very long brief that pushes element count up.',
    styleKit: 'charcoal',
    assetIds: {},
  };
  const header = createSectionFromRecipe('feature-grid', recipeInput);
  const headerSeed = header.elements[0];
  if (!headerSeed) throw new Error('large-state header fixture must have an element');
  header.elements = Array.from({ length: 400 }, (_, i) => ({
    ...structuredClone(headerSeed),
    id: `el-header-large-${String(i)}`,
  }));
  // 50 pages × every recipe to push the JSON well past 2k tokens.
  const pages = Array.from({ length: 50 }, (_, i) => {
    const sections = SECTION_RECIPE_IDS.map((id: SectionRecipeId) =>
      createSectionFromRecipe(id, recipeInput),
    );
    return {
      id: `page-large-${String(i)}`,
      slug: `slug-${String(i)}`,
      title: `Large page ${String(i)}`,
      width: 1440,
      sections,
    };
  });
  return { styleKit: 'charcoal', header, pages };
}

// ---------------------------------------------------------------------------
// Mock LlmAdapter — scripted multi-turn behaviour.
// ---------------------------------------------------------------------------

type Script = Array<() => AsyncIterable<LlmChunk>>;

class MockLlmAdapter implements LlmAdapter {
  private callIdx = 0;
  public readonly messageHistorySnapshots: LlmMessage[][] = [];

  constructor(private readonly script: Script) {}

  chatWithTools(messages: LlmMessage[], opts: ChatWithToolsOptions): AsyncIterable<LlmChunk> {
    void opts;
    this.messageHistorySnapshots.push(messages.map((m) => ({ ...m })));
    const next = this.script[this.callIdx];
    this.callIdx++;
    if (!next) {
      throw new Error(`MockLlmAdapter: script exhausted at call ${String(this.callIdx)}`);
    }
    return next();
  }
}

async function* yieldChunks(...chunks: LlmChunk[]): AsyncIterable<LlmChunk> {
  for (const c of chunks) {
    // The await makes the loop genuinely async, mirroring real adapter shapes.
    await Promise.resolve();
    yield c;
  }
}

// ---------------------------------------------------------------------------
// Test 1 — Two-turn conversation: query_site then rewriteText.
// ---------------------------------------------------------------------------

const fixtureState = buildFixtureState();
const heroSection = fixtureState.pages[0]?.sections[0];
if (!heroSection) throw new Error('smoke fixture missing hero section');
const heroText = heroSection.elements.find((e) => e.type === 'text');
if (!heroText) throw new Error('smoke fixture hero must have a text element');

const targetElementId = heroText.id;

const queryCallId = 'query_site-1-abc';
const rewriteCallId = 'rewriteText-1-def';

const mockScript: Script = [
  // Turn 1: model asks for the site summary.
  () =>
    yieldChunks(
      { type: 'text', text: 'Let me check the current site first. ' },
      {
        type: 'tool_call',
        id: queryCallId,
        name: 'query_site',
        arguments: { detail: 'full' },
      },
      { type: 'done', reason: 'tool_use' },
    ),
  // Turn 2: model proposes a rewriteText op.
  () =>
    yieldChunks(
      { type: 'text', text: 'Here is a more dramatic headline. ' },
      {
        type: 'tool_call',
        id: rewriteCallId,
        name: 'rewriteText',
        arguments: {
          elementId: targetElementId,
          content: [
            { text: 'Ship a site that feels ' },
            { text: 'lived-in', marks: [{ type: 'bold' }] },
            { text: '.' },
          ],
        },
      },
      { type: 'done', reason: 'tool_use' },
    ),
  // Turn 3: model wraps up, no more tools.
  () =>
    yieldChunks(
      { type: 'text', text: 'Done — accept to apply the new headline.' },
      { type: 'done', reason: 'stop' },
    ),
];

const adapter1 = new MockLlmAdapter(mockScript);
const writer1 = new BufferedStreamWriter();
const store1 = new InMemorySessionStore();
const session1 = await store1.create('site-smoke', 'customer-smoke');
const startCount = session1.messages.length;

const ctx1: OrchestratorContext = {
  adapter: adapter1,
  state: fixtureState,
  systemInstruction: '[smoke] system prompt',
};

const result1 = await runChatTurn({
  session: session1,
  userMessage: 'Make the hero more dramatic.',
  writer: writer1,
  ctx: ctx1,
});

// Persist the updated history through the store, mirroring the production
// route's save-after-turn semantic.
await store1.save(session1.id, result1.messages);

// ---- Assert SSE event order ----
const events1: readonly ChatStreamEvent[] = writer1.events();
const kinds1: string[] = events1.map((e) => e.kind);

// Expected sequence (turn-by-turn):
//   token, tool-call (query_site), tool-result (query_site),
//   token, tool-call (rewriteText), op-preview (rewriteText),
//   token, done.
// We assert key ordering, not every single token frame.

const querySiteCallIdx = events1.findIndex(
  (e) => e.kind === 'tool-call' && e.name === 'query_site',
);
const querySiteResultIdx = events1.findIndex(
  (e) => e.kind === 'tool-result' && e.name === 'query_site',
);
const rewriteCallIdx = events1.findIndex((e) => e.kind === 'tool-call' && e.name === 'rewriteText');
const opPreviewIdx = events1.findIndex(
  (e) => e.kind === 'op-preview' && e.toolName === 'rewriteText',
);
const doneIdx = events1.findIndex((e) => e.kind === 'done');

assert(
  querySiteCallIdx >= 0,
  `expected a query_site tool-call event (got kinds: ${kinds1.join(', ')})`,
);
assert(
  querySiteResultIdx > querySiteCallIdx,
  'expected query_site tool-result to come AFTER tool-call',
);
assert(
  rewriteCallIdx > querySiteResultIdx,
  'expected rewriteText tool-call to come AFTER the query_site result',
);
assert(
  opPreviewIdx > rewriteCallIdx,
  'expected op-preview to come AFTER the rewriteText tool-call',
);
assert(doneIdx > opPreviewIdx, 'expected done event to be last after op-preview');
assert(events1[doneIdx]?.kind === 'done', 'last expected event must be done');

// The orchestrator must have emitted exactly one op-preview for this turn.
const opPreviews1 = events1.filter((e) => e.kind === 'op-preview');
assert(
  opPreviews1.length === 1,
  `expected exactly 1 op-preview (got ${String(opPreviews1.length)})`,
);
assert(
  result1.previewOps.length === 1,
  'expected result.previewOps to mirror the op-preview events',
);

// ---- Assert preview op is well-formed and references the right element ----
const previewOp = result1.previewOps[0];
if (!previewOp) throw new Error('preview op missing from result');
assert(previewOp.op.kind === 'rewriteText', 'expected preview op kind=rewriteText');
if (previewOp.op.kind === 'rewriteText') {
  assert(
    previewOp.op.elementId === targetElementId,
    `expected preview op to target ${targetElementId}, got ${previewOp.op.elementId}`,
  );
}

console.log('[chat:smoke] 1/4 SSE event order — OK');

// ---------------------------------------------------------------------------
// Test 2 — Session persistence: history grows across send-message calls
// and the same sessionId returns the same history.
// ---------------------------------------------------------------------------

const reloaded = await store1.load(session1.id);
assert(reloaded !== null, 'expected to be able to reload session by id');
if (!reloaded) throw new Error('unreachable');

assert(
  reloaded.messages.length > startCount,
  `expected message count to grow (start=${String(startCount)}, after=${String(reloaded.messages.length)})`,
);

// Drive a second send-message turn. The adapter script left an entry for the
// "no more tools" wrap-up; we extend the script for a fresh user message.
const followupScript: Script = [
  () => yieldChunks({ type: 'text', text: 'Anything else?' }, { type: 'done', reason: 'stop' }),
];
const adapter2 = new MockLlmAdapter(followupScript);
const writer2 = new BufferedStreamWriter();
const ctx2: OrchestratorContext = {
  adapter: adapter2,
  state: fixtureState,
  systemInstruction: '[smoke] system prompt',
};
const beforeSecondTurn = reloaded.messages.length;
const result2 = await runChatTurn({
  session: reloaded,
  userMessage: 'Thanks.',
  writer: writer2,
  ctx: ctx2,
});
await store1.save(reloaded.id, result2.messages);

const finalSession = await store1.load(reloaded.id);
assert(finalSession !== null, 'expected final session to be loadable');
if (!finalSession) throw new Error('unreachable');
assert(
  finalSession.messages.length > beforeSecondTurn,
  `expected second turn to grow message history further (before=${String(beforeSecondTurn)}, after=${String(finalSession.messages.length)})`,
);
assert(
  finalSession.messages.some((m: ChatMessage) => m.role === 'user' && m.content === 'Thanks.'),
  'expected the new user message to be persisted',
);

console.log('[chat:smoke] 2/4 Session persistence — OK');

// ---------------------------------------------------------------------------
// Test 3 — Token budget on query_site output (≤ 2k tokens, truncated).
// ---------------------------------------------------------------------------

const summarySmall = buildQuerySiteSummary({ state: fixtureState, detail: 'full' });
const smallTokens = estimateTokens(JSON.stringify(summarySmall));
assert(
  smallTokens <= QUERY_SITE_TOKEN_CAP,
  `small site summary should fit budget (got ${String(smallTokens)} tokens)`,
);
assert(summarySmall.truncated === false, 'small site summary should not be truncated');

const largeState = buildLargeState();
const summaryLarge = buildQuerySiteSummary({ state: largeState, detail: 'full' });
const largeTokens = estimateTokens(JSON.stringify(summaryLarge));
assert(
  largeTokens <= QUERY_SITE_TOKEN_CAP,
  `large site summary must be trimmed to <= ${String(QUERY_SITE_TOKEN_CAP)} tokens (got ${String(largeTokens)} tokens)`,
);
assert(
  summaryLarge.truncated === true,
  'large site summary must flip truncated=true after trimming',
);
console.log('[chat:smoke] 3/4 Token budget cap — OK');

// ---------------------------------------------------------------------------
// Test 4 — Op preview is NOT applied automatically; the live editable state
// is unchanged after a turn that emitted an op-preview.
// ---------------------------------------------------------------------------

const beforeJson = JSON.stringify(fixtureState);
// Re-walk the same turn fixtures: orchestrator consumed ctx.state by reference.
const adapter3 = new MockLlmAdapter([
  () =>
    yieldChunks(
      {
        type: 'tool_call',
        id: 'rewriteText-only',
        name: 'rewriteText',
        arguments: {
          elementId: targetElementId,
          content: [{ text: 'A new heading.' }],
        },
      },
      { type: 'done', reason: 'tool_use' },
    ),
  () => yieldChunks({ type: 'text', text: 'Done.' }, { type: 'done', reason: 'stop' }),
]);
const writer3 = new BufferedStreamWriter();
const store3 = new InMemorySessionStore();
const session3 = await store3.create('site-smoke', 'customer-smoke');
const ctx3: OrchestratorContext = {
  adapter: adapter3,
  state: fixtureState,
  systemInstruction: '[smoke] system prompt',
};
const result3 = await runChatTurn({
  session: session3,
  userMessage: 'Replace the heading.',
  writer: writer3,
  ctx: ctx3,
});
const afterJson = JSON.stringify(fixtureState);

assert(beforeJson === afterJson, 'editable state must be unchanged after an op-preview turn');
assert(
  result3.previewOps.length === 1,
  `expected one preview op (got ${String(result3.previewOps.length)})`,
);

// And independently confirm the op is still a valid op the apply path would
// accept — we apply it to a fresh clone and validate. This guards against
// the orchestrator emitting a malformed op.
const previewOp3 = result3.previewOps[0];
if (!previewOp3) throw new Error('expected preview op');
const applied = applyCanvasAgentOp(fixtureState, previewOp3.op);
const validation = validateEditableSite(applied);
assert(
  validation.valid,
  validation.valid
    ? ''
    : `preview op would fail validateEditableSite: ${validation.errors.join('; ')}`,
);
// The source must STILL be unchanged after the clone-apply.
assert(JSON.stringify(fixtureState) === beforeJson, 'apply-clone must not mutate source');

console.log('[chat:smoke] 4/4 Op preview not auto-applied — OK');

// ---------------------------------------------------------------------------
// Done.
// ---------------------------------------------------------------------------

// Touch ChatSessionState type so unused imports are kept honest.
const _typeCheck: ChatSessionState | null = null;
void _typeCheck;

console.log('[chat:smoke] OK');
