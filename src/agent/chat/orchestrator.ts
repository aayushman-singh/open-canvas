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
import type { EditableSite } from '../../canvas/schema.js';
import type { SiteFont } from '../../db/schema.js';
import { translateToolCall, isRecord } from '../tool-parsers.js';
import {
  CHAT_AGENT_TOOLS,
  MUTATING_TOOL_NAMES,
  READ_ONLY_TOOL_NAMES,
  buildQuerySiteSummary,
  type QuerySiteDetail,
} from './tools.js';
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
        } else if (MUTATING_TOOL_NAMES.has(call.name)) {
          const dispatched = dispatchMutatingTool({ call, history });
          if (dispatched.preview) {
            await writer.write({
              kind: 'op-preview',
              id: call.id,
              toolName: call.name,
              op: dispatched.preview.op,
            });
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
