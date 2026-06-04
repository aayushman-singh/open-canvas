import { raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import {
  themeCss,
  componentsCss,
  themeFontHeadHtml,
  themeBootScript,
  themeToggleScript,
  uiStyles,
  OcLogo,
} from '../../ui';
import type { Theme } from '../../ui';
import { notificationsInboxScript } from '../../notifications/dashboard-inbox-script';
import { bellStyles } from '../../notifications/bell-styles';
import { opencanvasModalScript } from '../../ui/opencanvas-modal-script';

// MIGRATION.md §4 — dashboard chrome wears the Open Canvas skin.
//
// Two shell variants share one component:
//   1. Dashboard root (no `siteNav`): wordmark + primary nav (Your sites /
//      Templates / Add-ons / Settings) in the `.side` rail, top bar with
//      theme toggle + notifications + "New site" + avatar.
//   2. Site sub-page (`siteNav` provided): the `.side` rail swaps to back-
//      link + site identity + per-site links; the top bar gains the page
//      crumb. Drives the sub-pages in §7 (settings/forms/versions/...).
//
// `.app`, `.side`, `.topbar`, `.content`, `.iconbtn`, `.theme-toggle`
// live in components.css — this file only adds shell-specific rules that
// extend them (sidebar internals, brand mark sizing, modal dialogs).
const shellStyles = `
  body { background: var(--paper); }

  /* sidebar internals — match dashboard.html §"sidebar" */
  .side .brand {
    padding: 6px 8px 18px;
    display: inline-flex;
    align-items: center;
    gap: 11px;
    color: var(--ink);
  }
  .side .brand .oc-word { font-size: 15px; }
  .side .grp {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    padding: 14px 10px 6px;
  }
  .side a.nav-row {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 11px;
    border-radius: var(--r-xs);
    font-size: 14.5px;
    font-weight: 550;
    color: var(--ink-2);
    text-decoration: none;
    transition: background 0.14s, color 0.14s;
  }
  .side a.nav-row svg { width: 18px; height: 18px; flex-shrink: 0; }
  .side a.nav-row:hover { background: var(--surface-2); color: var(--ink); }
  .side a.nav-row[aria-current="page"] {
    background: var(--red-soft);
    color: var(--red-ink);
    font-weight: 650;
  }

  /* per-site sidebar identity card */
  .side .site-id-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 14px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 8px;
  }
  .side .site-id-row .swatch {
    width: 30px;
    height: 30px;
    border-radius: var(--r-xs);
    background: linear-gradient(135deg, #E9837A, #C5332F);
    flex-shrink: 0;
  }
  .side .site-id-row b { font-size: 14.5px; font-family: var(--display); color: var(--ink); }
  .side .site-id-row small { display: block; font-size: 11px; color: var(--ink-3); }

  /* topbar: page-level controls */
  .topbar a.brand-mini {
    color: var(--ink);
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  .topbar .crumb-trail {
    font-size: 14px;
    color: var(--ink-2);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .topbar .crumb-trail a {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 1px;
  }
  .topbar .crumb-trail a:hover { color: var(--ink); border-bottom-color: var(--line); }
  .topbar .crumb-trail .here { color: var(--ink); font-weight: 600; }
  .topbar .crumb-trail .sep { color: var(--ink-3); }

  /* icon button used for notifications etc. */
  .iconbtn {
    width: 40px;
    height: 40px;
    border-radius: var(--r-pill);
    border: 1.5px solid var(--line-2);
    background: var(--surface);
    color: var(--ink-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .iconbtn:hover { border-color: var(--ink); color: var(--ink); }

  /* avatar circle */
  .avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    text-decoration: none;
    overflow: hidden;
    background: linear-gradient(135deg, #E9837A, #C5332F);
  }
  .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

  /* content wrap matches dashboard.html sizing */
  .content { width: 100%; max-width: 1180px; padding: 32px 28px 60px; }

  nav.crumbs {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 28px;
    color: var(--ink-3);
    font-size: 13px;
  }
  nav.crumbs a {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid transparent;
    padding-bottom: 1px;
  }
  nav.crumbs a:hover { color: var(--ink); border-bottom-color: var(--line); }
  nav.crumbs .here { color: var(--ink); }

  /* modal dialog — restyled with Open Canvas surface + shadow */
  .opencanvas-modal-backdrop {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(26, 25, 23, 0.55);
    display: flex; align-items: center; justify-content: center;
    animation: opencanvas-modal-in .12s ease-out;
  }
  @keyframes opencanvas-modal-in { from { opacity: 0 } }
  .opencanvas-modal {
    width: min(440px, calc(100vw - 48px));
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r);
    padding: 24px;
    box-shadow: var(--shadow-lg);
    color: var(--ink);
    animation: opencanvas-modal-pop .12s ease-out;
  }
  @keyframes opencanvas-modal-pop { from { transform: scale(.96); opacity: 0 } }
  .opencanvas-modal h3 {
    margin: 0 0 8px;
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--ink);
  }
  .opencanvas-modal p {
    margin: 0 0 16px;
    font-size: 14px;
    color: var(--ink-2);
    line-height: 1.55;
    white-space: pre-line;
  }
  .opencanvas-modal input[type="text"] {
    width: 100%;
    background: var(--surface);
    border: 1.5px solid var(--line-2);
    border-radius: var(--r-sm);
    padding: 11px 14px;
    color: var(--ink);
    font: inherit;
    font-size: 14.5px;
    outline: none;
    margin-bottom: 16px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .opencanvas-modal input[type="text"]:focus {
    border-color: var(--red);
    box-shadow: var(--ring);
  }
  .opencanvas-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .opencanvas-modal-actions button {
    appearance: none;
    font: inherit;
    font-family: var(--sans);
    font-size: 13.5px;
    font-weight: 650;
    padding: 9px 18px;
    border-radius: var(--r-pill);
    cursor: pointer;
    border: 1.5px solid transparent;
    transition: background .15s, border-color .15s, color .15s, transform .12s;
  }
  .opencanvas-modal-actions button:active { transform: translateY(1px); }
  .opencanvas-modal-cancel {
    background: var(--surface);
    border-color: var(--line-2);
    color: var(--ink-2);
  }
  .opencanvas-modal-cancel:hover { border-color: var(--ink); color: var(--ink); }
  .opencanvas-modal-ok {
    background: var(--ink);
    color: var(--paper);
  }
  .opencanvas-modal-ok:hover { transform: translateY(-1px); }
  .opencanvas-modal-danger {
    background: var(--red);
    color: #fff;
    box-shadow: var(--shadow-red);
  }
  .opencanvas-modal-danger:hover { background: var(--red-strong); }

`;

export type Crumb = { href?: string; label: string };

export type SiteNavItem = { href: string; label: string; icon: string };

export type SiteNav = {
  siteId: string;
  siteName: string;
  subdomain?: string;
  items: SiteNavItem[];
  activePath: string;
};

// Open Canvas per-site sidebar icons. Each entry mirrors the SVG path
// data from design-references/site-shell.js so the chrome stays
// byte-identical with the design source.
const SITE_NAV_ITEMS: Omit<SiteNavItem, 'href'>[] = [
  {
    label: 'Editor',
    icon: '<path d="M12 19l7-7 3 3-7 7-3-3zM2 22l1.5-5L14 6.5 17.5 10 7 20.5 2 22z" stroke-linejoin="round"/>',
  },
  {
    label: 'Settings',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 4.6 13a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7 2 2 0 1 1 2.8-2.8A1.6 1.6 0 0 0 11 4.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 19.4 11"/>',
  },
  {
    label: 'Forms',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h5" stroke-linecap="round"/>',
  },
  {
    label: 'Entries',
    icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h7" stroke-linecap="round"/>',
  },
  {
    label: 'Versions',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2" stroke-linecap="round"/>',
  },
  {
    label: 'Domains',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  },
  {
    label: 'Addons',
    icon: '<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 19l-4.8 2.5.9-5.4L4.2 8.3l5.4-.8z" stroke-linejoin="round"/>',
  },
  {
    label: 'Accessibility',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5M12 16h.01" stroke-linecap="round"/>',
  },
  {
    label: 'Chat',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  },
];

const SITE_NAV_PATHS: Record<string, string> = {
  Editor: 'edit',
  Settings: 'settings',
  Forms: 'forms',
  Entries: 'entries',
  Versions: 'snapshots',
  Domains: 'domains',
  Addons: 'addons',
  Accessibility: 'a11y',
  Chat: 'chat',
};

export function buildSiteNav(siteId: string, siteName: string, activePath: string): SiteNav {
  const base = `/dashboard/sites/${siteId}`;
  return {
    siteId,
    siteName,
    activePath,
    items: SITE_NAV_ITEMS.map((item) => ({
      ...item,
      href: `${base}/${SITE_NAV_PATHS[item.label]}`,
    })),
  };
}

type UserMeta = {
  avatarUrl?: string | undefined;
  displayName?: string | undefined;
  email?: string | undefined;
};

type Props = {
  title: string;
  crumbs: Crumb[];
  activePath?: string;
  pageStyles?: string;
  userMeta?: UserMeta;
  siteNav?: SiteNav;
  // SSR pre-paint: the visitor's persisted theme, read from the `oc-theme`
  // cookie before render (see readThemeCookie in src/ui/theme.ts). When
  // 'dark', we stamp `data-theme="dark"` on <html> so the dark palette
  // resolves on first paint without waiting for JS. When undefined the
  // attribute is omitted — light is the implicit default and the boot
  // script remains a no-op for the cookie-less first-visit case. The
  // explicit `| undefined` matches exactOptionalPropertyTypes so callers
  // can pass `readThemeCookie(c)` directly without conditional spread.
  theme?: Theme | undefined;
  // Extra <head> children (e.g. <link rel="preload"> hints). Rendered after
  // the theme + fonts + page styles so the preload-scanner sees them on
  // first parse. Same-origin asset URLs requested here populate the HTTP
  // cache that same-origin iframes (e.g. site-card srcdoc previews) read
  // from — see ADR 0038 + dashboard index.tsx for the iframe shape.
  headLinks?: Child;
  children?: Child;
};

// Top-level nav for the dashboard root sidebar. Maps directly to the
// dashboard.html sidebar groups.
const PRIMARY_NAV = [
  {
    href: '/dashboard',
    label: 'Your sites',
    icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  },
  {
    href: '/dashboard/templates',
    label: 'Templates',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  },
  {
    href: '/dashboard/addons',
    label: 'Add-ons',
    icon: '<path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 19l-4.8 2.5.9-5.4L4.2 8.3l5.4-.8z"/>',
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.7 1.1 2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.6-1.1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 4.6 13a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.1-2.7 2 2 0 1 1 2.8-2.8A1.6 1.6 0 0 0 11 4.6a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.7 1.1 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 19.4 11"/>',
  },
];

// Help link sits below the spacer in the sidebar. Conceptual "help &
// guides" entry from dashboard.html.
const HELP_LINK = {
  href: '/dashboard/help',
  label: 'Help & guides',
  icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .7-1 1.7M12 17h.01" stroke-linecap="round"/>',
};

function NavIconSvg({ paths }: { paths: string }) {
  return raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`,
  );
}

function ThemeToggleIcons() {
  return raw(
    `<svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19"/></svg>` +
      `<svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z"/></svg>`,
  );
}

