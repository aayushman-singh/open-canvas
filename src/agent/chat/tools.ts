// src/agent/chat/tools.ts
//
// Tool surface for the chat orchestrator.
//
// The chat agent consumes the existing canvas tools (rewriteText,
// replaceMedia, designSection) verbatim from `src/agent/canvas-tools.ts` and
// adds two new tools owned here:
//
//   - `query_site` — read-only. Returns a token-bounded summary of the
//     current CanvasSiteState so the model can reference page / section /
//     element ids when it picks a follow-up tool call.
//   - `propose_op` — wraps a canvas op as a preview event. The orchestrator
//     does NOT apply ops to the editable state; it emits an `op-preview`
//     SSE event and the editor client renders accept/reject UI. The actual
//     apply happens through the existing `POST /api/canvas-agent/sites/:id/apply`
//     route — owned by the canvas-agent module — once the Owner accepts.
//
// The existing canvas tools (rewriteText, replaceMedia, designSection) are
// re-exported as part of CHAT_AGENT_TOOLS so the orchestrator dispatches
// them as `propose_op`-equivalent previews. The model sees a single
// extended tool catalogue.

import { CANVAS_AGENT_TOOLS } from '../canvas-tools.js';
import type { JsonSchema, LlmTool } from '../llm.js';
import type {
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  ElementType,
} from '../../canvas/schema.js';
import { ELEMENT_TYPES } from '../../canvas/schema.js';
import type { SiteFont } from '../../db/schema.js';
import { QUERY_SITE_TOKEN_CAP, estimateTokens } from './session.js';

// ---------------------------------------------------------------------------
// query_site — read-only tool
// ---------------------------------------------------------------------------

const querySiteSchema: JsonSchema = {
  type: 'object',
  description:
    'Read-only inspection of the current Editable Site. Returns a sanitised summary the model can use to reference page / section / element ids in follow-up tool calls.',
  properties: {
    detail: {
      type: 'string',
      enum: ['summary', 'full'],
      description:
        'summary (default): page count, section count per page, element type counts. full: per-section element listing with ids and types. Output is always token-capped — large sites are truncated.',
    },
  },
};

export const QUERY_SITE_TOOL: LlmTool = {
  name: 'query_site',
  description:
    'Inspect the current Editable Site. Use this BEFORE proposing an op when you need to learn page / section / element ids. The tool is read-only — it never mutates state.',
  parameters: querySiteSchema,
};

// ---------------------------------------------------------------------------
// CHAT_AGENT_TOOLS — full tool catalogue exposed to the chat model
// ---------------------------------------------------------------------------

export const CHAT_AGENT_TOOLS: LlmTool[] = [QUERY_SITE_TOOL, ...CANVAS_AGENT_TOOLS];

/** Tool names that mutate (produce ops); used by the orchestrator to route to op-preview events. */
export const MUTATING_TOOL_NAMES = new Set<string>([
  'rewriteText',
  'replaceMedia',
  'designSection',
]);

/** Tool names that are read-only; the orchestrator dispatches and feeds the result back into the model. */
export const READ_ONLY_TOOL_NAMES = new Set<string>(['query_site']);

// ---------------------------------------------------------------------------
// query_site implementation — token-budgeted site summary
// ---------------------------------------------------------------------------

export interface QuerySiteSummary {
  styleKit: string;
  defaultLocale: string;
  customStyleKitPresent: boolean;
  symbolsCount: number;
  pageCount: number;
  pages: QuerySitePageSummary[];
  customFonts: QuerySiteFontRef[];
  truncated: boolean;
}

export interface QuerySitePageSummary {
  id: string;
  slug: string;
  title: string;
  locale?: string;
  sectionCount: number;
  sections: QuerySiteSectionSummary[];
}

export interface QuerySiteSectionSummary {
  id: string;
  recipeId: string;
  name: string;
  elementCount: number;
  elementTypeCounts: Partial<Record<ElementType, number>>;
  elements?: Array<{ id: string; type: ElementType }>;
}

export interface QuerySiteFontRef {
  id: string;
  family: string;
  weight: number;
  style: string;
}

export type QuerySiteDetail = 'summary' | 'full';

