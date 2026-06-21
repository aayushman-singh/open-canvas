import { BREAKPOINTS, type Breakpoint, type CanvasSection, type ResponsiveLayoutVariant } from '../schema.js';

export interface ResponsiveVariantMembership {
  variantId: string;
  contentSourceId: string;
  breakpoint: Breakpoint;
  activeBreakpoints: Breakpoint[];
}

const ACTIVE_ORDER: Record<Breakpoint, Breakpoint[]> = {
  desktop: ['desktop'],
  tablet: ['tablet', 'desktop'],
  phone: ['phone', 'tablet', 'desktop'],
};

export function activeResponsiveVariantForBreakpoint(
  variants: readonly ResponsiveLayoutVariant[],
  breakpoint: Breakpoint,
): ResponsiveLayoutVariant | null {
  for (const candidate of ACTIVE_ORDER[breakpoint]) {
    const match = variants.find((variant) => variant.breakpoint === candidate);
    if (match) return match;
  }
  return null;
}

export function responsiveVariantMemberships(
  section: Pick<CanvasSection, 'responsiveVariants'>,
): Map<string, ResponsiveVariantMembership> {
  const memberships = new Map<string, ResponsiveVariantMembership>();
  const bySource = new Map<string, ResponsiveLayoutVariant[]>();
  for (const variant of section.responsiveVariants ?? []) {
    const variants = bySource.get(variant.contentSourceId) ?? [];
    variants.push(variant);
    bySource.set(variant.contentSourceId, variants);
  }

  for (const variants of bySource.values()) {
    const activeBreakpointsByVariant = new Map<string, Breakpoint[]>();
    for (const breakpoint of BREAKPOINTS) {
      const active = activeResponsiveVariantForBreakpoint(variants, breakpoint);
      if (!active) continue;
      const activeBreakpoints = activeBreakpointsByVariant.get(active.id) ?? [];
      activeBreakpoints.push(breakpoint);
      activeBreakpointsByVariant.set(active.id, activeBreakpoints);
    }
    for (const variant of variants) {
      const activeBreakpoints = activeBreakpointsByVariant.get(variant.id) ?? [];
      for (const elementId of variant.elementIds) {
        memberships.set(elementId, {
          variantId: variant.id,
          contentSourceId: variant.contentSourceId,
          breakpoint: variant.breakpoint,
          activeBreakpoints,
        });
      }
    }
  }

  return memberships;
}
