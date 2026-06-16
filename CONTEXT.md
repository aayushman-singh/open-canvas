# Open Canvas Context

Open Canvas is a live site builder where an owner starts from a template seed, edits a site directly, and publishes it to a public address visitors can open.

Agent pickup for the designer-template fidelity backlog lives at
[`docs/specs/designer-interactions-future-work.md`](docs/specs/designer-interactions-future-work.md).

## Language

**Owner**:
The person who creates, edits, and publishes a site.
_Avoid_: Admin, user, account

**Visitor**:
A person who views the published site at its public address.
_Avoid_: Customer, anonymous user, end user

**Template Seed**:
A curated composition that produces a new Editable Site. It references the Section Library by section id rather than embedding section data, and carries a Theme Choice, an optional site-pinned Header Section ref, an optional site-pinned Footer Section ref, and an ordered list of body Section Instances per page. Each Section Instance may carry a Section Override.
_Avoid_: Template app, theme, preset, starter kit

**Editable Site**:
The owner-controlled site state that can be changed before publishing.
_Avoid_: Draft app, workspace

**Published Site**:
The visitor-facing site state currently available at a public address.
_Avoid_: Production build, deployed bundle

**Published Snapshot**:
The stored whole-site state that visitors see after a publish.
_Avoid_: Draft, cache, build artifact

**Published Address**:
A real public location under the owner's domain that resolves to one published site.
_Avoid_: Subdomain, custom domain, route

**Theme Choice**:
A site-wide selection of a style kit that restyles the whole editable and published site without changing its content.
_Avoid_: Template style, skin, CSS preset

**Style Kit**:
A curated visual system for a site, including colours, typography, surfaces, shapes, shadows, and motion.
_Avoid_: CSS theme, skin, preset

**Design Primitive**:
A reusable visual primitive that can be positioned, styled, and combined to recreate many reference designs.
_Avoid_: Reference-site clone, component library, arbitrary CSS

**Motion Preset**:
A curated animation behaviour that can be applied to a section or positioned element. Time- or scroll-triggered (entrance, drift, parallax) — never driven by the visitor's cursor position.
_Avoid_: Custom animation code, interaction script, pointer-reactive effect

**Pointer-Reactive Effect**:
A curated visual behaviour on an element that responds continuously to the visitor's cursor position (e.g. a glow that follows the pointer, a tilt toward it). Distinct from a Motion Preset, which is time- or scroll-triggered and ignores the cursor.
_Avoid_: Motion preset, animation, hover state, interaction script

**Interaction Trigger**:
A schema-owned visitor or owner-preview event that starts or updates an authored behaviour, such as load, viewport entry, scroll progress, hover, pointer movement, click, route navigation, or media readiness.
_Avoid_: Event listener, hook, script callback

**Interaction Target**:
A named page, section, element, component part, text fragment, or overlay surface that an authored behaviour can affect.
_Avoid_: CSS selector, DOM node, query target

**Motion Sequence**:
An ordered animation relation from one Interaction Trigger to one or more Interaction Targets. It carries explicit steps, timings, easing, target parts, and animated properties.
_Avoid_: Keyframe blob, custom animation code, motion preset

**Scroll Scene**:
A scroll-position relation that binds progress through a page or section range to a Motion Sequence.
_Avoid_: Scroll trigger, parallax preset, scroll script

**Runtime Hydrator**:
The shared behaviour runner that reads schema-owned interactions and attaches the visitor/editor state needed to execute them.
_Avoid_: Per-component script, custom code, visitor-only runtime

**Overlay**:
A temporary visitor-facing surface opened above the current page from an explicit Interaction Trigger and closed by an explicit dismissal rule.
_Avoid_: Popup, modal widget, iframe drill-in

**Load Experience**:
An authored first-load choreography that can wait on explicit readiness gates before handing control to the page.
_Avoid_: Spinner, preloader script, loading state

**Route Transition**:
An authored navigation choreography between two page states that can define outgoing, incoming, and shared-target movement.
_Avoid_: Router hook, page animation, navigation script

**Layout Transition**:
An authored state-change relation between two named Interaction Targets whose geometry changes while the visitor should perceive continuity.
_Avoid_: FLIP script, shared-element hack, layout animation code

**Rich Motion Asset**:
A non-static media asset whose playback is schema-owned and rendered by a dedicated runtime, such as vector animation, interactive animation, or a 3D scene.
_Avoid_: Animation blob, embed, custom canvas script

