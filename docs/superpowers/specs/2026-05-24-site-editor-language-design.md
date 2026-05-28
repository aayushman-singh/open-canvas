# Site Editor Language - Design Spec

**Date:** 2026-05-24
**Status:** Approved

## WHY

Owners need the editing surface to describe their goal in their own language: they are building a site, not operating a generic graphics canvas. The UI should make that distinction clear. The page is the place where an owner edits a site; the canvas is the work surface inside that page; the floating control at the upper-left of the canvas changes the owner's view of that work surface without changing site content.

## Success Criteria

- Owner opens the editing page and sees language that confirms they are editing a site.
- Owner understands that zoom, pan, fit, reset, and select controls affect the canvas view, not the published site.
- Product, docs, accessibility labels, and code comments use the same names for the same concepts.
- "Canvas" remains available as a precise term for the editable work surface.
- Navigation language does not collide with the site's visitor-facing navigation.

## Non-Goals

- Renaming the data model types (`EditableSite`, `CanvasPage`, `CanvasSection`, `CanvasElement`).
- Redesigning the editor chrome.
- Changing zoom, pan, fit, reset, or selection behavior.
- Creating a broader brand voice guide.
- Renaming visitor-facing published site pages.

## Hard Constraints

- User-facing language must center the owner's outcome: editing and publishing a site.
- "Canvas" must not be used as the page name when speaking to owners.
- "Navigation controls" must not name the zoom/pan widget because site navigation already has a separate meaning.
- Names must be stable enough for UI copy, accessibility labels, docs, and internal code comments.
- The language must fit the existing product vocabulary: site, page, section, element, canvas, Style Kit, Published Address.

## Language Decisions

### Page

**Name:** Site Editor

The owner-facing page name is **Site Editor**. This matches what the owner came to do: edit a site. It also leaves "canvas" free to mean the editable work surface inside the page.

Recommended browser title:

```text
rev01 - {siteName} Site Editor
```

Recommended breadcrumb:

```text
rev01 / dashboard / {siteName} / edit
```

### Work Surface

**Name:** Canvas

The canvas is the editable work surface that displays the current page and its sections/elements. It is not the whole product page.

Use "canvas" when referring to direct manipulation, spatial layout, zooming, panning, selection, section slots, and element handles.

### Floating Upper-Left Widget

**Name:** Canvas View Controls

The top-left floating widget that contains zoom, pan, fit/reset, and select-mode controls is named **Canvas View Controls**.

Short UI and accessibility label:

```text
View controls
```

Recommended internal name:

```text
canvasViewControls
```

This name is more accurate than "Zoom toolbar" because the widget owns more than zoom. It is safer than "Navigation controls" because "navigation" already means visitor-facing site navigation elsewhere in the product.

## Product Glossary

- **Site:** The thing the owner builds and publishes.
- **Page:** One route/page inside the site.
- **Section:** A vertical band within a page.
- **Element:** A selectable object inside a section.
- **Canvas:** The editable work surface inside the Site Editor.
- **Canvas View Controls:** The widget that changes the owner's view of the canvas.
- **Style Kit:** The site's shared visual theme controls.
- **Published Address:** The public address where visitors see the published site.

## Copy Rules

- Use **Site Editor** for the page/surface in owner-facing navigation, titles, and docs.
- Use **canvas** for the manipulable work surface only.
- Use **Canvas View Controls** in docs and comments when naming the floating widget.
- Use **View controls** for compact UI labels and `aria-label` text.
- Use **zoom**, **pan**, **select**, **fit**, and **reset** for individual control actions.
- Do not call the widget "Zoom toolbar" unless referring only to a zoom-only subset.
- Do not call the widget "Navigation controls".

## User-Visible Done

The owner can point at the editor page and say, "This is where I edit my site." They can point at the floating upper-left widget and understand it as controls for viewing and moving around the canvas, not controls that change the site itself.
