# Open Canvas Context

Open Canvas is a live site builder where an owner starts from a template seed, edits a site directly, and publishes it to a public address visitors can open.

## Agent Operating Preferences

- Treat Codex tokens as a constrained resource. Default to delegating substantive execution work to Cursor CLI workers using `agent --model auto`.
- Use Codex primarily for orchestration, task decomposition, code review, verification, and merge-risk control.
- Parallelize by default when tasks are independent by file ownership or behavioural boundary. Use separate worktrees for concurrent edit tasks.
- Do not parallelize tasks that touch the same files or the same behavioural contract; serialize those to avoid drift and merge noise.
- When a task can be completed either directly in Codex or by a Cursor worker, prefer the Cursor worker unless there is a concrete reason not to.

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

**Custom Template**:
A reusable starting point captured from an Editable Site rather than curated as a Template Seed.
_Avoid_: Saved site, clone, draft template

**Curated Custom Template**:
A Custom Template controlled by Template Curators and prepared for possible global publication.
_Avoid_: Built-in template, Template Seed, public site

**Published Global Custom Template**:
A Curated Custom Template that every Owner can select as a starting point.
_Avoid_: Built-in template, Template Seed, unpublished template

**Template Curator**:
A trusted person who can prepare, publish, unpublish, and remove Curated Custom Templates.
_Avoid_: Owner, Visitor, Design Collaborator

**Template Draft**:
A hidden Editable Site used to prepare a Curated Custom Template before publication.
_Avoid_: Published Site, Template Seed, source PR

**Template Publication Status**:
The curator-controlled state that decides whether a Curated Custom Template is selectable by Owners.
_Avoid_: Visibility, access tier, draft mode

**Template Asset Custodian**:
A system account that owns media assets used by Template Drafts and Curated Custom Templates.
_Avoid_: Owner, curator account, site owner

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

**Motion Sequence Lite**:
An owner-facing step-list editor for simple Motion Sequences used by premium interactions.
_Avoid_: Timeline, keyframe editor, animation canvas

**Scroll Scene**:
A scroll-position relation that binds progress through a page or section range to a Motion Sequence.
_Avoid_: Scroll trigger, parallax preset, scroll script

**Runtime Hydrator**:
The shared behaviour runner that reads schema-owned interactions and attaches the visitor/editor state needed to execute them.
_Avoid_: Per-component script, custom code, visitor-only runtime

**Overlay**:
A temporary visitor-facing surface owned by an Editable Site, scoped to one or more pages, opened above the current page from an explicit Interaction Trigger, and closed by an explicit dismissal rule.
_Avoid_: Popup, modal widget, iframe drill-in

**Load Experience**:
A site-owned authored first-load choreography that can wait on explicit readiness gates before handing control to the page.
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

**Collection**:
A named set of repeated content entries for one Editable Site.
_Avoid_: CMS, database table, content type, page group

**Collection Entry**:
One authored content item inside a Collection.
_Avoid_: Canvas Page, blog page, row, record

**Collection Template Page**:
A Canvas Page that defines how one Collection Entry appears when published.
_Avoid_: Dynamic page, CMS template, detail page, generated page

**Collection Element**:
A Content Element that lists Collection Entries from a Collection on a Canvas Page.
_Avoid_: CMS widget, listing block, feed

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
An editable visible item in a site authoring surface, such as text, media, an action, a shape, or a container.
_Avoid_: Widget, layer

**Compound Element**:
A content element that owns a structured child set inside its own authoring model instead of relying only on sibling positioned elements in a canvas section.
_Avoid_: Component, widget, group, section

**Flow Container**:
A Compound Element placed inside a canvas section that arranges its children by flow rules inside its own bounds.
_Avoid_: Flow Section, auto-layout section, flexbox div, layout widget

**Flow Layout**:
A layout relation inside a Flow Container that arranges Flow Items by ordered rules, spacing, alignment, wrapping, and spans.
_Avoid_: CSS layout, flexbox, grid system, auto layout

