import { isTemplateSourceAdminCustomer, TEMPLATE_SOURCE_ADMIN_EMAIL } from './db-admin.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[db-admin:smoke] ${message}`);
}

assert(
  isTemplateSourceAdminCustomer({ email: TEMPLATE_SOURCE_ADMIN_EMAIL }),
  'configured template source admin email must be accepted',
);
assert(
  isTemplateSourceAdminCustomer({ email: `  ${TEMPLATE_SOURCE_ADMIN_EMAIL.toUpperCase()}  ` }),
  'template source admin email comparison must be case-insensitive and trimmed',
);
assert(
  !isTemplateSourceAdminCustomer({ email: 'someone@example.com' }),
  'non-admin email must be rejected',
);
assert(!isTemplateSourceAdminCustomer(null), 'missing customer row must be rejected');

console.log('[db-admin:smoke] OK');
