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
//   5. Loud summarisation failure: empty model output ends the turn with
//      `error` + `done(summarise-failed)`, never silently. Owner message is
//      preserved in history (ADR 0055 dec 5 + ADR 0056 follow-up).
//   6. Precise token count is authoritative at the cap boundary.
//   7. Wall-clock aborts during countTokens end the turn loudly.
//   8. Token trimming never orphans active tool responses.
//   9. Ghost previews fail loudly when the preview target cannot resolve.
//
// All paths run without GEMINI_API_KEY / DATABASE_URL — the mock LlmAdapter
// + InMemorySessionStore stand in.

import { applyCanvasAgentOp } from '../canvas-ops.js';
import type {
  ChatWithToolsOptions,
  CountTokensOptions,
  LlmAdapter,
  LlmChunk,
  LlmMessage,
} from '../llm.js';
import type { EditableSite, SectionRecipeId } from '../../canvas/schema.js';
import { SECTION_RECIPE_IDS } from '../../canvas/schema.js';
import { createSectionFromRecipe, type RecipeFactoryInput } from '../../canvas/recipes.js';
import { STYLE_KIT_PRESETS } from '../../canvas/style-kits.js';
import { validateEditableSite } from '../../canvas/validate.js';

import { CHAT_DEFAULT_MODEL, runChatTurn, type OrchestratorContext } from './orchestrator.js';
import {
  InMemorySessionStore,
  QUERY_SITE_TOKEN_CAP,
  estimateTokens,
  trimToBudget,
  type ChatMessage,
  type ChatSessionState,
} from './session.js';
import { BufferedStreamWriter, type ChatStreamEvent } from './stream.js';
import { buildQuerySiteSummary } from './tools.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  CHAT_DEFAULT_MODEL === 'gemini-3.5-flash',
  `CHAT_DEFAULT_MODEL must be gemini-3.5-flash (released 2026-05-19, the current frontier-class SKU), got ${CHAT_DEFAULT_MODEL}`,
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
type CountTokensImpl = (messages: LlmMessage[], opts: CountTokensOptions) => Promise<number>;

class MockLlmAdapter implements LlmAdapter {
  private callIdx = 0;
  public readonly countTokenCalls: Array<{ messages: LlmMessage[]; opts: CountTokensOptions }> = [];
  public readonly messageHistorySnapshots: LlmMessage[][] = [];

  constructor(
    private readonly script: Script,
    private readonly preciseTokenCounts: number[] = [],
    private readonly countTokensImpl?: CountTokensImpl,
  ) {}

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

