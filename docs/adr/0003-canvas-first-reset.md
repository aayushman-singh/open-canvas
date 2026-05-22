# ADR 0003 — Canvas-first reset

**Status:** Accepted
**Date:** 2026-05-22
**Author:** Aayushman Singh

## Context

The original implementation was built around a ProseMirror document where sections contain flow content. The product goal has moved to a desktop canvas site builder: every section is a bounded canvas, elements can be positioned and resized, AI edits are previewed before applying, themes recolour the whole site, and publish promotes a separate visitor-facing snapshot to a real public address.

## Decisions

1. **Rebuild the product surface around canvas pages.**

   **Why:** canvas positioning is a root document concern, not a toolbar feature. Keeping ProseMirror as the page model would make positioning, resizing, section recipes, and publish snapshots fight the data model.

2. **Reuse the repo and useful foundations instead of creating a new repository.**

   **Why:** the existing Worker, Hono, Drizzle/Neon, Clerk, theme derivation, docs, environment, and deployment setup are still aligned with the target; only the page model and editing surface are wrong.

3. **Retire ProseMirror as the page model for the POC.**

   **Why:** ProseMirror can still inform rich text behaviour inside a text element later, but the POC needs canvas JSON as the canonical editable and published page state.

## Out of scope

This ADR does not decide the final canvas schema, AI operation schema, asset storage provider, or visitor live-update transport.

## Consequences

**Positive:**
- The implementation can be shaped directly around the target demo.
- Existing infrastructure work is not thrown away.
- The POC can stay smaller than a migration from flow documents to canvas documents.

**Negative:**
- Existing ProseMirror editor, document renderer, and multiplayer schema work become reference material rather than production paths.
- Some README and architecture docs must be updated to stop advertising the old model.

## Follow-ups

- ADR 0004 — Canvas page schema and publish contract.
