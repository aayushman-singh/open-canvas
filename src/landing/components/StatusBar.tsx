import { Button, OcLogo } from '../../ui';

// Sticky translucent top navigation, per design-references/landing.html.
// Class name `StatusBar` is kept (existing import sites depend on it) but
// the rendered surface is the Open Canvas `.nav` header — logo + section
// links + theme toggle + sign-in + primary CTA.
//
// The `#themeToggle` button is wired by `themeToggleScript` (injected at
// the bottom of the landing page) and `themeBootScript` (injected in
// <head>) — both live in src/ui/theme.ts. See MIGRATION.md §6.
export function StatusBar() {
  return (
    <header class="nav" role="banner" aria-label="Open Canvas navigation">
      <div class="wrap">
        <a href="/" class="oc-logo" style="color:var(--ink)" aria-label="Open Canvas — home">
          <OcLogo size={28} />
          <span class="oc-word">Open&nbsp;Canvas</span>
        </a>
        <nav class="nav-links" aria-label="primary">
          <a href="#features">Features</a>
          <a href="#templates">Templates</a>
          <a href="/dashboard">Dashboard</a>
          <a
            href="https://github.com/aayushman-singh/opencanvas"
            rel="noopener"
          >
            GitHub
          </a>
        </nav>
        <div class="right">
          <button class="theme-toggle" id="themeToggle" aria-label="Toggle light/dark theme">
            <svg
              class="sun"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
            </svg>
            <svg
              class="moon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" />
            </svg>
          </button>
          <span class="auth-state-wrap auth-signed-out">
            <Button variant="ghost" size="sm" href="/auth">
              Sign in
            </Button>
            <Button variant="primary" size="sm" href="/auth?mode=signup">
              Sign up free
            </Button>
          </span>
          <span class="auth-state-wrap auth-signed-in">
            <Button variant="primary" size="sm" href="/dashboard">
              Open dashboard
            </Button>
          </span>
        </div>
      </div>
    </header>
  );
}
