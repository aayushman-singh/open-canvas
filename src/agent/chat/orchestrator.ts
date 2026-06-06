// src/agent/chat/orchestrator.ts
//
// Multi-turn chat loop for the AI chat command surface.
//
// Inputs:
//   - A `ChatSessionState` with the persisted message history.
//   - The Owner's next user message.
//   - The current `EditableSite` (for `query_site` + op preview validation).
//   - An LlmAdapter (Gemini in production; a mock in the smoke).
//   - A `ChatStreamWriter` the loop emits SSE events into.
//
// Loop shape:
//
//   1. Append the user message to history.
//   2. Trim history to the 16k token budget.
//   3. Stream a Gemini call with CHAT_AGENT_TOOLS.
//      - Emit `token` events for text deltas.
//      - Collect any tool_call chunks.
//   4. If the assistant emitted no tool calls, save history, emit `done`.
//   5. For each tool call, in order:
//        - `query_site` → dispatch locally, emit `tool-call` + `tool-result`,
//          push the assistant + tool messages onto history.
//        - mutating tool → translate to a CanvasAgentOp, emit `tool-call` +
//          `op-preview` (NOT applied to state), push assistant + a synthetic
//          tool message acknowledging the preview onto history.
//   6. Loop back to step 3 with the updated history. Cap at 5 iterations
//      per turn so a buggy model can't burn through the budget.
//
// Failure handling follows the repo policy: every translation error, LLM
// error, or tool-dispatch error fails LOUD via an `error` event followed
// by `done`. Silent fallbacks are not allowed.
//
// Preview pattern: mutating ops are NEVER applied to the editable state in
// the orchestrator. The Owner accepts via the existing
// `POST /api/canvas-agent/sites/:id/apply` route — the chat orchestrator
// hands the op back to the editor; the editor calls apply.

import type {
  ChatWithToolsOptions,
  LlmAdapter,
  LlmAssistantToolCall,
  LlmChunk,
  LlmMessage,
  LlmTool,
} from '../llm.js';
import type { CanvasAgentOp } from '../canvas-ops.js';
import type { CanvasPage, CanvasSection, EditableSite } from '../../canvas/schema.js';
import type { SiteFont } from '../../db/schema.js';
import { createSectionFromRecipe } from '../../canvas/recipes.js';
import { resolveDesignSection } from '../../canvas/layout/engine.js';
import { resolveStyleKitWithCustom } from '../../canvas/style-kits.js';
import { translateToolCall, isRecord } from '../tool-parsers.js';
import {
  CHAT_AGENT_TOOLS,
  MUTATING_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  buildQuerySiteSummary,
  type QuerySiteDetail,
} from './tools.js';
import {
  encodeImageDataUrl,
  generateImageViaReplicate,
  MAX_GENERATED_IMAGE_BYTES,
  snapToFluxAspectRatio,
} from '../replicate-image.js';
import {
  CHAT_TOKEN_BUDGET,
  SUMMARIZE_AFTER_TURNS,
  countTurns,
  estimateMessagesTokens,
  trimToBudget,
  type ChatMessage,
  type ChatSessionState,
  type ChatToolCall,
} from './session.js';
import type { ChatStreamWriter } from './stream.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// gemini-3.5-flash (released 2026-05-19) outperforms gemini-3.1-pro on every
// published benchmark — coding, agentic, multimodal — at a fraction of the
// price. With the GeminiAdapter now round-tripping thoughtSignature on every
// Part, both the "primary planning" tier and the "flash inspection" tier per
// ADR 0056 point at the same model. The two-tier code structure stays so a
// future split (e.g. routing inspection to 3.x-flash-lite for cost) is a
// constant change, not a refactor.
export const CHAT_DEFAULT_MODEL = 'gemini-3.5-flash';

// Flash tier for summarisation + read-only inspection sub-loops per ADR 0056.
// Currently the same model as CHAT_DEFAULT_MODEL — see comment above.
export const CHAT_FLASH_MODEL = 'gemini-3.5-flash';

// Tool-call safety net per ADR 0055 decision 2. The cap is intentionally
// high — it is NOT the primary stop condition (wall-clock and token budgets
// are). It exists to break a degenerate loop where the model calls the same
// read-only tool over and over. Set so legitimate sitewide revamps complete
// without bumping the cap; revisit if telemetry shows real work hitting it.
export const TOOL_CALL_SAFETY_NET = 50;

// Wall-clock budget per turn, per ADR 0055 decision 6. When the deadline
// fires the orchestrator aborts the in-flight Gemini stream, discards any
// partial tool-call buffer, and emits `done` with reason `wallclock-exceeded`.
// Initial value picked so a long sitewide revamp can complete but a runaway
// model cannot eat the full 600s Cloudflare worker invocation. Revisit once
// budget-exhaustion telemetry (ADR 0055 follow-up) lands.
export const DEFAULT_WALL_CLOCK_MS = 120_000;

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export interface OwnerAssetRef {
  id: string;
  kind: string;
  alt: string;
  contentHash: string;
  width?: number | null;
  height?: number | null;
}

export interface OrchestratorContext {
  adapter: LlmAdapter;
  model?: string;
  state: EditableSite;
  fonts?: SiteFont[];
  assets?: OwnerAssetRef[];
  /**
   * Optional. The smoke uses this to pin the system prompt to a stable
   * fixture. Production passes the live builder from `systemPrompt()`.
   */
  systemInstruction?: string;
  /**
   * Optional. The element the Owner currently has selected on the canvas.
   * The orchestrator injects this into the system prompt so the agent can
   * resolve vague references ("change this to blue") without a query_site.
   */
  selectedElementId?: string;
  tools?: LlmTool[];
  /**
   * Optional. Safety-net ceiling on tool-call iterations per turn (ADR 0055
   * decision 2). NOT the primary stop condition — wall-clock and token
   * budgets fire first on real work. Defaults to TOOL_CALL_SAFETY_NET.
   */
  toolCallBudget?: number;
  /**
   * Optional. Per-turn wall-clock budget in milliseconds (ADR 0055 decision 6).
   * When the deadline fires the in-flight Gemini stream is aborted and the turn
   * ends with `done` reason `wallclock-exceeded`. Defaults to DEFAULT_WALL_CLOCK_MS.
   */
  wallClockMs?: number;
  /**
   * Optional. Per-iteration sampling temperature. Defaults to 0.3 (chat).
   * The canvas-agent preview endpoint pins 0.2 for slightly tighter output.
   */
  temperature?: number;
  /**
   * Optional. Token-budget ceiling on accumulated history (ADR 0055 dec 2).
   * When trim cannot get history under this cap (verified precisely via
   * `countTokens` once the cheap estimate is within 20%), the turn ends
   * with `tokens-exceeded`. Defaults to CHAT_TOKEN_BUDGET. Smokes use this
   * to pin a deterministic budget without depending on the global constant.
   */
  tokenBudget?: number;
  /**
   * Optional. Replicate API token. Required iff the `generateImage` tool is
   * exposed in `tools` — without it the orchestrator throws a loud error on
   * dispatch. Threaded from the chat route which reads the binding from
   * Cloudflare env. Smokes omit this and exclude `generateImage` from tools.
   */
  replicateToken?: string;
  /**
   * Optional. Replicate-client injection seam. Production omits this so the
   * dispatcher uses the real `generateImageViaReplicate` over fetch; smokes
   * inject a stub that returns canned bytes without hitting the network.
   * Same signature as the real helper so the swap is type-checked.
   */
  replicateClient?: (
    token: string,
    prompt: string,
    aspectRatio: string,
  ) => Promise<{ bytes: Uint8Array; mediaType: string }>;
}

