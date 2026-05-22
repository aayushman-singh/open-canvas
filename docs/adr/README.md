# Architecture Decision Records

This directory holds rev01's Architecture Decision Records (ADRs). Each ADR captures one architectural decision, its context, its consequences, and any follow-ups.

> **Note.** ADR 0001 lives at [`docs/architecture/0001-architecture.md`](../architecture/0001-architecture.md) for historical reasons (it was authored before this index existed). All subsequent ADRs live in this directory.

---

## Index

| Number | Title | Status | Location |
|--------|-------|--------|----------|
| 0001 | rev01 architecture | Accepted | [`docs/architecture/0001-architecture.md`](../architecture/0001-architecture.md) |
| 0002 | Published address routing | Accepted | [`docs/adr/0002-published-address.md`](0002-published-address.md) |
| 0003 | Canvas-first reset | Accepted | [`docs/adr/0003-canvas-first-reset.md`](0003-canvas-first-reset.md) |

Add new ADRs here. Keep the index sorted by number.

---

## File naming

`NNNN-kebab-title.md` — four-digit zero-padded number, kebab-cased title, no date in the filename. The date lives inside the file.

Examples:
- `0002-document-schema.md`
- `0003-multiplayer-transport.md`
- `0004-agent-tool-surface.md`

---

## Status flow

```
Proposed ──┬──► Accepted ──► Superseded (by ADR NNNN)
           └──► Rejected
```

- **Proposed** — drafted, under discussion, not yet binding.
- **Accepted** — the decision stands; the codebase must conform.
- **Rejected** — explored, declined. The ADR stays in the repo as the record of why.
- **Superseded** — replaced by a later ADR. The header points to the successor.

Never delete an ADR. A rejected or superseded decision is part of the audit trail.

---

## Required sections

Every ADR has exactly these top-level sections, in this order:

1. **Header** — `Status`, `Date`, `Author` (and `Supersedes` / `Superseded by` if applicable).
2. **Context** — the user-perceived problem and the constraints that frame the decision. No mechanism yet.
3. **Decisions** — the choices made. Numbered. Each has a one-line statement and a "Why" paragraph.
4. **Out of scope** — what this ADR explicitly does *not* decide. Closes the door on scope creep.
5. **Consequences** — positive and negative trade-offs that fall out of the decisions.
6. **Follow-ups** — pointers to ADRs that must come next (with proposed numbers if known).

Decisions in the "Decisions" section are immutable once Accepted. Change of mind = new ADR that supersedes the old one.

---

## Authoring rules

- Reason from the **user's experience of "done"** first. The "why" of every decision must trace to a user-perceived outcome, not an internal preference.
- Write each "Why" as a falsifiable claim — what would have to be true in the world for this decision to be wrong?
- One ADR per coherent decision cluster. Do not bundle unrelated decisions to save numbering.
- Decisions are conceptual. Name *what* the system does, not *which library does it*. Library choices belong inside the "Why" paragraph as evidence, not in the decision title.
- No fallbacks, no degraded modes. If a decision implies a failure path, name the failure path explicitly.
