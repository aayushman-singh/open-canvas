import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { allTemplateSeeds } from '../../templates/registry';
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

const styles = `
  :root {
    color-scheme: dark;
    --bg: #080b13;
    --panel: #111827;
    --panel-strong: #182235;
    --text: #f6f7fb;
    --muted: #aeb7c8;
    --faint: #738096;
    --line: rgba(255, 255, 255, 0.12);
    --accent: #7dd3fc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  main {
    width: min(1120px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 32px 0 48px;
  }
  nav {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 28px;
    color: var(--faint);
    font-size: 13px;
  }
  a { color: inherit; }
  h1 {
    margin: 0;
    font-size: 32px;
    line-height: 1.1;
    letter-spacing: 0;
  }
  .lede {
    margin: 10px 0 24px;
    max-width: 640px;
    color: var(--muted);
    font-size: 15px;
  }
  form {
    display: grid;
    gap: 20px;
  }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 10px;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 12px;
  }
  .template {
    display: grid;
    min-height: 180px;
    cursor: pointer;
  }
  .template input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .template-body {
    display: grid;
    align-content: space-between;
    gap: 18px;
    padding: 16px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
  }
  .template input:checked + .template-body {
    border-color: var(--accent);
    background: var(--panel-strong);
  }
  .template:focus-within .template-body {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .template:hover .template-body {
    transform: translateY(-1px);
  }
  .template h2 {
    margin: 0 0 6px;
    font-size: 17px;
    letter-spacing: 0;
  }
  .template p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
  }
  .kit {
    color: var(--accent);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 11px;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 14px;
  }
  label.field {
    display: grid;
    gap: 6px;
    color: var(--muted);
    font-size: 13px;
  }
  input[type='text'] {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 11px 12px;
    font-size: 15px;
  }
  .subdomain {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .suffix {
    color: var(--faint);
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    font-size: 12px;
    white-space: nowrap;
  }
  small {
    color: var(--faint);
    font-size: 12px;
  }
  button {
    justify-self: start;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: #05111a;
    padding: 12px 16px;
    font-weight: 700;
    cursor: pointer;
  }
  @media (max-width: 760px) {
    .fields { grid-template-columns: 1fr; }
    .subdomain { align-items: stretch; flex-direction: column; }
  }
`;

function Page() {
  const subdomainPattern = SUBDOMAIN_RE.source;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>rev01 - create site</title>
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main>
          <nav>
            <a href="/dashboard">Dashboard</a>
            <span>/</span>
            <span>Create site</span>
          </nav>

          <h1>Choose a starting point</h1>
          <p class="lede">
            Pick the canvas seed closest to what you want. You can still move every primitive,
            rewrite the rich text, swap the Style Kit, and publish when it feels right.
          </p>

          <form method="post" action="/api/sites">
            <fieldset>
              <legend>Template</legend>
              <div class="templates">
                {allTemplateSeeds.map((template, idx) => (
                  <label class="template">
                    <input
                      type="radio"
                      name="templateId"
                      value={template.id}
                      required
                      checked={idx === 0}
                    />
                    <span class="template-body">
                      <span>
                        <h2>{template.name}</h2>
                        <p>{template.tagline}</p>
                      </span>
                      <span class="kit">{template.state.styleKit}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div class="fields">
              <label class="field">
                <span>Site name</span>
                <input type="text" name="siteName" maxlength={80} required placeholder="My site" />
              </label>

              <label class="field">
                <span>Subdomain</span>
                <span class="subdomain">
                  <input
                    type="text"
                    name="subdomain"
                    maxlength={63}
                    required
                    pattern={subdomainPattern}
                    placeholder="my-site"
                  />
                  <span class="suffix">{PUBLISHED_SUFFIX}</span>
                </span>
                <small>Lowercase letters, numbers, and hyphens. 2 to 63 characters.</small>
              </label>
            </div>

            <button type="submit">Create site</button>
          </form>
        </main>
      </body>
    </html>
  );
}

templatesRoute.get('/', (c) => c.html(<Page />));