  countTokens(messages: LlmMessage[], opts: CountTokensOptions): Promise<number> {
    this.countTokenCalls.push({ messages: messages.map((m) => ({ ...m })), opts });
    if (this.countTokensImpl) return this.countTokensImpl(messages, opts);
    return Promise.resolve(this.preciseTokenCounts.shift() ?? 0);
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

console.log('[chat:smoke] 1/9 SSE event order — OK');

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

console.log('[chat:smoke] 2/9 Session persistence — OK');

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
console.log('[chat:smoke] 3/9 Token budget cap — OK');

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

console.log('[chat:smoke] 4/9 Op preview not auto-applied — OK');

// ---------------------------------------------------------------------------
// Test 5 — Loud summarisation failure (ADR 0055 dec 5 + ADR 0056 follow-up).
// When summarisation produces no text the orchestrator must end the turn
// with `error` + `done(summarise-failed)`. No silent skip.
// ---------------------------------------------------------------------------

const tenTurnHistory: ChatMessage[] = [];
for (let i = 0; i < 10; i++) {
  tenTurnHistory.push({ role: 'user', content: `Owner message ${String(i)}` });
  tenTurnHistory.push({ role: 'assistant', content: `Agent reply ${String(i)}` });
}

const summariseEmptyAdapter = new MockLlmAdapter([
  // Summarisation call: stream emits zero text chunks then `done`. Per ADR
  // 0055 dec 5 the orchestrator must treat this as a loud failure.
  () => yieldChunks({ type: 'done', reason: 'stop' }),
]);

const writer5 = new BufferedStreamWriter();
const store5 = new InMemorySessionStore();
const session5 = await store5.create('site-smoke-summ', 'customer-smoke-summ', tenTurnHistory);
const ctx5: OrchestratorContext = {
  adapter: summariseEmptyAdapter,
  state: fixtureState,
  systemInstruction: '[smoke] system prompt',
};
const result5 = await runChatTurn({
  session: session5,
  userMessage: 'Trigger summarisation.',
  writer: writer5,
  ctx: ctx5,
});

assert(
  result5.doneReason === 'summarise-failed',
  `expected doneReason summarise-failed, got ${result5.doneReason}`,
);
const events5 = writer5.events();
const lastTwo = events5.slice(-2);
assert(
  lastTwo[0]?.kind === 'error',
  `expected penultimate event to be error, got ${lastTwo[0]?.kind ?? 'none'}`,
);
assert(
  lastTwo[1]?.kind === 'done' && lastTwo[1].reason === 'summarise-failed',
  `expected final event done(summarise-failed), got ${lastTwo[1]?.kind ?? 'none'}`,
);
assert(result5.previewOps.length === 0, 'failed-summarise turn must produce zero preview ops');
// The Owner's appended user message must still be in the returned history so
// the caller can persist it.
const lastMessage5 = result5.messages[result5.messages.length - 1];
assert(
  lastMessage5?.role === 'user' && lastMessage5.content === 'Trigger summarisation.',
  'failed-summarise turn must preserve the Owner appended message',
);

console.log('[chat:smoke] 5/9 Loud summarisation failure — OK');

// ---------------------------------------------------------------------------
// Test 6 - Precise countTokens is authoritative at the cap boundary.
// ---------------------------------------------------------------------------

const preciseUnderBudgetAdapter = new MockLlmAdapter(
  [
    () =>
      yieldChunks(
        {
          type: 'tool_call',
          id: 'query-assets-large-cheap-estimate',
          name: 'query_assets',
          arguments: { limit: 20 },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () =>
      yieldChunks(
        { type: 'text', text: 'The precise count still fits.' },
        { type: 'done', reason: 'stop' },
      ),
  ],
  [90],
);

const writer6 = new BufferedStreamWriter();
const store6 = new InMemorySessionStore();
const session6 = await store6.create('site-smoke-precise-count', 'customer-smoke-precise-count');
const result6 = await runChatTurn({
  session: session6,
  userMessage: 'Inspect the assets before planning.',
  writer: writer6,
  ctx: {
    adapter: preciseUnderBudgetAdapter,
    state: fixtureState,
    assets: Array.from({ length: 20 }, (_, idx) => ({
      id: `asset-large-${String(idx)}`,
      kind: 'image',
      alt: `large asset alt ${String(idx)} ${'x'.repeat(160)}`,
      contentHash: `hash-large-${String(idx)}`,
    })),
    systemInstruction: '[smoke] system prompt',
    tokenBudget: 100,
  },
});
assert(
  preciseUnderBudgetAdapter.countTokenCalls.length === 1,
  `expected one precise countTokens call at the cap boundary, got ${String(
    preciseUnderBudgetAdapter.countTokenCalls.length,
  )}`,
);
assert(
  result6.doneReason === 'stop',
  `precise under-budget count must allow the turn to continue, got ${result6.doneReason}`,
);
assert(
  writer6.events().some((e) => e.kind === 'token' && e.text.includes('precise count still fits')),
  'expected the second LLM pass to run after the precise under-budget count',
);
assert(
  !writer6.events().some((e) => e.kind === 'done' && e.reason === 'tokens-exceeded'),
  'precise under-budget count must not emit done(tokens-exceeded)',
);

console.log('[chat:smoke] 6/9 Precise token count boundary — OK');

// ---------------------------------------------------------------------------
// Test 7 - Wall-clock abort during countTokens maps to done(wallclock-exceeded).
// ---------------------------------------------------------------------------

const abortDuringCountAdapter = new MockLlmAdapter(
  [
    () =>
      yieldChunks(
        {
          type: 'tool_call',
          id: 'query-assets-count-abort',
          name: 'query_assets',
          arguments: { limit: 20 },
        },
        { type: 'done', reason: 'tool_use' },
      ),
  ],
  [],
  async (_messages, opts) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (opts.signal?.aborted) throw new Error('countTokens aborted');
    return 90;
  },
);

const writer7 = new BufferedStreamWriter();
const store7 = new InMemorySessionStore();
const session7 = await store7.create('site-smoke-count-abort', 'customer-smoke-count-abort');
const result7 = await runChatTurn({
  session: session7,
  userMessage: 'Inspect assets until the deadline trips.',
  writer: writer7,
  ctx: {
    adapter: abortDuringCountAdapter,
    state: fixtureState,
    assets: Array.from({ length: 20 }, (_, idx) => ({
      id: `asset-count-abort-${String(idx)}`,
      kind: 'image',
      alt: `count abort asset alt ${String(idx)} ${'x'.repeat(160)}`,
      contentHash: `hash-count-abort-${String(idx)}`,
    })),
    systemInstruction: '[smoke] system prompt',
    tokenBudget: 100,
    wallClockMs: 1,
  },
});
assert(
  result7.doneReason === 'wallclock-exceeded',
  `expected countTokens abort to end as wallclock-exceeded, got ${result7.doneReason}`,
);
const events7 = writer7.events();
const final7 = events7[events7.length - 1];
assert(
  final7?.kind === 'done' && final7.reason === 'wallclock-exceeded',
  `expected final event done(wallclock-exceeded), got ${final7?.kind ?? 'none'}`,
);

console.log('[chat:smoke] 7/9 countTokens wall-clock abort — OK');

// ---------------------------------------------------------------------------
// Test 8 - Trimming preserves the active tool-call protocol tail.
// ---------------------------------------------------------------------------

const activeToolTail: ChatMessage[] = [
  { role: 'user', content: 'Old prompt ' + 'x'.repeat(400) },
  { role: 'assistant', content: 'Old answer ' + 'x'.repeat(400) },
  { role: 'user', content: 'Inspect the current site.' },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'query-site-active', name: 'query_site', arguments: { detail: 'full' } }],
  },
  {
    role: 'tool',
    toolCallId: 'query-site-active',
    toolName: 'query_site',
    content: JSON.stringify({ summary: 'x'.repeat(400) }),
  },
];
const trimmedActiveToolTail = trimToBudget(activeToolTail, 10);
assert(
  trimmedActiveToolTail.some((m) => m.role === 'user' && m.content === 'Inspect the current site.'),
  'trimToBudget must preserve the active user message',
);
assert(
  trimmedActiveToolTail.some(
    (m) => m.role === 'assistant' && m.toolCalls?.some((call) => call.id === 'query-site-active'),
  ),
  'trimToBudget must preserve the assistant tool-call message for active tool results',
);
assert(
  trimmedActiveToolTail.some((m) => m.role === 'tool' && m.toolCallId === 'query-site-active'),
  'trimToBudget must preserve the active tool result',
);

