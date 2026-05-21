import { Hono } from 'hono';
import { raw } from 'hono/html';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { templates, type TemplateDescriptor } from '../../templates/registry';
import { styles } from './templates.styles';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

export const templatesRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

templatesRoute.use('*', requireAuth());

function Card({ template }: { template: TemplateDescriptor }) {
  const seedColor = template.tokens.paletteSeed;
  const thumbStyle = `background: linear-gradient(140deg, ${seedColor} 0%, oklch(0.18 0.04 245) 110%);`;
  return (
    <article class="card">
      <div class="thumb" style={thumbStyle} aria-hidden="true">
        <span class="thumb-name">{template.name}</span>
      </div>
      <div class="body">
        <div class="row">
          <h2>{template.name}</h2>
          <span class="badge">{template.category}</span>
        </div>
        <p class="tagline">{template.tagline}</p>
        <form method="post" action="/api/sites">
          <input type="hidden" name="templateId" value={template.id} />
          <label for={`siteName-${template.id}`}>Site name</label>
          <input
            type="text"
            id={`siteName-${template.id}`}
            name="siteName"
            placeholder={`My ${template.name.toLowerCase()} site`}
            maxlength={80}
            required
          />
          <button type="submit">Use template</button>
        </form>
      </div>
    </article>
  );
}

function Page() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>rev01 — templates</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
        <style>{raw(styles)}</style>
      </head>
      <body>
        <main>
          <div class="topbar">
            <div class="crumbs">
              <span>rev01</span>
              <span class="sep">/</span>
              <span>dashboard</span>
              <span class="sep">/</span>
              <span class="here">templates</span>
            </div>
            <nav>
              <a href="/dashboard">Dashboard</a>
              <a href="/dashboard/templates" class="active">
                Templates
              </a>
            </nav>
          </div>
          <header class="head">
            <div>
              <h1>
                Pick a <span class="accent">starting point.</span>
              </h1>
              <p class="sub">
                Each template is a seed document. Choosing one copies its pages and theme tokens
                into a new site you fully own — edit, rename, or replace it after.
              </p>
            </div>
            <span class="count">
              {String(templates.length)} {templates.length === 1 ? 'template' : 'templates'}
            </span>
          </header>
          <section class="grid" aria-label="template catalog">
            {templates.map((t) => (
              <Card template={t} />
            ))}
          </section>
          <footer>
            <span class="pip" /> rev01 / templates catalog v0
          </footer>
        </main>
      </body>
    </html>
  );
}

templatesRoute.get('/', (c) => c.html(<Page />));