**Variant**:
A named, designed look for a single element that the owner selects with one choice, applying a complete coherent presentation at once. Sits above the granular per-element style: a Variant sets the base, the owner's explicit style choices override it. Each element kind that offers Variants exposes a fixed, curated set.
_Avoid_: Theme, skin, preset, template, style kit

**Component Style**:
A named group of owner-chosen visual values for the meaningful parts of one Content Element.
_Avoid_: Variant, theme, preset, raw CSS, pinned style

**Pinned Style**:
An explicit element-level visual choice for a Positioned Element when no named Component Style owns that choice.
_Avoid_: Override, custom CSS, inline style

**Presence Indicator**:
A lightweight signal that someone is viewing or editing a site.
_Avoid_: Multiplayer, collaborator list, cursor

**Owner Asset**:
A media object owned by an owner and reusable across all of the owner's editable sites and their published snapshots.
_Avoid_: Site asset, upload, blob, library item

**Agent**:
An AI collaborator that changes the editable site only from an owner request.
_Avoid_: Chatbot, assistant, generator

**Agent Edit**:
An owner-requested change made by the agent to the Editable Site. The owner previews every Agent Edit before it takes effect.
_Avoid_: Prompt response, AI output, background automation

**Agent Turn**:
One bounded unit of work in which the Agent processes one Owner ask — from the moment the Owner submits a message to the moment the Agent emits a done signal. A turn may propose zero or many Agent Edits and is bounded by named budgets the Owner can observe when they exhaust.
_Avoid_: Iteration, conversation round, message exchange, prompt cycle

**Section Recipe**:
A constrained canvas section shape the agent may use when creating a new section. Also serves as a categorisation column on every Section in the Section Library.
_Avoid_: Freeform layout, arbitrary generation, template

**Section Library**:
The canonical pool of reusable Section definitions. Every built-in Section, every Owner-saved Section, and every standalone library fixture lives in the Section Library. A Template references the Section Library; it does not embed Section data of its own.
_Avoid_: Section catalog, section pool, section registry, snippet library

**Section Category**:
A high-level bucket assigned to each Section in the Section Library that determines where the Section lives in the rendered site and how the picker surfaces it. Categories: header, hero, features, testimonials, cta, gallery, footer, other. Orthogonal to Section Recipe (which is a structural constraint) and to visibility (which is an auth concern).
_Avoid_: Section type, section kind, section tag, section role

**Section Instance**:
A usage of a Section inside a Template Seed or an Editable Site. Carries an instance scope so the same Section can appear multiple times in one page without identity collision between its elements and anchors. May carry a Section Override.
_Avoid_: Section copy, section embed, section reference

**Section Override**:
A sparse per-instance edit to a Section's fields, applied when the Section is instantiated. Only the fields the override touches differ from the Section's canonical shape. Authored at the Template Seed level or the Editable Site level.
_Avoid_: Customisation, patch, modifier, theme override

**Owned-Domain Subdomain**:
A published address adapter where an owner-chosen name under the owner's domain resolves to a published site.
_Avoid_: Custom domain, path route

**Page**:
A single editable and publishable document within a site.
_Avoid_: Screen, view

**Canvas Page**:
A page made of ordered canvas sections rather than flow-based document content.
_Avoid_: Prose document, webpage DOM, slide deck

**Section Role**:
A designation on a page section that marks it as a body section, the only remaining role since ADR 0059 removed inline header/footer roles in favour of site-pinned Header Section and Footer Section.
_Avoid_: Section type, section kind, section category

**Section**:
A reusable structural unit in the Section Library, identified by a stable section id and base slug. A Section is data only. When a Template Seed or an Editable Site uses a Section, it does so via a Section Instance — never by embedding the Section's data.
_Avoid_: Component, template slice, layout block, snippet

**Header Section**:
A site-pinned Section Instance rendered before every Canvas Page. Sourced from the Section Library; the Editable Site holds the section id, not the section data. At most one per Editable Site. Cannot be reordered into page body sections or duplicated.
_Avoid_: Nav bar, site chrome, header component

**Footer Section**:
A site-pinned Section Instance rendered after every Canvas Page. Sourced from the Section Library; the Editable Site holds the section id, not the section data. At most one per Editable Site.
_Avoid_: Bottom bar, footer component

**Canvas Section**:
A section with its own bounded 2D editing space where content elements can be positioned and resized.
_Avoid_: Full-page canvas, freeform page, absolute page layer