**Flow Item**:
A child of a Flow Container whose placement comes from order, span, and alignment within flow layout rather than freeform canvas position.
_Avoid_: Positioned Element, layer, DOM node

**Content Collaborator**:
A person invited by an Owner to propose content changes without controlling layout, style, structure, behaviour, or publish.
_Avoid_: Editor, teammate, member, viewer

**Design Collaborator**:
A person invited by an Owner to change content, layout, style, structure, or behaviour on an Editable Site without owning publish or administrative controls.
_Avoid_: Content Collaborator, viewer, visitor, teammate

**On-page Content Editing**:
A constrained workflow where a Content Collaborator proposes content changes from the Published Site context.
_Avoid_: On-site editor, canvas editor, page builder, inline layout editing

**On-page Design Editing**:
A full editing workflow where an Owner or Design Collaborator changes the Editable Site from the Published Site context.
_Avoid_: On-page Content Editing, live production editing, DOM patching, visitor edit

**Content Change**:
A proposed change to words, media choice, media description, link destination, form copy, or collection content that does not change layout, style, structure, or behaviour.
_Avoid_: Layout edit, style edit, schema change, publish

**Design Change**:
A change to content, layout, style, structure, or behaviour made by an Owner or Design Collaborator on an Editable Site.
_Avoid_: Content Change, Review Request, live patch, published edit

**Review Request**:
A bundle of Content Changes awaiting an Owner decision before it can affect an Editable Site.
_Avoid_: Draft, branch, pull request, autosave

**Media Element**:
A content element that displays an image or video asset.
_Avoid_: Media module, video widget, embed

**Positioned Element**:
A content element with a position and size inside a canvas section.
_Avoid_: Flow Item, DOM node, layer

**Film Reel**:
A right-side panel that shows all sections of a canvas page as miniature thumbnails, used for visual reordering and blank section insertion.
_Avoid_: Section manager, section list, reorder panel

**Slot History**:
The ordered record of owner assets that have previously occupied one media element, kept only for the editing experience.
_Avoid_: Undo stack, version history, asset trail

## Relationships

- An **Owner** creates an **Editable Site** from exactly one **Template Seed**
- An **Owner** may create an **Editable Site** from one **Custom Template**
- A **Published Global Custom Template** is a **Curated Custom Template** that every **Owner** may use
- A **Template Curator** prepares a **Curated Custom Template** through a **Template Draft**
- A **Template Draft** is an **Editable Site** that does not appear as a normal Owner site
- A **Curated Custom Template** has at most one **Template Draft**
- A **Curated Custom Template** changes only after explicit publication from a **Template Draft**
- A **Template Publication Status** determines whether a **Curated Custom Template** is a **Published Global Custom Template**
- A **Template Asset Custodian** owns assets used by **Template Drafts**
- An **Editable Site** contains one or more **Canvas Pages**
- An **Editable Site** may have one **Header Section** and one **Footer Section** shared by every **Canvas Page**
- A **Canvas Page** contains one or more **Canvas Sections**
- A **Canvas Page** contains body sections; shared header/footer sections live on the **Editable Site**
- Every visible **Section** in the POC is a **Canvas Section**
- A **Section** contains one or more **Content Elements**
- A **Canvas Section** contains one or more **Positioned Elements**
- A **Compound Element** is a **Content Element**
- A **Canvas Section** may contain **Flow Containers** as **Positioned Elements**
- A **Flow Container** has exactly one **Flow Layout**
- A **Flow Layout** arranges **Flow Items**
- A **Flow Container** contains one or more **Flow Items**
- A **Flow Item** contains one **Content Element**
- A **Flow Item** places its **Content Element** through **Flow Layout**
- A **Flow Item** is not a **Positioned Element**
- A **Flow Container** does not replace **Canvas Section**
- An **Owner** may invite a **Design Collaborator** to an **Editable Site**
- A **Design Collaborator** uses **On-page Design Editing** to make **Design Changes**
- **On-page Design Editing** changes the **Editable Site**, not the **Published Site**
- A **Published Site** reflects **Design Changes** only after the **Owner** publishes
- An **Owner** may invite a **Content Collaborator** to an **Editable Site**
- A **Content Collaborator** uses **On-page Content Editing** to create **Review Requests**
- A **Review Request** contains one or more **Content Changes**
- A **Content Change** changes content only; it does not change layout, style, structure, or behaviour
- An accepted **Review Request** changes the **Editable Site**
- A **Published Site** reflects accepted **Content Changes** only after the **Owner** publishes

