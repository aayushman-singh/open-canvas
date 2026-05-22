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

    // Clerk's hosted account portal hands off the session via a handshake
    // round-trip. When status === 'handshake', Clerk wants the user redirected
    // back to itself to complete cookie setup; we must return its response
    // verbatim (Location + Set-Cookie). Skipping this step breaks sign-in:
    // requireAuth keeps redirecting to /sign-in because the session cookie
    // never lands on the parent domain.
    if (requestState.status === 'handshake') {
      const location = requestState.headers.get('location');
      const status = location ? 307 : 200;
      return new Response(null, { status, headers: requestState.headers });
    }

    // Forward any Set-Cookie / Clerk-* headers Clerk attached to the response
    // (used by the SDK to refresh the session cookie when it's nearing expiry).
    for (const [key, value] of requestState.headers.entries()) {
      c.header(key, value, { append: true });
    }

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
