import type { BillingPlan } from '../db/schema';

export interface PlanEntitlements {
  siteLimit: number;
  storageBytes: number;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

export const PLAN_DISPLAY_NAMES: Record<BillingPlan, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
};

export const PLAN_ENTITLEMENTS: Record<BillingPlan, PlanEntitlements> = {
  free: { siteLimit: 3, storageBytes: 100 * 1024 * 1024 },
  pro: { siteLimit: UNLIMITED, storageBytes: 10 * 1024 * 1024 * 1024 },
  team: { siteLimit: UNLIMITED, storageBytes: 50 * 1024 * 1024 * 1024 },
};

export function entitlementsFor(plan: BillingPlan | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan ?? 'free'];
}

export function isUnlimited(value: number): boolean {
  return !Number.isFinite(value);
}

export function siteLimitExceededMessage(plan: BillingPlan): string {
  const { siteLimit } = entitlementsFor(plan);
  if (isUnlimited(siteLimit)) {
    throw new Error(`siteLimitExceededMessage called for plan with unlimited sites: ${plan}`);
  }
  const planName = PLAN_DISPLAY_NAMES[plan];
  return `${planName} plan allows up to ${String(siteLimit)} sites. Upgrade to create more.`;
}
