import { Hono } from 'hono';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { starterTemplate } from '../../templates/registry';
import { SUBDOMAIN_RE } from '../api/sites';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

export const templatesRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

templatesRoute.use('*', clerkAuth());
templatesRoute.use('*', requireAuth());

const PUBLISHED_SUFFIX = '.rev01.aayushman.dev';

function Page() {
  const subdomainPattern = SUBDOMAIN_RE.source;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark light" />
        <title>rev01 — create site</title>
      </head>
      <body
        style="font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5;"
      >
        <nav style="margin-bottom: 1.5rem;">
          <a href="/dashboard">Dashboard</a> · <span>Create site</span>
        </nav>

        <h1>Create a new site</h1>
        <p>
          rev01 ships with one starting point: <strong>{starterTemplate.name}</strong>.{' '}
          {starterTemplate.tagline}
        </p>

        <form
          method="post"
          action="/api/sites"
          style="display: grid; gap: 1rem; margin-top: 1.5rem;"
        >
          <input type="hidden" name="templateId" value={starterTemplate.id} />

          <label style="display: grid; gap: 0.25rem;">
            <span>Site name</span>
            <input
              type="text"
              name="siteName"
              maxlength={80}
              required
              placeholder="My site"
              style="padding: 0.5rem; font-size: 1rem;"
            />
          </label>

          <label style="display: grid; gap: 0.25rem;">
            <span>Subdomain</span>
            <span
              style="display: inline-flex; align-items: center; gap: 0.25rem; font-family: ui-monospace, monospace;"
            >
              <input
                type="text"
                name="subdomain"
                maxlength={63}
                required
                pattern={subdomainPattern}
                placeholder="my-site"
                style="padding: 0.5rem; font-size: 1rem; flex: 1; min-width: 0;"
              />
              <span>{PUBLISHED_SUFFIX}</span>
            </span>
            <small>
              Lowercase letters, numbers, and hyphens. Cannot start or end with a hyphen. 2 to 63
              characters.
            </small>
          </label>

          <button
            type="submit"
            style="padding: 0.65rem 1rem; font-size: 1rem; cursor: pointer;"
          >
            Create site
          </button>
        </form>
      </body>
    </html>
  );
}

templatesRoute.get('/', (c) => c.html(<Page />));
