# ADR 0043 — In-app notifications: persistent, recipient-tagged, delivered live over the existing site-room socket

**Status:** Proposed
**Date:** 2026-06-01
**Author:** Aayushman Singh
**Drives:** the Owner-asks-have-I-missed-anything gap. Today an Owner who steps away from the editor has no signal that a form was submitted, a collaborator joined, a publish failed, or their own access was revoked — they have to remember to check the Forms inbox, the collaborators panel, the publish history, and the Site Settings page. The events exist; the Owner-perceived signal does not.

## Context

A rev01 Owner today juggles four classes of async events that land on their site or account while they are not actively looking:

1. **Form submissions.** A Visitor fills out a contact/lead form; the row lands in the Forms inbox. The Owner has to remember to open `Dashboard → Forms` to find it. There is no in-app prompt.
2. **Collaborator events.** Another Owner accepts a co-edit invite, leaves a site, or has their role changed. The collaborators panel updates only when the page is refreshed.
3. **Publish events.** A publish completes or fails (sync today; potentially async if background retry is added). The in-editor toast is the only signal and it disappears in 5 seconds — the Owner who looks away misses it.
4. **Their own access changing.** Another Owner revokes their role on a shared site, or changes them from `editor` to `viewer`. Today the next attempt to open the editor 403s out of nowhere; the affected Owner has zero pre-event signal.

In all four cases the underlying event already commits to Neon (forms inbox row, role row, publish history row). What is missing is a write-once, read-many, per-recipient inbox the Owner can scan and act on.

The Owner-perceived "done" looks like: a bell with an unread count, visible from both the dashboard and the canvas editor; clicking it opens a list of recent events with a one-line summary and a "go here" link; the badge clears as items are read; the Owner can lose their place, close the tab, return the next day, and still see what happened.

Some of the events are addressed to *me, the person* (somebody invited me; somebody revoked my access). Others are addressed to *the site I share with two other collaborators* (a form landed on our site; a publish completed; somebody else joined our site). Both classes need to coexist, and a single event sometimes generates both — `revokeAccess(meTrue, themFalse, siteS)` is "personal notif to me + site notif to the others on S who lost a teammate."

## Decisions

1. **Notifications are persisted in a single Neon table with a tagged-union recipient (`recipient_kind ∈ {owner, site}`). One row never crosses recipient classes; fan-out happens at write time.**

   **Why:** the Owner needs to see their full history regardless of which event class produced it; one inbox query has to surface both personal and site notifs the Owner can act on. A tagged-union row tagged at write time lets the inbox query stay shape-uniform: `SELECT … WHERE (recipient_kind='owner' AND recipient_id=$me) OR (recipient_kind='site' AND recipient_id = ANY($mySites))`. Splitting personal and site into two tables forces every reader to `UNION` them at read time and forces every "mark read" call to know which table it targets — both costs scale with every place we add a notification surface (dashboard, editor, future mobile).

   This would be wrong if personal and site notifs developed truly different shapes (different lifecycle, different retention policy, different access-control rules). Today they don't: both are bounded blobs the recipient reads then dismisses; both retain for the same period; both are gated by "the recipient is the addressed Owner, or a collaborator on the addressed site." If a future kind diverges (e.g. a long-lived "task" with sub-states), it gets its own table; this one stays focused on notifications.

2. **The `notifications` row shape is `(id, created_at, kind, recipient_kind, recipient_id, payload jsonb, read_at nullable)`.** `kind` is a string enum drawn from a closed `NOTIFICATION_KINDS` constant; `payload` is type-tagged jsonb specific to the kind; `read_at` is the single source of truth for "is this in the unread badge."

   **Why:** the Owner reads notifs as a flat list — date, summary, action link. Hoisting `kind` to a column rather than burying it inside `payload` lets the inbox query filter (`WHERE kind IN (…)` for type-specific views) and lets indexes target the unread-count hot path (`(recipient_kind, recipient_id) WHERE read_at IS NULL`). Putting `read_at` on the row (rather than a separate `notification_read` join table) means marking-read is a one-row update with no contention; the cost is that "this notif was read by collaborator A but not B" is not modeled — which is exactly correct for the *site*-tagged subset, because per decision 1, every collaborator gets their own row for personal events and the site-tagged events are intentionally shared-read.

   Wait — that last sentence is wrong on its face: site-tagged events are *one row* per site, so two collaborators marking-read would race. The decision: site-tagged read state is *per-collaborator*, modeled as a small `notification_reads (notification_id, owner_id, read_at)` join table that only site-kind notifs use. Personal notifs use the `read_at` column on the main row (since recipient is unique). The cost of one extra table is paid only for the site-kind read path; the inbox query becomes `LEFT JOIN notification_reads nr ON …` and treats the absence of a row as "unread for me." This is a real complexity; the alternative (every Owner gets their own row for site events too, fanning out on write) doubles the write cost per site event and makes "3 collaborators read the same form-submission notif" hit 3 rows instead of 1. We accept the join.

   This would be wrong if the payload shape stopped being kind-tagged (every notif having the same set of fields would obviate the jsonb), or if the site-collaborator count grew past low single digits (the join becomes expensive). Neither holds today.