export interface RunTurnInput {
  session: ChatSessionState;
  userMessage: string;
  writer: ChatStreamWriter;
  ctx: OrchestratorContext;
}

export interface RunTurnResult {
  /** Updated message history after the turn (already trimmed + summarised). */
  messages: ChatMessage[];
  /** Ops emitted as op-preview events during this turn. */
  previewOps: Array<{ id: string; toolName: string; op: CanvasAgentOp }>;
  /** Reason the loop stopped — mirrors the `done` event. */
  doneReason:
    | 'stop'
    | 'length'
    | 'tool_use'
    | 'safety'
    | 'other'
    | 'tool-call-cap'
    | 'tokens-exceeded'
    | 'summarise-failed'
    | 'wallclock-exceeded';
}

/**
 * Drive one Owner ↔ Agent turn end-to-end. Mutates nothing externally — the
 * caller persists the returned `messages` array via `saveMessages()`.
 */

// Telemetry helpers (ADR 0055 + ADR 0056 follow-ups). Cloudflare Workers Logs
// captures these via console.warn / console.log; the structured payload lets a
// log query slice by reason / model / iteration without parsing free text.
function logBudgetExhausted(payload: {
  sessionId: string;
  reason: RunTurnResult['doneReason'];
  iteration: number;
  toolCallBudget: number;
  wallClockMs: number;
}): void {
  console.warn('[chat/orchestrator] ADR-0055 budget exhausted', payload);
}

function logIterationTier(payload: {
  sessionId: string;
  iteration: number;
  model: string;
  reactedToReadOnly: boolean;
}): void {
  console.log('[chat/orchestrator] ADR-0056 tier choice', payload);
}

