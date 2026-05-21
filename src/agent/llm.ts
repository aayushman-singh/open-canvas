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
  | { role: 'assistant'; content: string; toolCalls?: LlmAssistantToolCall[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string };

export interface LlmAssistantToolCall {
  id: string;
  name: string;
  arguments: unknown;
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
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | { type: 'done'; reason: 'stop' | 'length' | 'tool_use' | 'safety' | 'other' };

export interface ChatWithToolsOptions {
  model: string;
  tools: LlmTool[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmAdapter {
  chatWithTools(messages: LlmMessage[], opts: ChatWithToolsOptions): AsyncIterable<LlmChunk>;
}