export interface QuerySiteInput {
  state: CanvasSiteState;
  detail: QuerySiteDetail;
  fonts?: SiteFont[];
}

/**
 * Build a token-bounded summary of the current site state.
 *
 * Two modes: `summary` (default) emits per-section element type counts only;
 * `full` includes the per-element id+type listing. In both modes the result
 * is post-trimmed against {@link QUERY_SITE_TOKEN_CAP} — if the JSON-encoded
 * output exceeds the cap we drop element listings first, then trailing
 * sections, then trailing pages, setting `truncated: true` so the model
 * knows it is reading a partial view.
 */
export function buildQuerySiteSummary(input: QuerySiteInput): QuerySiteSummary {
  const { state, detail, fonts = [] } = input;

  const pages: QuerySitePageSummary[] = state.pages.map((page) => summarisePage(page, detail));

  const customFonts: QuerySiteFontRef[] = fonts.map((f) => ({
    id: f.id,
    family: f.family,
    weight: f.weight,
    style: f.style,
  }));

  const summary: QuerySiteSummary = {
    styleKit: state.styleKit,
    defaultLocale: state.defaultLocale ?? 'en',
    customStyleKitPresent: state.customStyleKit !== undefined,
    symbolsCount: state.symbols.length,
    pageCount: state.pages.length,
    pages,
    customFonts,
    truncated: false,
  };

  return trimToCap(summary);
}

function summarisePage(page: CanvasPage, detail: QuerySiteDetail): QuerySitePageSummary {
  const out: QuerySitePageSummary = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    sectionCount: page.sections.length,
    sections: page.sections.map((section) => summariseSection(section, detail)),
  };
  if (page.locale !== undefined) out.locale = page.locale;
  return out;
}

function summariseSection(
  section: CanvasSection,
  detail: QuerySiteDetail,
): QuerySiteSectionSummary {
  const counts: Partial<Record<ElementType, number>> = {};
  for (const t of ELEMENT_TYPES) {
    // initialise lazily — only emit present types in the output to avoid
    // wasting tokens on a forest of zeros.
    void t;
  }
  for (const el of section.elements) {
    counts[el.type] = (counts[el.type] ?? 0) + 1;
  }
  const out: QuerySiteSectionSummary = {
    id: section.id,
    recipeId: section.recipeId,
    name: section.name,
    elementCount: section.elements.length,
    elementTypeCounts: counts,
  };
  if (detail === 'full') {
    out.elements = section.elements.map((el) => ({ id: el.id, type: el.type }));
  }
  return out;
}

/**
 * Reduce the summary until its JSON projection fits the token cap. Drop
 * (in order): per-element listings, then trailing sections, then trailing
 * pages. Each drop flips `truncated` so the model knows it's looking at a
 * partial view.
 */
function trimToCap(summary: QuerySiteSummary): QuerySiteSummary {
  const cap = QUERY_SITE_TOKEN_CAP;
  const sizeOf = (s: QuerySiteSummary): number => estimateTokens(JSON.stringify(s));

  if (sizeOf(summary) <= cap) return summary;

  // 1) Drop per-element listings.
  let working: QuerySiteSummary = {
    ...summary,
    pages: summary.pages.map((p) => ({
      ...p,
      sections: p.sections.map((s) => {
        const stripped: QuerySiteSectionSummary = {
          id: s.id,
          recipeId: s.recipeId,
          name: s.name,
          elementCount: s.elementCount,
          elementTypeCounts: s.elementTypeCounts,
        };
        return stripped;
      }),
    })),
    truncated: true,
  };
  if (sizeOf(working) <= cap) return working;

  // 2) Drop trailing sections within each page.
  while (sizeOf(working) > cap) {
    const lastNonEmpty = [...working.pages].reverse().find((p) => p.sections.length > 0);
    if (!lastNonEmpty) break;
    lastNonEmpty.sections.pop();
  }
  if (sizeOf(working) <= cap) return working;

  // 3) Drop trailing pages outright.
  while (working.pages.length > 1 && sizeOf(working) > cap) {
    working = { ...working, pages: working.pages.slice(0, -1) };
  }

  return working;
}
