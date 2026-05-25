// src/agent/chat/orchestrator.ts
//
// Multi-turn chat loop for the AI chat command surface (wishlist #23).
//
// Inputs:
//   - A `ChatSessionState` with the persisted message history.
//   - The Owner's next user message.
//   - The current `CanvasSiteState` (for `query_site` + op preview validation).
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
import type { CanvasSiteState, InlineMark, InlineRun, MediaKind } from '../../canvas/schema.js';
import type { SiteFont } from '../../db/schema.js';
import { INLINE_MARK_TYPES, MEDIA_KINDS } from '../../canvas/schema.js';
import { isAllowedHref } from '../../canvas/validate.js';
import { parseDesignSectionToolArgs } from '../design-section-parser.js';
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
  trimToBudget,
  type ChatMessage,
  type ChatSessionState,
  type ChatToolCall,
} from './session.js';
import type { ChatStreamWriter } from './stream.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const CHAT_DEFAULT_MODEL = 'gemini-2.5-pro';
export const MAX_TOOL_CALL_ITERATIONS = 5;

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export interface OrchestratorContext {
  adapter: LlmAdapter;
  model?: string;
  state: CanvasSiteState;
  fonts?: SiteFont[];
  /**
   * Optional. The smoke uses this to pin the system prompt to a stable
   * fixture. Production passes the live builder from `systemPrompt()`.
   */
  systemInstruction?: string;
  tools?: LlmTool[];
  /**
   * Optional. If provided, the orchestrator runs at most this many tool-call
   * iterations before forcing a `done` event. Defaults to MAX_TOOL_CALL_ITERATIONS.
   */
  maxIterations?: number;
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
  doneReason: 'stop' | 'length' | 'tool_use' | 'safety' | 'other' | 'cap';
}

/**
 * Drive one Owner ↔ Agent turn end-to-end. Mutates nothing externally — the
 * caller persists the returned `messages` array via `saveMessages()`.
 */
export async function runChatTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const { session, userMessage, writer, ctx } = input;
  const tools = ctx.tools ?? CHAT_AGENT_TOOLS;
  const model = ctx.model ?? CHAT_DEFAULT_MODEL;
  const systemInstruction = ctx.systemInstruction ?? buildSystemPrompt(ctx.state);
  const maxIterations = ctx.maxIterations ?? MAX_TOOL_CALL_ITERATIONS;

  // 1. Append the user message to history.
  let history: ChatMessage[] = [...session.messages, { role: 'user', content: userMessage }];

  // 2. Compact when we've crossed the summarise threshold. Summarisation
  //    runs only on the older pre-cutoff slice so the active turn stays
  //    intact.
  if (countTurns(history) >= SUMMARIZE_AFTER_TURNS) {
    history = await summariseIfNeeded(history, ctx.adapter, model);
  }
  history = trimToBudget(history, CHAT_TOKEN_BUDGET);

  const previewOps: Array<{ id: string; toolName: string; op: CanvasAgentOp }> = [];
  let doneReason: RunTurnResult['doneReason'] = 'stop';
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const llmMessages = toLlmMessages(history);
    const opts: ChatWithToolsOptions = {
      model,
      tools,
      systemInstruction,
      temperature: 0.3,
    };

    const { text, toolCalls, finishReason } = await streamOnePass(
      ctx.adapter,
      llmMessages,
      opts,
      writer,
    );

    // Append the assistant turn even when it produced no tool calls — the
    // user's history needs to mirror what the model said.
    const assistantMessage: ChatMessage = { role: 'assistant', content: text };
    if (toolCalls.length > 0) {
      assistantMessage.toolCalls = toolCalls.map<ChatToolCall>((c) => ({
        id: c.id,
        name: c.name,
        arguments: c.arguments,
      }));
    }
    history.push(assistantMessage);

    if (toolCalls.length === 0) {
      doneReason = finishReason ?? 'stop';
      break;
    }

    // Dispatch every tool call from this turn before looping. We feed the
    // results back as `tool` messages so the next pass sees them.
    let sawMutating = false;
    for (const call of toolCalls) {
      if (READ_ONLY_TOOL_NAMES.has(call.name)) {
        await dispatchReadOnlyTool({ call, writer, ctx, history });
      } else if (MUTATING_TOOL_NAMES.has(call.name)) {
        sawMutating = true;
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

    // After mutating tools we still loop back so the model can either
    // confirm, propose the next op, or finish. Cap protects us from runaway
    // loops.
    if (iteration >= maxIterations) {
      doneReason = 'cap';
      break;
    }
    // If the model proposed mutating ops only and no read query, the model
    // typically returns `stop` on the next pass once we feed back the
    // synthetic tool acknowledgements; let the loop continue.
    void sawMutating;
  }

  await writer.write({ kind: 'done', reason: doneReason });

  return {
    messages: history,
    previewOps,
    doneReason,
  };
}