export async function runChatTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const { session, userMessage, writer, ctx } = input;
  const tools = ctx.tools ?? CHAT_AGENT_TOOLS;
  const model = ctx.model ?? CHAT_DEFAULT_MODEL;
  const systemInstruction =
    ctx.systemInstruction ?? buildSystemPrompt(ctx.state, ctx.selectedElementId);
  const toolCallBudget = ctx.toolCallBudget ?? TOOL_CALL_SAFETY_NET;
  const wallClockMs = ctx.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const temperature = ctx.temperature ?? 0.3;
  const tokenBudget = ctx.tokenBudget ?? CHAT_TOKEN_BUDGET;

  // 1. Append the user message to history.
  let history: ChatMessage[] = [...session.messages, { role: 'user', content: userMessage }];

  // 2. Per ADR 0055 decision 6, every Gemini call in this turn shares one
  //    AbortController. The deadline timer fires once; if it trips during the
  //    summarise call OR any iteration, the adapter's stream throws and the
  //    nearest catch maps it to `wallclock-exceeded`. The Owner's appended
  //    message is preserved in `history` so the caller still persists it.
  const controller = new AbortController();
  const deadlineTimer = setTimeout(() => controller.abort(), wallClockMs);

  const previewOps: Array<{ id: string; toolName: string; op: CanvasAgentOp }> = [];
  let doneReason: RunTurnResult['doneReason'] = 'stop';
  let iteration = 0;
  // ADR 0056 decision 2: reactive Flash routing. After iteration N's tool
  // calls land, if every call was read-only, iteration N+1 runs on Flash.
  // Iteration 1 always starts on Pro — the planning decision belongs there.
  let lastIterationWasReadOnlyOnly = false;

  try {
    // 3. Compact when we've crossed the summarise threshold. Summarisation
    //    runs only on the older pre-cutoff slice so the active turn stays
    //    intact. Per ADR 0055 decision 5 summarisation failure is loud; per
    //    ADR 0055 decision 6 a wall-clock abort during summarisation is
    //    surfaced as `wallclock-exceeded`, not `summarise-failed`.
    if (countTurns(history) >= SUMMARIZE_AFTER_TURNS) {
      try {
        // ADR 0056 decision 1: summarisation always runs on Flash regardless
        // of the orchestrator's primary model. Constrained synthesis, no
        // tools, no chained reasoning — Pro is wasted here.
        history = await summariseIfNeeded(
          history,
          ctx.adapter,
          CHAT_FLASH_MODEL,
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          logBudgetExhausted({
            sessionId: session.id,
            reason: 'wallclock-exceeded',
            iteration,
            toolCallBudget,
            wallClockMs,
          });
          await writer.write({ kind: 'done', reason: 'wallclock-exceeded' });
          return { messages: history, previewOps, doneReason: 'wallclock-exceeded' };
        }
        const message = err instanceof Error ? err.message : String(err);
        logBudgetExhausted({
          sessionId: session.id,
          reason: 'summarise-failed',
          iteration,
          toolCallBudget,
          wallClockMs,
        });
        await writer.write({ kind: 'error', error: message });
        await writer.write({ kind: 'done', reason: 'summarise-failed' });
        return { messages: history, previewOps, doneReason: 'summarise-failed' };
      }
    }
    history = trimToBudget(history, tokenBudget);

    while (iteration < toolCallBudget) {
      iteration++;

      const llmMessages = toLlmMessages(history);
      const iterationModel = lastIterationWasReadOnlyOnly ? CHAT_FLASH_MODEL : model;
      logIterationTier({
        sessionId: session.id,
        iteration,
        model: iterationModel,
        reactedToReadOnly: lastIterationWasReadOnlyOnly,
      });
      const opts: ChatWithToolsOptions = {
        model: iterationModel,
        tools,
        systemInstruction,
        temperature,
        signal: controller.signal,
      };

      let pass: PassResult;
      try {
        pass = await streamOnePass(ctx.adapter, llmMessages, opts, writer);
      } catch (err) {
        if (controller.signal.aborted) {
          logBudgetExhausted({
            sessionId: session.id,
            reason: 'wallclock-exceeded',
            iteration,
            toolCallBudget,
            wallClockMs,
          });
          await writer.write({ kind: 'done', reason: 'wallclock-exceeded' });
          return { messages: history, previewOps, doneReason: 'wallclock-exceeded' };
        }
        throw err;
      }
      const { text, toolCalls, textSignature, finishReason } = pass;

      // Append the assistant turn even when it produced no tool calls — the
      // user's history needs to mirror what the model said.
      const assistantMessage: ChatMessage = { role: 'assistant', content: text };
      if (textSignature) assistantMessage.thoughtSignature = textSignature;
      if (toolCalls.length > 0) {
        assistantMessage.toolCalls = toolCalls.map<ChatToolCall>((c) => {
          const out: ChatToolCall = { id: c.id, name: c.name, arguments: c.arguments };
          if (c.thoughtSignature) out.thoughtSignature = c.thoughtSignature;
          return out;
        });
      }
      history.push(assistantMessage);

      if (toolCalls.length === 0) {
        doneReason = finishReason ?? 'stop';
        break;
      }

      // Dispatch every tool call from this turn before looping. We feed the
      // results back as `tool` messages so the next pass sees them.
      for (const call of toolCalls) {
        if (READ_ONLY_TOOL_NAMES.has(call.name)) {
          await dispatchReadOnlyTool({ call, writer, ctx, history });
        } else if (call.name === 'generateImage') {
          // The generateImage tool is mutating but its op is produced by an
          // async Replicate call, not a pure parse. Special-cased so the await
          // happens inline and any failure surfaces as a loud SSE error event.
          const dispatched = await dispatchGenerateImage({ call, ctx, history, writer });
          if (dispatched.preview) {
            const event: Extract<
              Parameters<ChatStreamWriter['write']>[0],
              { kind: 'op-preview' }
            > = {
              kind: 'op-preview',
              id: call.id,
              toolName: call.name,
              op: dispatched.preview.op,
            };
            await writer.write(event);
            previewOps.push({ id: call.id, toolName: call.name, op: dispatched.preview.op });
          }
        } else if (MUTATING_TOOL_NAMES.has(call.name)) {
          const dispatched = dispatchMutatingTool({ call, history });
          if (dispatched.preview) {
            let previewSection: CanvasSection | undefined;
            try {
              previewSection = resolvePreviewSection(dispatched.preview.op, ctx.state);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              await writer.write({ kind: 'error', error: message });
              history.push({
                role: 'tool',
                toolCallId: call.id,
                toolName: call.name,
                content: JSON.stringify({ error: message }),
              });
              await writer.write({ kind: 'done', reason: 'other' });
              return { messages: history, previewOps, doneReason: 'other' };
            }
            const event: Extract<
              Parameters<ChatStreamWriter['write']>[0],
              { kind: 'op-preview' }
            > = {
              kind: 'op-preview',
              id: call.id,
              toolName: call.name,
              op: dispatched.preview.op,
            };
            if (previewSection) event.previewSection = previewSection;
            await writer.write(event);
            previewOps.push({ id: call.id, toolName: call.name, op: dispatched.preview.op });
          }
        } else {
          const errMsg = `unknown tool name: ${call.name}`;
          await writer.write({ kind: 'error', error: errMsg });
          history.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: JSON.stringify({ error: errMsg }),
          });
        }
      }

      // ADR 0056 decision 2: classify this iteration for next-iteration
      // routing. Read-only-only → next iteration runs on Flash; anything
      // else (mutating, mixed, unknown) → next iteration stays on Pro.
      lastIterationWasReadOnlyOnly = toolCalls.every((call) => READ_ONLY_TOOL_NAMES.has(call.name));

      // Per ADR 0055 decision 4, re-trim after every tool dispatch — a large
      // query_site / query_assets result can land mid-iteration and blow the
      // token budget for the next pass. The trimmer drops oldest non-system,
      // non-summary messages; the active turn at the tail stays pinned.
      history = trimToBudget(history, tokenBudget);

      // Per ADR 0055 decision 2+3, decide token-exhaustion with the cheap
      // length/4 estimate as a pre-filter and only call Gemini's countTokens
      // when the cheap estimate signals we're within 20% of the cap. Bounds
      // the API round-trip cost to at most once per turn.
      let overBudget: boolean;
      try {
        overBudget = await isOverTokenBudget({
          adapter: ctx.adapter,
          history,
          model,
          systemInstruction,
          tools,
          signal: controller.signal,
          tokenBudget,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          logBudgetExhausted({
            sessionId: session.id,
            reason: 'wallclock-exceeded',
            iteration,
            toolCallBudget,
            wallClockMs,
          });
          await writer.write({ kind: 'done', reason: 'wallclock-exceeded' });
          return { messages: history, previewOps, doneReason: 'wallclock-exceeded' };
        }
        throw err;
      }
      if (controller.signal.aborted) {
        logBudgetExhausted({
          sessionId: session.id,
          reason: 'wallclock-exceeded',
          iteration,
          toolCallBudget,
          wallClockMs,
        });
        await writer.write({ kind: 'done', reason: 'wallclock-exceeded' });
        return { messages: history, previewOps, doneReason: 'wallclock-exceeded' };
      }
      if (overBudget) {
        logBudgetExhausted({
          sessionId: session.id,
          reason: 'tokens-exceeded',
          iteration,
          toolCallBudget,
          wallClockMs,
        });
        await writer.write({ kind: 'done', reason: 'tokens-exceeded' });
        return { messages: history, previewOps, doneReason: 'tokens-exceeded' };
      }

      // Safety net: a degenerate loop calling the same tool over and over
      // exits here. Real work completes well below this ceiling. Per ADR 0056
      // follow-up F, no separate "next turn forced to Pro" escalation is
      // needed — `lastIterationWasReadOnlyOnly` is scoped to this turn and
      // resets to false on the next runChatTurn call, so the next turn's
      // iteration 1 always starts on Pro by default.
      if (iteration >= toolCallBudget) {
        doneReason = 'tool-call-cap';
        logBudgetExhausted({
          sessionId: session.id,
          reason: 'tool-call-cap',
          iteration,
          toolCallBudget,
          wallClockMs,
        });
        break;
      }
    }

    await writer.write({ kind: 'done', reason: doneReason });

    return {
      messages: history,
      previewOps,
      doneReason,
    };
  } finally {
    clearTimeout(deadlineTimer);
  }
}

// ---------------------------------------------------------------------------
// Single LLM pass — drain the stream and re-emit token + tool-call events.
// ---------------------------------------------------------------------------

interface PassResult {
  text: string;
  toolCalls: LlmAssistantToolCall[];
  /** Text-part thoughtSignature from Gemini 3.x; persisted on the assistant message for next-turn replay. */
  textSignature?: string;
  finishReason?: RunTurnResult['doneReason'];
}

async function streamOnePass(
  adapter: LlmAdapter,
  messages: LlmMessage[],
  opts: ChatWithToolsOptions,
  writer: ChatStreamWriter,
): Promise<PassResult> {
  const toolCalls: LlmAssistantToolCall[] = [];
  let text = '';
  // Gemini emits the text-part thoughtSignature on the final text chunk only,
  // so a "last non-empty wins" capture matches the spec.
  let textSignature: string | undefined;
  let finishReason: RunTurnResult['doneReason'] | undefined;

  for await (const chunk of adapter.chatWithTools(messages, opts)) {
    if (chunk.type === 'text') {
      text += chunk.text;
      if (chunk.thoughtSignature) textSignature = chunk.thoughtSignature;
      await writer.write({ kind: 'token', text: chunk.text });
    } else if (chunk.type === 'tool_call') {
      const call: LlmAssistantToolCall = {
        id: chunk.id,
        name: chunk.name,
        arguments: chunk.arguments,
      };
      if (chunk.thoughtSignature) call.thoughtSignature = chunk.thoughtSignature;
      toolCalls.push(call);
      await writer.write({
        kind: 'tool-call',
        id: chunk.id,
        name: chunk.name,
        args: chunk.arguments,
      });
    } else if (chunk.type === 'done') {
      finishReason = mapDoneReason(chunk.reason);
    }
  }

  const out: PassResult = { text, toolCalls };
  if (textSignature !== undefined) out.textSignature = textSignature;
  if (finishReason !== undefined) out.finishReason = finishReason;
  return out;
}

