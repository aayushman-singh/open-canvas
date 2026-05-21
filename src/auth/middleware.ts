import { createClerkClient, type User } from '@clerk/backend';
import { createMiddleware } from 'hono/factory';

export type AuthState = {
  userId: string | null;
  sessionId: string | null;
  getToken: ((options?: { template?: string }) => Promise<string | null>) | null;
};

type ClerkBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
};

export type ClerkAuthVariables = {
  auth: AuthState;
  user: User | null;
  clerk: ReturnType<typeof createClerkClient>;
};

const AUTHORIZED_PARTIES = ['http://localhost:8787', 'https://rev01.aayushman.dev'];

export function clerkAuth() {
  return createMiddleware<{
    Bindings: ClerkBindings;
    Variables: ClerkAuthVariables;
  }>(async (c, next) => {
    const clerk = createClerkClient({
      publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      secretKey: c.env.CLERK_SECRET_KEY,
    });
    c.set('clerk', clerk);

    const requestState = await clerk.authenticateRequest(c.req.raw, {
      authorizedParties: AUTHORIZED_PARTIES,
    });

    if (!requestState.isAuthenticated) {
      c.set('auth', { userId: null, sessionId: null, getToken: null });
      c.set('user', null);
      await next();
      return;
    }

    const auth = requestState.toAuth();
    c.set('auth', {
      userId: auth.userId,
      sessionId: auth.sessionId,
      getToken: auth.getToken,
    });

    const user = await clerk.users.getUser(auth.userId);
    c.set('user', user);

    await next();
  });
}
