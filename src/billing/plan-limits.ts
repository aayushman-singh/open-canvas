export const FREE_SITE_LIMIT = 3;
export const FREE_STORAGE_LIMIT = 100 * 1024 * 1024;
const PRO_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;
const TEAM_STORAGE_LIMIT = 50 * 1024 * 1024 * 1024;

export function siteLimitForPlan(plan: string): number | null {
  switch (plan) {
    case 'pro':
    case 'team':
      return null;
    case 'free':
    default:
      return FREE_SITE_LIMIT;
  }
}

export function storageLimitForPlan(plan: string): number {
  switch (plan) {
    case 'pro':
      return PRO_STORAGE_LIMIT;
    case 'team':
      return TEAM_STORAGE_LIMIT;
    case 'free':
    default:
      return FREE_STORAGE_LIMIT;
  }
}

export function billingPlanLabel(plan: string): string {
  switch (plan) {
    case 'free':
      return 'Free';
    case 'pro':
      return 'Pro';
    case 'team':
      return 'Team';
    default:
      return 'Current';
  }
}

export function billingPlanInvoiceAmount(plan: string): string {
  switch (plan) {
    case 'pro':
      return '$19.00';
    case 'team':
      return '$49.00';
    case 'free':
    default:
      return '$0.00';
  }
}

export function siteLimitError(plan: string): string {
  const siteLimit = siteLimitForPlan(plan);
  if (siteLimit === null) {
    throw new Error(`site limit error requested for uncapped plan: ${plan}`);
  }
  return `${billingPlanLabel(plan)} plan allows up to ${String(siteLimit)} sites. Upgrade to create more.`;
}