function mapDoneReason(
  reason: Extract<LlmChunk, { type: 'done' }>['reason'],
): RunTurnResult['doneReason'] {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'safety') return 'safety';
  return 'other';
}

// ---------------------------------------------------------------------------
// Read-only tool dispatch — query_site
// ---------------------------------------------------------------------------

interface ReadOnlyDispatchInput {
  call: LlmAssistantToolCall;
  writer: ChatStreamWriter;
  ctx: OrchestratorContext;
  history: ChatMessage[];
}

async function dispatchReadOnlyTool(input: ReadOnlyDispatchInput): Promise<void> {
  const { call, writer, ctx, history } = input;
  const args = isRecord(call.arguments) ? call.arguments : {};

  let output: unknown;

  if (call.name === 'query_site') {
    // Default to 'full' so the agent always sees per-element ids in its
    // first inspection. With 'summary' the model only sees per-section
    // element-type counts and then hallucinates element ids when proposing
    // mutating ops; every such op fails at the apply layer with
    // 'element not found'. The token-cap inside buildQuerySiteSummary
    // protects the budget on large sites by trimming element listings,
    // then trailing sections, then trailing pages.
    const requested = args.detail;
    const detail: QuerySiteDetail = requested === 'summary' ? 'summary' : 'full';
    output = buildQuerySiteSummary({
      state: ctx.state,
      detail,
      fonts: ctx.fonts ?? [],
    });
  } else if (call.name === 'query_assets') {
    const assets = ctx.assets ?? [];
    const limit =
      typeof args.limit === 'number' && Number.isFinite(args.limit)
        ? Math.min(Math.max(1, args.limit), 200)
        : 50;
    const sliced = assets.slice(0, limit);
    output = {
      assets: sliced.map((a) => ({
        id: a.id,
        kind: a.kind,
        alt: a.alt,
        contentHash: a.contentHash,
        ...(a.width != null ? { width: a.width } : {}),
        ...(a.height != null ? { height: a.height } : {}),
      })),
      total: assets.length,
      truncated: assets.length > limit,
    };
  } else {
    const err = `unsupported read-only tool: ${call.name}`;
    await writer.write({ kind: 'error', error: err });
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: err }),
    });
    return;
  }

  const outputJson = JSON.stringify(output);
  await writer.write({
    kind: 'tool-result',
    id: call.id,
    name: call.name,
    output,
  });
  history.push({
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: outputJson,
  });
}

// ---------------------------------------------------------------------------
// Mutating tool dispatch — translate to CanvasAgentOp + emit preview
// ---------------------------------------------------------------------------

interface MutatingDispatchInput {
  call: LlmAssistantToolCall;
  history: ChatMessage[];
}

interface MutatingDispatchResult {
  preview?: { op: CanvasAgentOp };
}

function dispatchMutatingTool(input: MutatingDispatchInput): MutatingDispatchResult {
  const { call, history } = input;
  const parsed = translateToolCall(call);
  if (!parsed.ok) {
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: parsed.error }),
    });
    return {};
  }
  history.push({
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: JSON.stringify({ ok: true, preview: true, op: parsed.op }),
  });
  return { preview: { op: parsed.op } };
}

// ---------------------------------------------------------------------------
// generateImage dispatch — call Replicate, emit op-preview with inline bytes
// ---------------------------------------------------------------------------
//
// Separate from `dispatchMutatingTool` because the op cannot be built purely
// from the tool call arguments — flux-schnell must run first and the bytes
// ride on the op-preview payload (ADR 0004 D2). Every failure path here is
// loud: a missing REPLICATE_API_TOKEN, an unresolvable target, a Replicate
// error, or an oversize response all emit an `error` SSE event and a tool
// message describing the failure so the next pass can react.

interface GenerateImageDispatchInput {
  call: LlmAssistantToolCall;
  ctx: OrchestratorContext;
  history: ChatMessage[];
  writer: ChatStreamWriter;
}

interface GenerateImageDispatchResult {
  preview?: { op: CanvasAgentOp };
}

interface GenerateImageArgs {
  prompt: string;
  alt: string;
  target:
    | { mode: 'replace'; elementId: string; boxW: number; boxH: number }
    | {
        mode: 'add';
        sectionId: string;
        // ADD-mode always carries a box now: either the model passed one or
        // the orchestrator computed a media-shaped default during parse so the
        // ghost overlay has a slot to paint into.
        box: { x: number; y: number; w: number; h: number };
        aspectW: number;
        aspectH: number;
      };
}

function parseGenerateImageArgs(
  args: unknown,
  state: EditableSite,
): { ok: true; value: GenerateImageArgs } | { ok: false; error: string } {
  if (!isRecord(args)) return { ok: false, error: 'generateImage: arguments must be an object' };
  const prompt = args.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { ok: false, error: 'generateImage: prompt is required (non-empty string)' };
  }
  const altRaw = args.alt;
  const alt = typeof altRaw === 'string' && altRaw.length > 0 ? altRaw : prompt;
  const elementIdRaw = args.elementId;
  const sectionIdRaw = args.sectionId;
  const hasElement = typeof elementIdRaw === 'string' && elementIdRaw.length > 0;
  const hasSection = typeof sectionIdRaw === 'string' && sectionIdRaw.length > 0;
  if (hasElement === hasSection) {
    return {
      ok: false,
      error: 'generateImage: provide exactly one of elementId (replace) or sectionId (add)',
    };
  }
  if (hasElement) {
    const elementId = elementIdRaw;
    const found = findMediaElementForGenerate(state, elementId);
    if (!found) {
      return {
        ok: false,
        error: `generateImage: element ${elementId} not found or not a media element`,
      };
    }
    const { box } = found;
    if (!box || !Number.isFinite(box.w) || !Number.isFinite(box.h) || box.w <= 0 || box.h <= 0) {
      return {
        ok: false,
        error: `generateImage: media element ${elementId} has no measurable box — resize the slot before generating`,
      };
    }
    return {
      ok: true,
      value: { prompt, alt, target: { mode: 'replace', elementId, boxW: box.w, boxH: box.h } },
    };
  }
  // hasSection is true here (the hasElement===hasSection early-return and the
  // hasElement branch above both terminate), but TS's alias narrowing only
  // ties hasSection back to sectionIdRaw inside `if (hasSection)`, so re-state
  // the guard so the literal narrows to string.
  if (typeof sectionIdRaw !== 'string' || sectionIdRaw.length === 0) {
    return { ok: false, error: 'generateImage: sectionId is required (non-empty string)' };
  }
  const sectionId: string = sectionIdRaw;
  if (!sectionExists(state, sectionId)) {
    return { ok: false, error: `generateImage: section ${sectionId} not found` };
  }
  const boxRaw = args.box;
  let box: { x: number; y: number; w: number; h: number };
  let aspectW: number;
  let aspectH: number;
  if (boxRaw === undefined || boxRaw === null) {
    // Server-computed default mirrors applyCanvasAgentOp's `addElement`
    // auto-placement: x=40, y=bottomY+20 (below the lowest existing element
    // in the section), with media-tailored dimensions (480x270 / 16:9) so
    // the Replicate aspect-ratio snap lands on a useful preset and the
    // editor's ghost overlay paints at a meaningful size. Carrying the box
    // on the op-preview also lets the editor render the ghost at the same
    // slot the eventual addElement will land in.
    box = computeDefaultAddBox(state, sectionId);
    aspectW = box.w;
    aspectH = box.h;
  } else if (!isRecord(boxRaw)) {
    return { ok: false, error: 'generateImage: box must be an object' };
  } else {
    const { x, y, w, h } = boxRaw;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof w !== 'number' ||
      typeof h !== 'number'
    ) {
      return { ok: false, error: 'generateImage: box.x, .y, .w, .h must all be numbers' };
    }
    if (w <= 0 || h <= 0 || !Number.isFinite(w) || !Number.isFinite(h)) {
      return { ok: false, error: 'generateImage: box.w and box.h must be positive finite numbers' };
    }
    box = { x, y, w, h };
    aspectW = w;
    aspectH = h;
  }
  const addTarget: Extract<GenerateImageArgs['target'], { mode: 'add' }> = {
    mode: 'add',
    sectionId,
    aspectW,
    aspectH,
    box,
  };
  return { ok: true, value: { prompt, alt, target: addTarget } };
}

