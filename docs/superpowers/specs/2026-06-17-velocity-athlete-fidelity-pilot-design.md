# Velocity Athlete Fidelity Pilot Design

Date: 2026-06-17
Status: approved direction, awaiting written spec review

## User-Visible Done State

An Owner opens a new template and sees a site that feels like a high-end
creative athlete/personality site: kinetic, premium, media-heavy, editorial,
and interaction-led. The site should have the same class of experience as the
Lando Norris benchmark, but it must be an original Open Canvas template with
new name, copy, assets, palette refinements, and content.

The Owner should be able to say: "This does not feel like a generic site
builder template. It feels like a carefully directed creative site I can adapt
for an athlete, creator, performer, or personality brand."

## Why This Exists

Open Canvas already has a strong template composition model, but high-end
references drift when they are translated loosely into generic sections. This
pilot uses one demanding reference as a fidelity benchmark first, then turns
the proven structure into an original template. The benchmark is a measuring
tool, not shippable content.

The product problem is not "we need another nice template." The problem is
"we need a repeatable way to reproduce premium creative site behaviour without
quietly flattening the parts that made the reference feel premium."

## Success Criteria

- The template opens as a coherent, original athlete/personality site.
- The first viewport carries a premium identity immediately: strong mark,
  fullscreen spatial field, clear CTA, compact navigation, and an intentional
  load/enter moment.
- The page includes at least one section where scroll position changes the
  user's spatial relationship to content, not only entrance opacity.
- Large editorial text has choreographed behaviour, not only static text.
- Media density and layout hierarchy feel comparable to the benchmark:
  hero object, story media, artifact grid, CTA/product moment, social/partner
  collage, and footer statement.
- Every mismatch between the benchmark and Open Canvas capability is classified
  as native, approximate, or requires primitive. Nothing is silently degraded.
- No benchmark brand names, logos, protected copy, sponsor marks, or original
  assets ship in the template.

## Non-Goals

- Shipping a Lando Norris clone.
- Copying protected assets, source code, brand marks, sponsor marks, or copy.
- Adding GSAP to Open Canvas core.
- Letting arbitrary custom JavaScript or arbitrary CSS become the answer.
- Solving all Awwwards-style interactions in one pass.
- Expanding this into a general importer before the fidelity ledger proves
  which primitives matter.

## Hard Constraints

- The benchmark can guide fidelity, but the shipped template must be original.
- New behaviours must be schema-owned and validator-owned.
- Unsupported behaviour must fail loudly or be recorded as a primitive gap.
- Runtime execution must converge toward one editor/visitor hydrator. New
  interaction work should not deepen the existing two-runtime split.
- GSAP stays out of core unless Webflow/GSAP grants explicit written permission.
- Existing Section Library and Template Seed composition remain the template
  backbone.
- The design must respect reduced motion. Reduced motion should be an explicit
  authored mode, not an untested accident.

## Benchmark Evidence

Reference:

- Awwwards entry: https://www.awwwards.com/sites/lando-norris
- Live site: https://landonorris.com/

Inspection date: 2026-06-17

Observed live-site signals:

- 12 major sections.
- 133 images.
- 21 canvas surfaces.
- 86 SVGs.
- 446 split-text related nodes.
- Rive attributes throughout the page.
- Lenis smooth scrolling.
- WebGL render activity.
- Custom OFF+BRAND bundle contains GSAP, ScrollTrigger, SplitText, Rive,
  Three/WebGL, Lenis, Observer, and Flip strings.

Local inspection artifacts:

- `.codex-screens/lando-norris/report.json`
- `.codex-screens/lando-norris/actual-01-0.png`
- `.codex-screens/lando-norris/actual-04-3000.png`
- `.codex-screens/lando-norris/actual-07-7900.png`
- `.codex-screens/lando-norris/actual-10-12600.png`

## Chosen Approach

Use a reference-led fidelity ledger.

The pilot starts by describing the benchmark in Open Canvas terms, section by
section and behaviour by behaviour. Each item gets one of three labels:

- `native`: Open Canvas can express it with existing primitives.
- `approximate`: Open Canvas can produce a static or partial version, but the
  result is visibly less faithful.
- `requires primitive`: Open Canvas must add a schema-owned primitive before
  the behaviour can be called high fidelity.

This is the right approach because it keeps the "aim for perfect replica first"
discipline while preventing protected content or arbitrary scripts from becoming
the product architecture.

## Alternatives Rejected

Static approximation now:

This would create a good-looking template faster, but it would hide the drift.
The benchmark's character comes from load state, scroll-scrubbed movement,
split text, rich motion, and WebGL/Rive surfaces. A static imitation is not a
high-fidelity pilot.

Primitive-first without a reference:

This is cleaner architecturally, but too abstract. The Lando-style benchmark
forces every primitive to prove why it exists against an observable user
experience.

