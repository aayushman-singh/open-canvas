// Gemini API implementation of LlmAdapter.
//
// Wraps @google/genai's generateContentStream. The streaming API yields a
// sequence of GenerateContentResponse chunks; each chunk's
// candidates[0].content.parts may carry text parts and/or functionCall parts.
// We re-emit those as LlmChunk events in the order they arrive, then emit a
// terminal `done` event mapped from the candidate finishReason.
//
// Function call ids: Gemini's stream model surfaces functionCall objects
// without a stable per-call id when called via the developer API. We
// synthesise one from the call name + a monotonic counter so the orchestrator
// can pair the matching functionResponse on the next turn.

import {
  GoogleGenAI,
  Type,
  type Content,
  type CountTokensConfig,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type ToolListUnion,
} from '@google/genai';
import type {
  ChatWithToolsOptions,
  CountTokensOptions,
  JsonSchema,
  LlmAdapter,
  LlmChunk,
  LlmMessage,
  LlmTool,
} from './llm';

type DoneReason = Extract<LlmChunk, { type: 'done' }>['reason'];

export class GeminiAdapter implements LlmAdapter {
  private readonly client: GoogleGenAI;

  constructor(opts: { apiKey: string }) {
    if (!opts.apiKey) {
      throw new Error('GeminiAdapter: apiKey is required');
    }
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
  }

  async *chatWithTools(
    messages: LlmMessage[],
    opts: ChatWithToolsOptions,
  ): AsyncIterable<LlmChunk> {
    const contents = translateMessagesToContents(messages);
    const functionDeclarations = opts.tools.map(translateToolToDeclaration);

    const config: GenerateContentConfig = {};
    if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction;
    if (opts.temperature !== undefined) config.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) config.maxOutputTokens = opts.maxTokens;
    if (opts.signal) config.abortSignal = opts.signal;
    if (functionDeclarations.length > 0) {
      const tools: ToolListUnion = [{ functionDeclarations }];
      config.tools = tools;
    }

    let toolCallCounter = 0;
    const stream = await this.client.models.generateContentStream({
      model: opts.model,
      contents,
      config,
    });

    let finishReason: string | undefined;

    for await (const chunk of stream) {
      const candidates = chunk.candidates;
      if (!candidates || candidates.length === 0) continue;
      const candidate = candidates[0];
      if (!candidate) continue;
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { type: 'text', text: part.text };
        }
        if (part.functionCall) {
          const name = part.functionCall.name ?? 'unknown';
          const id = part.functionCall.id ?? synthCallId(name, toolCallCounter++);
          const args = (part.functionCall.args ?? {}) as unknown;
          yield { type: 'tool_call', id, name, arguments: args };
        }
      }
      if (candidate.finishReason) {
        finishReason = String(candidate.finishReason);
      }
    }

    yield { type: 'done', reason: mapFinishReason(finishReason) };
  }

  async countTokens(messages: LlmMessage[], opts: CountTokensOptions): Promise<number> {
    const contents = translateMessagesToContents(messages);
    const config: CountTokensConfig = {};
    if (opts.systemInstruction) config.systemInstruction = opts.systemInstruction;
    if (opts.signal) config.abortSignal = opts.signal;
    if (opts.tools && opts.tools.length > 0) {
      const functionDeclarations = opts.tools.map(translateToolToDeclaration);
      config.tools = [{ functionDeclarations }];
    }
    const response = await this.client.models.countTokens({
      model: opts.model,
      contents,
      config,
    });
    if (typeof response.totalTokens !== 'number') {
      throw new Error('GeminiAdapter.countTokens: response missing totalTokens');
    }
    return response.totalTokens;
  }
}

function synthCallId(name: string, counter: number): string {
  return `${name}-${counter}-${crypto.randomUUID().slice(0, 8)}`;
}

function mapFinishReason(raw: string | undefined): DoneReason {
  switch (raw) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
      return 'safety';
    case 'TOOL_USE':
    case 'FUNCTION_CALL':
      return 'tool_use';
    case undefined:
    case '':
      return 'stop';
    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// LlmMessage[]  ->  Gemini Content[].
//
// Gemini uses two roles on the wire: `user` for human turns + tool responses,
// `model` for assistant turns. System prompts go to a separate
// systemInstruction field, NOT into Content[].
// ---------------------------------------------------------------------------

function translateMessagesToContents(messages: LlmMessage[]): Content[] {
  const out: Content[] = [];
  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        throw new Error(
          'GeminiAdapter: system messages must be passed via systemInstruction, not in the messages array',
        );
      case 'user':
        out.push({ role: 'user', parts: [{ text: msg.content }] });
        break;
      case 'assistant': {
        const parts: NonNullable<Content['parts']> = [];
        if (msg.content.length > 0) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const call of msg.toolCalls) {
            parts.push({
              functionCall: {
                id: call.id,
                name: call.name,
                args: (call.arguments ?? {}) as Record<string, unknown>,
              },
            });
          }
        }
        // Gemini requires at least one part per Content entry.
        if (parts.length === 0) parts.push({ text: '' });
        out.push({ role: 'model', parts });
        break;
      }
      case 'tool':
        out.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: msg.toolCallId,
                name: msg.toolName,
                response: safeJsonParse(msg.content),
              },
            },
          ],
        });
        break;
    }
  }
  return out;
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return { output: v };
  } catch {
    return { output: s };
  }
}

// ---------------------------------------------------------------------------
// LlmTool  ->  Gemini FunctionDeclaration.
//
// Use parametersJsonSchema so we can pass through enum/items/etc verbatim
// without translating to Gemini's Type enum — the schema is already
// JSON-Schema-shaped.
// ---------------------------------------------------------------------------

function translateToolToDeclaration(tool: LlmTool): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  };
}

export { Type };
export type { JsonSchema };
