// src/agent/chat/session.ts
//
// Chat session shape + persistence helpers for the AI chat multi-turn command
// surface.
//
// A ChatSession is the per-(site, customer) conversation memory the
// orchestrator turns into LlmMessage[] for each Gemini call. Messages persist
// across HTTP turns through the `chat_session` Postgres table (declared in
// `src/db/schema.ts`); the orchestrator loads + appends + saves the row
// in-band on every send-message turn.
//
// Token budget strategy:
//   * Hard cap: 16,000 tokens of rolling context. The orchestrator trims the
//     oldest user/assistant pairs off the front of `messages` until the
//     remaining payload's estimated token count fits. System prompt + the
//     active turn are always preserved.
//   * Summarisation: after the 10th completed turn the orchestrator inserts
//     a synthesised `summary` message at the front of the history and drops
//     all turns it represents. The summarisation request itself is a normal
//     Gemini call with no tools.
//
// Token estimates here are intentionally cheap (4 chars per token) — they
// are NOT a fidelity-critical count. The cap exists to keep the wire payload
// sane; the model's own context window is the real ceiling. A bad estimate
// fails safe: too aggressive trims a turn we could have kept, too lax sends
// a few more tokens than budgeted — neither corrupts state.
//
// Concurrent-write contract: `saveMessages` is a plain UPDATE without a
// version column. Two browser tabs racing on the same session UPDATE the
// row last-writer-wins — the second write overwrites the first and the
// first tab's appended message is lost. This is the explicit contract per
// ADR 0048 (`chat session is last-writer-wins`); the migration to
// optimistic concurrency is shaped in decision 3 of that ADR and will
// land when telemetry justifies it.

import { and, desc, eq } from 'drizzle-orm';
import { chatSession, type ChatSession, type NewChatSession } from '../../db/schema';
import { db } from '../../db/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One persisted turn in a chat session. `role` mirrors the Gemini convention
 * (user / assistant / tool); `toolCalls` is populated on assistant turns that
 * dispatched one or more tools; `toolCallId` / `toolName` pair tool messages
 * with their dispatching assistant turn. `summary` rows are inserted by the
 * orchestrator when it compacts older turns.
 */
export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool' | 'summary';

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ChatMessage {
  role: ChatMessageRole;
  content: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ChatSessionState {
  id: string;
  siteId: string;
  customerId: string;
  startedAt: string;
  endedAt: string | null;
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Token budget
// ---------------------------------------------------------------------------

/** Approximate token count for a string. 4 chars/token is the conventional cheap estimate. */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/** Estimate tokens across an entire message array, including tool-call argument JSON. */
export function estimateMessagesTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
    if (msg.toolCalls) {
      for (const call of msg.toolCalls) {
        total += estimateTokens(call.name);
        total += estimateTokens(JSON.stringify(call.arguments ?? {}));
      }
    }
    if (msg.toolName) total += estimateTokens(msg.toolName);
  }
  return total;
}

export const CHAT_TOKEN_BUDGET = 16_000;
export const SUMMARIZE_AFTER_TURNS = 10;
// 2_000 was too small for the canonical Apogee Showcase site: full detail
// (per-element id+type listings across 6 pages × ~7 sections × ~10–15
// elements) overflows the cap and trips truncated=true on the first call,
// at which point the agent loops re-calling query_site instead of
// proposing edits. Bumped to 12_000 to fit Apogee comfortably while still
// leaving room in the chat budget (CHAT_TOKEN_BUDGET = 16k).
export const QUERY_SITE_TOKEN_CAP = 12_000;

/**
 * Trim oldest non-system / non-summary messages from the front of the array
 * until the remaining estimated token count fits within `budget`. The latest
 * user message and everything after it is always preserved (we never drop the
 * active turn, including assistant tool calls and tool responses).
 *
 * Returns a NEW array; the input is not mutated.
 */
