# Follow Ups

## Resolution — 2026-06-21

- Raydotsh Fidelity Track is implemented on `feat/raydotsh-next-fidelity` in
  `0ecb37ad feat: reauthor raydotsh project primitives`.
- Runtime Hydrator Shared Adapter Track is implemented on
  `refactor/video-hover-shared-adapter` in
  `f16e570d refactor: share video hover runtime adapter`.
- Verified both commits through the repository pre-commit hook:
  `lint-staged --no-stash`, `bun run typecheck`, and `bun run ci:smoke`.
- Re-ran `bun run raydotsh-portfolio:smoke` after fast-forwarding the root
  Raydotsh branch.
- Local asset seeding was verified with `bun run seed:assets`; remote upload
  was not run because it writes to R2 + DB.
- Scroll Scene was not started. The Video Hover adapter branch should land
  first so Scroll Scene starts after the duplicated adapter pattern is reduced.

## Raydotsh Fidelity Track

Branch: `feat/raydotsh-next-fidelity`

Recent commits:

- `921d807 feat: apply raydotsh typewriter greeting`
- `6e8cffb feat: add reveal sequence child targets`
- `2bcc567 feat: add responsive layout variants`

Verification already passed during the latest commits:

- `bun run typecheck`
- Full configured smoke suite from the commit hook
- Focused checks for Issue 5:
  - `bun run responsive:smoke`
  - `bun run yjs-projection:smoke`
  - `bun run create-editor-runtime:smoke`
  - `bun run typecheck`

### Next Implementation Work

1. Re-author the Raydotsh template sections to actually use the new primitives.

   The primitives now exist, but the Raydotsh template still needs section-level authoring changes:

   - Use Motion Sequence `children-of` targets for repeated list/card reveal behavior.
   - Group relevant Raydotsh cards/lists into compound containers where child-index reveal makes sense.
   - Add `responsiveVariants` on sections that need separate desktop and phone child trees.
   - Keep the fidelity ledger honest: only move an item to `native` after the Raydotsh smoke proves the behavior is represented by schema/runtime primitives.

2. Run the Raydotsh smoke after template re-authoring.

   Command:

   ```powershell
   bun run raydotsh-portfolio:smoke
   ```

   Expected outcome:

   - Template validates.
   - Ledger statuses match the real primitive coverage.
   - No approximate/missing status is cleared unless the actual Raydotsh template uses the new primitive.

3. Re-check focused primitives if the Raydotsh template changes touch them.

   Useful commands:

   ```powershell
   bun run behaviour-primitives:smoke
   bun run behaviour-runtime:smoke
   bun run responsive:smoke
   bun run yjs-projection:smoke
   bun run typecheck
   ```

4. Seed/upload assets for global availability after local template behavior is correct.

   Likely command:

   ```powershell
   bun run seed:assets --upload --remote
   ```

   Do this after the local Raydotsh smoke is green so uploaded state is not ahead of the verified template.

### Known Gaps To Keep Separate

- `.codex-screens/` is currently untracked and was not included in commits.
- The reveal primitive currently resolves descendant elements under a compound host in DOM order. That works for simple flow/card groups; nested compound cases may need a direct-child metadata relation later if the template requires it.
- Responsive layout variants are section-level metadata. They do not automatically redesign Raydotsh sections; the section data still needs explicit desktop/tablet/phone variant authoring.
- R2/global asset availability is still a deployment/seed step, not part of the local primitive commits.

### Possible Commit Boundaries

- `feat: apply raydotsh reveal sequences`
- `feat: add raydotsh responsive variants`
- `test: verify raydotsh faithful template behavior`
- `chore: upload raydotsh seed assets`

## Runtime Hydrator Shared Adapter Track

Status: landed on `main` and pushed to `origin/main`.

Landed commit:

- `0eae183d refactor: share marquee runtime adapter`

What landed:

- Marquee is now the first shared-source Runtime Hydrator adapter.
- `src/interactive/marquee.ts` exports the typed `hydrateMarquees` implementation and generates `MARQUEE_RUNTIME_SRC` from those same functions.
- `src/editor-client/hydrate-interactives.ts` imports the shared marquee hydrator instead of carrying a duplicate local implementation.
- Smoke coverage now verifies shared-source generation, editor import/no local hydrator, exact editor chrome class matching, and no silent lane animation skip when `animate` is missing.

Verification on merged `main` before push:

```powershell
bun run typecheck
bun run ci:smoke
```

Both exited 0. The smoke suite still prints existing harness warning/log noise, including seed fallback diagnostics, KaTeX quirks-mode warnings, behaviour failure-event fixtures, and editor test environment notices.

Cleaned up:

- Removed worktree `C:/Repo/open-canvas/.worktrees/runtime-hydrator-marquee-adapter`.
- Removed temporary landing worktree `C:/Repo/open-canvas/.worktrees/main-landing`.
- Deleted local branch `feat/runtime-hydrator-marquee-adapter` after verifying it was an ancestor of `main`.

### Next Runtime Hydrator Work

1. Convert Video Hover into the next shared-source Runtime Hydrator adapter.

   Current state: Video Hover still follows the duplicated editor-vs-visitor pattern that Marquee just escaped.

   Target outcome:

   - Editor imports the typed Video Hover implementation from `src/interactive/video-hover.ts` or an equivalent shared module.
   - Visitor runtime string is generated from that same implementation.
   - Existing `video-hover-runtime:smoke`, `video-hover-inspector:smoke`, `runtime-hydrator-parity:smoke`, and `reduced-motion-preview:smoke` continue to pass.

2. After Video Hover, start the Scroll Scene slice in a fresh worktree.

   Pushback: do not start Scroll Scene until the remaining duplicated adapter pattern is reduced. Scroll Scene will add enough runtime surface that keeping duplicate adapter sources around will make parity bugs harder to isolate.

3. Keep using Gemini CLI for subagents.

   Memory was updated earlier to require:

   ```powershell
   gemini -m auto -p "<prompt>"
   ```

   Main agent still owns review, integration, and verification.
