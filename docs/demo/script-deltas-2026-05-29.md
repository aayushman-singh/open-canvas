# Script-vs-reality deltas — decisions queue (2026-05-29)

Per-row decisions for the script-vs-reality table that `dryrun-report.md` surfaced + ones I observed in this verification pass. Each row has the script claim, the live editor's actual behaviour, and a recommended call. The recommendation is the cheapest path that keeps Maya's narrative coherent; alternatives are noted.

A beat marked **trivial-script-fix** can be edited directly into [act-1-script.md](act-1-script.md) — no product change. Beats marked **product-change-needed** require either an editor update before recording, or a script rewrite.

> _Outdated as soon as the editor moves. If a row's "reality" changes, re-verify before recording._

---

## Quick wins (apply directly, no question)

| Beat       | Script                                                                           | Reality                                                                                                                                                                                                                   | Recommended call                                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S0.2**   | cursor lands on the **"Sign in"** button                                         | actual label is **"Launch dashboard"**                                                                                                                                                                                    | **trivial-script-fix.** Replace "Sign in" → "Launch dashboard" in the voiceover. Also the action: "Click 'Launch dashboard'."                                                                                                                    |
| **S0.3**   | "Let's start where she would start." Click "Sign in."                            | same delta as S0.2                                                                                                                                                                                                        | Update the action to "Click 'Launch dashboard.'"                                                                                                                                                                                                 |
| **S2.B.2** | "fourteen direct-add buttons for every element type, plus the style kits picker" | sidebar shows **14 buttons** (text, image, video, button, shape, container, chart, form, embed, code, accordion, carousel, table, nav) — Media is split into Image + Video, **Collection is in the Sections tab not Add** | **trivial-script-fix.** Keep "fourteen" but list the names explicitly. Move the Collection mention to S2.B.3 ("Sections — searchable catalog of section recipes she can drop in, plus the Collection element which lives here rather than Add"). |

These three are pure voiceover/action edits; no product change.

---

## S2.A topbar — four deltas, one decision (drop OR add)

S2.A.4–S2.A.7 all assume the topbar has Undo/Redo, Dark preview, RTL preview, plus separate AI/Chat buttons. The handoff confirmed the live topbar shows only: dashboard chip, published-address pill, **AI Chat** button, Settings, Save, Publish, Save as template.

Two paths, pick one:

| Option                                                                                                                                                                                                                                                          | Effect                                                                       | Cost                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **A. Drop the beats.** Cut S2.A.4 (Undo/Redo), S2.A.5 (Dark preview), S2.A.6 (RTL preview), and re-script S2.A.7 to match the actual topbar. Undo/Redo coverage moves to Ctrl+Z mention in S2.E. Dark/RTL preview moves to S5 element exercise (mentions only). | **Honest with current product.** Loses three minutes of editor-tour density. | trivial-script-fix only.                                                            |
| **B. Add the buttons.** Wire Undo/Redo, Dark preview toggle, RTL preview toggle into the editor topbar before recording.                                                                                                                                        | **Matches the script as written.** Adds product polish viewers see.          | medium product change (4 button slots + handlers in `src/editor/canvas-client.ts`). |

**Recommendation: A.** Recording is overdue, product polish doesn't change the architectural story. The script's editor tour is densest in S2.B (sidebar tabs + inspector) anyway — losing 4 topbar beats doesn't gut the session.

**If A:** rewrite S2.A.4 as `"Editor controls: undo and redo wrap the underlying Yjs history. Use Ctrl+Z and Ctrl+Y" + show Ctrl+Z + Ctrl+Y keystrokes hitting the Yjs undo. No button click.`

---

## S2.C/D AI Agent vs AI Chat — collapse into one surface

The script splits AI into two distinct surfaces:

- **S2.C** an "AI Agent prompt modal" — one-shot bulk rebrand
- **S2.D** an "AI Chat slide-out panel" — iterative refinement

Reality: only the **AI Chat** button exists in the topbar. There is no separate Agent modal.

Three options:

