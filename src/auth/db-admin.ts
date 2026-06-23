import type { Customer } from '../db/schema.js';

export const TEMPLATE_SOURCE_ADMIN_EMAIL = 'aayushman2702@gmail.com';

type CustomerEmail = Pick<Customer, 'email'>;

export function isTemplateSourceAdminCustomer(
  customer: CustomerEmail | null | undefined,
  clerkUserId?: string | null,
  adminUserIds?: string,
): boolean {
  const email = customer?.email;
  if (typeof email === 'string' && email.trim().toLowerCase() === TEMPLATE_SOURCE_ADMIN_EMAIL) {
    return true;
  }
  if (!clerkUserId) return false;
  return (adminUserIds ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(clerkUserId);
}