console.log('[chat:smoke] 8/9 Active tool tail trim — OK');

// ---------------------------------------------------------------------------
// Test 9 - Trimming drops complete historical tool-call turns.
// ---------------------------------------------------------------------------

const historicalToolTurn: ChatMessage[] = [
  { role: 'user', content: 'Old prompt ' + 'x'.repeat(200) },
  {
    role: 'assistant',
    content: 'Calling query_site. ' + 'x'.repeat(800),
    toolCalls: [{ id: 'query-site-old', name: 'query_site', arguments: { detail: 'full' } }],
  },
  {
    role: 'tool',
    toolCallId: 'query-site-old',
    toolName: 'query_site',
    content: JSON.stringify({ ok: true }),
  },
  { role: 'user', content: 'Keep this active request.' },
];
const trimmedHistoricalToolTurn = trimToBudget(historicalToolTurn, 80);
assert(
  trimmedHistoricalToolTurn.length === 1 &&
    trimmedHistoricalToolTurn[0]?.role === 'user' &&
    trimmedHistoricalToolTurn[0].content === 'Keep this active request.',
  'trimToBudget must drop the whole historical tool-call turn before the active user message',
);
assert(
  !trimmedHistoricalToolTurn.some((m) => m.role === 'tool'),
  'trimToBudget must not leave orphan historical tool results',
);

