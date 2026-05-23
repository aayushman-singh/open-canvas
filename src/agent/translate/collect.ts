// src/agent/translate/collect.ts
//
// Wishlist #24 — Walk a `CanvasSiteState` and produce a flat table of every
// translatable string the LLM should rewrite. Each entry carries a stable
// JSONPath-like `path` string that `apply.ts` re-parses to mutate the matching
// field in the produced op set.
//
// Why JSONPath strings instead of structural keys: a typed map (e.g.
// `{pageIdx, sectionIdx, elementIdx, runIdx}`) couples the collect+apply
// halves to a single element kind. Path strings let us list every field —
// page title, page description, text runs, action labels, embed titles,
// chart axes, table headers/cells, form labels/placeholders/options,
// accordion item titles + bodies, carousel slide captions, nav link labels,
// nav logos (no — that's an asset, skipped), media alt — in one flat table
// keyed by the exact wire location.
//
// Skipped on purpose:
//   - `code.source` (Owner-authored code — never translated).
//   - `embed.url` (URLs — never translated).
//   - `nav.logoAssetId` (asset id — never translated).
//   - `media.assetId` / `carousel.assetId` (asset ids — never translated).
//   - `nav.link.href`, `action.href`, `link.mark.href` (URLs — never translated).
//   - Style kit fields, font names, kit token strings.
//
// Walked because the brief says "translate alt text? Translate it.":
//   - `media.alt`, `carousel.caption` (caption is also the alt).
//
// The path grammar is:
//
//   pages[<idx>].title
//   pages[<idx>].description
//   pages[<idx>].sections[<sidx>].elements[<eidx>].<field>
//   pages[<idx>].sections[<sidx>].elements[<eidx>].content[<rIdx>].text
//   pages[<idx>].sections[<sidx>].elements[<eidx>].columns[<cIdx>].header
//   pages[<idx>].sections[<sidx>].elements[<eidx>].rows[<rIdx>].cells.<colId>
//   pages[<idx>].sections[<sidx>].elements[<eidx>].fields[<fIdx>].label
//   pages[<idx>].sections[<sidx>].elements[<eidx>].fields[<fIdx>].placeholder
//   pages[<idx>].sections[<sidx>].elements[<eidx>].fields[<fIdx>].options[<oIdx>].label
//   pages[<idx>].sections[<sidx>].elements[<eidx>].items[<iIdx>].title
//   pages[<idx>].sections[<sidx>].elements[<eidx>].items[<iIdx>].body[<rIdx>].text
//   pages[<idx>].sections[<sidx>].elements[<eidx>].slides[<sIdx>].caption
//   pages[<idx>].sections[<sidx>].elements[<eidx>].links[<lIdx>].label
//
// Columns are indexed by their id in the cells path because the cells
// record is keyed by column id, not by ordinal — keying by ordinal would
// re-order under a column move.

import type { CanvasSiteState } from '../../canvas/schema.js';

export interface CollectedString {
  /** JSONPath-like address; consumed verbatim by `apply.ts`. */
  path: string;
  /** Current value at that path; what the LLM is asked to translate. */
  original: string;
}

/**
 * Walk the editable state once and return every translatable string with its
 * stable address. Order: deterministic — `JSON.stringify`-style pre-order walk
 * so two equal states produce byte-identical tables (which makes the LLM batch
 * stable across runs).
 *
 * Empty strings are skipped: there is nothing to translate and including them
 * would only invite the LLM to hallucinate a non-empty result that overwrites
 * a deliberate blank.
 */
export function collectTranslatableStrings(state: CanvasSiteState): CollectedString[] {
  const out: CollectedString[] = [];
  state.pages.forEach((page, pIdx) => {
    const pagePath = `pages[${String(pIdx)}]`;
    pushIfPresent(out, `${pagePath}.title`, page.title);
    if (typeof page.description === 'string') {
      pushIfPresent(out, `${pagePath}.description`, page.description);
    }
    page.sections.forEach((section, sIdx) => {
      const sectionPath = `${pagePath}.sections[${String(sIdx)}]`;
      section.elements.forEach((element, eIdx) => {
        const elPath = `${sectionPath}.elements[${String(eIdx)}]`;
        collectFromElement(out, elPath, element);
      });
    });
  });
  return out;
}

