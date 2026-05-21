// Local smoke for the agent orchestrator.
// Run: `bun run src/agent/smoke.ts`.
// Mock LLM emits a scripted 2-tool-call sequence; we assert the orchestrator
// dispatches the calls, dry-runs validation, applies via applyOp, feeds tool
// results back, and terminates cleanly. Also covers:
//   - max-turns cap fires for runaway sequences
//   - invalid args produce a tool_result error (not a throw)
//   - applyDocOp + validateDocument round-trip on the seed doc

import mapleCoffee from '../templates/seeds/maple-coffee/pages/home.json';
import type { DocumentJSON } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applyDocOp, applyDocOpToYDoc, type DocOp } from './ops';
import { runAgent, MAX_TURNS } from './orchestrator';
import type { ChatWithToolsOptions, LlmAdapter, LlmChunk, LlmMessage } from './llm';
import { hydrateYDoc, serializeYDoc } from '../multiplayer/snapshot';

declare const process: { exit: (code: number) => never };

let failed = false;
function ok(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
    failed = true;
  }
}

type DoneReason = Extract<LlmChunk, { type: 'done' }>['reason'];

interface ScriptedTurn {
  text?: string;
  toolCalls?: { id: string; name: string; arguments: unknown }[];
  reason?: DoneReason;
}

class ScriptedAdapter implements LlmAdapter {
  public received: LlmMessage[][] = [];
  constructor(private readonly script: ScriptedTurn[]) {}
  // eslint-disable-next-line @typescript-eslint/require-await
  async *chatWithTools(
    messages: LlmMessage[],
    opts: ChatWithToolsOptions,
  ): AsyncIterable<LlmChunk> {
    void opts;
    this.received.push(messages.map((m) => ({ ...m })));
    const turn = this.script[this.received.length - 1];
    if (!turn) {
      // If the orchestrator asked for more turns than scripted, simulate a
      // benign "done with no tools" to terminate; surfacing this fact via the
      // assertions below.
      yield { type: 'done', reason: 'stop' };
      return;
    }
    if (turn.text) yield { type: 'text', text: turn.text };
    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) yield { type: 'tool_call', ...tc };
    }
    yield { type: 'done', reason: turn.reason ?? 'stop' };
  }
}

const seed = mapleCoffee as DocumentJSON;

// ---------------------------------------------------------------------------
// Test 1 — seed validates and a setHeadingText DocOp produces a still-valid doc.
// ---------------------------------------------------------------------------

ok('seed validates', validateDocument(seed).valid);

const headingOp: DocOp = {
  kind: 'setHeadingText',
  sectionIndex: 0,
  headingIndex: 0,
  text: 'Roasted on Tuesdays',
};
const mutated = applyDocOp(seed, headingOp);
ok('mutated doc validates', validateDocument(mutated).valid);
ok('mutated heading text was applied', JSON.stringify(mutated).includes('Roasted on Tuesdays'));

// ---------------------------------------------------------------------------
// Test 2 — orchestrator runs a 2-tool-call sequence, applies both, terminates.
// ---------------------------------------------------------------------------

const scripted = new ScriptedAdapter([
  {
    text: 'Updating the headline and the menu button.',
    toolCalls: [
      {
        id: 'call-1',
        name: 'setHeadingText',
        arguments: { sectionIndex: 0, headingIndex: 0, text: 'Roasted on Tuesdays' },
      },
      {
        id: 'call-2',
        name: 'setActionLabel',
        arguments: {
          sectionIndex: 0,
          actionsIndex: 2,
          actionIndex: 0,
          label: "View today's pour",
        },
      },
    ],
    reason: 'tool_use',
  },
  {
    text: 'Done — both changes applied.',
    reason: 'stop',
  },
]);

const applied: DocOp[] = [];
let currentDoc = seed;
const events1: unknown[] = [];
for await (const ev of runAgent({
  pageId: 'pg-smoke',
  message: 'change the headline and the menu button',
  currentDoc,
  applyOp: (op) => {
    applied.push(op);
    currentDoc = applyDocOp(currentDoc, op);
    return Promise.resolve();
  },
  llm: scripted,
})) {
  events1.push(ev);
}

