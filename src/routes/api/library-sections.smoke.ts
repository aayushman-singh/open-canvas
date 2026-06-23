import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const routeSource = readFileSync('src/routes/api/library-sections.ts', 'utf8');
assert(
  routeSource.includes('isTemplateSourceAdminCustomer'),
  'library sections admin API must use the Template Curator customer gate',
);
assert(
  routeSource.includes('ADMIN_CLERK_USER_IDS'),
  'library sections admin API must accept the admin allowlist as a curator fallback',
);
assert(
  !routeSource.includes('requireAdmin()'),
  'library sections admin API must not use the generic Clerk-ID admin gate',
);
assert(
  routeSource.includes('isTemplateSourceAdminCustomer(customerRecord, auth.userId, c.env.ADMIN_CLERK_USER_IDS)'),
  'library sections admin API must pass auth user id and admin allowlist into the curator gate',
);

console.log('[library-sections:smoke] OK');