**Content Element**:
An editable item inside a section, such as text, media, an action, a shape, or a container.
_Avoid_: Widget, layer

**Media Element**:
A content element that displays an image or video asset.
_Avoid_: Media module, video widget, embed

**Positioned Element**:
A content element with a position and size inside a canvas section.
_Avoid_: Flow item, DOM node, layer

**Film Reel**:
A right-side panel that shows all sections of a canvas page as miniature thumbnails, used for visual reordering and blank section insertion.
_Avoid_: Section manager, section list, reorder panel

**Slot History**:
The ordered record of owner assets that have previously occupied one media element, kept only for the editing experience.
_Avoid_: Undo stack, version history, asset trail

## Relationships

- An **Owner** creates an **Editable Site** from exactly one **Template Seed**
- An **Editable Site** contains one or more **Canvas Pages**
- An **Editable Site** may have one **Header Section** and one **Footer Section** shared by every **Canvas Page**
- A **Canvas Page** contains one or more **Canvas Sections**
- A **Canvas Page** contains body sections; shared header/footer sections live on the **Editable Site**
- Every visible **Section** in the POC is a **Canvas Section**
- A **Section** contains one or more **Content Elements**
- A **Canvas Section** contains one or more **Positioned Elements**

### Section Library

- Every **Section** has exactly one entry in the **Section Library**
- A **Section** is identified by a stable section id and a base slug; later edits create new entries via the lineage chain rather than mutating the original
- A **Section** has exactly one **Section Recipe** and exactly one **Section Category**
- A **Section** has exactly one visibility: `private` (owner-only) or `global` (built-in)
- A **Template Seed** is a composition of **Section Instances**; it never embeds **Section** data
- A **Template Seed** declares an ordered list of body **Section Instances** per **Canvas Page** plus optional Header and Footer **Section Instance** refs
- A **Section Instance** belongs to exactly one **Section** in the **Section Library**
- A **Section Instance** may carry one **Section Override**
- A **Section Override** is sparse — only the fields it touches differ from the referenced **Section**
- The same **Section** may be used as multiple **Section Instances** in the same **Canvas Page**; their instance scope keeps Content Element identity from colliding
- Editing a private **Section** in place is allowed; saving as a new version creates a successor **Section** with `parentId` linking to the predecessor
- A `global` **Section** is immutable from the UI; only a code-managed deploy may upsert it
- A **Published Site** is backed by exactly one current **Published Snapshot**
- A **Published Snapshot** is promoted from the whole **Editable Site**
- A **Published Snapshot** reflects the owner's live editable state at the moment publish is requested
- A **Theme Choice** applies to the whole **Editable Site** and is included in the **Published Snapshot**
- A **Style Kit** controls the default look of **Design Primitives**
- A **Variant** gives one **Content Element** a complete base look
- A **Component Style** belongs to one **Content Element** and overrides that element's **Variant**
- A **Pinned Style** belongs to one **Positioned Element**, does not duplicate its **Component Style**, and survives **Theme Choice** changes
- A **Motion Sequence** starts from one **Interaction Trigger** and affects one or more **Interaction Targets**
- A **Scroll Scene** drives one **Motion Sequence** from scroll progress rather than elapsed time
- An **Overlay** opens from one **Interaction Trigger** and closes by one explicit dismissal rule
- A **Load Experience** belongs to an **Editable Site** or **Page** and hands off to the initial page state
- A **Route Transition** belongs to page navigation and may include one or more **Layout Transitions**
- A **Runtime Hydrator** runs schema-owned interactions for both the **Editable Site** preview and the **Published Site**
- A **Rich Motion Asset** belongs to one **Owner** and may be referenced by media elements in any of that owner's editable sites
- A **Media Element** references an **Owner Asset**
- An **Owner Asset** belongs to one **Owner** and may be referenced by media elements in any of that owner's editable sites
- An **Owner Asset** survives deletion of any single editable site that references it
- A **Media Element** has one **Slot History**
- A **Slot History** is editor-only and is not included in the **Published Snapshot**
- A **Slot History** is removed when its **Media Element** is deleted
- A **Media Element** may display an image or a video
- An **Owner** requests an **Agent Edit**
- An **Owner** ask drives exactly one **Agent Turn**
- An **Agent Turn** may propose zero or more **Agent Edits**
- An **Agent Edit** changes the **Editable Site**, not the **Published Site**
- An **Agent Edit** is previewed by the **Owner** before it takes effect
- A media-producing **Agent Edit** creates an **Owner Asset** only when the owner applies the previewed media to a media element
- Discarded media-edit previews and discarded direct-generation previews never become **Owner Assets**
- An **Owner Asset** can only be deleted by its **Owner** after the owner confirms the named consequences for every editable site, every **Media Element**, and every **Published Site** that references it
- A **Presence Indicator** may show that the editable or published site is being viewed without exposing full collaboration controls
- A **Published Address** resolves to exactly one **Published Site**
- An **Owned-Domain Subdomain** is the first **Published Address** adapter for the POC
- A **Visitor** opens a **Published Address** and sees the **Published Site**, not the **Editable Site**
- A publish changes the **Published Site** and updates already-open **Visitor** views at the **Published Address**