function NotificationIcon() {
  return raw(
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );
}

function PlusIcon() {
  return raw(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  );
}

function BackArrowIcon() {
  return raw(
    `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
  );
}

export function DashboardShell({ title, crumbs, activePath, pageStyles, userMeta, siteNav, theme, headLinks, children }: Props) {
  // theme.css tokens go FIRST so the alias block re-points
  // --bg/--panel/--text/--accent/... onto Open Canvas palette before any
  // chrome rule reads them. Per-page <style> blocks (pageStyles) win last
  // so route-specific overrides still take effect.
  const css = pageStyles
    ? `${themeCss}\n${componentsCss}\n${uiStyles}\n${shellStyles}\n${bellStyles}\n${pageStyles}`
    : `${themeCss}\n${componentsCss}\n${uiStyles}\n${shellStyles}\n${bellStyles}`;
  const showCrumbs = crumbs.length > 1;

  const initial = (userMeta?.displayName ?? userMeta?.email ?? '?').charAt(0).toUpperCase();

  const sidebar = siteNav ? (
    <aside class="side" role="navigation" aria-label="Site management">
      <a href="/dashboard" class="nav-row">
        <BackArrowIcon />
        All sites
      </a>
      <div class="site-id-row">
        <span class="swatch" />
        <span>
          <b>{siteNav.siteName}</b>
          {siteNav.subdomain && <small>{siteNav.subdomain}</small>}
        </span>
      </div>
      {siteNav.items.map((item) => (
        <a
          href={item.href}
          class="nav-row"
          {...(siteNav.activePath === item.href ? { 'aria-current': 'page' } : {})}
        >
          <NavIconSvg paths={item.icon} />
          {item.label}
        </a>
      ))}
      <div class="spacer" />
      <a href="/dashboard" class="nav-row">
        <NavIconSvg paths={HELP_LINK.icon} />
        Help &amp; guides
      </a>
    </aside>
  ) : (
    <aside class="side" role="navigation" aria-label="Primary">
      <a href="/dashboard" class="oc-logo brand">
        <OcLogo size={26} />
        <span class="oc-word">Open&nbsp;Canvas</span>
      </a>
      {PRIMARY_NAV.map((item) => (
        <a
          href={item.href}
          class="nav-row"
          {...(activePath === item.href ? { 'aria-current': 'page' } : {})}
        >
          <NavIconSvg paths={item.icon} />
          {item.label}
        </a>
      ))}
      <div class="spacer" />
      <a href={HELP_LINK.href} class="nav-row">
        <NavIconSvg paths={HELP_LINK.icon} />
        Help &amp; guides
      </a>
    </aside>
  );

  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <script>{raw(themeBootScript)}</script>
        {raw(themeFontHeadHtml)}
        <style>{raw(css)}</style>
        {headLinks}
      </head>
      <body>
        <div class="app">
          {sidebar}
          <div class="main">
            <header class="topbar">
              {siteNav ? (
                <span class="crumb-trail">
                  <a href="/dashboard">Dashboard</a>
                  <span class="sep">/</span>
                  <span class="here">{siteNav.siteName}</span>
                </span>
              ) : (
                <span class="crumb-trail">
                  <span class="here">Your sites</span>
                </span>
              )}
              <div class="sp" />
              <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
                <ThemeToggleIcons />
              </button>
              <div class="notif-wrap">
                <button class="notif-bell" id="notif-bell" aria-label="Notifications" aria-expanded="false" aria-controls="notif-panel">
                  <NotificationIcon />
                  <span class="notif-badge" id="notif-badge" hidden aria-hidden="true">0</span>
                </button>
                <div class="notif-panel" id="notif-panel" role="region" aria-labelledby="notif-bell" hidden>
                  <div class="notif-panel-head">
                    <span>Notifications</span>
                    <button type="button" class="notif-mark-all" id="notif-mark-all" hidden>
                      Mark all read
                    </button>
                  </div>
                  <ul class="notif-list" id="notif-list" aria-live="polite">
                    <li class="notif-empty" data-state="loading">Loading…</li>
                  </ul>
                </div>
              </div>
              <a href="/dashboard/templates" class="btn btn-primary btn-sm">
                <PlusIcon />
                New site
              </a>
              {userMeta && (
                <a
                  href="/dashboard/profile"
                  class="avatar"
                  title={userMeta.displayName ?? userMeta.email ?? 'Profile'}
                >
                  {userMeta.avatarUrl ? (
                    <img src={userMeta.avatarUrl} alt="" width="38" height="38" />
                  ) : (
                    initial
                  )}
                </a>
              )}
            </header>
            <main class="content">
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
          </div>
        </div>
        <script>{raw(themeToggleScript)}</script>
        <script>{raw(opencanvasModalScript)}</script>
        <script>{raw("window.__opencanvasInboxApiBase = '/api';")}</script>
        <script>{raw(notificationsInboxScript)}</script>
      </body>
    </html>
  );
}
