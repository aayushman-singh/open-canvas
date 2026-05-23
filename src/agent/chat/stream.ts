// src/agent/chat/stream.ts
//
// SSE event contract for the chat orchestrator. The orchestrator emits a
// stream of `ChatStreamEvent`s as it runs the multi-turn loop. Each event
// is serialised to one SSE `data:` frame.
//
// On the wire:
//
//   data: {"kind":"token","text":"Hello"}\n\n
//   data: {"kind":"tool-call","name":"query_site","args":{}}\n\n
//   data: {"kind":"tool-result","name":"query_site","output":"..."}\n\n
//   data: {"kind":"op-preview","op":{...}}\n\n
//   data: {"kind":"error","error":"..."}\n\n
//   data: {"kind":"done"}\n\n
//
// `text/event-stream` framing — each frame is `data: <one-line-json>\n\n`.
// The router uses Hono's `streamSSE` helper; the helpers here keep the event
// shape and the smoke test in one place so the editor client can rely on a
// single contract.

import type { CanvasAgentOp } from '../canvas-ops.js';

// ---------------------------------------------------------------------------
// Event union
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'token'; text: string }
  | { kind: 'tool-call'; id: string; name: string; args: unknown }
  | { kind: 'tool-result'; id: string; name: string; output: unknown }
  | { kind: 'op-preview'; id: string; toolName: string; op: CanvasAgentOp }
  | { kind: 'error'; error: string }
  | { kind: 'done'; reason: 'stop' | 'length' | 'tool_use' | 'safety' | 'other' | 'cap' };

/** Encode an event as one SSE frame (`data: <json>\n\n`). */
export function encodeSseFrame(event: ChatStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ---------------------------------------------------------------------------
// In-memory writer (used by the smoke test + any caller that needs to
// collect the event sequence without binding to a real HTTP response).
// ---------------------------------------------------------------------------

export interface ChatStreamWriter {
  write(event: ChatStreamEvent): Promise<void>;
  close(): Promise<void>;
}

/**
 * Synchronous in-memory writer. Collects every event into a buffer the
 * caller inspects after the orchestrator drains. Returned alongside an
 * `events()` accessor so smoke tests can assert ordering.
 */
export class BufferedStreamWriter implements ChatStreamWriter {
  private readonly buffer: ChatStreamEvent[] = [];
  private closed = false;

  write(event: ChatStreamEvent): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('BufferedStreamWriter: write after close'));
    }
    this.buffer.push(event);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  events(): readonly ChatStreamEvent[] {
    return this.buffer;
  }

  encoded(): string[] {
    return this.buffer.map(encodeSseFrame);
  }
}

// ---------------------------------------------------------------------------
// SSE adapter — Hono streamSSE callback shape
// ---------------------------------------------------------------------------

/**
 * Minimal shape we need from Hono's `SSEStreamingApi`. Keeping the type
 * structural lets the smoke pass a plain stub without pulling Hono in. The
 * route wires the real Hono stream up.
 */
export interface SseSink {
  writeSSE(message: { data: string }): Promise<void>;
}

/** Adapter: dispatches `ChatStreamEvent` writes through a Hono SSE sink. */
export class SseStreamWriter implements ChatStreamWriter {
  private closed = false;

  constructor(private readonly sink: SseSink) {}

  async write(event: ChatStreamEvent): Promise<void> {
    if (this.closed) {
      throw new Error('SseStreamWriter: write after close');
    }
    await this.sink.writeSSE({ data: JSON.stringify(event) });
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