/**
 * Compute a default box for ADD-mode `generateImage` when the model omits
 * one. Mirrors `applyCanvasAgentOp(addElement)` auto-placement: x=40,
 * y=bottomY+20, dimensions tailored for media (480x270 / 16:9). The box
 * rides on the op-preview so the editor's ghost overlay paints at the slot
 * the eventual addElement will occupy, instead of fighting the apply path's
 * later default.
 */
function computeDefaultAddBox(
  state: EditableSite,
  sectionId: string,
): { x: number; y: number; w: number; h: number } {
  const section = findSectionForGenerate(state, sectionId);
  if (!section) {
    // sectionExists has already verified this path; getting here means a
    // race between parse and compute, which is impossible in this codepath.
    // Throw loudly rather than silently returning a guess.
    throw new Error(
      `computeDefaultAddBox: section ${sectionId} disappeared between validation and box computation`,
    );
  }
  let bottomY = 40;
  for (const el of section.elements) {
    const eb = (el as { box?: { y?: unknown; h?: unknown } }).box;
    if (!eb) continue;
    if (typeof eb.y !== 'number' || typeof eb.h !== 'number') continue;
    const elBottom = eb.y + eb.h;
    if (elBottom > bottomY) bottomY = elBottom;
  }
  return { x: 40, y: bottomY + 20, w: 480, h: 270 };
}

function findSectionForGenerate(
  state: EditableSite,
  sectionId: string,
): { elements: ReadonlyArray<unknown> } | null {
  if (state.header && state.header.id === sectionId) return state.header;
  if (state.footer && state.footer.id === sectionId) return state.footer;
  for (const page of state.pages) {
    for (const section of page.sections) {
      if (section.id === sectionId) return section;
    }
  }
  return null;
}

function findMediaElementForGenerate(
  state: EditableSite,
  elementId: string,
): { box: { w: number; h: number } } | null {
  function scan(section: { elements: ReadonlyArray<{ id: string; type: string; box?: unknown }> }):
    | { box: { w: number; h: number } }
    | null {
    for (const el of section.elements) {
      if (el.id !== elementId) continue;
      if (el.type !== 'media') return null;
      const box = el.box;
      if (
        !isRecord(box) ||
        typeof box.w !== 'number' ||
        typeof box.h !== 'number'
      ) {
        return null;
      }
      return { box: { w: box.w, h: box.h } };
    }
    return null;
  }
  if (state.header) {
    const hit = scan(state.header);
    if (hit) return hit;
  }
  if (state.footer) {
    const hit = scan(state.footer);
    if (hit) return hit;
  }
  for (const page of state.pages) {
    for (const section of page.sections) {
      const hit = scan(section);
      if (hit) return hit;
    }
  }
  return null;
}

function sectionExists(state: EditableSite, sectionId: string): boolean {
  if (state.header && state.header.id === sectionId) return true;
  if (state.footer && state.footer.id === sectionId) return true;
  for (const page of state.pages) {
    for (const section of page.sections) {
      if (section.id === sectionId) return true;
    }
  }
  return false;
}

async function dispatchGenerateImage(
  input: GenerateImageDispatchInput,
): Promise<GenerateImageDispatchResult> {
  const { call, ctx, history, writer } = input;
  const token = ctx.replicateToken;
  if (typeof token !== 'string' || token.length === 0) {
    const errMsg = 'generateImage: REPLICATE_API_TOKEN binding is missing on this deployment';
    await writer.write({ kind: 'error', error: errMsg });
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: errMsg }),
    });
    return {};
  }
  const parsed = parseGenerateImageArgs(call.arguments, ctx.state);
  if (!parsed.ok) {
    await writer.write({ kind: 'error', error: parsed.error });
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: parsed.error }),
    });
    return {};
  }
  const { prompt, alt, target } = parsed.value;
  const aspectRatio =
    target.mode === 'replace'
      ? snapToFluxAspectRatio(target.boxW, target.boxH)
      : snapToFluxAspectRatio(target.aspectW, target.aspectH);
  const replicateClient = ctx.replicateClient ?? generateImageViaReplicate;
  let image;
  try {
    image = await replicateClient(token, prompt, aspectRatio);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writer.write({ kind: 'error', error: `generateImage: ${message}` });
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: message }),
    });
    return {};
  }
  if (image.bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    const errMsg = `generateImage: generated asset too large (${String(image.bytes.byteLength)} bytes; cap is ${String(MAX_GENERATED_IMAGE_BYTES)})`;
    await writer.write({ kind: 'error', error: errMsg });
    history.push({
      role: 'tool',
      toolCallId: call.id,
      toolName: call.name,
      content: JSON.stringify({ error: errMsg }),
    });
    return {};
  }
  const dataUrl = encodeImageDataUrl(image);
  const opTarget: Extract<CanvasAgentOp, { kind: 'placeGeneratedImage' }>['target'] =
    target.mode === 'replace'
      ? { mode: 'replace', elementId: target.elementId }
      : { mode: 'add', sectionId: target.sectionId, box: target.box };
  const op: CanvasAgentOp = {
    kind: 'placeGeneratedImage',
    target: opTarget,
    prompt,
    alt,
    dataUrl,
    mediaType: image.mediaType,
    aspectRatio,
  };
  // Per the surrounding tool-call pattern, the assistant turn that emitted
  // this call already pushed onto history before the dispatch loop; we now
  // push a synthetic tool result so the next pass sees the success. The
  // bytes themselves stay out of history — they would balloon the token
  // budget and the model never needs to read them.
  history.push({
    role: 'tool',
    toolCallId: call.id,
    toolName: call.name,
    content: JSON.stringify({
      ok: true,
      preview: true,
      generated: { mediaType: image.mediaType, aspectRatio, byteLength: image.bytes.byteLength },
    }),
  });
  return { preview: { op } };
}