## Aesthetic Direction

Template name: Velocity Athlete.

Subject: an original elite athlete or performance personality brand. The first
version should avoid any specific real athlete and use generic owner-replaceable
content such as "Ari Vale", "2026 world tour", "training archive", and
"field notes".

Palette:

- Pit black: `#111112`
- Bone white: `#F4F4ED`
- Signal citron: `#C8FF1A`
- Deep olive: `#282C20`
- Track graphite: `#5D6254`
- Heat orange: `#FF6B2A`

Type direction:

- Display serif: sharp, compressed, used only for emphasis words and large
  statement moments.
- Heavy grotesk: navigation, CTAs, labels, stats, and direct athlete language.
- Utility mono: race/event cards, metadata, collection labels, and timestamps.

Layout signature:

The site uses a "course map" spatial field: thin contour lines and soft track
shapes move behind content, while media cards and rich-motion objects sit on
top as evidence. The risk is the intentionally oversized first-screen negative
space; it only works if the load, central mark, and movement feel precise.

## Conceptual System

Nodes:

- Reference Benchmark: observed external site behaviour.
- Fidelity Ledger: structured account of what must be matched, approximated,
  or promoted into primitives.
- Velocity Template Seed: original template composition.
- Section Library Entry: reusable authored section.
- Behaviour Primitive: schema-owned interaction or motion capability.
- Rich Motion Asset: owned media with explicit playback contract.
- Runtime Hydrator: execution boundary for editor and visitor.
- Validator: write/publish gate that rejects unsupported relations.

Directed relations:

- Reference Benchmark constrains Fidelity Ledger.
- Fidelity Ledger constrains Velocity Template Seed.
- Velocity Template Seed references Section Library Entries.
- Section Library Entries reference Elements, Component Styles, and Behaviour
  Primitives.
- Behaviour Primitives target schema-owned elements or sections.
- Rich Motion Assets are referenced by Media/Rich Motion elements.
- Runtime Hydrator executes Behaviour Primitives and Rich Motion Assets.
- Validator rejects invalid Template Seeds, primitive relations, and unsupported
  runtime combinations.

Reduction checks:

- The Fidelity Ledger exists because otherwise "looks close" hides drift.
- Behaviour Primitive exists only when at least two benchmark behaviours need
  the same reusable relation.
- Rich Motion Asset exists because Rive/WebGL/image-sequence behaviour cannot
  be represented honestly as a static media element.
- Runtime Hydrator exists as one boundary because duplicated editor/visitor
  execution creates mismatched behaviour.

## Section Fidelity Ledger

| Benchmark area | Velocity Athlete section | Current expression | Fidelity label | Required decision |
| --- | --- | --- | --- | --- |
| Fullscreen load screen with explicit enter action | Load Experience | Not first-class | requires primitive | Add authored Load Experience before claiming parity |
| Sticky nav with logo, store CTA, menu button | Header/Nav | Nav, Action, Shape, pinned style | native | Use current primitives |
| Menu as rich overlay | Command menu | Popup section is too limited | requires primitive | Use first-class Overlay, not section mutation |
| Fullscreen hero spatial field | Hero field | Section background, media, shapes, pinned style | approximate | Static pattern is acceptable only for first visual slice |
| Central animated mark/object | Hero motion object | Media can show image/video only | requires primitive | Rich Motion Asset for Rive/3D/image sequence |
| Event/race card | Event card | Text, Shape, Media, Container | native | Use reusable card section fragment |
| Split manifesto text | Impact statement | Text and rich text exist | approximate | Text Split + Motion Sequence for fidelity |
| Scroll-driven horizontal media story | Story track | Carousel/scroll-snap is not equivalent | requires primitive | Scroll Scene with pinned horizontal progress |
| ON/OFF style dual panels | Path panels | Sections, Media, Text, Action | native | Use original labels and content |
| Helmet/artifact gallery | Artifact gallery | Collection exists, custom rendering limited | approximate | Collection rendering needs production-grade card styling |
| Product/store CTA | Drop section | Media, Text, Action, Shape | native | Use original product language |
| Partner/social collage | Media collage | Media cards and actions exist | approximate | Hover/cursor/video-stream behaviour needs primitives |
| Footer statement and logo marquee | Footer marquee | Static footer possible | approximate | Repeating motion track needs Motion Sequence |
| Page transition | Route transition | Not first-class | requires primitive | Use Load/Route Transition model |

## Primitive Gap Set

P0 for honest high fidelity:

- Load Experience: authored, explicit, bounded load/enter state.
- Motion Sequence: staged timeline across schema-owned targets.
- Text Split Target: line/word/char target mode for Motion Sequence.
- Scroll Scene: scroll-progress relation that can pin and scrub movement.
- Rich Motion Asset: Rive, bounded 3D, and image-sequence playback contract.
- Runtime Hydrator unification: one execution contract for editor and visitor.

