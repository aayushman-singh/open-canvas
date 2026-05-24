import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { uiStyles } from '../../ui';

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

  .app-header {
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .app-header-inner {
    width: min(1120px, calc(100vw - 32px));
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 28px;
    height: 52px;
  }
  .app-logo {
    font-weight: 700;
    font-size: 15px;
    color: var(--text);
    text-decoration: none;
    letter-spacing: -0.03em;
    margin-right: 4px;
  }
  .app-nav {
    display: flex;
    gap: 2px;
  }
  .app-nav-link {
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: none;
    border-radius: 6px;
    transition: color 0.12s, background 0.12s;
  }
  .app-nav-link:hover {
    color: var(--text);
    background: rgba(255,255,255,0.05);
  }
  .app-nav-link[aria-current="page"] {
    color: var(--text);
    background: rgba(255,255,255,0.08);
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
  activePath?: string;
  pageStyles?: string;
  children?: Child;
};

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Sites' },
  { href: '/dashboard/templates', label: 'Templates' },
];

export function DashboardShell({ title, crumbs, activePath, pageStyles, children }: Props) {
  const css = pageStyles ? `${uiStyles}\n${shellStyles}\n${pageStyles}` : `${uiStyles}\n${shellStyles}`;
  const showCrumbs = crumbs.length > 1;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style>{raw(css)}</style>
      </head>
      <body>
        <header class="app-header">
          <div class="app-header-inner">
            <a href="/dashboard" class="app-logo">rev01</a>
            <nav class="app-nav">
              {NAV_ITEMS.map((item) => (
                <a
                  href={item.href}
                  class="app-nav-link"
                  {...(activePath === item.href ? { 'aria-current': 'page' } : {})}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <main>
          {showCrumbs && (
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
          )}
          {children}
        </main>
      </body>
    </html>
  );
}