/**
 * Resolve a server-side CanvasSection preview for additive section ops so
 * the editor can ghost-render it in place between existing sections. Returns
 * undefined for op kinds where in-place ghosting is not part of Phase A
 * (delete*, update*, addElement, addPage, setStyleKit, setSiteConfig,
 * moveSection, rewriteText, replaceMedia).
 *
 * Resolution rules:
 *   - insertSection  → createSectionFromRecipe (pure factory)
 *   - designSection  → resolveDesignSection against the target page's width
 *                      and the resolved Style Kit (custom kit handled via
 *                      resolveStyleKitWithCustom, mirroring applyCanvasAgentOp)
 *   - duplicateSection → clone the targeted section from state with new ids
 *
 * Failures are loud. The ghost is the Owner's preview of what Accept will do,
 * so resolution must mirror applyCanvasAgentOp instead of silently omitting or
 * retargeting the preview section.
 */
function resolvePreviewSection(
  op: CanvasAgentOp,
  state: EditableSite,
): CanvasSection | undefined {
  if (op.kind === 'insertSection') {
    resolvePreviewInsertionPage(state, op.pageId ?? null, op.afterSectionId, 'insertSection');
    return createSectionFromRecipe(op.recipeId, op.input);
  }
  if (op.kind === 'designSection') {
    const targetPage = resolvePreviewInsertionPage(
      state,
      op.pageId ?? null,
      op.afterSectionId,
      'designSection',
    );
    const preset = resolveStyleKitWithCustom(state);
    const result = resolveDesignSection(op.input, targetPage.width, preset);
    return result.section;
  }
  if (op.kind === 'duplicateSection') {
    return cloneSectionForPreview(state, op.sectionId);
  }
  return undefined;
}

function resolvePreviewInsertionPage(
  state: EditableSite,
  opPageId: string | null | undefined,
  opAfterSectionId: string | null,
  kindLabel: string,
): CanvasPage {
  const firstPage = state.pages[0];
  if (!firstPage) {
    throw new Error('resolvePreviewSection: state must have at least one page');
  }
  if (typeof opPageId === 'string' && opPageId.length > 0) {
    const target = state.pages.find((p) => p.id === opPageId);
    if (!target) {
      throw new Error(
        `resolvePreviewSection(${kindLabel}): pageId not found: ${opPageId}. Known pages: ${state.pages
          .map((p) => p.id)
          .join(', ')}`,
      );
    }
    if (
      typeof opAfterSectionId === 'string' &&
      opAfterSectionId.length > 0 &&
      !target.sections.some((s) => s.id === opAfterSectionId)
    ) {
      throw new Error(
        `resolvePreviewSection(${kindLabel}): afterSectionId ${opAfterSectionId} does not exist on page ${opPageId}`,
      );
    }
    return target;
  }
  if (typeof opAfterSectionId === 'string' && opAfterSectionId.length > 0) {
    const target = state.pages.find((p) => p.sections.some((s) => s.id === opAfterSectionId));
    if (!target) {
      throw new Error(
        `resolvePreviewSection(${kindLabel}): afterSectionId not found on any page: ${opAfterSectionId}`,
      );
    }
    return target;
  }
  return firstPage;
}

function cloneSectionForPreview(
  state: EditableSite,
  sectionId: string,
): CanvasSection {
  for (const page of state.pages) {
    const found = page.sections.find((s) => s.id === sectionId);
    if (found) {
      const clone = structuredClone(found);
      clone.id = `sec-${clone.recipeId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      clone.name = `${found.name} copy`;
      for (const el of clone.elements) {
        const prefix = el.id.includes('-') ? el.id.split('-').slice(0, -1).join('-') : 'el';
        el.id = `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      }
      if (clone.role) delete clone.role;
      return clone;
    }
  }
  if (state.header && state.header.id === sectionId) {
    throw new Error('resolvePreviewSection(duplicateSection): cannot duplicate header or footer');
  }
  if (state.footer && state.footer.id === sectionId) {
    throw new Error('resolvePreviewSection(duplicateSection): cannot duplicate header or footer');
  }
  throw new Error(`resolvePreviewSection(duplicateSection): section not found: ${sectionId}`);
}

// ---------------------------------------------------------------------------
// History → LlmMessage[] translation
// ---------------------------------------------------------------------------

export function toLlmMessages(history: readonly ChatMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const msg of history) {
    if (msg.role === 'system' || msg.role === 'summary') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    if (msg.role === 'assistant') {
      const assistant: Extract<LlmMessage, { role: 'assistant' }> = {
        role: 'assistant',
        content: msg.content,
      };
      if (msg.thoughtSignature) assistant.thoughtSignature = msg.thoughtSignature;
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistant.toolCalls = msg.toolCalls.map((c) => {
          const llmCall: LlmAssistantToolCall = { id: c.id, name: c.name, arguments: c.arguments };
          if (c.thoughtSignature) llmCall.thoughtSignature = c.thoughtSignature;
          return llmCall;
        });
      }
      out.push(assistant);
      continue;
    }
    if (msg.role === 'tool') {
      if (msg.toolCallId === undefined || msg.toolName === undefined) {
        throw new Error('chat orchestrator: tool message missing toolCallId / toolName');
      }
      out.push({
        role: 'tool',
        toolCallId: msg.toolCallId,
        toolName: msg.toolName,
        content: msg.content,
      });
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the chat-orchestrator system prompt from the current site state.
 * Uses domain language from CONTEXT.md verbatim — Owner, Editable Site,
 * Canvas Page, Canvas Section, Content Element, Section Recipe, Style Kit.
 */
function findElementSummary(
  state: EditableSite,
  elementId: string,
): { type: string; sectionName: string; pageTitle: string } | null {
  if (state.header) {
    for (const el of state.header.elements) {
      if (el.id === elementId) {
        return { type: el.type, sectionName: state.header.name ?? 'header', pageTitle: '(global)' };
      }
    }
  }
  if (state.footer) {
    for (const el of state.footer.elements) {
      if (el.id === elementId) {
        return { type: el.type, sectionName: state.footer.name ?? 'footer', pageTitle: '(global)' };
      }
    }
  }
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const el of section.elements) {
        if (el.id === elementId) {
          return {
            type: el.type,
            sectionName: section.name ?? section.id,
            pageTitle: page.title ?? page.id,
          };
        }
      }
    }
  }
  return null;
}