P1 after the first vertical slice:

- Overlay: menu/modal content with focus, scroll lock, dismissal, and
  entrance/exit motion.
- Route Transition: same-site navigation transition that rehydrates runtime.
- Pointer/Hover FX expansion: card hover, media reveal, cursor-follow, tilt,
  and stream hover.
- Collection card styling: stronger component style and repeated card rules.
- Marquee/looping track: authored repeating motion for logos and statements.

## First Implementation Slice

The first implementation plan should not attempt the whole site. It should
prove the hardest relations with a thin vertical slice:

1. Load Experience for the template entry moment.
2. Hero field with original identity, event card, and one Rich Motion Asset
   contract that either executes through a supported adapter or blocks template
   completion with an explicit unsupported-adapter finding.
3. Impact statement with text-split Motion Sequence.
4. Horizontal story section driven by Scroll Scene.
5. Artifact gallery using the existing Collection element, with every mismatch
   recorded in the fidelity ledger.

If any one of those behaviours cannot be represented with schema and validator
support, the implementation should stop at an explicit blocked finding instead
of replacing the behaviour with a weaker hidden approximation.

## Data Model Direction

No arbitrary selectors.

Interaction targets should reference stable Open Canvas identities:

- site
- page
- section
- element
- element child target, when the element owns named internal parts
- text split unit, when text split is explicitly enabled

New fields should follow the ADR direction already present in the repo:

- Motion Preset remains shorthand.
- Motion Sequence becomes the canonical authored timeline.
- Scroll Scene owns scroll-progress relations.
- Rich Motion Asset owns Rive/3D/image-sequence playback metadata.
- Overlay owns modal/menu behaviour.
- Load Experience and Route Transition own page entry/swap behaviour.

## Runtime Direction

The Runtime Hydrator should become the one place that executes:

- Motion Sequence.
- Scroll Scene.
- Rich Motion Asset playback.
- Overlay behaviour.
- Load Experience.
- Route Transition.
- Existing accordion, carousel, popup, and pointer effects as they are migrated.

The editor and visitor should not grow separate implementations for new premium
behaviour. If editor preview cannot execute a primitive yet, the editor should
show an explicit unsupported-preview state with the primitive name and reason.

## Error Handling

- Unknown primitive kind: validation error with site, page, section, element,
  primitive id, and primitive kind.
- Missing target: validation error with the target relation and owner object.
- Missing asset: validation error with asset id, element id, and section id.
- Unsupported rich-motion family: validation error before render.
- Runtime adapter failure: emit an explicit runtime failure event with primitive
  id, adapter name, target ids, and error stack, then stop dependent behaviour.
- Import or benchmark capture failure: record the missing observation in the
  fidelity ledger with the exact URL, status, and step that failed.

No silent substitution is acceptable. If the system cannot execute a behaviour,
it must say which relation failed.

## Testing Strategy

- Schema smoke for every new primitive shape.
- Validator smoke for missing targets, unsupported primitive kinds, missing
  assets, and invalid scroll ranges.
- Renderer smoke proving primitive metadata survives server render as explicit
  data attributes or bootstrap payload.
- Runtime smoke for Motion Sequence, Scroll Scene, Load Experience, and Rich
  Motion Asset adapter dispatch.
- Editor/visitor parity smoke proving the same primitive produces the same
  runtime command set in both surfaces.
- Section Library composition smoke proving Velocity Athlete sections resolve
  from the canonical library into a Template Seed.
- Playwright visual checks at desktop 1440x900 and one narrower viewport for:
  load entry, hero, impact statement, horizontal story, artifact grid, and
  footer/CTA.
- Reduced-motion check proving moving primitives can be disabled or transformed
  into explicit non-motion states without changing content availability.

## Acceptance Boundary

The pilot is successful only when Open Canvas can distinguish these three states
for every benchmark behaviour:

- Represented natively and visible in the template.
- Intentionally out of scope and documented as such.
- Blocked by a named primitive gap with no hidden approximation.

The pilot fails if the result is merely a static lime-and-black page, if the
template ships benchmark-owned assets or brand marks, or if unsupported motion
is replaced by quiet preset animation.

## Resolved Design Decisions

- The first implementation slice includes the Rich Motion Asset contract and
  adapter dispatch. If no supported adapter lands, template completion is blocked
  explicitly; the template is not declared high fidelity.
- Velocity Athlete uses a fictional athlete identity from the start so layout,
  tone, and content hierarchy can be judged as a real site instead of a wireframe.
- Scroll Scene is a general scrub relation with pinned horizontal track as the
  first required use. It should also be able to drive scale, opacity, and
  rotation when those properties are allowed for the target kind.

## Next Step After Review

After this spec is reviewed and approved, create an implementation plan that
starts with the first implementation slice above and sequences primitive work
before template authoring where fidelity depends on it.