function pushIfPresent(out: CollectedString[], path: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) return;
  out.push({ path, original: value });
}

function collectFromElement(
  out: CollectedString[],
  path: string,
  element: CanvasSiteState['pages'][number]['sections'][number]['elements'][number],
): void {
  switch (element.type) {
    case 'text': {
      element.content.forEach((run, rIdx) => {
        pushIfPresent(out, `${path}.content[${String(rIdx)}].text`, run.text);
      });
      return;
    }
    case 'action': {
      pushIfPresent(out, `${path}.label`, element.label);
      return;
    }
    case 'media': {
      pushIfPresent(out, `${path}.alt`, element.alt);
      return;
    }
    case 'embed': {
      // url is never translated; title is human-facing label.
      if (typeof element.title === 'string') {
        pushIfPresent(out, `${path}.title`, element.title);
      }
      return;
    }
    case 'chart': {
      element.categories.forEach((cat, cIdx) => {
        pushIfPresent(out, `${path}.categories[${String(cIdx)}]`, cat);
      });
      element.series.forEach((series, sIdx) => {
        pushIfPresent(out, `${path}.series[${String(sIdx)}].label`, series.label);
      });
      if (typeof element.xAxisTitle === 'string') {
        pushIfPresent(out, `${path}.xAxisTitle`, element.xAxisTitle);
      }
      if (typeof element.yAxisTitle === 'string') {
        pushIfPresent(out, `${path}.yAxisTitle`, element.yAxisTitle);
      }
      return;
    }
    case 'table': {
      element.columns.forEach((col, cIdx) => {
        pushIfPresent(out, `${path}.columns[${String(cIdx)}].header`, col.header);
      });
      element.rows.forEach((row, rIdx) => {
        // Keyed by column id — the row's cells record is keyed by column id.
        for (const colId of Object.keys(row.cells)) {
          const value = row.cells[colId];
          if (typeof value === 'string') {
            pushIfPresent(out, `${path}.rows[${String(rIdx)}].cells.${colId}`, value);
          }
        }
      });
      return;
    }
    case 'form': {
      element.fields.forEach((field, fIdx) => {
        pushIfPresent(out, `${path}.fields[${String(fIdx)}].label`, field.label);
        if (typeof field.placeholder === 'string') {
          pushIfPresent(out, `${path}.fields[${String(fIdx)}].placeholder`, field.placeholder);
        }
        if (Array.isArray(field.options)) {
          field.options.forEach((opt, oIdx) => {
            pushIfPresent(
              out,
              `${path}.fields[${String(fIdx)}].options[${String(oIdx)}].label`,
              opt.label,
            );
          });
        }
      });
      pushIfPresent(out, `${path}.submitLabel`, element.submitLabel);
      pushIfPresent(out, `${path}.successMessage`, element.successMessage);
      return;
    }
    case 'accordion': {
      element.items.forEach((item, iIdx) => {
        pushIfPresent(out, `${path}.items[${String(iIdx)}].title`, item.title);
        item.body.forEach((run, rIdx) => {
          pushIfPresent(
            out,
            `${path}.items[${String(iIdx)}].body[${String(rIdx)}].text`,
            run.text,
          );
        });
      });
      return;
    }
    case 'carousel': {
      element.slides.forEach((slide, sIdx) => {
        if (typeof slide.caption === 'string') {
          pushIfPresent(out, `${path}.slides[${String(sIdx)}].caption`, slide.caption);
        }
      });
      return;
    }
    case 'nav': {
      element.links.forEach((link, lIdx) => {
        pushIfPresent(out, `${path}.links[${String(lIdx)}].label`, link.label);
      });
      return;
    }
    case 'code':
      // Never translate code source.
      return;
    case 'shape':
    case 'container':
    case 'symbol-instance':
      // Decorative / structural — no Owner-facing strings here. Symbol
      // instances render through their master section, whose strings are
      // walked when the master's section is encountered (Wave 3 #14 wires
      // masters into the editable state separately). The POC site state
      // exposes only top-level page sections, so master-internal strings
      // are out of scope for this batch — when an Owner edits a master
      // directly it re-translates on next run.
      return;
  }
}
