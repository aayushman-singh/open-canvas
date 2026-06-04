// src/canvas/site-pinned-only-migration.smoke.ts
//
// ADR 0059 — Site header/footer is the only canonical pinned section.
//
// Algorithmic mirror of `drizzle/0014_site_pinned_only.sql`. The SQL file
// is the actual deploy artefact; this smoke verifies the algorithm it
// implements is correct on representative pre-migration shapes and is
// idempotent. If the SQL changes, this smoke changes; if this smoke
// changes, the SQL must be updated to match.
//
// Run with `bun run site-pinned-only-migration:smoke`.

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[site-pinned-only-migration:smoke] ${message}`);
}

type AnyObj = Record<string, unknown>;
type Section = AnyObj & { role?: string };
type Page = AnyObj & { sections: Section[] };
type State = AnyObj & {
  pages: Page[];
  header?: AnyObj;
  footer?: AnyObj;
};

function stripRole(section: Section): Section {
  const { role: _role, ...rest } = section;
  return rest;
}

/**
 * Mirror of the SQL migration's `rewrite_pinned_only` function. Pure,
 * does not mutate input.
 */
export function rewritePinnedOnly(state: State): State {
  const out = JSON.parse(JSON.stringify(state)) as State;

  let promotedHeader: Section | null = null;
  let promotedFooter: Section | null = null;
  const headerAlreadySet = out.header !== undefined && out.header !== null;
  const footerAlreadySet = out.footer !== undefined && out.footer !== null;

  out.pages = (out.pages ?? []).map((page) => {
    const newSections = (page.sections ?? []).map((section) => {
      if (section.role === 'header') {
        if (!headerAlreadySet && promotedHeader === null) {
          promotedHeader = stripRole(section);
        }
        return stripRole(section);
      }
      if (section.role === 'footer') {
        if (!footerAlreadySet && promotedFooter === null) {
          promotedFooter = stripRole(section);
        }
        return stripRole(section);
      }
      return section;
    });
    return { ...page, sections: newSections };
  });

  if (promotedHeader !== null) {
    out.header = promotedHeader;
  }
  if (promotedFooter !== null) {
    out.footer = promotedFooter;
  }

  // Strip `role` from site.header / site.footer even when they pre-existed
  // — was a redundant label at site level, invalid after the union narrows.
  if (out.header) {
    out.header = stripRole(out.header);
  }
  if (out.footer) {
    out.footer = stripRole(out.footer);
  }

  return out;
}

// -- Test cases ---------------------------------------------------------------

function makeSection(id: string, role?: string): Section {
  const base: Section = { id, recipeId: 'custom', name: id, height: 100, elements: [] };
  if (role) base.role = role;
  return base;
}

function makePage(slug: string, sections: Section[]): Page {
  return { id: `page-${slug}`, slug, title: slug, sections };
}

function requirePage(state: State, idx: number): Page {
  const page = state.pages[idx];
  if (!page) throw new Error(`page ${idx} missing`);
  return page;
}

function requireSection(page: Page, idx: number): Section {
  const section = page.sections[idx];
  if (!section) throw new Error(`section ${idx} missing on page ${page.slug as string}`);
  return section;
}

function requireFooter(state: State): Section {
  if (!state.footer) throw new Error('site.footer missing');
  return state.footer;
}

function requireHeader(state: State): Section {
  if (!state.header) throw new Error('site.header missing');
  return state.header;
}

// Case 1: empty site.footer + one page-level role:'footer' section → promoted, role stripped.
{
  const input: State = {
    pages: [makePage('home', [makeSection('hero'), makeSection('foot-1', 'footer')])],
  };
  const out = rewritePinnedOnly(input);
  const footer = requireFooter(out);
  assert(footer.id === 'foot-1', 'case 1: promoted footer id mismatch');
  assert(!('role' in footer), 'case 1: promoted footer role should be stripped');
  const page = requirePage(out, 0);
  assert(page.sections.length === 2, 'case 1: page should still have both sections');
  assert(!('role' in requireSection(page, 1)), 'case 1: page section role should be stripped');
}

// Case 2: site.footer already set + page role:'footer' → no promotion, page role stripped.
{
  const existing = { id: 'site-foot', recipeId: 'custom', name: 'Footer', height: 100, elements: [] };
  const input: State = {
    pages: [makePage('home', [makeSection('foot-2', 'footer')])],
    footer: existing,
  };
  const out = rewritePinnedOnly(input);
  assert(requireFooter(out).id === 'site-foot', 'case 2: existing footer should be kept');
  assert(
    !('role' in requireSection(requirePage(out, 0), 0)),
    'case 2: page section role should still be stripped',
  );
}

// Case 3: site.footer carries redundant role:'footer' label → role stripped from site slot.
{
  const input: State = {
    pages: [makePage('home', [makeSection('placeholder')])],
    footer: { id: 'site-foot', recipeId: 'custom', name: 'Footer', height: 100, role: 'footer', elements: [] },
  };
  const out = rewritePinnedOnly(input);
  const footer = requireFooter(out);
  assert(!('role' in footer), 'case 3: site footer role should be stripped');
  assert(footer.id === 'site-foot', 'case 3: site footer id preserved');
}

// Case 4: multiple pages each carry a role:'footer' section → only first is promoted.
{
  const input: State = {
    pages: [
      makePage('home', [makeSection('foot-a', 'footer')]),
      makePage('about', [makeSection('foot-b', 'footer')]),
    ],
  };
  const out = rewritePinnedOnly(input);
  assert(requireFooter(out).id === 'foot-a', 'case 4: first-found footer should win');
  assert(
    !('role' in requireSection(requirePage(out, 1), 0)),
    'case 4: second page footer role should still be stripped',
  );
}

// Case 5: no role:'header'|'footer' anywhere → no-op (modulo deep clone).
{
  const input: State = {
    pages: [makePage('home', [makeSection('hero'), makeSection('body')])],
  };
  const out = rewritePinnedOnly(input);
  assert(out.footer === undefined, 'case 5: footer should not be invented');
  assert(out.header === undefined, 'case 5: header should not be invented');
  const page = requirePage(out, 0);
  assert(page.sections.length === 2, 'case 5: section count preserved');
  assert(!('role' in requireSection(page, 0)), 'case 5: sections without role stay without role');
}

// Case 6: symmetric header behaviour.
{
  const input: State = {
    pages: [makePage('home', [makeSection('head-1', 'header'), makeSection('body')])],
  };
  const out = rewritePinnedOnly(input);
  assert(requireHeader(out).id === 'head-1', 'case 6: promoted header id mismatch');
  assert(
    !('role' in requireSection(requirePage(out, 0), 0)),
    'case 6: page header role should be stripped',
  );
}

// Case 7: idempotency — running the migration twice produces the same output as once.
{
  const input: State = {
    pages: [
      makePage('home', [makeSection('head-x', 'header'), makeSection('hero'), makeSection('foot-x', 'footer')]),
      makePage('about', [makeSection('hero-2'), makeSection('foot-y', 'footer')]),
    ],
  };
  const once = rewritePinnedOnly(input);
  const twice = rewritePinnedOnly(once);
  assert(JSON.stringify(once) === JSON.stringify(twice), 'case 7: migration must be idempotent');
}

// Case 8: full mixed real-world shape — home.json pre-migration analogue.
{
  const input: State = {
    styleKit: 'charcoal',
    pages: [
      makePage('home', [
        makeSection('hdr', 'header'),
        makeSection('hero'),
        makeSection('features'),
        makeSection('cta'),
        makeSection('ftr', 'footer'),
      ]),
    ],
  };
  const out = rewritePinnedOnly(input);
  assert(requireHeader(out).id === 'hdr', 'case 8: header promoted');
  assert(requireFooter(out).id === 'ftr', 'case 8: footer promoted');
  const page = requirePage(out, 0);
  for (const section of page.sections) {
    assert(
      !('role' in section) || (section.role !== 'header' && section.role !== 'footer'),
      `case 8: page section ${section.id as string} still carries pinned role`,
    );
  }
  assert(page.sections.length === 5, 'case 8: section count preserved');
}

console.log('[site-pinned-only-migration:smoke] ok');