console.log('[chat:smoke] 9/9 Historical tool-call trim — OK');

// ---------------------------------------------------------------------------
// Test 10 — Ghost-preview: op-preview events for additive section ops carry
//   a server-resolved previewSection so the editor can render the proposal
//   in place between existing sections.
//
//   Coverage:
//     10a — designSection on a custom-styled site (exercises the
//           resolveStyleKitWithCustom path; mirrors the fix in commit
//           d496996 — without it, resolvePreviewSection would have thrown
//           and the orchestrator would have shipped op-preview without
//           previewSection, silently downgrading the UI).
//     10b — Non-additive op (rewriteText from test 1) must NOT carry
//           previewSection. Phase A ghosts are section-shaped only.
//   Not covered (intentional):
//     - insertSection: the chat agent does not expose insertSection as a
//       tool; only designSection is in CANVAS_AGENT_TOOLS. The
//       resolvePreviewSection insertSection branch exists for direct API
//       callers (recipe pickers, programmatic apply) and is exercised via
//       canvas-agent-smoke's createSectionFromRecipe coverage instead.
//     - duplicateSection: same as insertSection — not an LLM tool name.
// ---------------------------------------------------------------------------

const ghostState = buildFixtureState();
const ghostHero = ghostState.pages[0]!.sections[0]!;

// 10a — designSection on a state with styleKit:'custom' resolves through
// resolveStyleKitWithCustom (mirrors the canvas-ops fix from commit d496996).
const ghostCustomState = {
  ...buildFixtureState(),
  styleKit: 'custom' as const,
  customStyleKit: STYLE_KIT_PRESETS.charcoal,
};
const ghostCustomHero = ghostCustomState.pages[0]!.sections[0]!;
const designCallId = 'designSection-1-def';
const ghostDesignAdapter = new MockLlmAdapter([
  () =>
    yieldChunks(
      { type: 'text', text: 'Designing a careers section. ' },
      {
        type: 'tool_call',
        id: designCallId,
        name: 'designSection',
        // designSection tool args are FLAT — sectionName + layout at the
        // top level, not nested under `input` (that's the OP shape, which
        // the parser builds from these args internally).
        arguments: {
          afterSectionId: ghostCustomHero.id,
          sectionName: 'Careers',
          layout: {
            type: 'stack',
            direction: 'column',
            align: 'center',
            children: [
              {
                element: {
                  type: 'text',
                  text: {
                    content: 'Now hiring',
                    role: 'heading',
                    color: 'text',
                    font: 'display',
                    size: 56,
                  },
                },
              },
            ],
          },
        },
      },
      { type: 'done', reason: 'tool_use' },
    ),
  () => yieldChunks({ type: 'text', text: 'Accept to apply.' }, { type: 'done', reason: 'stop' }),
]);
const ghostDesignWriter = new BufferedStreamWriter();
const ghostDesignStore = new InMemorySessionStore();
const ghostDesignSession = await ghostDesignStore.create('site-ghost-design', 'customer-smoke');
await runChatTurn({
  session: ghostDesignSession,
  userMessage: 'Add a careers section.',
  writer: ghostDesignWriter,
  ctx: { adapter: ghostDesignAdapter, state: ghostCustomState, systemInstruction: '[smoke] sys' },
});
const designPreview = ghostDesignWriter
  .events()
  .find((e): e is Extract<ChatStreamEvent, { kind: 'op-preview' }> => e.kind === 'op-preview');
