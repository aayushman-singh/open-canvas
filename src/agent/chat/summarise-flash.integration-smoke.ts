// src/agent/chat/summarise-flash.integration-smoke.ts
//
// Integration smoke for ADR 0056 follow-up: verify that a real
// gemini-2.5-flash summarisation round-trip retains every element /
// section / asset id present in the input turns. The summarisation
// prompt explicitly instructs preservation of IDs; this smoke catches
// the day Flash quietly stops honouring that instruction.
//
// Run with `bun --env-file=.env run src/agent/chat/summarise-flash.integration-smoke.ts`.
// Requires GEMINI_API_KEY. Excluded from the pre-commit smoke suite
// because it hits the live model and costs real tokens.

import { GeminiAdapter } from '../llm-gemini';
import { CHAT_FLASH_MODEL, summariseIfNeeded } from './orchestrator';
import type { ChatMessage } from './session';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[summarise-flash:integration-smoke] ${message}`);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY || GEMINI_API_KEY.length === 0) {
  throw new Error(
    'GEMINI_API_KEY is required (load .env via bunfig.toml or `bun --env-file=.env`)',
  );
}

// Fixture IDs that the summarisation MUST preserve. Picked across the three
// id namespaces the agent surfaces in chat — pages, sections, elements,
// assets — so a regression in any one shows up.
const KNOWN_IDS = [
  'page-home',
  'page-about',
  'section-hero-001',
  'section-feature-grid-002',
  'el-text-headline-A',
  'el-text-body-B',
  'el-media-photo-C',
  'asset-owner-7f3a',
  'asset-owner-9b2d',
] as const;

// Build a 20-turn fixture (10 user + 10 assistant) referencing every ID
// at least twice. Each message is kept short (well under the 600-char
// truncate inside summariseIfNeeded) so IDs land in the prompt verbatim.
function buildFixtureHistory(): ChatMessage[] {
  const history: ChatMessage[] = [];
  history.push({ role: 'user', content: 'Rebuild the hero on page page-home.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed rewriteText on el-text-headline-A in section-hero-001 (page page-home) and a replaceMedia on el-media-photo-C with asset-owner-7f3a.',
  });
  history.push({ role: 'user', content: 'Apply that. Also tweak section-feature-grid-002.' });
  history.push({
    role: 'assistant',
    content:
      'Applied rewriteText el-text-headline-A. For section-feature-grid-002 I would update el-text-body-B with a tighter copy line.',
  });
  history.push({ role: 'user', content: 'Add an about page.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed addPage page-about with a single hero section reusing asset-owner-9b2d for the lead image.',
  });
  history.push({ role: 'user', content: 'Move the body element down on the hero.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed updateElement el-text-body-B in section-hero-001 to bottom-align under el-text-headline-A.',
  });
  history.push({ role: 'user', content: 'Swap the hero photo back to asset-owner-7f3a everywhere.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed replaceMedia el-media-photo-C with asset-owner-7f3a on page-home and page-about.',
  });
  history.push({ role: 'user', content: 'Confirm the layout on section-feature-grid-002.' });
  history.push({
    role: 'assistant',
    content:
      'section-feature-grid-002 currently holds el-text-body-B at a 12-col span; would tighten to 8-col with grid pad reduced.',
  });
  history.push({ role: 'user', content: 'Make page-about use the dark style kit.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed setStyleKit charcoal scoped to page-about (page-home unchanged).',
  });
  history.push({ role: 'user', content: 'Delete the lead media on page-about.' });
  history.push({
    role: 'assistant',
    content:
      'Proposed deleteElement el-media-photo-C on page-about (asset-owner-9b2d retained — still referenced on page-home).',
  });
  history.push({ role: 'user', content: 'Trigger summarisation.' });
  // The active turn's user message stays out of the summarised slice (per
  // summariseIfNeeded — it slices up to lastUserIdx). To exercise the
  // summarisation step we need at least one user message AFTER everything
  // we want summarised; the message above plays that role.
  return history;
}

const adapter = new GeminiAdapter({ apiKey: GEMINI_API_KEY });
const history = buildFixtureHistory();
const result = await summariseIfNeeded(history, adapter, CHAT_FLASH_MODEL);

// Result must start with a `summary` role message holding the synthesised
// recap, then the active turn appended after.
const summaryMessage = result[0];
assert(
  summaryMessage?.role === 'summary',
  `expected first message to be role=summary, got ${summaryMessage?.role ?? 'undefined'}`,
);
const summaryText = summaryMessage?.content ?? '';
assert(summaryText.length > 0, 'summary must be non-empty');

const missing = KNOWN_IDS.filter((id) => !summaryText.includes(id));
if (missing.length > 0) {
  console.error('[summarise-flash:integration-smoke] summary output was:\n', summaryText);
}
assert(
  missing.length === 0,
  `Flash summarisation dropped ${String(missing.length)} of ${String(KNOWN_IDS.length)} ids: ${missing.join(', ')}`,
);

console.log(
  `[summarise-flash:integration-smoke] OK — all ${String(KNOWN_IDS.length)} ids retained in Flash summary (${String(summaryText.length)} chars)`,
);