| Option                                                                                                                                                                                                                                                   | Effect                                                         | Cost                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------- |
| **A. Collapse into one chat-only flow.** Merge S2.C and S2.D under a single "AI Chat panel" session. First few prompts: bulk rebrand ("Rename every Apogee..."). Then iterative refinement ("Hero copy calmer..."). Both happen in the same chat thread. | Most honest, removes a fictional surface.                      | trivial-script-fix.          |
| **B. Add the Agent modal.** Introduce a one-shot AI Agent prompt modal as a separate topbar button + dedicated surface.                                                                                                                                  | Matches script.                                                | medium-large product change. |
| **C. Demo the chat in two phases as if they were different surfaces.** Camera framing makes the same chat panel look like two different uses.                                                                                                            | Coverage stays, no product change, but it's deceptive viewing. | trivial-script-fix.          |

**Recommendation: A.** Honest, the narrative still works: "AI Chat — same model under the hood, can do one-shot batches OR multi-turn refinement. Watch."

---

## S2.C.4 "Thirty-four operations in one batch" — chat batches 1–2 at a time

The dryrun observed the agent batches 1-2 ops per Accept card and lost track around 14 ops on Apogee. The deterministic 34-op rebrand only landed cleanly after a direct mass-apply bypassing the chat.

| Option                                                                                                                                                                                 | Effect                                           | Cost                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Honest small-batch recording.** Maya runs the rebrand prompt, accepts the first 6-8 op cards as they stream, voiceover frames this as "the agent shows me each batch as it goes." | Matches reality, viewers see the actual UX.      | trivial-script-fix (voiceover + S2.C.5 caption: "She accepts each batch as it arrives" instead of "Scroll the stack."). |
| **B. Pre-seed a smaller starting state.** Use a 6-page slim Apogee variant where 34 ops fits in one batch.                                                                             | Matches the original "34 ops one batch" framing. | medium fixture change.                                                                                                  |
| **C. Add a system-prompt directive** asking the agent to emit ≥N ops at once.                                                                                                          | Matches framing, no fixture change.              | small orchestrator change in `src/agent/chat/orchestrator.ts` system prompt.                                            |

**Recommendation: A.** Aligns with the chat-concurrency boundary memory — single chat at a time, multiple op-cards is fine. Viewers see the real model behavior. Honest narration wins.

---

## S2.D.4 "two text proposals from chat" — chat emits one at a time

The chat panel returns one preview card per prompt, with an Accept button. No two-option choice picker.

| Option                                                                                                                                                                                 | Effect                     | Cost                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| **A. Two prompts.** Maya sends prompt 1 ("Rewrite the hero heading. Option 1 please."), accepts, then sends prompt 2 ("Now option 2 — alternative tone."), compares the two on-screen. | Matches the per-card flow. | trivial-script-fix.    |
| **B. Add a 2-option chat tool.** Extend the orchestrator to emit `rewriteText` with an alternatives array; the panel surfaces an A/B card.                                             | Matches script as written. | medium product change. |

**Recommendation: A.** Same chat-boundary reason as S2.C.4.

---

## S5.R "3 popup triggers" — fixture has popups removed

End of dryrun session removed popup-trigger sections (`wf-popup-exit`, `wf-popup-delay`, `wf-popup-scroll`) from `apogee-showcase.json` because they rendered as empty modals on Briar. New sites won't have them; Briar still has stale popup sections from the pre-removal fixture.

| Option                                                                                                                                                                                                                                           | Effect                                                       | Cost                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------- |
| **A. Add popup live via inspector.** Maya selects a section, opens the section inspector, picks a popup trigger from the popupTrigger dropdown, voiceover walks through exit-intent / delay / scroll-depth. No content editing inside the popup. | Demonstrates the feature without relying on fixture content. | trivial-script-fix.    |
| **B. Skip the popup beat entirely.** Cut S5.R from the element exercise.                                                                                                                                                                         | Loses ~30s of coverage for an under-developed area.          | trivial-script-fix.    |
| **C. Improve popup content editing first.** Per handoff "Editor support for popup _content_ editing is currently weak." Polish the inspector before recording.                                                                                   | Matches the most comprehensive beat.                         | medium product change. |

**Recommendation: A.** Trigger is the interesting bit; the popup content is incidental. Easy live add demonstrates the feature.

---

## S7 "A11y blocks publish" — the route ALREADY gates this

