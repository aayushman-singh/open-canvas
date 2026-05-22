# ADR 0004 — Owner-rooted assets and their lifecycle

**Status:** Accepted
**Date:** 2026-05-22
**Author:** Aayushman Singh
**Supersedes:** the per-site asset assumption in ADR 0001

## Context

The owner experience the product is being built toward is: open any editable site, click an image slot, see the few images that have lived in that slot, and below that see every image the owner has ever kept across all their sites. Pick one and the canvas updates instantly. Generate one with AI, decide whether to keep it, and only the kept ones populate the library.

The current implementation roots every uploaded or generated image under one editable site. Assets cascade-delete with their site. AI image generation persists bytes the moment Replicate responds, before the owner has decided to use the result. There is no concept of an asset that belongs to the owner rather than to a site, and no concept of a media element having a history of previous occupants.

The product outcome requires those concepts. Sites stop being the asset root, the owner becomes the asset root, AI previews stop being assets until the owner accepts them, and deleting an asset stops being a quiet cascade off a site delete and becomes an explicit owner choice with a named consequence list.

## Decisions

1. **An Owner Asset is the root concept for owner-produced media; sites only reference it.**

   **Why:** the user-perceived feature is "the gallery shows every image I've kept." That cannot be true while assets are scoped to a single editable site. Re-rooting assets to the owner makes the gallery a literal description of the truth instead of a fiction synthesised across sites. The cost — a new `owner_asset` table, reparenting existing `site_asset` rows from `siteId` to the site's `customerId`, preserving the asset id so canvas JSON keeps resolving — is paid once. The visitor asset route shifts from "this asset belongs to this site" to "this asset is referenced by a published snapshot the visitor can reach," which is the same intent expressed against the new root.

2. **AI generation previews are not Owner Assets until the owner applies them to a slot.**

   **Why:** the owner is supposed to see only images they decided to keep. Persisting every Replicate response would fill the gallery with images the owner rejected and make the "kept" framing dishonest. The bytes return from the generate endpoint to the browser. The browser holds them through the preview moment. Only on Apply does the browser POST the bytes back and the server create the Owner Asset. Discarded previews are gone when the tab closes. The server holds no transient asset state, which removes the need for a cleanup job that would not otherwise exist.

3. **Deleting an Owner Asset requires the owner to confirm the named consequences for every editable site, every media element, and every published site that references it.**

   **Why:** an asset can be referenced by media elements across many sites and by zero or more published snapshots that visitors are reading right now. Blocking deletion entirely is paternalistic in the face of an owner who genuinely wants the image gone. Silent cascade is the failure mode the project explicitly rejects: a visitor would see a broken image on a live public address with no signal sent to the owner. Confirm-cascade names every consequence at the moment of the choice — "deletes this image, leaves slot X in site Y blank, breaks the live site at coffee.aayushman.dev until you re-publish" — and proceeds only after the owner accepts those words. The failure is loud at the moment of decision rather than silent at the moment of harm.

4. **Slot History lives in a sibling table, not in the canvas JSON.**

   **Why:** the history exists to make the editor experience feel like the owner has a record. Visitors never read it. Keeping it out of the canvas JSON keeps the published snapshot lean and avoids a filtering step at the publish boundary every time the snapshot is produced. A `slot_history` table keyed by `(siteId, elementId)` carries the ordered list of `(ownerAssetId, usedAt)` rows. Rows are removed when the media element is deleted and when the referenced Owner Asset is deleted.

## Out of scope

This ADR does not decide:
- Storage backend for Owner Asset bytes (today they live inline in Neon as base64; an object-storage move is a separate decision)
- Cross-owner sharing of assets, marketplace concepts, or owner-to-owner gifting
- Image transformations, server-side resize variants, or responsive `srcset` generation
- Quotas, per-owner asset budgets, or billing implications of cross-site reuse
- Rich filtering, tagging, search, or folder organisation in the gallery
- Multi-version history (the model is per-slot MRU, not versioned)
- Concurrent edits to the same slot from multiple editor sessions

## Consequences

**Positive:**
- The gallery feature can be specified as a literal description of the data: "show every Owner Asset, ordered by last use." No synthesis layer needed.
- AI generation cost is paid in Replicate; storage cost is only paid for kept results.
- Deletion is honest. The owner is never surprised by where the asset was being used.
- Slot History does not bloat published snapshots.
- An Owner Asset survives any single site's deletion, matching the owner's mental model of "my images are mine."

**Negative:**
- A migration is required: existing `site_asset` rows must be reparented to the owning customer, ids preserved, `site_id` column replaced by a `customer_id` column. Visitor route logic must be re-stated against the new root.
- The AI generate endpoint changes contract: it returns bytes to the client and no longer creates a persistent row. Any caller depending on the prior side effect breaks.
- Deletion is more work to ship than a cascade — the confirm-cascade flow must compute references across editable states and published snapshots, render the affected list, and only then apply the delete.
- The Slot History table is a third table touched on every media swap, alongside the canvas state and the asset. Writes per swap go up.

## Follow-ups

- A migration step to copy `site_asset` rows into `owner_asset` and rewrite the visitor asset route.
- Update of the AI generate route to return bytes rather than persist them, and a matching client change that POSTs the bytes back on Apply.
- A media-element-deletion path that purges its Slot History.
- A future ADR if and when Owner Asset bytes move out of Neon into object storage.
