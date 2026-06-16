# ADR 0071 - Load Experience and Route Transition

**Status:** Accepted
**Date:** 2026-06-16
**Author:** Aayushman Singh

## Context

The Owner-facing gap is first impression and navigation continuity. A template
author should be able to reproduce branded preloaders, media-readiness gates,
logo draws, mask openings, route wipes, shared-card movement, and coordinated
incoming page reveals. The visitor should feel a deliberate handoff from load to
page and from page to page.

Published Open Canvas pages are server-rendered multi-page HTML. The visitor
live-update script can replace snapshot HTML with `innerHTML`, but inline
scripts do not run after that swap, so hydration is currently one-shot. That
same weakness would break page transitions if route swaps were added without a
shared Runtime Hydrator.

Swup is a free page-transition library for server-rendered websites that owns
navigation lifecycle, content replacement, caching, preloading, browser history,
and page-view hooks: <https://swup.js.org/getting-started/>. The browser View
Transition API exists for animated transitions between views:
<https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>. Those
are implementation candidates; the domain concepts are Load Experience and
Route Transition.

## Decisions

1. **Load Experience is a site/page authored object, not an incidental loading
   spinner.**

   **Why:** designer preloaders carry brand, sequence, readiness, and handoff.
   A generic spinner cannot reproduce a logo draw, progress count, media gate,
   mask reveal, or "run once per session" rule. This would be wrong if the
   only need were dashboard waiting states. The need is visitor-facing template
   choreography.

2. **Readiness gates are explicit and bounded.**

   **Why:** a preloader that waits on invisible work can trap visitors. A Load
   Experience must declare which local assets, fonts, media, or document events
   gate the handoff, plus the explicit error surface when the gate fails. The
   runtime must not silently skip a declared gate. This would be wrong if
   readiness were optional decoration. The asked-for behaviour is a gate.

3. **Route Transition is a schema-owned navigation contract.**

   **Why:** a route transition needs outgoing sequence, incoming sequence,
   content-swap moment, optional shared Interaction Targets, scroll restoration,
   focus target, and hydration handoff. A router hook alone cannot express that
   in the editor or importer. This would be wrong if page transitions were just
   CSS classes on links. Designer transitions are stateful navigation
   choreography.

4. **Published pages stay server-rendered; the route runtime owns same-site
   navigation lifecycle.**

   **Why:** the existing public renderer, SEO path, password gate, assets,
   custom domains, and page routing already depend on server-rendered HTML.
   Turning published sites into a client SPA would add a large new system to
   solve animation. Swup fits the existing MPA shape by intercepting internal
   navigation, loading the next document, swapping the configured content
   container, and emitting lifecycle hooks. This would be wrong if the site
   model required client-side route data. It does not.

5. **Every content swap must call the Runtime Hydrator before the transition is
   considered complete.**

   **Why:** route transitions and live publish updates both replace DOM. If the
   new DOM is not hydrated, accordions, carousels, overlays, pointer effects,
   Motion Sequences, and Rich Motion Assets can render dead. This would be wrong
   if interactions were static HTML only. They are not.

6. **View Transition API is an approved adapter only for modes that can meet the
   same Open Canvas contract.**

   **Why:** browser-native view snapshots can help with shared-target movement,
   but the API is not the domain model and should not dictate which transitions
   the schema can describe. A Route Transition mode may use View Transitions
   when validation, browser support policy, focus, scroll restoration, and
   hydration are all explicit. This would be wrong if Open Canvas only targeted
   one browser engine. It does not.

7. **Navigation runtime failures keep the current page and emit an explicit
   failure event.**

   **Why:** half-swapping the page and then losing hydration creates the worst
   visitor state: visually new content with broken interactions. If fetching,
   parsing, swapping, animating, or hydrating a route transition fails, the
   current page remains active and the runtime emits a named failure event with
   route, transition id, and failing phase. This would be wrong if normal link
   navigation were the product contract during a transition. Once a Route
   Transition owns navigation, it owns failure too.

## Out of scope

- Defining every preloader visual style.
- Defining a client-side application router.
- Rich Motion Asset playback.
- Overlay behaviour.
- A visual transition editor.
- GSAP integration.

## Consequences

- The public HTML root needs a stable transition container separate from the
  footer and app chrome.
- The current visitor live-update script needs to call the same Runtime
  Hydrator after swapping snapshot HTML.
- The route runtime needs tests for fetch, swap, hydration, scroll, focus, and
  explicit failure events.
- Load Experience can only gate work the runtime can observe. Unsupported gates
  fail validation instead of becoming inert text.
- Route Transition can share Motion Sequence, Overlay, and future Layout
  Transition concepts without each feature inventing a navigation lifecycle.

## Implementation Status

- **Load Experience runtime shipped in the designer-interactions branch.** The
  visitor Runtime Hydrator consumes the saved `loadExperience`, runs bounded
  readiness gates, plays configured Motion Sequences, and emits explicit ready
  or failure events.
- **Route Transition runtime shipped in the designer-interactions branch.** The
  visitor Runtime Hydrator intercepts eligible same-site link clicks, fetches
  the next document, parses the public root, plays outgoing and incoming Motion
  Sequences, swaps and hydrates the new root, updates title/history/scroll/focus,
  emits ready or failure events, and restores the previous DOM when hydration or
  dependent post-swap work fails.
- **Editor authoring shipped in the designer-interactions branch.** The page
  inspector can enable a Load Experience or Route Transition, bind existing
  Motion Sequences, choose readiness/run/swap/scroll/focus controls, and remove
  either contract without touching unrelated interaction state.

## Follow-ups

- Evaluate a Swup adapter behind the Runtime Hydrator if native lifecycle code
  starts duplicating cache/preload/history concerns.
- Decide which View Transition API modes are allowed once browser support and
  validation rules are explicit.
- Replace the live-update `innerHTML` restore path with node-preserving
  `replaceChildren` semantics like Route Transition uses.
