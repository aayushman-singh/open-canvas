import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';

const shellStyles = `
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
  nav.crumbs {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 28px;
    color: var(--faint);
    font-size: 13px;
  }
  nav.crumbs a {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 1px;
  }
  nav.crumbs a:hover { color: var(--text); border-bottom-color: var(--line); }
  nav.crumbs .here { color: var(--text); }
  a { color: var(--accent); }
  h1 {
    margin: 0 0 12px;
    font-size: 32px;
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  p { color: var(--muted); line-height: 1.55; }
`;

export type Crumb = { href?: string; label: string };

type Props = {
  title: string;
  crumbs: Crumb[];
  pageStyles?: string;
  children?: Child;
};

export function DashboardShell({ title, crumbs, pageStyles, children }: Props) {
  const css = pageStyles ? `${shellStyles}\n${pageStyles}` : shellStyles;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{raw(css)}</style>
      </head>
      <body>
        <main>
          <nav class="crumbs">
            {crumbs.map((crumb, i) => (
              <>
                {i > 0 && <span>/</span>}
                {crumb.href ? (
                  <a href={crumb.href}>{crumb.label}</a>
                ) : (
                  <span class="here">{crumb.label}</span>
                )}
              </>
            ))}
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