export function buildSystemPrompt(state: EditableSite, selectedElementId?: string): string {
  const lines: string[] = [];
  lines.push(
    'You are the Agent for the Open Canvas site builder — an AI collaborator that changes an Editable Site only from an Owner request.',
  );
  lines.push(
    'Every change you propose is shown to the Owner as a preview; the Owner accepts or rejects before it applies to the site.',
  );
  lines.push(
    'You speak in terms of: Owner, Visitor, Editable Site, Canvas Page, Canvas Section, Content Element, Style Kit, Agent Edit.',
  );
  lines.push('');
  lines.push('Behaviour rules — must follow exactly:');
  lines.push(
    '  1. If the Owner instructs you not to modify the site (e.g. "do not change anything", "only answer questions", "no edits"), call ONLY read-only tools (query_site, query_assets) and reply in plain text. Do not call any mutating tool, even if asked to "describe a change" — describing one in prose is fine; emitting a tool call is not.',
  );
  lines.push(
    '  2. Tool calls are proposals, not actions. The Owner accepts or rejects before anything applies. Phrase every reply about a mutating tool call in future / proposal tense: "Here\'s a proposed change…", "I can enlarge the heading to…", "Tell me to apply this and I will…". NEVER use past or completed tense ("I\'ve made", "I changed", "I updated", "Done", "Applied") for a proposal still pending Owner accept — that is a lie about the site\'s state.',
  );
  lines.push(
    '  3. Past tense becomes accurate only AFTER a tool call has been accepted. Until then, the Editable Site is unchanged.',
  );
  lines.push(
    '  4. Make a confident default choice. Vague Owner requests are normal — Owners often do not know exactly what they want. Resolve ambiguity yourself: pick a sensible interpretation, propose the change, and let the Owner judge the result. The preview/Accept/Reject loop is cheap; iterating from a concrete proposal is faster than iterating from a clarifying question.',
  );
  lines.push(
    '  5. Ask a clarifying question ONLY when two reasonable interpretations of the request would produce meaningfully different results AND you cannot tell which the Owner wants. Examples that justify asking: "delete the page" when there are multiple pages with similar names; "make it blue" when the Owner could mean text colour, background, or accent. Examples that do NOT justify asking: "add a hiring section" (pick a reasonable layout and propose it); "make the hero punchier" (rewrite with confident editorial judgement); "give it a darker feel" (propose a setStyleKit to a dark kit or a Pinned Style tweak). When in doubt, propose — never ask "what would you like the text to say?" or "how big should the heading be?" — make a choice.',
  );
  lines.push(
    '  6. When you do need to ask, ask ONE focused question. Never lead with a wall of questions. Multiple back-and-forth turns are cheap; bombarding the Owner is not.',
  );
  lines.push('');
  lines.push('Reply structure — must follow exactly:');
  lines.push(
    '  A. Open with a SHORT acknowledgement of the request before emitting any mutating tool call. One short phrase only, e.g. "Got it.", "On it.", "Sure — proposing this now.". Do NOT enumerate or describe the proposals you are about to make. The Owner sees each proposal rendered as its own card; pre-announcing them duplicates the UI.',
  );
  lines.push(
    '  B. Emit your tool calls. Do not narrate between them. Do not write sentences like "First, I\'ll propose...", "After that, I\'ll propose...", "Now I\'ll add..." — the cards speak for themselves.',
  );
  lines.push(
    '  C. After the last tool call for the turn, close with ONE short sentence summarising what was proposed and inviting feedback, e.g. "I\'ve proposed a new Manifesto page and a hero section — let me know if you\'d like changes." Keep proposal-tense ("proposed", "suggested"), never accepted-tense.',
  );
  lines.push(
    '  D. For read-only or question-answering turns (no mutating tool calls), reply in normal prose. The acknowledgement-then-summary rule only applies when at least one mutating tool call is emitted.',
  );
  lines.push('');
  lines.push('Read-only tools:');
  lines.push(
    '  query_site — inspect site structure (pages, sections, elements with IDs). Defaults to detail="full" so every element id is visible. Call this BEFORE proposing any element-level change. NEVER invent element ids — every rewriteText / updateElement / deleteElement target id MUST appear verbatim in a prior query_site result.',
  );
  lines.push(
    "  query_assets — list the owner's uploaded media assets. Call this when you need asset IDs for replaceMedia or addElement.",
  );
  lines.push('');
  lines.push('Mutating tools (all previewed before applying):');
  lines.push(
    '  rewriteText — rewrite text element content. content MUST be InlineRun[] — never a plain string.',
  );
  lines.push('  replaceMedia — swap a media element to an EXISTING uploaded Owner Asset.');
  lines.push(
    '  generateImage — generate a BRAND-NEW image via Replicate flux-schnell and place it. Use elementId for REPLACE mode (swap an existing image slot) or sectionId for ADD mode (append a new media element). The image is created at preview time; the Owner Asset row only persists if the Owner accepts. Use this whenever the Owner asks for an image that does not exist in their library — never invent fake assetIds for replaceMedia.',
  );
  lines.push(
    '  designSection — design a new section from a semantic layout tree (stack/grid/split).',
  );
  lines.push(
    '  updateElement — change properties of an existing element. Pass elementType matching the actual type.',
  );
  lines.push('  deleteElement — remove an element from its section.');
  lines.push(
    '  addElement — add a new element to a section. Auto-placed below existing content unless box is specified.',
  );
  lines.push(
    '  updateSection — change section name, height, background effect, or entrance animation.',
  );
  lines.push(
    '  deleteSection — remove a section (including header/footer). Cannot delete the last section on a page.',
  );
  lines.push(
    '  moveSection — reorder a body section. Pass afterSectionId (empty string = move to top).',
  );
  lines.push('  duplicateSection — clone a body section with new IDs.');
  lines.push('  addPage — create a new page with title and URL slug.');
  lines.push('  updatePage — update page title, slug, SEO metadata, locale, and other properties.');
  lines.push('  deletePage — remove a page. Cannot delete the last page.');
  lines.push(
    '  setStyleKit — switch to a built-in style kit (charcoal, orange-editorial, blue-saas, green-organic).',
  );
  lines.push(
    "  setSiteConfig — set visitorTheme ('light' | 'dark' | 'toggleable'), defaultLocale, or siteNoIndex.",
  );
  lines.push(
    "  renameToken — site-wide literal find-and-replace on visible string fields (text content, action labels, media alt, page titles). USE THIS for any \"rename X to Y everywhere\", \"swap brand name\", or \"replace all instances of …\" intent. Emit ONE renameToken op, never enumerate per-element rewriteText calls for a bulk rename — the deterministic walk is exhaustive across pages, header, footer, tabs, and collection entries. Pure substring replace; pass caseSensitive:false to match regardless of casing.",
  );
  lines.push('');
  lines.push(`Current Style Kit: ${state.styleKit}.`);
  lines.push('Do not invent IDs — call query_site or query_assets first when unsure.');
  lines.push('');
  lines.push('Architecture primer — how Open Canvas is shaped:');
  lines.push(
    '  - An Owner edits one Editable Site; a Visitor sees the Published Site at a public address. Publishing promotes the whole Editable Site to a Published Snapshot. Agent Edits change ONLY the Editable Site, never the Published Site.',
  );
  lines.push(
    '  - An Editable Site has zero-or-one Header Section, zero-or-one Footer Section, and one-or-more Canvas Pages. Header and Footer are site-pinned and shared by every page; they are NOT page sections. Body sections belong to a page.',
  );
  lines.push(
    '  - Every Section lives in the Section Library (the canonical pool). An Editable Site or Template Seed REFERENCES sections by id; it does not embed section data. The same Section can appear on multiple pages as separate Section Instances; an instance may carry a sparse Section Override that only changes the fields it touches.',
  );
  lines.push(
    '  - A Canvas Section is a bounded 2D space holding Positioned Elements (Content Elements with x/y/width/height). Element types include text, media, action, shape, container, accordion, carousel, chart, collection, form, nav, tabs, table.',
  );
  lines.push(
    '  - Style is layered: a site-wide Theme Choice picks one Style Kit (charcoal / orange-editorial / blue-saas / green-organic) which restyles every Design Primitive. A Pinned Style on a single element overrides the Style Kit for that element only and survives kit switches. Use setStyleKit to change the whole site; use updateElement for element-level Pinned Style.',
  );
  lines.push(
    "  - Media Elements reference an Owner Asset by id. Owner Assets belong to the Owner (not the site) — the same asset can appear on many sites. NEVER fabricate asset ids; always call query_assets first.",
  );
  lines.push(
    '  - The Agent Edit preview/accept loop is structural, not cosmetic: every mutating tool call you emit is a PROPOSAL. The Owner sees a preview card and either accepts (which applies the op via the apply route) or rejects (which discards it). Until accept, the Editable Site is unchanged — that is why your past-tense rule above is absolute.',
  );
  lines.push(
    '  - Collection elements (CMS) are special: their content is materialised at render time from CMS entries the Owner manages in the dashboard, NOT from inline element data. To change what a collection displays, the Owner edits CMS entries — proposing a rewriteText on a collection child element will fail.',
  );
  lines.push(
    '  - Each chat turn is one Agent Turn bounded by wall-clock, token, and tool-call budgets. When a budget exhausts the turn ends with a named done reason; the Owner sees that reason and can resume with a new ask.',
  );
  lines.push(
    'PAGE IDS: NEVER write synthetic page ids like "page_1", "page_2", "page-1". The only valid pageIds are the exact strings enumerated in the "Pages:" section above (e.g. "page-pf-home", "page-2aea8178"). If you need to refer to "the second page", look up its real id from that list. If you cannot identify the target page by id, OMIT the pageId field — most ops default to the currently-focused page.',
  );
  lines.push(
    'ARRAY FIELDS: When updating any array field on an element (e.g. nav links, carousel slides, gallery images, accordion items, tabs), the patch is FULL-REPLACE — the new array OVERWRITES the existing one entirely. To add or modify a single item, you MUST first call query_site to read the current array, then send back the complete list including the unchanged items plus your additions/changes. Sending a partial array will delete every omitted item. The apply path now rejects partial-shrink operations with an error — read it as a signal that you forgot to include existing items.',
  );

  if (selectedElementId) {
    const summary = findElementSummary(state, selectedElementId);
    lines.push('');
    if (summary) {
      lines.push(
        `Owner has currently selected element id="${selectedElementId}" (type=${summary.type}, in section "${summary.sectionName}" of page "${summary.pageTitle}").`,
      );
      lines.push(
        `When the Owner says "this", "it", "that", "the selected one", or otherwise omits an element id, resolve it to "${selectedElementId}" unless they clearly name another element. You may skip query_site for this id — it is already validated.`,
      );
    } else {
      lines.push(
        `Owner reports element id="${selectedElementId}" as currently selected, but it was not found in the current site state. Treat any "this/it/that" reference as ambiguous and call query_site to clarify before proposing changes.`,
      );
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Token-budget check — cheap estimate as pre-filter, precise countTokens
// at the cap boundary. Per ADR 0055 decision 3.
// ---------------------------------------------------------------------------

interface OverBudgetInput {
  adapter: LlmAdapter;
  history: ChatMessage[];
  model: string;
  systemInstruction: string;
  tools: LlmTool[];
  signal: AbortSignal;
  tokenBudget: number;
}

const PRECISE_COUNT_THRESHOLD = 0.8;

async function isOverTokenBudget(input: OverBudgetInput): Promise<boolean> {
  const cheap = estimateMessagesTokens(input.history);
  if (cheap <= input.tokenBudget * PRECISE_COUNT_THRESHOLD) {
    // Comfortably under the cap; don't burn an API call.
    return false;
  }
  // At the cap boundary the Gemini count is authoritative. The length/4
  // estimate can be high on tool-result JSON; using it as a hard stop would
  // end turns the real model context can still accept.
  const precise = await input.adapter.countTokens(toLlmMessages(input.history), {
    model: input.model,
    systemInstruction: input.systemInstruction,
    tools: input.tools,
    signal: input.signal,
  });
  return precise > input.tokenBudget;
}

// ---------------------------------------------------------------------------
// Summarisation step — replaces older turns with a synthesised summary
// once the session crosses the SUMMARIZE_AFTER_TURNS threshold.
// ---------------------------------------------------------------------------

/**
 * Run the summarisation step on `history`, returning a new array with the
 * old turns replaced by a synthesised `summary` message. Exported so the
 * Flash-summarisation integration smoke (ADR 0056 follow-up) can call the
 * exact production code path without duplicating the prompt format.
 *
 * Throws when the summarisation call returns empty / errors — the caller in
 * `runChatTurn` maps that to a loud `done(summarise-failed)`.
 */
export async function summariseIfNeeded(
  history: ChatMessage[],
  adapter: LlmAdapter,
  model: string,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  // Already summarised? The leading message is a `summary` row — skip.
  const head = history[0];
  if (head && head.role === 'summary') return history;

  // Build a summarisation prompt from the existing history (excluding the
  // active turn — keep the last user message un-summarised).
  const lastUserIdx = lastIndexOf(history, (m) => m.role === 'user');
  if (lastUserIdx <= 0) return history;
  const toSummarise = history.slice(0, lastUserIdx);
  if (toSummarise.length === 0) return history;

  const summarisePrompt: LlmMessage[] = [
    {
      role: 'user',
      content:
        'Summarise the following Owner ↔ Agent conversation in 6-10 short bullets. Preserve any element / section / asset ids the Agent mentioned. Output plain text.\n\n' +
        toSummarise.map((m) => `[${m.role}] ${truncate(m.content, 600)}`).join('\n'),
    },
  ];

  let summary = '';
  try {
    const summariseOpts: ChatWithToolsOptions = {
      model,
      tools: [],
      temperature: 0,
    };
    if (signal) summariseOpts.signal = signal;
    for await (const chunk of adapter.chatWithTools(summarisePrompt, summariseOpts)) {
      if (chunk.type === 'text') summary += chunk.text;
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`summarisation failed: ${reason}`);
  }
  if (summary.length === 0) {
    throw new Error('summarisation failed: model returned empty output');
  }
  return [
    { role: 'summary', content: `Earlier in this session: ${summary}` },
    ...history.slice(lastUserIdx),
  ];
}

function lastIndexOf<T>(arr: readonly T[], predicate: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== undefined && predicate(v)) return i;
  }
  return -1;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
