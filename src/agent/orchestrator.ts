// Agent orchestration loop.
//
// Multi-turn dialog with the LLM:
//   user msg -> LLM emits text + tool_call events -> apply each tool_call as
//   a DocOp (dry-run for validation, then live via applyOp) -> feed the tool
//   result back as a tool message -> loop until the LLM emits `done` with no
//   pending tool calls, or until MAX_TURNS.
//
// Validation gate: every tool call is dry-run against the in-memory
// DocumentJSON via applyDocOp and then validated with validateDocument. If
// either step fails, the orchestrator returns the error to the model as a
// tool result (not an exception), so the model can self-correct on its next
// turn. Per repo policy: no silent fallbacks — every rejection is loud.
//
// The orchestrator does NOT own the live Y.Doc. It delegates the actual
// mutation to a callback (`applyOp`) supplied by the caller. In the worker
// this callback hits the PageDocument DO over an internal RPC; in tests
// (smoke.ts) it just mutates a local copy.

import type { DocumentJSON } from '../document/schema';
import { validateDocument } from '../document/validate';
import type { LlmAdapter, LlmAssistantToolCall, LlmMessage } from './llm';
import { applyDocOp, type DocOp } from './ops';
import { AGENT_TOOLS, parseToolCall } from './tools';

export const DEFAULT_AGENT_MODEL = 'gemini-2.5-pro';
export const MAX_TURNS = 6;

export interface RunAgentInput {
  pageId: string;
  message: string;
  currentDoc: DocumentJSON;
  applyOp: (op: DocOp) => Promise<void>;
  llm: LlmAdapter;
  model?: string;
}

export type AgentEvent =
  | { type: 'thinking'; turn: number }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: true; opKind: string }
  | { type: 'tool_result'; id: string; name: string; ok: false; error: string }
  | { type: 'done'; reason: string; turns: number }
  | { type: 'error'; message: string };

export async function* runAgent(input: RunAgentInput): AsyncIterable<AgentEvent> {
  const model = input.model ?? DEFAULT_AGENT_MODEL;
  let doc = input.currentDoc;
  const history: LlmMessage[] = [{ role: 'user', content: input.message }];

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    yield { type: 'thinking', turn };

    let assistantText = '';
    const turnCalls: LlmAssistantToolCall[] = [];

    let finishReason: 'stop' | 'length' | 'tool_use' | 'safety' | 'other' = 'stop';

    try {
      for await (const chunk of input.llm.chatWithTools(history, {
        model,
        tools: AGENT_TOOLS,
        systemInstruction: buildSystemPrompt(doc),
        temperature: 0.2,
      })) {
        if (chunk.type === 'text') {
          assistantText += chunk.text;
          yield { type: 'text', text: chunk.text };
        } else if (chunk.type === 'tool_call') {
          turnCalls.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
          yield {
            type: 'tool_call',
            id: chunk.id,
            name: chunk.name,
            arguments: chunk.arguments,
          };
        } else if (chunk.type === 'done') {
          finishReason = chunk.reason;
        }
      }
    } catch (err) {
      yield { type: 'error', message: errorMessage(err) };
      return;
    }

    // Push the assistant turn into history regardless of whether it asked
    // for tools. This is what the model expects to see when we send tool
    // responses back to it.
    history.push({
      role: 'assistant',
      content: assistantText,
      ...(turnCalls.length > 0 ? { toolCalls: turnCalls } : {}),
    });

    if (turnCalls.length === 0) {
      yield { type: 'done', reason: finishReason, turns: turn };
      return;
    }

    // Apply each tool call. Dry-run against the in-memory doc first so we can
    // reject without touching the live Y.Doc; then call the live applyOp.
    for (const call of turnCalls) {
      const parsed = parseToolCall(call.name, call.arguments);
      if (!parsed.ok) {
        yield { type: 'tool_result', id: call.id, name: call.name, ok: false, error: parsed.error };
        history.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ ok: false, error: parsed.error }),
        });
        continue;
      }

      let nextDoc: DocumentJSON;
      try {
        nextDoc = applyDocOp(doc, parsed.op);
      } catch (err) {
        const error = errorMessage(err);
        yield { type: 'tool_result', id: call.id, name: call.name, ok: false, error };
        history.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ ok: false, error }),
        });
        continue;
      }

      const validation = validateDocument(nextDoc);
      if (!validation.valid) {
        const error = `validation failed after ${parsed.op.kind}: ${validation.errors.join('; ')}`;
        yield { type: 'tool_result', id: call.id, name: call.name, ok: false, error };
        history.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ ok: false, error }),
        });
        continue;
      }

      try {
        await input.applyOp(parsed.op);
      } catch (err) {
        const error = errorMessage(err);
        yield { type: 'tool_result', id: call.id, name: call.name, ok: false, error };
        history.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify({ ok: false, error }),
        });
        continue;
      }

      doc = nextDoc;
      yield {
        type: 'tool_result',
        id: call.id,
        name: call.name,
        ok: true,
        opKind: parsed.op.kind,
      };
      history.push({
        role: 'tool',
        toolCallId: call.id,
        toolName: call.name,
        content: JSON.stringify({ ok: true, applied: parsed.op.kind }),
      });
    }
  }

  yield { type: 'done', reason: 'max_turns', turns: MAX_TURNS };
}

