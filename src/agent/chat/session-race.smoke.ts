// src/agent/chat/session-race.smoke.ts
//
// Regression gate for ADR 0048 decision 4: the chat-race telemetry hook in
// `saveMessages` MUST surface a structured warn payload when the persisted
// row's message count already exceeds the baseline the caller observed at
// session-load time. The hook is the rarity-measurement contract; without
// it, the LWW posture in decisions 1+2 is unmeasured.
//
// The telemetry's load-bearing arithmetic lives in `computeChatRacePayload`
// — a pure function extracted so this smoke can pin the contract without
// mocking a DB. The marker string `CHAT_RACE_WARN_MARKER` is co-exported
// from session.ts and asserted here so a future rename produces a smoke
// failure instead of silent log drift.
//
// Contract pinned here:
//
//   1. currentLength == expectedBaselineLength  → null (no warn).
//   2. currentLength < expectedBaselineLength   → null (no warn; defensive).
//   3. currentLength >  expectedBaselineLength  → payload with the precise
//                                                  lostMessages count and the
//                                                  sessionId / incomingLength
//                                                  echoed back for log triage.
//   4. The warn-marker string contains "ADR-0048" so log greps work.
//
// Run with `bun run chat-session-race:smoke`.

import {
  CHAT_RACE_WARN_MARKER,
  computeChatRacePayload,
  type ChatRacePayload,
} from './session.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[chat-session-race:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Marker contract
// ---------------------------------------------------------------------------

assert(
  CHAT_RACE_WARN_MARKER.includes('ADR-0048'),
  `marker must contain ADR-0048 for log greps. got: "${CHAT_RACE_WARN_MARKER}"`,
);
assert(
  CHAT_RACE_WARN_MARKER.includes('[chat/session]'),
  `marker must carry the subsystem prefix. got: "${CHAT_RACE_WARN_MARKER}"`,
);

// ---------------------------------------------------------------------------
// Scenario 1 — baseline equals current → no warn.
// ---------------------------------------------------------------------------

{
  const payload = computeChatRacePayload({
    sessionId: 'sess-1',
    currentLength: 2,
    expectedBaselineLength: 2,
    incomingLength: 3,
  });
  assert(payload === null, `scenario 1: baseline==current must return null, got: ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// Scenario 2 — current < baseline → defensively returns null. This shouldn't
// happen in practice (we always read AFTER the baseline was captured) but
// the pure function must not throw or report negative lostMessages.
// ---------------------------------------------------------------------------

{
  const payload = computeChatRacePayload({
    sessionId: 'sess-2',
    currentLength: 1,
    expectedBaselineLength: 5,
    incomingLength: 6,
  });
  assert(payload === null, `scenario 2: current<baseline must return null, got: ${JSON.stringify(payload)}`);
}

// ---------------------------------------------------------------------------
// Scenario 3 — current > baseline → payload with the precise math.
// Reproduces "Tab A loaded 2; Tab B already wrote, persisted is now 4;
// Tab A is overwriting with 3 messages."
// ---------------------------------------------------------------------------

{
  const payload = computeChatRacePayload({
    sessionId: 'sess-3',
    currentLength: 4,
    expectedBaselineLength: 2,
    incomingLength: 3,
  });
  assert(payload !== null, 'scenario 3: race MUST produce a payload');
  const p = payload as ChatRacePayload;
  assert(p.sessionId === 'sess-3', `scenario 3: sessionId echo, got: ${p.sessionId}`);
  assert(p.currentLength === 4, `scenario 3: currentLength=4, got: ${String(p.currentLength)}`);
  assert(
    p.expectedBaselineLength === 2,
    `scenario 3: expectedBaselineLength=2, got: ${String(p.expectedBaselineLength)}`,
  );
  assert(
    p.incomingLength === 3,
    `scenario 3: incomingLength=3, got: ${String(p.incomingLength)}`,
  );
  assert(p.lostMessages === 2, `scenario 3: lostMessages=4-2=2, got: ${String(p.lostMessages)}`);
}

// ---------------------------------------------------------------------------
// Scenario 4 — a one-write race (the most common case): baseline=3,
// current=4, incoming=4. lostMessages must be exactly 1.
// ---------------------------------------------------------------------------

{
  const payload = computeChatRacePayload({
    sessionId: 'sess-4',
    currentLength: 4,
    expectedBaselineLength: 3,
    incomingLength: 4,
  });
  assert(payload !== null, 'scenario 4: one-write race MUST produce a payload');
  assert(
    (payload as ChatRacePayload).lostMessages === 1,
    `scenario 4: lostMessages=1, got: ${String((payload as ChatRacePayload).lostMessages)}`,
  );
}

console.log('✓ chat-session-race smoke passed (ADR 0048 telemetry hook)');
