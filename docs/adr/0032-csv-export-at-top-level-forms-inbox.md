# ADR 0032 — CSV export reachable from the top-level Forms inbox

**Status:** Accepted
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** beats S8.A.1, S8.A.2, S8.B.1 of [docs/demo/act-1-script.md](../demo/act-1-script.md). The script wants the Owner to export a form's submissions as CSV directly from the top-level Forms inbox, without first drilling into `/forms/{formId}`. Named as the fix in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.5.

## Context

The Forms inbox dashboard has two surfaces:

- The **top-level forms list** at [src/routes/dashboard/forms-inbox.tsx:357](../../src/routes/dashboard/forms-inbox.tsx) — one row per form on the site, with submission counts and the last-submitted timestamp.
- The **per-form submissions view** at [src/routes/dashboard/forms-inbox.tsx:531](../../src/routes/dashboard/forms-inbox.tsx) — the `/forms/{formId}` route, where the **Export CSV** link lives today.

The Owner who wants a CSV for one form has to click the form row, land on `/forms/{formId}`, then click Export. The recording script treats that intermediate page as an unnecessary step: S8.A.1 covers the top-level totals, S8.A.2 drills into a single submission for full detail, and S8.B.1 expects Export to be reachable at the top level — not gated behind a navigation.

The CSV-generating route already exists at the per-form surface and produces a per-form file. Adding a second entry point should not duplicate the generator; it should re-use the same endpoint. A top-level Forms inbox for a site with N forms emits N possible CSVs — one per form — not a combined "everything" export.

## Decisions

1. **The top-level Forms inbox grows a per-row CSV download control.** Each form row exposes its own export trigger; there is no global "export all forms" button. The control hits the existing per-form CSV endpoint with the row's `formId`.

   **Why:** the existing per-form route is already the canonical CSV generator — re-using it keeps one code path responsible for the response (headers, filename, row format). A new top-level "combined" export would invent a different output shape (which form's columns win? how are mixed schemas reconciled?) and answer a question no one in the script is asking. Per-row matches the data: each form is its own schema and its own CSV.

2. **The control is rendered as a small icon (download glyph) at the right end of each row, not a full-width button.** It carries a visible tooltip on hover (`Download CSV`) and an `aria-label` reading `Download submissions CSV for <form name>`.

   **Why:** the top-level inbox row is dense (form name, counts, last-submitted timestamp); a text button would crowd it and shift the row's visual centre away from the form identity. An icon keeps the row scannable, and the per-row `aria-label` interpolating the form name keeps the action unambiguous for screen-reader users who hear the icons sequentially. Tooltip text is the same phrase as the per-form Export link's label for cross-surface consistency.

3. **The icon hits the same route handler as the per-form Export link — no new endpoint, no client-side filter.** The handler is unaware of which surface the request came from; it sees a `formId` and produces that form's CSV.

   **Why:** two entry points to one action means one response contract. A separate top-level route would force two implementations of the same generator to stay in sync; the first time someone fixes a CSV bug at the per-form route and forgets the top-level twin, the surfaces diverge silently. Sharing the URL also means a browser-history hit on the CSV download works identically from either surface.

4. **Clicking the icon triggers the download in-place; it does not navigate the Owner away from the top-level inbox.** The row stays visible, the URL bar does not change to `/forms/{formId}`.

   **Why:** the whole point of the top-level icon is to remove the navigation step. Navigating as a side-effect of the download would defeat that. The endpoint already returns a `Content-Disposition: attachment` response, so the browser handles the file save without a route change.

## Out of scope

- A combined "export every form on this site as one CSV" action. Not in the script, not in the handoff, and the schema-reconciliation question makes it a distinct feature.
- Per-submission CSV (one row at a time). The per-submission detail view is its own beat (S8.A.2) and is not the export surface.
- Format negotiation (JSON, XLSX, etc.). CSV is the only format the existing endpoint emits; multi-format is a separate decision.
- The per-form `/forms/{formId}` Export link itself. It stays exactly as it is; this ADR only adds a second entry point to the same action.
- Loading / progress UI for large exports. The endpoint streams; the icon click is a normal link-triggered download.

## Consequences

**Positive:**
- Script S8.B.1 records without the Owner detouring through `/forms/{formId}`.
- One CSV-generating route, two surfaces — bug fixes and format changes land in one place.
- Per-row icon scales naturally as forms are added: each new row gets its own export without inbox-wide layout changes.
- Screen-reader users get per-form `aria-label` text instead of a generic "Export" that requires row context.

**Negative:**
- An icon-only control is less discoverable than a text button for first-time Owners. Mitigated by the `Download CSV` hover tooltip; not eliminated.
- Two visible Export entry points (top-level icon + per-form link) is a small redundancy. Acceptable because they share one endpoint; the redundancy is at the UI layer only.

## Follow-ups

- Identify a download glyph consistent with the dashboard's existing iconography (the same set used elsewhere in `forms-inbox.tsx`'s row controls).
- Confirm the per-form CSV endpoint's URL is stable enough for the icon to link to directly; if it is currently a form-`POST` or session-scoped, the icon's link target needs the same affordance.
- Grep the dashboard's Playwright smokes for assertions that the only Export entry point is at `/forms/{formId}`; relax those so the top-level icon does not break them.
- Add the top-level CSV path to the recording script's S8 shot list so future Pass-N drives exercise it.
