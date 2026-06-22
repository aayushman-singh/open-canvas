import type { Customer } from '../db/schema.js';

export const TEMPLATE_SOURCE_ADMIN_EMAIL = 'aayushman2702@gmail.com';

type CustomerEmail = Pick<Customer, 'email'>;

export function isTemplateSourceAdminCustomer(
  customer: CustomerEmail | null | undefined,
): boolean {
  const email = customer?.email;
  return typeof email === 'string' && email.trim().toLowerCase() === TEMPLATE_SOURCE_ADMIN_EMAIL;
}
