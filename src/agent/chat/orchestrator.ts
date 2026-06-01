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
  trimToBudget,
  type ChatMessage,
  type ChatSessionState,
  type ChatToolCall,
} from './session.js';
import type { ChatStreamWriter } from './stream.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

// Gemini 3.x added a thought_signature round-trip requirement on tool
// calls that our GeminiAdapter does not yet capture or replay, so 3.1
// returns HTTP 400 on every multi-turn tool flow. Reverted to 2.5-pro
// until the adapter is upgraded; do not bump without that work first.
export const CHAT_DEFAULT_MODEL = 'gemini-2.5-pro';
export const MAX_TOOL_CALL_ITERATIONS = 5;

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
  const systemInstruction =
    ctx.systemInstruction ?? buildSystemPrompt(ctx.state, ctx.selectedElementId);
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