assert(
  designPreview !== undefined && designPreview.toolName === 'designSection',
  'expected an op-preview for designSection',
);
assert(
  designPreview!.previewSection !== undefined,
  'designSection op-preview on a custom-styled site must carry a previewSection (resolveStyleKitWithCustom should not throw)',
);
assert(
  designPreview!.previewSection!.elements.length > 0,
  'designSection previewSection must contain the resolved layout-tree elements',
);

// 10b — rewriteText (non-additive op from test 1) must NOT carry previewSection.
const rewriteEvt = events1.find(
  (e): e is Extract<ChatStreamEvent, { kind: 'op-preview' }> => e.kind === 'op-preview',
);
assert(
  rewriteEvt !== undefined && rewriteEvt.previewSection === undefined,
  'rewriteText op-preview must NOT carry previewSection — Phase A ghosts are section-shaped only',
);

// 10c — preview resolution failure must be loud. An explicit pageId that
// does not exist is the same error applyCanvasAgentOp would throw; the chat
// turn must stop with error+done instead of shipping an op-preview without a
// ghost and deferring the failure until Accept.
const invalidPageDesignAdapter = new MockLlmAdapter([
  () =>
    yieldChunks(
      {
        type: 'tool_call',
        id: 'designSection-invalid-page',
        name: 'designSection',
        arguments: {
          pageId: 'page-does-not-exist',
          afterSectionId: ghostHero.id,
          sectionName: 'Broken target',
          layout: {
            type: 'stack',
            direction: 'column',
            children: [
              {
                element: {
                  type: 'text',
                  text: {
                    content: 'This should not preview',
                    role: 'heading',
                    color: 'text',
                    font: 'display',
                    size: 48,
                  },
                },
              },
            ],
          },
        },
      },
      { type: 'done', reason: 'tool_use' },
    ),
  () =>
    yieldChunks(
      { type: 'text', text: 'This pass should not run.' },
      { type: 'done', reason: 'stop' },
    ),
]);
const invalidPageWriter = new BufferedStreamWriter();
const invalidPageSession = await new InMemorySessionStore().create(
  'site-ghost-invalid',
  'customer-smoke',
);
const invalidPageResult = await runChatTurn({
  session: invalidPageSession,
  userMessage: 'Add a section to a missing page.',
  writer: invalidPageWriter,
  ctx: { adapter: invalidPageDesignAdapter, state: ghostState, systemInstruction: '[smoke] sys' },
});
const invalidPageEvents = invalidPageWriter.events();
const invalidPageError = invalidPageEvents.find(
  (e): e is Extract<ChatStreamEvent, { kind: 'error' }> => e.kind === 'error',
);
assert(
  invalidPageError !== undefined &&
    invalidPageError.error.includes('pageId not found: page-does-not-exist'),
  'invalid designSection preview pageId must emit a loud error with the missing page id',
);
assert(
  !invalidPageEvents.some((e) => e.kind === 'op-preview'),
  'invalid designSection preview target must stop before op-preview',
);
assert(
  invalidPageResult.doneReason === 'other' &&
    invalidPageEvents.some((e) => e.kind === 'done' && e.reason === 'other'),
  'invalid designSection preview target must end the turn with done(other)',
);

console.log('[chat:smoke] 10/10 Ghost-preview — OK');

// ---------------------------------------------------------------------------
// Test 11-14 — generateImage tool dispatch
// ---------------------------------------------------------------------------
//
// The orchestrator's `generateImage` path is special-cased: it must call
// Replicate (mocked here via ctx.replicateClient), encode bytes inline on
// the op-preview, and honour ADR 0004 D2 by never persisting an asset
// server-side. These tests pin:
//   11. REPLACE mode happy path — elementId resolves, ghost-friendly data
//       URL arrives, target.boxW/boxH drive the snapped aspect ratio.
//   12. ADD mode default box — sectionId only, orchestrator computes the
//       default 480x270 box so the editor's ghost has a slot to paint into.
//   13. Missing REPLICATE_API_TOKEN — loud error event, no op-preview.
//   14. Both elementId and sectionId — parser rejects, loud error.

