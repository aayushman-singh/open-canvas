// One-shot live Gemini smoke. Hits real API once to verify tool-call works.
// Run: `bun run src/agent/_live-smoke.ts`. NOT registered as a package script
// to keep accidental usage low — this hits paid API quota.

import { GeminiAdapter } from './llm-gemini';
import type { LlmTool } from './llm';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY missing in env');
  process.exit(1);
}

const tools: LlmTool[] = [
  {
    name: 'setHeadingText',
    description: 'Change the text of a heading at the given indices.',
    parameters: {
      type: 'object',
      properties: {
        sectionIndex: {
          type: 'number',
          description: 'Index of the section containing the heading.',
        },
        headingIndex: { type: 'number', description: 'Index of the heading inside the section.' },
        text: { type: 'string', description: 'New text for the heading.' },
      },
      required: ['sectionIndex', 'headingIndex', 'text'],
    },
  },
];

const adapter = new GeminiAdapter({ apiKey });

const messages = [
  {
    role: 'user' as const,
    content: 'Change the first heading in section 0 to "Roasted on Tuesdays".',
  },
];

let textChunks = 0;
let toolCalls = 0;
let done: string | null = null;
let toolCallName = '';
let toolCallArgs: unknown = null;

for await (const chunk of adapter.chatWithTools(messages, {
  model: 'gemini-2.5-flash',
  tools,
  systemInstruction:
    'You edit a document by calling tools. Always call setHeadingText for this request.',
  temperature: 0,
})) {
  if (chunk.type === 'text') textChunks += 1;
  else if (chunk.type === 'tool_call') {
    toolCalls += 1;
    toolCallName = chunk.name;
    toolCallArgs = chunk.arguments;
  } else if (chunk.type === 'done') done = chunk.reason;
}

console.log(`text chunks: ${textChunks}`);
console.log(`tool calls: ${toolCalls}`);
console.log(`done reason: ${done}`);
if (toolCalls > 0) {
  console.log(`tool: ${toolCallName} args:`, JSON.stringify(toolCallArgs));
}

if (toolCalls === 0) {
  console.error('FAIL: expected at least one tool_call');
  process.exit(1);
}
if (toolCallName !== 'setHeadingText') {
  console.error(`FAIL: expected tool name "setHeadingText", got "${toolCallName}"`);
  process.exit(1);
}
const args = toolCallArgs as { text?: string };
if (!args.text?.toLowerCase().includes('roasted')) {
  console.error('FAIL: expected text arg to mention "roasted"', args);
  process.exit(1);
}

console.log('live-smoke PASS');
