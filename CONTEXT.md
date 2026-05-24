# rev01 Context

rev01 is a live site builder where an owner starts from a template seed, edits a site directly, and publishes it to a public address visitors can open.

## Language

**Owner**:
The person who creates, edits, and publishes a site.
_Avoid_: Admin, user, account

**Visitor**:
A person who views the published site at its public address.
_Avoid_: Customer, anonymous user, end user

**Template Seed**:
A starting site shape copied into a new editable site.
_Avoid_: Template app, theme, preset

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
A reusable visual building block that can be positioned, styled, and combined to recreate many reference designs.
_Avoid_: Webflow clone, component library, arbitrary CSS

**Motion Preset**:
A curated animation behaviour that can be applied to a section or positioned element.
_Avoid_: Custom animation code, interaction script

**Pinned Style**:
An explicit element-level visual choice that is not changed by a theme choice.
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
An owner-requested change made by the agent to a text element, media element, or canvas section.
_Avoid_: Prompt response, AI output, background automation

**Section Recipe**:
A constrained canvas section shape the agent may use when creating a new section.
_Avoid_: Freeform layout, arbitrary generation, template

**Owned-Domain Subdomain**:
A published address adapter where an owner-chosen name under the owner's domain resolves to a published site.
_Avoid_: Custom domain, path route

**Page**:
A single editable and publishable document within a site.
_Avoid_: Screen, view

**Canvas Page**:
A page made of ordered canvas sections rather than flow-based document content.
_Avoid_: Prose document, webpage DOM, slide deck

**Section**:
An interchangeable page region the owner can insert, remove, reorder, or replace.
_Avoid_: Block, component, template slice

**Canvas Section**:
A section with its own bounded 2D editing space where content elements can be positioned and resized.
_Avoid_: Full-page canvas, freeform page, absolute page layer

**Content Element**:
An editable item inside a section, such as text, media, an action, a shape, or a container.
_Avoid_: Block, widget, layer

**Media Element**:
A content element that displays an image or video asset.
_Avoid_: Image block, video widget, embed

**Positioned Element**:
A content element with a position and size inside a canvas section.
_Avoid_: Flow block, DOM node, layer

**Film Reel**:
A right-side panel that shows all sections of a canvas page as miniature thumbnails, used for visual reordering and blank section insertion.
_Avoid_: Section manager, section list, reorder panel

**Slot History**:
The ordered record of owner assets that have previously occupied one media element, kept only for the editing experience.
_Avoid_: Undo stack, version history, asset trail

## Relationships

- An **Owner** creates an **Editable Site** from exactly one **Template Seed**
- An **Editable Site** contains one or more **Canvas Pages**
- A **Canvas Page** contains one or more **Canvas Sections**
- Every visible **Section** in the POC is a **Canvas Section**
- A **Section** contains one or more **Content Elements**
- A **Canvas Section** contains one or more **Positioned Elements**
- A **Published Site** is backed by exactly one current **Published Snapshot**
- A **Published Snapshot** is promoted from the whole **Editable Site**
- A **Published Snapshot** reflects the owner's live editable state at the moment publish is requested
- A **Theme Choice** applies to the whole **Editable Site** and is included in the **Published Snapshot**
- A **Style Kit** controls the default look of **Design Primitives**
- A **Pinned Style** belongs to one **Positioned Element** and survives **Theme Choice** changes
- A **Media Element** references an **Owner Asset**
- An **Owner Asset** belongs to one **Owner** and may be referenced by media elements in any of that owner's editable sites
- An **Owner Asset** survives deletion of any single editable site that references it
- A **Media Element** has one **Slot History**
- A **Slot History** is editor-only and is not included in the **Published Snapshot**
- A **Slot History** is removed when its **Media Element** is deleted
- A **Media Element** may display an image or a video
- An **Owner** requests an **Agent Edit**
- An **Agent Edit** changes the **Editable Site**, not the **Published Site**
- An **Agent Edit** may rewrite a text element, replace a media element, or create a **Canvas Section** from a **Section Recipe**
- An **Agent Edit** is previewed by the **Owner** before it changes the **Editable Site**
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

## Example dialogue

> **Dev:** "When the **Owner** edits a **Section**, should the **Visitor** see it immediately?"
> **Domain expert:** "No. The **Visitor** sees the **Published Site** only after the **Owner** publishes, and then the open **Published Address** updates immediately."

**Site Import**:
The act of creating an Editable Site by scraping an external website at a given URL, rather than starting from a Template Seed.
_Avoid_: Migration, clone, copy, conversion

**Scraper Service**:
An external service that loads a URL in a headless browser, extracts page structure and assets, and returns a CanvasSiteState.
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

## Flagged ambiguities

- "subdomain" was used as one possible form of **Published Address**. The product concept is **Published Address**; subdomain routing is only one way to provide it.