The handoff/dryrun listed P2-1 as "audit does not block publish." The publish route at [src/routes/api/publish.ts:300-310](../../src/routes/api/publish.ts#L300-L310) actually returns a structured 422 with `blockers[]` when `runAudit(editableState).blockerCount > 0`. The dryrun's Briar publish succeeded because Briar genuinely had no blocking a11y issues, not because the gate didn't fire.

**Recommendation: keep S7 as written, but verify on prod before recording.** Set Briar's hero media `alt` to empty (and `decorative: false`), attempt publish — expect 422 with blockers in body. Then re-add alt text and re-publish. The narrative in S7.A–H is accurate.

Cost: zero script change. One verification step.

---

## S1.2 "dashboard is empty" — owner at 3/3 sites

Maya's authenticated owner already has Briar + others sitting at the Free plan cap. The script claims the dashboard is empty at start.

| Option                                                                                                                                                                                                              | Effect                                                 | Cost                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------- |
| **A. Pre-record state explicit.** Add to S1's pre-record block: "Maya is recorded from a fresh Clerk session on a brand-new test account with 0 sites." Pre-record-state assumption rather than reactive narrative. | Recordable.                                            | trivial-script-fix. |
| **B. Use a Pro account.** Maya is on Pro with cap higher than 3. The plan-cap line never appears in the narrative anyway.                                                                                           | Recordable, also bumps account-settings beat in S11.I. | trivial-script-fix. |

**Recommendation: A.** Free plan matches the indie-founder persona better than Pro. Test account is cheap to refresh.

---

## S13 "v2 publish + live broadcast" — verified working

Was blocked by P0-1 (Worker 1102 on v2 publish). Re-verified working as part of this session — Briar published successfully through v13. The deferred-side-effects path (commit `deb3b17`) means the publish response returns immediately and the visitor broadcast fires in the waitUntil chain.

**Recommendation: keep S13 as written.** Note for the recording operator: between v1 publish and v2 publish, leave ~5 seconds so the deferred OG warmup finishes before the v2 attempt (otherwise the broadcast race produces a "no change visible to visitor" gap).

---

## Skipped beats — still need work after this fix

These were marked blocked in `dryrun-report.md` and remain so unless someone supplies the prerequisites:

| Beat                    | Blocker                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **I1 Sam collaborator** | needs a second authenticated Clerk account; recording operator's call.               |
| **S9 Custom domain**    | needs real DNS for `briar.app` (or a sandbox domain) pointed at Cloudflare for SaaS. |
| **S10 Addon Shop**      | only verified that the routes exist; not driven.                                     |
| **S11 Dashboard tour**  | surfaces exist; per-control behaviour not exercised.                                 |
| **S12 Version restore** | UI exists, restore flow not driven. Worth a single-restore drive before recording.   |

The other blocked beats (S13 v2 publish + AI Agent stress on a fresh site + POST /api/sites) are now unblocked per this session's verification.

---

## Editor-side product changes that would un-block deltas without re-scripting

If you want to keep the script as drafted and patch the product, these are the targeted changes ranked by leverage:

1. **Topbar Undo/Redo buttons** (resolves S2.A.4 and S5.T). Easiest of the four; Yjs history is already in place.
2. **Topbar Dark preview toggle** (resolves S2.A.5). Already a tokenized CSS variable swap per the script's Act 2 voiceover.
3. **Topbar RTL preview toggle** (resolves S2.A.6). Same shape as Dark preview.
4. **AI Agent prompt modal as a separate topbar surface** (resolves S2.C entirely). Largest piece, distinct UX.
5. **Collection direct-add button in the Add sidebar** (resolves S2.B.1/.2). Small.

None are recording-blockers; they're polish.

---

## Recommended action order for the recording operator

1. Apply the **quick wins** (S0.2, S0.3, S2.B.2) — pure voiceover edits in `act-1-script.md`.
2. Pick **Option A** for the topbar (drop the four beats) — edit the script accordingly.
3. Pick **Option A** for AI Agent vs AI Chat — collapse S2.C and S2.D under a single chat-panel beat.
4. Pick **Option A** for the 34-op batch (S2.C.4) — narrate the streaming batches honestly.
5. Pick **Option A** for the two-option chat (S2.D.4) — two sequential prompts.
6. Pick **Option A** for the popup beat (S5.R) — live-add via inspector.
7. Refresh the test owner account to 0 sites for S1.
8. Verify S7 on Briar with a deliberate alt-text removal — confirm 422 + blockers.
9. Record S13's v2 publish with a ~5s gap after v1 publish so the deferred warmup completes.

After this, the drafted sessions (S0–S2.E + S7 + S13 + the stub sessions S3–S12 once their tables land) should record cleanly straight through.