function buildGenerateFixture() {
  const fix = buildFixtureState();
  const hero = fix.pages[0]?.sections[0];
  if (!hero) throw new Error('generate-fixture: hero section missing');
  const heroMedia = hero.elements.find((e) => e.type === 'media');
  if (!heroMedia) throw new Error('generate-fixture: hero must have a media element');
  const features = fix.pages[0]?.sections[1];
  if (!features) throw new Error('generate-fixture: features section missing');
  return { state: fix, heroMediaId: heroMedia.id, featuresSectionId: features.id };
}

// PNG signature bytes — enough for a real image-shaped payload without
// committing to a full encoder. The orchestrator only cares about
// byteLength and mediaType.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
]);

interface ReplicateCall {
  token: string;
  prompt: string;
  aspectRatio: string;
}

function makeReplicateStub(): {
  client: (
    token: string,
    prompt: string,
    aspectRatio: string,
  ) => Promise<{ bytes: Uint8Array; mediaType: string }>;
  calls: ReplicateCall[];
} {
  const calls: ReplicateCall[] = [];
  return {
    client: (token, prompt, aspectRatio) => {
      calls.push({ token, prompt, aspectRatio });
      return Promise.resolve({ bytes: PNG_BYTES, mediaType: 'image/png' });
    },
    calls,
  };
}

// ---- Test 11 — REPLACE mode happy path -----------------------------------

{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-replace-1';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        { type: 'text', text: 'On it. Proposing a generated photo.' },
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: { elementId: fix.heroMediaId, prompt: 'a foggy harbour at dawn' },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Done.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create('site-gen-rep', 'customer-smoke');
  const result = await runChatTurn({
    session,
    userMessage: 'Generate a hero image.',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      replicateToken: 'test-token-XYZ',
      replicateClient: stub.client,
      imageRateLimit: () => Promise.resolve({ allowed: true, retryAfterMs: null }),
    },
  });

  assert(stub.calls.length === 1, 'REPLACE mode must call Replicate exactly once');
  const replicateCall = stub.calls[0]!;
  assert(
    replicateCall.token === 'test-token-XYZ',
    'Replicate stub must receive the ctx.replicateToken verbatim',
  );
  assert(
    replicateCall.prompt === 'a foggy harbour at dawn',
    'Replicate stub must receive the model prompt verbatim',
  );
  // Hero media box is 600x540 → ratio ≈ 1.11 → closest preset is 1:1.
  assert(
    replicateCall.aspectRatio === '1:1',
    `expected aspect_ratio snap to 1:1 for 600x540 slot, got ${replicateCall.aspectRatio}`,
  );

  const events = writer.events();
  const preview = events.find(
    (e): e is Extract<ChatStreamEvent, { kind: 'op-preview' }> => e.kind === 'op-preview',
  );
  assert(preview !== undefined, 'REPLACE mode must emit an op-preview');
  const previewOp = preview!.op as {
    kind?: string;
    target?: { mode?: string; elementId?: string };
    prompt?: string;
    alt?: string;
    dataUrl?: string;
    mediaType?: string;
    aspectRatio?: string;
  };
  assert(
    previewOp.kind === 'placeGeneratedImage',
    `op.kind must be placeGeneratedImage, got ${String(previewOp.kind)}`,
  );
  assert(
    previewOp.target?.mode === 'replace' && previewOp.target.elementId === fix.heroMediaId,
    'op.target must carry mode=replace + the requested elementId',
  );
  assert(
    typeof previewOp.dataUrl === 'string' &&
      previewOp.dataUrl.startsWith('data:image/png;base64,'),
    'op.dataUrl must be a base64 data URL with the Replicate mediaType',
  );
  assert(
    previewOp.mediaType === 'image/png',
    `op.mediaType must mirror the Replicate stub mediaType, got ${String(previewOp.mediaType)}`,
  );
  assert(
    previewOp.aspectRatio === '1:1',
    'op.aspectRatio must carry the snapped preset for downstream re-use',
  );
  assert(
    result.doneReason === 'stop',
    `expected doneReason=stop after REPLACE happy path, got ${result.doneReason}`,
  );
  console.log('[chat:smoke] 11/16 generateImage REPLACE mode — OK');
}

