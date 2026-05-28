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

  .app-header-inner { justify-content: flex-start; }
  .app-nav { flex: 1; }
  .app-avatar-link {
    display: flex;
    align-items: center;
    text-decoration: none;
    border: none;
    margin-left: auto;
    flex-shrink: 0;
  }
  .app-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid transparent;
    transition: border-color 0.12s;
  }
  .app-avatar-link:hover .app-avatar { border-color: var(--accent); }
  .app-avatar--fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(125,211,252,0.15);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
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

  .site-layout { display: flex; gap: 0; min-height: calc(100vh - 53px); }
  .site-sidebar {
    width: 220px;
    flex-shrink: 0;
    border-right: 1px solid var(--line);
    padding: 20px 0;
    position: sticky;
    top: 53px;
    height: calc(100vh - 53px);
    overflow-y: auto;
  }
  .site-sidebar-back {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 20px 16px;
    font-size: 12px;
    color: var(--faint);
    text-decoration: none;
    border-bottom: 1px solid var(--line);
    margin-bottom: 8px;
  }
  .site-sidebar-back:hover { color: var(--text); }
  .site-sidebar-name {
    padding: 10px 20px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }
  .site-sidebar-nav { display: flex; flex-direction: column; gap: 1px; padding: 0 8px; }
  .site-sidebar-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: none;
    border-radius: 6px;
    transition: color 0.12s, background 0.12s;
  }
  .site-sidebar-link:hover { color: var(--text); background: rgba(255,255,255,0.05); }
  .site-sidebar-link[aria-current="page"] { color: var(--text); background: rgba(255,255,255,0.08); }
  .site-sidebar-link .ico { width: 16px; text-align: center; font-size: 14px; flex-shrink: 0; opacity: 0.7; }
  .site-sidebar-link[aria-current="page"] .ico { opacity: 1; }
  .site-layout main { flex: 1; min-width: 0; }

  .r-modal-backdrop {
    position: fixed; inset: 0; z-index: 10000;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    animation: r-modal-in .12s ease-out;
  }
  @keyframes r-modal-in { from { opacity: 0 } }
  .r-modal {
    width: min(440px, calc(100vw - 48px));
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 24px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    color: var(--text);
    animation: r-modal-pop .12s ease-out;
  }
  @keyframes r-modal-pop { from { transform: scale(.96); opacity: 0 } }
  .r-modal h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  .r-modal p { margin: 0 0 16px; font-size: 14px; color: var(--muted); line-height: 1.5; white-space: pre-line; }
  .r-modal input[type="text"] {
    width: 100%; background: var(--bg); border: 1px solid var(--line);
    border-radius: 6px; padding: 10px 12px; color: var(--text);
    font: inherit; font-size: 14px; outline: none; margin-bottom: 16px;
  }
  .r-modal input[type="text"]:focus { border-color: var(--accent); }
  .r-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .r-modal-actions button {
    appearance: none; font: inherit; font-size: 13px; font-weight: 500;
    padding: 8px 16px; border-radius: 6px; cursor: pointer;
    transition: background .12s, border-color .12s, color .12s;
  }
  .r-modal-cancel {
    background: transparent; border: 1px solid var(--line); color: var(--muted);
  }
  .r-modal-cancel:hover { border-color: var(--accent); color: var(--text); }
  .r-modal-ok {
    background: var(--accent); border: 1px solid var(--accent); color: #080b13;
  }
  .r-modal-ok:hover { filter: brightness(1.1); }
  .r-modal-danger {
    background: #ef4444; border: 1px solid #ef4444; color: #fff;
  }
  .r-modal-danger:hover { background: #dc2626; border-color: #dc2626; }
`;

export type Crumb = { href?: string; label: string };

export type SiteNavItem = { href: string; label: string; icon: string };

export type SiteNav = {
  siteId: string;
  siteName: string;
  items: SiteNavItem[];
  activePath: string;
};

const SITE_NAV_ITEMS: Omit<SiteNavItem, 'href'>[] = [
  { label: 'Go to editor', icon: '✎' },
  { label: 'Settings', icon: '⚙' },
  { label: 'Navigation', icon: '☰' },
  { label: 'Forms', icon: '✉' },
  { label: 'Versions', icon: '⧖' },
  { label: 'Domains', icon: '⌗' },
  { label: 'Addons', icon: '⬡' },
  { label: 'Accessibility', icon: '✔' },
  { label: 'Chat', icon: '…' },
];

const SITE_NAV_PATHS: Record<string, string> = {
  'Go to editor': 'edit',
  Settings: 'settings',
  Navigation: 'nav',
  Forms: 'forms',
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
  children?: Child;
};

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Sites' },
  { href: '/dashboard/templates', label: 'Templates' },
  { href: '/dashboard/shop', label: 'Shop' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export function DashboardShell({ title, crumbs, activePath, pageStyles, userMeta, siteNav, children }: Props) {
  const css = pageStyles ? `${uiStyles}\n${shellStyles}\n${pageStyles}` : `${uiStyles}\n${shellStyles}`;
  const showCrumbs = crumbs.length > 1;

  const mainContent = (
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
  );

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
            {userMeta && (
              <a href="/dashboard/profile" class="app-avatar-link" title={userMeta.displayName ?? userMeta.email ?? 'Profile'}>
                {userMeta.avatarUrl ? (
                  <img src={userMeta.avatarUrl} alt="" class="app-avatar" width="28" height="28" />
                ) : (
                  <span class="app-avatar app-avatar--fallback">
                    {(userMeta.displayName ?? userMeta.email ?? '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </a>
            )}
          </div>
        </header>
        {siteNav ? (
          <div class="site-layout">
            <aside class="site-sidebar" role="navigation" aria-label="Site management">
              <a href="/dashboard" class="site-sidebar-back">&larr; All sites</a>
              <div class="site-sidebar-name">{siteNav.siteName}</div>
              <nav class="site-sidebar-nav">
                {siteNav.items.map((item) => (
                  <a
                    href={item.href}
                    class="site-sidebar-link"
                    {...(siteNav.activePath === item.href ? { 'aria-current': 'page' } : {})}
                  >
                    <span class="ico">{item.icon}</span>
                    {item.label}
                  </a>
                ))}
              </nav>
            </aside>
            {mainContent}
          </div>
        ) : (
          mainContent
        )}
        <script>{raw(`(function(){
  function _build(o){return new Promise(function(resolve){
    var bd=document.createElement('div');bd.className='r-modal-backdrop';
    var m=document.createElement('div');m.className='r-modal';
    m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    if(o.title){var h=document.createElement('h3');h.textContent=o.title;m.appendChild(h);}
    if(o.message){var p=document.createElement('p');p.textContent=o.message;m.appendChild(p);}
    var inp=null;
    if(o.type==='prompt'){inp=document.createElement('input');inp.type='text';inp.value=o.defaultValue||'';m.appendChild(inp);}
    var acts=document.createElement('div');acts.className='r-modal-actions';
    var cancelBtn=null;
    if(o.type!=='alert'){cancelBtn=document.createElement('button');cancelBtn.type='button';cancelBtn.className='r-modal-cancel';cancelBtn.textContent='Cancel';acts.appendChild(cancelBtn);}
    var ok=document.createElement('button');ok.type='button';
    ok.className=o.danger?'r-modal-danger':'r-modal-ok';
    ok.textContent=o.confirmLabel||'OK';acts.appendChild(ok);m.appendChild(acts);bd.appendChild(m);
    function close(v){document.removeEventListener('keydown',onKey,true);if(bd.parentNode)bd.parentNode.removeChild(bd);resolve(v);}
    function onKey(e){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(o.type==='confirm'?false:null);return;}
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(o.type==='prompt')close(inp.value);else if(o.type==='confirm')close(true);else close(undefined);}
    }
    bd.addEventListener('click',function(e){if(e.target===bd)close(o.type==='confirm'?false:null);});
    if(cancelBtn)cancelBtn.addEventListener('click',function(){close(o.type==='confirm'?false:null);});
    ok.addEventListener('click',function(){if(o.type==='prompt')close(inp.value);else if(o.type==='confirm')close(true);else close(undefined);});
    document.addEventListener('keydown',onKey,true);document.body.appendChild(bd);
    if(inp){inp.focus();inp.select();}else{ok.focus();}
  });}
  window.__rev01Modal={
    alert:function(msg,title){return _build({type:'alert',message:msg,title:title||''});},
    confirm:function(msg,opts){var o=opts||{};return _build({type:'confirm',message:msg,title:o.title||'',confirmLabel:o.confirmLabel,danger:o.danger});},
    prompt:function(msg,def,title){return _build({type:'prompt',message:msg,defaultValue:def||'',title:title||''});}
  };
})();`)}</script>
      </body>
    </html>
  );
}