3. **The four v1 kinds are `form_submission`, `collaborator_event` (invited/joined/left), `publish_event` (succeeded/failed), and `access_event` (role-changed/revoked).** Each kind has a typed payload defined in `src/notifications/kinds.ts` and a constructor (`buildFormSubmissionNotif`, etc.) that the upstream event handler calls inside the same transaction (or immediately after) that commits the underlying event.

   **Why:** the Owner experiences each kind as a different sentence (`"A new submission to the Contact form on apogee.example landed at 2:34pm"` vs `"Alice accepted your invite to apogee.example as an editor"`); coupling the payload shape to the kind makes that sentence a pure function of the row, not a per-place string-template chase. Building the notif at the same commit point as the underlying event means there is exactly one place per kind that needs to know how to spell the event; if a new kind is added, the compiler enforces that its payload shape, its constructor, and its renderer all land in the same PR. Decoupling write from event (e.g. via a background outbox poller) would buy retry resilience at the cost of "the publish landed but the notif hasn't been delivered yet" race, which is exactly the Owner-perceived inconsistency this ADR exists to fix.

   This would be wrong if the underlying event had a meaningfully different transactional boundary than the notification write — e.g. if form-submissions were processed by a worker that couldn't reach the notifications table. Today they can; if they ever can't, the outbox pattern lands then as an explicit ADR amendment with the user-facing trade-off named.