// ---- Test 12 — ADD mode with default box ---------------------------------

{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-add-1';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        { type: 'text', text: 'Sure — proposing a new image.' },
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: {
            sectionId: fix.featuresSectionId,
            prompt: 'a sunlit workshop bench',
          },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Done.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create('site-gen-add', 'customer-smoke');
  await runChatTurn({
    session,
    userMessage: 'Add a generated image to the features section.',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      replicateToken: 'test-token-ABC',
      replicateClient: stub.client,
      imageRateLimit: () => Promise.resolve({ allowed: true, retryAfterMs: null }),
    },
  });

  assert(stub.calls.length === 1, 'ADD mode must call Replicate exactly once');
  // Default ADD box is 480x270 → ratio ≈ 1.78 → closest preset is 16:9.
  assert(
    stub.calls[0]!.aspectRatio === '16:9',
    `expected aspect_ratio 16:9 for default 480x270 box, got ${stub.calls[0]!.aspectRatio}`,
  );

  const events = writer.events();
  const preview = events.find(
    (e): e is Extract<ChatStreamEvent, { kind: 'op-preview' }> => e.kind === 'op-preview',
  );
  assert(preview !== undefined, 'ADD mode must emit an op-preview');
  const previewOp = preview!.op as {
    kind?: string;
    target?: {
      mode?: string;
      sectionId?: string;
      box?: { x: number; y: number; w: number; h: number };
    };
  };
  assert(
    previewOp.kind === 'placeGeneratedImage' &&
      previewOp.target?.mode === 'add' &&
      previewOp.target.sectionId === fix.featuresSectionId,
    'op.target must carry mode=add + the requested sectionId',
  );
  const box = previewOp.target?.box;
  assert(
    box !== undefined &&
      box.x === 40 &&
      box.w === 480 &&
      box.h === 270 &&
      typeof box.y === 'number' &&
      box.y >= 40,
    `op.target.box must default to {x:40, w:480, h:270, y >= 40}, got ${JSON.stringify(box)}`,
  );
  console.log('[chat:smoke] 12/16 generateImage ADD mode default box — OK');
}

// ---- Test 13 — Missing REPLICATE_API_TOKEN -------------------------------

{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-no-token';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: { elementId: fix.heroMediaId, prompt: 'anything' },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Done.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create('site-gen-noenv', 'customer-smoke');
  await runChatTurn({
    session,
    userMessage: 'Generate.',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      // intentionally no replicateToken
      replicateClient: stub.client,
    },
  });

  assert(
    stub.calls.length === 0,
    'missing token must short-circuit before calling Replicate',
  );
  const events = writer.events();
  const err = events.find(
    (e): e is Extract<ChatStreamEvent, { kind: 'error' }> => e.kind === 'error',
  );
  assert(
    err !== undefined && err.error.includes('REPLICATE_API_TOKEN'),
    'missing token must surface a loud REPLICATE_API_TOKEN error',
  );
  assert(
    !events.some((e) => e.kind === 'op-preview'),
    'missing token must not emit any op-preview',
  );
  console.log('[chat:smoke] 13/16 generateImage missing-token — OK');
}

// ---- Test 14 — both elementId and sectionId ------------------------------

{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-both';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: {
            elementId: fix.heroMediaId,
            sectionId: fix.featuresSectionId,
            prompt: 'ambiguous target',
          },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Done.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create('site-gen-both', 'customer-smoke');
  await runChatTurn({
    session,
    userMessage: 'Generate (ambiguous).',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      replicateToken: 'test-token',
      replicateClient: stub.client,
    },
  });

  assert(
    stub.calls.length === 0,
    'parser rejection must short-circuit before calling Replicate',
  );
  const events = writer.events();
  const err = events.find(
    (e): e is Extract<ChatStreamEvent, { kind: 'error' }> => e.kind === 'error',
  );
  assert(
    err !== undefined && err.error.includes('exactly one of elementId'),
    `parser rejection must name the validation rule, got ${err?.error}`,
  );
  assert(
    !events.some((e) => e.kind === 'op-preview'),
    'parser rejection must not emit any op-preview',
  );
  console.log('[chat:smoke] 14/16 generateImage parser rejection — OK');
}

