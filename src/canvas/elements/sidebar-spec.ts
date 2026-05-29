// src/canvas/elements/sidebar-spec.ts
//
// Per-element sidebar + section-toolbar spec (ADR 0011 Step 3 dec 2).
//
// The editor sidebar's "Components" grid (`src/editor/route.tsx`) and the
// in-canvas section toolbar (`buildSectionToolbar` in
// `src/editor/canvas-client.ts`) both used to declare per-element drop-in
// buttons inline — one hardcoded `<button>` per element type in two
// different files, plus an `add-X` switch in `componentActionForSidebar`,
// plus another `add-X` switch in `handleSectionAction` that built each
// type's default JSON. Four lockstep edits per new element type.
//
// Each element module now exports a `<type>SidebarSpec: SidebarSpec`
// carrying 0..N `SidebarCommandSpec` entries. `media` exports two (image
// and video); `collection` exports zero (sections are recipe-only and the
// LLM-only `designSection` path covers add); everything else exports one.
//
// `factoryName` is a stable identifier the canvas-client IIFE binds to a
// JS factory in `SIDEBAR_FACTORIES` (same pattern as
// `INSPECTOR_MOUNT_HANDLERS` / `INSPECTOR_ACTION_HANDLERS` in Step 1).
// The smoke verifies every spec's `factoryName` is in a curated
// `REGISTERED_FACTORIES` list so "added a command but forgot the factory"
// becomes a build-time failure.

export interface SidebarCommandSpec {
  /**
   * Unique key used as `data-sidebar-add-component="X"` in the sidebar grid
   * and as the `add-<key>` action string in canvas-client. Must be unique
   * across all specs in the dispatch — the smoke enforces this.
   * Examples: `"text"`, `"image"`, `"video"`, `"action"`.
   */
  key: string;

  /** Sidebar grid label — the visible button text. */
  sidebarLabel: string;

  /** Sidebar grid tooltip (`title` attribute). */
  sidebarTip: string;

  /**
   * Section-toolbar shorthand label — the small icon-style button rendered
   * inside each section node (e.g. `"+T"`, `"+Img"`). Omit to skip the
   * toolbar surface; only a curated subset of element types appears in the
   * toolbar (text, image, video, action, shape, container, chart).
   */
  toolbarLabel?: string;

  /** Section-toolbar tooltip when `toolbarLabel` is present. */
  toolbarTip?: string;

  /**
   * Name of the JS factory registered in `SIDEBAR_FACTORIES` inside
   * canvas-client.ts. The factory receives `(section, ctx)` and returns
   * the new element JSON (minus its `box`, which the caller computes via
   * `defaultBox(section, w, h)`).
   *
   * Stable across migrations — change here means change the JS factory
   * name in canvas-client.ts in the same commit. The smoke catches drift.
   */
  factoryName: string;
}

export interface SidebarSpec {
  /**
   * 0..N commands. Most element types contribute one; `media` contributes
   * two (image + video); `collection` contributes zero.
   */
  commands: SidebarCommandSpec[];
}