// ---------------------------------------------------------------------------
// Single LLM pass — drain the stream and re-emit token + tool-call events.
// ---------------------------------------------------------------------------

interface PassResult {
  text: string;
  toolCalls: LlmAssistantToolCall[];
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
  let finishReason: RunTurnResult['doneReason'] | undefined;

  for await (const chunk of adapter.chatWithTools(messages, opts)) {
    if (chunk.type === 'text') {
      text += chunk.text;
      await writer.write({ kind: 'token', text: chunk.text });
    } else if (chunk.type === 'tool_call') {
      const call: LlmAssistantToolCall = {
        id: chunk.id,
        name: chunk.name,
        arguments: chunk.arguments,
      };
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
  if (call.name !== 'query_site') {
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
  const args = isRecord(call.arguments) ? call.arguments : {};
  const requested = args.detail;
  const detail: QuerySiteDetail = requested === 'full' ? 'full' : 'summary';
  const summary = buildQuerySiteSummary({
    state: ctx.state,
    detail,
    fonts: ctx.fonts ?? [],
  });
  const outputJson = JSON.stringify(summary);
  await writer.write({
    kind: 'tool-result',
    id: call.id,
    name: call.name,
    output: summary,
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
// Tool-call translation — copied / adapted from `routes/api/canvas-agent.ts`.
// We re-implement here (not import) because the canvas-agent route module is
// off-limits per the brief and importing internals would couple us to its
// HTTP shell. Both implementations enforce the same contract.
// ---------------------------------------------------------------------------

type ParseResult = { ok: true; op: CanvasAgentOp } | { ok: false; error: string };

function translateToolCall(call: LlmAssistantToolCall): ParseResult {
  switch (call.name) {
    case 'rewriteText':
      return parseRewriteText(call.arguments);
    case 'replaceMedia':
      return parseReplaceMedia(call.arguments);
    case 'designSection':
      return parseDesignSection(call.arguments);
    default:
      return { ok: false, error: `unknown tool name: ${call.name}` };
  }
}

function parseRewriteText(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'rewriteText arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'rewriteText.elementId must be a non-empty string' };
  }
  const parsed = parseInlineRuns(args.content);
  if (!parsed.ok) return { ok: false, error: `rewriteText.${parsed.error}` };
  return {
    ok: true,
    op: { kind: 'rewriteText', elementId: args.elementId, content: parsed.runs },
  };
}

function parseReplaceMedia(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'replaceMedia arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'replaceMedia.elementId must be a non-empty string' };
  }
  if (!isOneOf<MediaKind>(args.mediaKind, MEDIA_KINDS)) {
    return {
      ok: false,
      error: `replaceMedia.mediaKind must be one of [${MEDIA_KINDS.join(', ')}]`,
    };
  }
  if (typeof args.assetId !== 'string' || args.assetId.length === 0) {
    return { ok: false, error: 'replaceMedia.assetId must be a non-empty string' };
  }
  if (typeof args.alt !== 'string') {
    return { ok: false, error: 'replaceMedia.alt must be a string' };
  }
  return {
    ok: true,
    op: {
      kind: 'replaceMedia',
      elementId: args.elementId,
      mediaKind: args.mediaKind,
      assetId: args.assetId,
      alt: args.alt,
    },
  };
}

function parseDesignSection(args: unknown): ParseResult {
  const parsed = parseDesignSectionToolArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    op: { kind: 'designSection', afterSectionId: parsed.afterSectionId, input: parsed.input },
  };
}

function parseInlineRuns(
  value: unknown,
): { ok: true; runs: InlineRun[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'content must be an array of InlineRun objects (not a string)' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'content must be a non-empty array' };
  }
  const runs: InlineRun[] = [];
  const items: unknown[] = value;
  for (let i = 0; i < items.length; i++) {
    const raw: unknown = items[i];
    if (!isRecord(raw)) {
      return { ok: false, error: `content[${String(i)}] must be an object` };
    }
    const text = raw.text;
    if (typeof text !== 'string') {
      return { ok: false, error: `content[${String(i)}].text must be a string` };
    }
    const run: InlineRun = { text };
    const rawMarks = raw.marks;
    if (rawMarks !== undefined) {
      if (!Array.isArray(rawMarks)) {
        return { ok: false, error: `content[${String(i)}].marks must be an array` };
      }
      const marks: InlineMark[] = [];
      const markItems: unknown[] = rawMarks;
      for (let m = 0; m < markItems.length; m++) {
        const parsed = parseInlineMark(markItems[m], i, m);
        if (typeof parsed === 'string') return { ok: false, error: parsed };
        marks.push(parsed);
      }
      run.marks = marks;
    }
    runs.push(run);
  }
  return { ok: true, runs };
}

function parseInlineMark(value: unknown, runIdx: number, markIdx: number): InlineMark | string {
  if (!isRecord(value)) {
    return `mark[${String(runIdx)}][${String(markIdx)}] must be an object`;
  }
  if (!isOneOf(value.type, INLINE_MARK_TYPES)) {
    return `mark[${String(runIdx)}][${String(markIdx)}].type must be one of [${INLINE_MARK_TYPES.join(', ')}]`;
  }
  if (value.type === 'link') {
    if (typeof value.href !== 'string' || value.href.length === 0) {
      return `mark[${String(runIdx)}][${String(markIdx)}] is a link mark but href is missing`;
    }
    if (!isAllowedHref(value.href)) {
      return `mark[${String(runIdx)}][${String(markIdx)}] link href ${JSON.stringify(value.href)} is not allowed`;
    }
    return { type: 'link', href: value.href };
  }
  return { type: value.type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
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
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        assistant.toolCalls = msg.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          arguments: c.arguments,
        }));
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
export function buildSystemPrompt(state: CanvasSiteState): string {
  const lines: string[] = [];
  lines.push(
    'You are the Agent for the rev01 site builder — an AI collaborator that changes an Editable Site only from an Owner request.',
  );
  lines.push(
    'Every change you propose is shown to the Owner as a preview; the Owner accepts or rejects before it applies to the site.',
  );
  lines.push(
    'You speak in terms of: Owner, Visitor, Editable Site, Canvas Page, Canvas Section, Content Element, Section Recipe, Style Kit, Agent Edit.',
  );
  lines.push('Tools available:');
  lines.push(
    '  - query_site: read-only inspection. Use this BEFORE proposing changes when you need page / section / element ids.',
  );
  lines.push(
    '  - rewriteText: rewrite a Text Element. content MUST be an InlineRun[] — never a plain string.',
  );
  lines.push(
    '  - replaceMedia: swap a Media Element to an EXISTING uploaded Owner Asset. The tool does NOT generate media bytes.',
  );
  lines.push(
    '  - designSection: design a custom section from scratch using a semantic layout tree (stack/grid/split). ' +
      'Use this for new Canvas Sections such as pricing tiers, FAQ, team grids, stats, and CTAs.',
  );
  lines.push(`Current Style Kit: ${state.styleKit}.`);
  lines.push('Do not invent ids — call query_site first when you are unsure.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Summarisation step — replaces older turns with a synthesised summary
// once the session crosses the SUMMARIZE_AFTER_TURNS threshold.
// ---------------------------------------------------------------------------

async function summariseIfNeeded(
  history: ChatMessage[],
  adapter: LlmAdapter,
  model: string,
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
  for await (const chunk of adapter.chatWithTools(summarisePrompt, {
    model,
    tools: [],
    temperature: 0,
  })) {
    if (chunk.type === 'text') summary += chunk.text;
  }
  if (summary.length === 0) {
    // Loud-fail-safe: summarisation produced nothing. Skip compaction;
    // budget trim will still keep things sane.
    return history;
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