// ---- Test 15 — per-account image cap blocks generation -------------------
//
// When ctx.imageRateLimit reports the account is over the 'ai-image' budget,
// the generateImage tool must NOT call Replicate and must surface a loud
// error to the model — mirroring the missing-token branch. Pins the fix for
// the chat image-gen cap bypass (codex review).
{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-capped-1';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        { type: 'text', text: 'Generating…' },
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: { elementId: fix.heroMediaId, prompt: 'a foggy harbour at dawn' },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Acknowledged.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create('site-gen-capped', 'customer-smoke');
  await runChatTurn({
    session,
    userMessage: 'Generate a hero image.',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      replicateToken: 'test-token-XYZ',
      replicateClient: stub.client,
      imageRateLimit: () => Promise.resolve({ allowed: false, retryAfterMs: 9_999 }),
    },
  });

  assert(stub.calls.length === 0, 'over-budget image cap must NOT call Replicate');
  const events = writer.events();
  assert(
    events.some((e) => e.kind === 'error' && e.error.includes('image generation limit reached')),
    'over-budget image cap must emit a loud error event',
  );
  assert(
    !events.some((e) => e.kind === 'op-preview'),
    'over-budget image cap must not emit an op-preview',
  );
  console.log('[chat:smoke] 15/16 generateImage rate-limit cap — OK');
}

// ---- Test 16 — image generation requires a cap hook ----------------------
//
// Valid generateImage dispatch with a Replicate token but no imageRateLimit
// hook is a server wiring error. The orchestrator must fail closed before the
// provider call; otherwise a future CHAT_AGENT_TOOLS caller can bypass the
// per-account 'ai-image' cap by forgetting the route-level hook.
{
  const fix = buildGenerateFixture();
  const stub = makeReplicateStub();
  const callId = 'gen-no-limit-hook';
  const adapter = new MockLlmAdapter([
    () =>
      yieldChunks(
        {
          type: 'tool_call',
          id: callId,
          name: 'generateImage',
          arguments: { elementId: fix.heroMediaId, prompt: 'a foggy harbour at dawn' },
        },
        { type: 'done', reason: 'tool_use' },
      ),
    () => yieldChunks({ type: 'text', text: 'Acknowledged.' }, { type: 'done', reason: 'stop' }),
  ]);
  const writer = new BufferedStreamWriter();
  const session = await new InMemorySessionStore().create(
    'site-gen-no-limit-hook',
    'customer-smoke',
  );
  await runChatTurn({
    session,
    userMessage: 'Generate a hero image.',
    writer,
    ctx: {
      adapter,
      state: fix.state,
      systemInstruction: '[smoke] sys',
      replicateToken: 'test-token-XYZ',
      replicateClient: stub.client,
    },
  });

  assert(stub.calls.length === 0, 'missing imageRateLimit hook must NOT call Replicate');
  const events = writer.events();
  assert(
    events.some((e) => e.kind === 'error' && e.error.includes('image rate limiter')),
    'missing imageRateLimit hook must emit a loud wiring error',
  );
  assert(
    !events.some((e) => e.kind === 'op-preview'),
    'missing imageRateLimit hook must not emit an op-preview',
  );
  console.log('[chat:smoke] 16/16 generateImage limiter wiring — OK');
}

// ---------------------------------------------------------------------------
// Done.
// ---------------------------------------------------------------------------

// Touch ChatSessionState type so unused imports are kept honest.
const _typeCheck: ChatSessionState | null = null;
void _typeCheck;

console.log('[chat:smoke] OK');