4. **Live delivery in open editor sessions reuses the existing per-site-room DO websocket; live delivery in open dashboard tabs uses 30s polling. There is no separate notification-DO or push channel.**

   **Why:** the Owner editing site `S` already has an open ws to the site-room DO for that site, used for co-edit. A site-kind notif targeting `S` broadcasts as a new `notification` ws message over that existing channel; every collaborator currently in the room sees it without any new connection. The dashboard is the place an Owner sits when they are *not* editing — a poll every 30s on `/api/notifications?since=T` is cheap and bounded; the cost of a new SSE channel per Owner (one open connection per Owner per dashboard tab) buys ~30s of latency reduction that the Owner does not perceive. Personal notifs need a place to land when the Owner is not in any site-room: the dashboard poll covers them. If the Owner is also editing some site, personal notifs piggyback on that ws too (the DO knows the connection's owner id and delivers any pending personal notifs on join + on broadcast). Push notifications (cross-device, tab-closed) are explicitly out of scope (see Out of scope).

   This would be wrong if 30s of dashboard latency turned out to matter (an Owner racing to catch a form submission before their phone notifies them about it), or if the per-site-room ws started routinely dropping (in which case live delivery becomes noisy and the polling has to carry the contract). Neither is current state.

5. **No silent fallback on the live channel.** If the ws broadcast fails (DO restart, transient network), the row already sits in Neon; the next poll or next reconnect surfaces it. There is no retry, no in-memory queue, no "delivered-flag" column.

   **Why:** per the no-fallback rule (CLAUDE.md), the system either delivers correctly or fails loudly. The persistent row is the truth; the ws is a UX nicety on top. A retry layer would add a separate failure mode (the queue itself dropping) without changing the correctness story. The Owner does not perceive a 5-second delay on first-load if the ws missed an event in the gap — the polling and the dashboard's reconnect-and-resync both close it. What they would perceive is a half-delivered queue silently dropping a notif, which the no-retry posture rules out.

   This would be wrong if there was no fallback read path at all — e.g. if dashboards relied purely on the ws and never polled. Decision 4 closes that gap.

6. **Marking-read is per-row, idempotent, and triggered by the Owner opening the notification in the inbox (or clicking its "go here" link).** No "mark all read" button in v1.

   **Why:** the Owner uses unread-count as a "did I deal with this?" signal; a "mark all read" button trains them to dismiss the count without engaging, which makes the signal lie. Forcing per-row read means the Owner who quickly skims the inbox to look for one specific notif does not accidentally lose track of the others. The cost is friction; the benefit is the signal remains honest. If usage data shows Owners routinely have 50+ unread (i.e. the friction outweighs the signal), the follow-up adds a bulk-read with an explicit confirmation step.

   This would be wrong if Owners habitually accumulated decorative notifs they had no obligation to act on (e.g. "Alice joined" three months ago) — in which case bulk-clear is the natural escape valve. v1's four kinds are all actionable; we ship without bulk-read and revisit.

## Out of scope

- **Email / SMS / mobile-push notifications.** The decision is in-app only. Email is a separate channel with its own consent + deliverability story; if added, a separate ADR names the relationship between in-app and email (do they replace each other? duplicate? does in-app "read" mark the email "read"?). Out of v1.
- **Web Push API + service worker for cross-device, tab-closed notifs.** Real cost (SW lifecycle, endpoint registry, permissions UX); separate ADR if a real Owner asks.
- **Mentions (`@user` inside editor content or comments).** Requires a comment/discussion model that does not yet exist; out until that lands.
- **Notification preferences (turn off a kind).** Defer until usage data shows real opt-out demand. Today the four kinds are all actionable; opt-out before evidence risks letting Owners silence the signal they need.
- **Visitor-facing notifications.** The page Visitor is anonymous; nothing about this ADR applies to them.
- **Cross-fork notifications.** Each fork is a separate deployment; cross-fork is meaningless.
- **Retention beyond 90 days.** A `created_at < now() - interval '90 days'` soft-delete is sketched in Follow-ups; the exact policy is a separate decision once real volume is observable.
- **A "Notifications" route in the editor sidebar.** v1 puts the bell + inbox in the dashboard top-bar and the editor's top-right header cluster; no full-page route, no sidebar entry.

## Consequences

**Positive:**

- The Owner gets a single, persistent surface for the four async event classes they care about. Form submissions, collaborator changes, publish outcomes, and access changes all surface without the Owner having to check four different panels.
- The hybrid recipient model means personal asks (someone invited me, my role changed) sit alongside site events (forms landed on our site, we published) in the same inbox query — the Owner doesn't have to know which kind they're looking for.
- Live delivery for editing collaborators is free (one new message type on the existing site-room ws). Live delivery for dashboard sitters is cheap (30s poll, bounded query).
- The notification row in Neon is the source of truth; the ws is an accelerant. A DO restart, a transient network drop, or a tab refresh all converge on the same persisted state — no half-delivered queue to debug.
- The row shape supports growth: new kinds are a new enum value + new payload shape + new constructor + new renderer; the inbox query stays unchanged.

**Negative:**

- The `notification_reads` join table for site-kind read state is a real complexity. The alternative (per-collaborator row on every site event) saves the join but trades it for write fan-out cost — we picked the join. A future refactor may revisit if the join shows up in slow-query analytics.
- The constructor pattern means every upstream event handler now writes one extra row inside its transaction. For form submissions (~rare) and collab events (~rare), this is invisible. For publish events on a high-frequency republish setup, the cost is one row per publish.
- The dashboard poll adds a recurring `/api/notifications?since=T` request per open dashboard tab. At 30s and bounded query, the cost is small; if many Owners leave dashboard tabs open, aggregate request volume rises. A push-style channel (SSE) would replace polling at the cost of a long-lived connection per Owner-tab — explicitly deferred per decision 4.
- No bulk-read means an Owner who comes back from vacation faces 50+ unread items they have to click through. The follow-up names the escape valve.
- The four kinds are hard-coded; a fork wanting a fifth has to land an ADR + a constructor + a renderer. This is intentional — drift is expensive — but it does mean v1 is a deliberate commitment, not a pluggable framework.

## Follow-ups

- **Retention.** A nightly job soft-deletes `notifications` and `notification_reads` rows older than 90 days. Either the existing scheduler or a `cron` trigger; ADR amendment if 90 days is wrong for a compliance reason.
- **Bulk-mark-read.** If usage shows Owners routinely accumulate 50+ unread, ship "mark all as read" as an action with a 2-step confirm (modal: "this clears N notifs, are you sure?"). Triggered by a separate small ADR or amendment if it lands during this release cycle.
- **Email delivery for Owners who are away from the app.** Each kind decides individually whether it warrants email; the trigger is per-kind. Separate ADR.
- **Mentions / comments-in-editor.** Out until the comment model lands; that ADR will then name how mentions become personal notifs of a new kind.
- **Notification preferences UI.** Defer until evidence; if a kind becomes "noise" we surface opt-out at that point.
- **Cross-tab dedup.** An Owner with two dashboard tabs open polls twice; both render the same unread badge. No correctness problem; consider a `BroadcastChannel`-based dedup if it becomes visible.
- **Editor header surface.** v1 puts the bell in the editor's top-right cluster (next to the existing settings gear / A11y link). Visual treatment is owned by the editor-client work and is not constrained here beyond "the bell shows the unread count from `/api/notifications?since=…&unreadOnly=true`."
- **Site-room ws message-type tax.** Adding a new message type to the per-site DO ws means the existing co-edit client must learn to ignore unknown types gracefully; if it doesn't already, this ADR's PR adds that.
