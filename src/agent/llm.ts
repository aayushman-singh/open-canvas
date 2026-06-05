// Model-agnostic LLM adapter.
//
// The orchestrator depends on this interface and nothing else; concrete
// implementations live alongside (llm-gemini.ts today; future Anthropic or
// OpenAI adapters drop in as new files, no caller changes). Tool schemas use
// the JSON-Schema subset every modern function-calling model speaks, so the
// same LlmTool[] feeds all adapters.

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: LlmAssistantToolCall[];
      // Gemini 3.x signs each model turn with an opaque base64 thoughtSignature
      // on every Part. Missing them on the next request returns HTTP 400. This
      // field carries the text-part signature; per-tool-call signatures live on
      // LlmAssistantToolCall.thoughtSignature.
      thoughtSignature?: string;
    }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export interface LlmAssistantToolCall {
  id: string;
  name: string;
  arguments: unknown;
  // See LlmMessage.assistant.thoughtSignature. With parallel tool calls Gemini
  // only emits a signature on the first call; downstream calls have it
  // omitted.
  thoughtSignature?: string;
}

// JSON-Schema subset that every supported model accepts. Use plain strings for
// types so the same value works in Gemini's parametersJsonSchema and OpenAI's
// tools.function.parameters without translation.
export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  enum?: readonly (string | number)[];
  // String pattern, min/max for numbers — pass through to the model.
  pattern?: string;
  minimum?: number;
  maximum?: number;
};

export interface LlmTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type LlmChunk =
  | { type: 'text'; text: string; thoughtSignature?: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown; thoughtSignature?: string }
  | { type: 'done'; reason: 'stop' | 'length' | 'tool_use' | 'safety' | 'other' };

export interface ChatWithToolsOptions {
  model: string;
  tools: LlmTool[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Optional. Aborts the in-flight stream. Per ADR 0055 decision 6, the
   * orchestrator threads a deadline-driven signal here so a runaway turn
   * cannot consume the worker's wall-clock budget.
   */
  signal?: AbortSignal;
}

export interface CountTokensOptions {
  model: string;
  systemInstruction?: string;
  tools?: LlmTool[];
  signal?: AbortSignal;
}

export interface LlmAdapter {
  chatWithTools(messages: LlmMessage[], opts: ChatWithToolsOptions): AsyncIterable<LlmChunk>;
  /**
   * Authoritative token count for the given messages + system prompt + tools.
   * Per ADR 0055 decision 3 the orchestrator calls this only when the cheap
   * char/4 estimate is within 20% of the cap, so the API round-trip cost is
   * bounded to at most one per turn.
   */
  countTokens(messages: LlmMessage[], opts: CountTokensOptions): Promise<number>;
}