## Constraints

- The POC proves desktop editing and desktop visitor viewing only
- The POC uses a small deterministic set of style kits
- The POC treats full multiplayer collaboration as out of scope unless it is already trivial to expose
- Every **Agent Turn** is bounded by three named budgets — wall-clock, accumulated tokens, and a tool-call safety net. When any budget exhausts the turn ends and the **Owner** sees which budget tripped (see ADR 0055 + ADR 0056)

## Example dialogue

> **Dev:** "When the **Owner** edits a **Section**, should the **Visitor** see it immediately?"
> **Domain expert:** "No. The **Visitor** sees the **Published Site** only after the **Owner** publishes, and then the open **Published Address** updates immediately."

**Site Import**:
The act of creating an Editable Site by scraping an external website at a given URL, rather than starting from a Template Seed.
_Avoid_: Migration, clone, copy, conversion

**Scraper Service**:
An external service that loads a URL in a headless browser, extracts page structure and assets, and returns an EditableSite.
_Avoid_: Crawler, spider, proxy, converter

**Import Mapping**:
The classification of a scraped DOM element into a Design Primitive type (Text, Media, Action, Shape, Container) based on tag semantics and computed styles.
_Avoid_: Conversion rule, parser, transformer

**Seed Color**:
The single most prominent brand/accent color extracted from a scraped site, used as input to the OKLCH theme algebra to derive a full Style Kit.
_Avoid_: Primary color, theme color, dominant color

## Relationships (Import)

- A **Site Import** creates one **Editable Site** with one **Canvas Page**
- A **Site Import** derives a custom **Style Kit** from the scraped site's **Seed Color** and font usage
- A **Scraper Service** performs the **Import Mapping** for every visible element on the source page
- A **Site Import** downloads external assets and stores them as **Owner Assets**
- A **Site Import** replaces source animations with the nearest **Motion Preset**

**Addon**:
A purchasable capability that can be enabled per-site after an Owner acquires it. Each addon has its own integration logic that determines how it affects the Published Site.
_Avoid_: Plugin, extension, module, feature flag

**Addon Entitlement**:
The fact that an Owner has acquired an Addon, granting them the right to enable it on any of their sites.
_Avoid_: License, subscription, purchase record

**Site Addon**:
The per-site activation and configuration of an acquired Addon. Only meaningful when the Owner holds the corresponding Addon Entitlement.
_Avoid_: Site plugin, site integration, site feature

**Addon Registry**:
The curated catalog of available Addons defined in code. Each entry declares the addon's identity, its configuration shape, and its integration logic.
_Avoid_: Marketplace, store, addon database

**Addon Shop**:
The dashboard tab where an Owner browses the Addon Registry and acquires Addon Entitlements.
_Avoid_: Marketplace, store, catalog page

## Relationships (Addons)

- An **Addon Registry** lists all available **Addons**
- An **Owner** acquires an **Addon** through the **Addon Shop**, creating an **Addon Entitlement**
- An **Addon Entitlement** belongs to one **Owner** and one **Addon**
- An **Owner** may hold at most one **Addon Entitlement** per **Addon**
- A **Site Addon** belongs to one **Editable Site** and one **Addon**
- A **Site Addon** is only valid when the site's **Owner** holds the corresponding **Addon Entitlement**
- A **Site Addon** carries per-site configuration (e.g. a Measurement ID for Google Analytics)
- A **Site Addon** affects the **Published Site** only after a publish
- Removing an **Addon Entitlement** does not cascade-delete **Site Addons** — it disables their effect at render time

## Flagged ambiguities

- "subdomain" was used as one possible form of **Published Address**. The product concept is **Published Address**; subdomain routing is only one way to provide it.