### Collections

- An **Editable Site** may have one or more **Collections**
- A **Collection** contains one or more **Collection Entries**
- A **Collection Entry** belongs to exactly one **Collection**
- A **Collection Template Page** belongs to one **Collection**
- A **Collection Element** lists **Collection Entries** from one **Collection**
- An **Editable Site** does not create one **Canvas Page** per **Collection Entry**
- A **Published Site** renders one visitor-facing page per published **Collection Entry** through the **Collection Template Page**

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
- **Motion Sequence Lite** edits a constrained subset of **Motion Sequences**
- A **Scroll Scene** drives one **Motion Sequence** from scroll progress rather than elapsed time
- An **Editable Site** may own one or more **Overlays**
- An **Overlay** may be scoped to all pages or to named **Canvas Pages**
- An **Overlay** has one **Canvas Section**-shaped content surface that is not a body section of any **Canvas Page**
- An **Overlay** opens from one **Interaction Trigger** and closes by one explicit dismissal rule
- A **Load Experience** belongs to an **Editable Site** and hands off to the initial page state
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

**Growth Signal**:
An owner-chosen visitor occurrence that Open Canvas measures on a Published Site, such as a page view, action click, form submission, or site search query.
_Avoid_: Event, telemetry, tracking event, behavioural stream

**Conversion Goal**:
An owner-chosen desired visitor outcome on a Published Site, evaluated from one or more Growth Signals.
_Avoid_: KPI, analytics goal, funnel metric

**Experiment**:
An owner-run comparison on a Published Site that assigns visitors between Alternatives and evaluates them against one Conversion Goal.
_Avoid_: A/B test, split test, variant test, personalization

**Alternative**:
One published page, section, or content state being compared inside an Experiment.
_Avoid_: Variant, style variant, branch, treatment

**Visitor Segment**:
An owner-authored rule that matches a Visitor request for a Published Site using explicit request or site context.
_Avoid_: Audience, cohort, visitor profile, inferred profile

**Personalization Rule**:
An owner-authored relation from one Visitor Segment to one published page, section, or content state.
_Avoid_: Experiment, targeting script, recommendation, automation

## Relationships (Growth)

- An **Owner** chooses which **Growth Signals** a **Published Site** measures
- A **Published Site** records only the **Growth Signals** the **Owner** has chosen
- A **Growth Signal** is produced by a **Visitor** interacting with a **Published Site**
- A **Conversion Goal** belongs to one **Editable Site**
- A **Conversion Goal** is evaluated from the **Growth Signals** recorded for the corresponding **Published Site**
- An **Experiment** compares two or more **Alternatives**
- An **Experiment** evaluates exactly one **Conversion Goal**
- An **Alternative** belongs to exactly one **Experiment**
- A **Visitor** sees one **Alternative** for a given **Experiment**
- An **Owner** defines **Visitor Segments** for one **Editable Site**
- A **Visitor Segment** matches a **Visitor** request to the corresponding **Published Site**
- A **Personalization Rule** uses one **Visitor Segment**
- A **Personalization Rule** changes what matching **Visitors** see on the **Published Site**
- A **Published Site** applies **Personalization Rules** only after publish

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
