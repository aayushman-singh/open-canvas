// src/templates/section-catalog.ts
//
// Boot-time index of every section from every TemplateSeed. The picker UI
// fetches this list once; templates change only on code deploy, so the
// catalog is built statically at module load.

import type { CanvasSection } from '../canvas/schema.js';
import { allTemplateSeeds, instantiateTemplate } from './registry.js';
import { buildSectionThumbnailSvg } from './section-thumbnail.js';

export interface SectionCatalogEntry {
  templateId: string;
  templateName: string;
  sectionId: string;
  recipeId: string;
  sectionName: string;
  headingPreview: string;
  /** Schematic SVG showing the section's element layout — see section-thumbnail.ts. */
  thumbnail: string;
}

function firstHeadingPreview(section: CanvasSection): string {
  for (const element of section.elements) {
    if (element.type !== 'text') continue;
    if (element.role !== 'heading') continue;
    const plain = element.content.map((run) => run.text).join('');
    if (plain.trim().length === 0) continue;
    return plain.length > 80 ? `${plain.slice(0, 77)}…` : plain;
  }
  return '';
}

function buildCatalog(): SectionCatalogEntry[] {
  const entries: SectionCatalogEntry[] = [];
  for (const seed of allTemplateSeeds) {
    // ADR 0061 Phase D — TemplateSeeds are compositions now; materialise
    // each to read the body sections. This walks only the first page,
    // matching the pre-Phase-D behaviour the picker relied on.
    const state = instantiateTemplate(seed.id);
    const page = state.pages[0];
    if (!page) continue;
    for (const section of page.sections) {
      const heading = firstHeadingPreview(section);
      entries.push({
        templateId: seed.id,
        templateName: seed.name,
        sectionId: section.id,
        recipeId: section.recipeId,
        sectionName: section.name,
        headingPreview: heading.length > 0 ? heading : section.recipeId,
        thumbnail: buildSectionThumbnailSvg(section, page.width),
      });
    }
  }
  return entries;
}

export const SECTION_CATALOG: ReadonlyArray<SectionCatalogEntry> = Object.freeze(buildCatalog());
