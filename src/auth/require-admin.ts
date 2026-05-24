import { createMiddleware } from 'hono/factory';
import type { ClerkAuthVariables } from './middleware';

type AdminBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  ADMIN_CLERK_USER_IDS?: string;
};

let cachedAdminIds: Set<string> | null = null;
let cachedRaw: string | undefined;

function resolveAdminIds(raw: string | undefined): Set<string> {
  if (cachedAdminIds && cachedRaw === raw) return cachedAdminIds;
  cachedRaw = raw;
  cachedAdminIds = new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return cachedAdminIds;
}

export function requireAdmin() {
  return createMiddleware<{
    Bindings: AdminBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth.userId) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const adminIds = resolveAdminIds(c.env.ADMIN_CLERK_USER_IDS);
    if (!adminIds.has(auth.userId)) {
      return c.json({ error: 'admin access required' }, 403);
    }
    await next();
  });
}

export function isAdmin(userId: string, adminUserIds: string | undefined): boolean {
  return resolveAdminIds(adminUserIds).has(userId);
}