ok('orchestrator applied 2 ops', applied.length === 2, `got ${applied.length}`);
ok('orchestrator applied setHeadingText first', applied[0]?.kind === 'setHeadingText');
ok('orchestrator applied setActionLabel second', applied[1]?.kind === 'setActionLabel');
ok(
  'orchestrator emitted done',
  events1.some((e) => (e as { type?: string }).type === 'done'),
);
ok(
  'orchestrator fed tool results back to LLM',
  scripted.received.length === 2 &&
    (scripted.received[1] ?? []).some((m) => m.role === 'tool' && m.toolName === 'setHeadingText'),
);
ok(
  'final doc still validates',
  validateDocument(currentDoc).valid,
  validateDocument(currentDoc).valid ? undefined : 'see errors',
);

// ---------------------------------------------------------------------------
// Test 3 — invalid args surface as tool_result error, not a throw.
// ---------------------------------------------------------------------------

const badScripted = new ScriptedAdapter([
  {
    toolCalls: [
      {
        id: 'call-x',
        name: 'setHeadingText',
        arguments: { sectionIndex: 'oops', headingIndex: 0, text: 'hi' },
      },
    ],
    reason: 'tool_use',
  },
  {
    text: 'I will give up gracefully.',
    reason: 'stop',
  },
]);

const events3: unknown[] = [];
let badApplied = 0;
for await (const ev of runAgent({
  pageId: 'pg-smoke',
  message: 'break it',
  currentDoc: seed,
  applyOp: () => {
    badApplied += 1;
    return Promise.resolve();
  },
  llm: badScripted,
})) {
  events3.push(ev);
}
ok('invalid args do not throw', true);
ok('invalid args do not call applyOp', badApplied === 0);
ok(
  'invalid args produce a tool_result error',
  events3.some(
    (e) =>
      (e as { type?: string; ok?: boolean }).type === 'tool_result' &&
      (e as { ok?: boolean }).ok === false,
  ),
);

// ---------------------------------------------------------------------------
// Test 4 — runaway loop is capped at MAX_TURNS.
// ---------------------------------------------------------------------------

const runawayScript: ScriptedTurn[] = [];
for (let i = 0; i < MAX_TURNS + 4; i++) {
  runawayScript.push({
    toolCalls: [
      {
        id: `loop-${i}`,
        name: 'setHeadingText',
        arguments: { sectionIndex: 0, headingIndex: 0, text: `turn ${i}` },
      },
    ],
    reason: 'tool_use',
  });
}
const runawayAdapter = new ScriptedAdapter(runawayScript);
let runawayApplied = 0;
const events4: unknown[] = [];
let runawayDoc = seed;
for await (const ev of runAgent({
  pageId: 'pg-smoke',
  message: 'loop',
  currentDoc: runawayDoc,
  applyOp: (op) => {
    runawayApplied += 1;
    runawayDoc = applyDocOp(runawayDoc, op);
    return Promise.resolve();
  },
  llm: runawayAdapter,
})) {
  events4.push(ev);
}
ok(
  'runaway loop caps at MAX_TURNS',
  runawayApplied === MAX_TURNS,
  `applied ${runawayApplied} (expected ${MAX_TURNS})`,
);
ok(
  'runaway loop terminates with max_turns reason',
  events4.some(
    (e) =>
      (e as { type?: string }).type === 'done' && (e as { reason?: string }).reason === 'max_turns',
  ),
);

// ---------------------------------------------------------------------------
// Test 5 — applyDocOpToYDoc broadcasts via Y.transact origin='agent'.
// ---------------------------------------------------------------------------

const ydoc = hydrateYDoc(seed);
let observedOrigin: unknown = null;
ydoc.on('update', (_u, origin) => {
  observedOrigin = origin;
});
applyDocOpToYDoc(ydoc, {
  kind: 'setHeadingText',
  sectionIndex: 0,
  headingIndex: 0,
  text: 'Y.Doc Applied',
});
ok(
  'applyDocOpToYDoc tags origin as "agent"',
  observedOrigin === 'agent',
  `got ${String(observedOrigin)}`,
);
const ydocSnap = serializeYDoc(ydoc);
ok('Y.Doc post-mutation snapshot validates', validateDocument(ydocSnap).valid);
ok('Y.Doc heading text was applied', JSON.stringify(ydocSnap).includes('Y.Doc Applied'));

if (failed) {
  console.error('agent smoke FAILED');
  process.exit(1);
} else {
  console.log('agent smoke PASSED');
}
