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
  nav.tabs {
    display: flex;
    gap: 4px;
    align-items: center;
    width: fit-content;
    margin-bottom: 28px;
    padding: 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
  }
  nav.tabs a,
  nav.tabs span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    border: 1px solid transparent;
  }
  nav.tabs a {
    color: var(--muted);
  }
  nav.tabs a:hover {
    color: var(--text);
  }
  nav.tabs span.active {
    background: var(--panel-strong);
    color: var(--text);
    border-color: var(--line);
  }
  a { color: var(--accent); }
  h1 {
    margin: 0 0 12px;
    font-size: 32px;
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  p { color: var(--muted); line-height: 1.55; }
`;

export type Tab = { href: string; label: string; active: boolean };

type Props = {
  title: string;
  tabs: Tab[];
  pageStyles?: string;
  children?: Child;
};

export function DashboardShell({ title, tabs, pageStyles, children }: Props) {
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
          <nav class="tabs" aria-label="Dashboard">
            {tabs.map((tab) =>
              tab.active ? (
                <span class="active" aria-current="page">
                  {tab.label}
                </span>
              ) : (
                <a href={tab.href}>{tab.label}</a>
              ),
            )}
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