export function trimToBudget(
  messages: readonly ChatMessage[],
  budget: number = CHAT_TOKEN_BUDGET,
): ChatMessage[] {
  const out = [...messages];
  while (out.length > 1 && estimateMessagesTokens(out) > budget) {
    const activeStart = activeTurnStartIndex(out);
    // Find the first message we can drop: skip any system / summary at the
    // very front (they hold the persistent context) and drop the next one.
    let dropIdx = 0;
    while (dropIdx < out.length && (out[dropIdx]?.role === 'system' || out[dropIdx]?.role === 'summary')) {
      dropIdx++;
    }
    if (dropIdx >= activeStart) {
      // Nothing left to drop besides the active turn. The orchestrator's
      // precise token-budget check decides whether to continue or end loudly.
      break;
    }
    out.splice(dropIdx, 1);
  }
  return out;
}

function activeTurnStartIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return i;
  }
  return Math.max(0, messages.length - 1);
}

/**
 * Count "turns" — user + assistant pairs. Tool messages do not count; summary
 * rows do not count. Used by the orchestrator to decide whether to invoke
 * the summarisation step.
 */
export function countTurns(messages: readonly ChatMessage[]): number {
  let turns = 0;
  for (const msg of messages) {
    if (msg.role === 'user') turns++;
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Persistence — Postgres `chat_session` table
// ---------------------------------------------------------------------------

type DbEnv = { DATABASE_URL: string };

/** Load a session by id. Returns null when the row does not exist. */
export async function loadSession(
  env: DbEnv,
  sessionId: string,
): Promise<ChatSessionState | null> {
  const database = db(env);
  const row = await database
    .select()
    .from(chatSession)
    .where(eq(chatSession.id, sessionId))
    .limit(1);
  const r = row[0];
  if (!r) return null;
  return rowToState(r);
}

/** Find the most recent (open) session for a (site, customer) pair, or null. */
export async function loadLatestOpenSession(
  env: DbEnv,
  siteId: string,
  customerId: string,
): Promise<ChatSessionState | null> {
  const database = db(env);
  const row = await database
    .select()
    .from(chatSession)
    .where(and(eq(chatSession.siteId, siteId), eq(chatSession.customerId, customerId)))
    .orderBy(desc(chatSession.startedAt))
    .limit(1);
  const r = row[0];
  if (!r) return null;
  if (r.endedAt) return null;
  return rowToState(r);
}

/** Insert a fresh session row. Returns the persisted state. */
export async function createSession(
  env: DbEnv,
  siteId: string,
  customerId: string,
  seed: ChatMessage[] = [],
): Promise<ChatSessionState> {
  const database = db(env);
  const insert: NewChatSession = {
    siteId,
    customerId,
    messages: seed as unknown as Array<Record<string, unknown>>,
  };
  const inserted = await database.insert(chatSession).values(insert).returning();
  const r = inserted[0];
  if (!r) {
    throw new Error('createSession: insert returned no row');
  }
  return rowToState(r);
}

export const CHAT_RACE_WARN_MARKER = '[chat/session] ADR-0048 concurrent-write race detected';

export interface ChatRacePayload {
  sessionId: string;
  expectedBaselineLength: number;
  currentLength: number;
  incomingLength: number;
  lostMessages: number;
}

/**
 * Pure-arithmetic check for the ADR 0048 telemetry hook. Returns the structured
 * warn payload when the persisted row's message count already exceeds the
 * caller's expected baseline (i.e. another writer landed between baseline-load
 * and this call); returns `null` otherwise.
 *
 * Extracted as a pure function so the regression smoke can pin the contract
 * (`src/agent/chat/session-race.smoke.ts`) without mocking a DB.
 */
export function computeChatRacePayload(args: {
  sessionId: string;
  currentLength: number;
  expectedBaselineLength: number;
  incomingLength: number;
}): ChatRacePayload | null {
  if (args.currentLength > args.expectedBaselineLength) {
    return {
      sessionId: args.sessionId,
      expectedBaselineLength: args.expectedBaselineLength,
      currentLength: args.currentLength,
      incomingLength: args.incomingLength,
      lostMessages: args.currentLength - args.expectedBaselineLength,
    };
  }
  return null;
}

/**
 * Replace the messages array on an existing session.
 *
 * Optional `expectedBaselineLength` is the length of `messages` the caller
 * observed when it loaded the session at the start of the turn. When
 * provided, this function reads the row's current `messages.length` before
 * the UPDATE and emits a structured log via `computeChatRacePayload` when
 * the persisted length already exceeds the expected baseline — that is the
 * ADR-0048-decision-4 telemetry hook for measuring concurrent-tab race
 * frequency.
 *
 * The hook does NOT change the write contract: this function still
 * last-writer-wins per ADR 0048 decision 1. It only surfaces the race
 * post-hoc so the rarity claim becomes a measured one. A pre-UPDATE read
 * misses the case where two writers race past it together, but it catches
 * the common case (one writer lands between baseline-load and the second
 * writer's UPDATE) — sufficient to answer "does this race happen at all?"
 */
export async function saveMessages(
  env: DbEnv,
  sessionId: string,
  messages: ChatMessage[],
  expectedBaselineLength?: number,
): Promise<void> {
  const database = db(env);
  if (expectedBaselineLength !== undefined) {
    const rows = await database
      .select({ messages: chatSession.messages })
      .from(chatSession)
      .where(eq(chatSession.id, sessionId))
      .limit(1);
    const current = rows[0]?.messages;
    const currentLength = Array.isArray(current) ? current.length : 0;
    const payload = computeChatRacePayload({
      sessionId,
      currentLength,
      expectedBaselineLength,
      incomingLength: messages.length,
    });
    if (payload !== null) {
      console.warn(CHAT_RACE_WARN_MARKER, payload);
    }
  }
  await database
    .update(chatSession)
    .set({ messages: messages as unknown as Array<Record<string, unknown>> })
    .where(eq(chatSession.id, sessionId));
}

/** Mark a session ended (sets `ended_at = now()`). */
export async function endSession(env: DbEnv, sessionId: string): Promise<void> {
  const database = db(env);
  await database
    .update(chatSession)
    .set({ endedAt: new Date() })
    .where(eq(chatSession.id, sessionId));
}

// ---------------------------------------------------------------------------
// In-memory session store (for the smoke test + any code path that needs to
// run without a database).
// ---------------------------------------------------------------------------

/**
 * Minimal storage backend the orchestrator can swap into when the smoke runs
 * the multi-turn loop without a live DB. The smoke wires up an `InMemoryStore`
 * and asserts persistence semantics; production paths use the Postgres
 * helpers above.
 */
export interface SessionStore {
  load(sessionId: string): Promise<ChatSessionState | null>;
  create(siteId: string, customerId: string, seed?: ChatMessage[]): Promise<ChatSessionState>;
  save(sessionId: string, messages: ChatMessage[]): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly rows = new Map<string, ChatSessionState>();
  private nextId = 1;

  load(sessionId: string): Promise<ChatSessionState | null> {
    return Promise.resolve(this.rows.get(sessionId) ?? null);
  }

  create(siteId: string, customerId: string, seed: ChatMessage[] = []): Promise<ChatSessionState> {
    const id = `chat-mem-${String(this.nextId++)}`;
    const state: ChatSessionState = {
      id,
      siteId,
      customerId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      messages: [...seed],
    };
    this.rows.set(id, state);
    return Promise.resolve(state);
  }

  save(sessionId: string, messages: ChatMessage[]): Promise<void> {
    const existing = this.rows.get(sessionId);
    if (!existing) {
      return Promise.reject(new Error(`InMemorySessionStore: unknown sessionId ${sessionId}`));
    }
    existing.messages = [...messages];
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToState(r: ChatSession): ChatSessionState {
  const raw = (r.messages ?? []) as unknown as ChatMessage[];
  return {
    id: r.id,
    siteId: r.siteId,
    customerId: r.customerId,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    messages: raw.map(normalizeMessage),
  };
}

function normalizeMessage(m: ChatMessage): ChatMessage {
  // Defensive: messages from JSONB may have arrived with unexpected fields.
  // Keep only the contract-shaped fields.
  const out: ChatMessage = { role: m.role, content: m.content };
  if (m.toolCalls) out.toolCalls = m.toolCalls;
  if (m.toolCallId !== undefined) out.toolCallId = m.toolCallId;
  if (m.toolName !== undefined) out.toolName = m.toolName;
  return out;
}