// ---------------------------------------------------------------------------
// System prompt — describes the schema and the live document compactly so the
// model can reason about indices without the full doc bloating the context.
// ---------------------------------------------------------------------------

function buildSystemPrompt(doc: DocumentJSON): string {
  return [
    'You are the rev01 page-editing agent. The user is editing a page whose document is described below.',
    '',
    'You can change the document only through the provided tools. Do not emit document JSON in text.',
    'When you make changes, briefly tell the user in natural language what you did.',
    'If the user asks for something destructive (removing a section, dropping content), confirm with them first unless they were already specific.',
    'Indices are 0-based and refer to positions inside the current document, NOT after pending edits. After each tool call, the document has been mutated; re-derive indices from the previous tool response if needed.',
    '',
    'Document outline (compact JSON):',
    JSON.stringify(summariseDoc(doc)),
    '',
    'Section kinds available for insertSection: hero, feature, pricing, gallery, cta, footer, custom.',
    'Heading levels are 1..6 (insertSection defaults to level 2).',
  ].join('\n');
}

// Compact outline so the model gets shape + indices without the full content.
interface SectionOutline {
  sectionIndex: number;
  kind: string;
  blocks: BlockOutline[];
}
interface BlockOutline {
  blockIndex: number;
  type: string;
  preview?: string;
  level?: number;
  childCount?: number;
}

function summariseDoc(doc: DocumentJSON): SectionOutline[] {
  return doc.content.map((section, sectionIndex) => ({
    sectionIndex,
    kind: section.attrs.kind,
    blocks: section.content.map((block, blockIndex) => {
      const out: BlockOutline = { blockIndex, type: block.type };
      if (block.type === 'heading' || block.type === 'paragraph') {
        out.preview = textPreview(block);
        if (block.type === 'heading' && 'attrs' in block && block.attrs) {
          const lvl = (block.attrs as { level?: number }).level;
          if (lvl !== undefined) out.level = lvl;
        }
      } else if (block.type === 'actions' && 'content' in block) {
        out.childCount = block.content.length;
        out.preview = block.content
          .map((a) => (a.attrs as { label?: string }).label ?? '')
          .filter(Boolean)
          .join(' | ');
      } else if ('content' in block) {
        out.childCount = (block as { content: unknown[] }).content.length;
      }
      return out;
    }),
  }));
}

function textPreview(block: { content?: unknown[] }): string {
  const chunks: string[] = [];
  for (const inline of block.content ?? []) {
    if (inline && typeof inline === 'object' && 'text' in inline) {
      const t = inline.text;
      if (typeof t === 'string') chunks.push(t);
    }
  }
  const joined = chunks.join('');
  return joined.length > 100 ? `${joined.slice(0, 97)}...` : joined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
