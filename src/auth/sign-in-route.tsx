import { Hono } from 'hono';
import { raw } from 'hono/html';
import { resolveClerkKeys } from './middleware';
import { OcLogo } from '../ui/brand';
import {
  themeCss,
  componentsCss,
  themeFontHeadHtml,
  themeBootScript,
  themeToggleScript,
  readThemeCookie,
} from '../ui';
import type { Theme } from '../ui';

// Open Canvas sign-in / create-account surface — MIGRATION.md §5g + README
// §3 entry 12. Renders the split shell from
// `design-references/auth.html` (dark brand panel on the left, form pane on
// the right) and mounts Clerk's `<SignIn>` / `<SignUp>` widget into the
// right pane via clerk-js, styled with the OC `appearance` map below so the
// widget's primary button, fields, and OAuth blocks render as our `.btn`,
// `.field`, and `.btn-outline` primitives.
//
// This is a *new* sign-in entry point — `requireAuth()` still redirects to
// the hosted Clerk Account Portal for back-compat (review-smoke locks that
// path). Owners who reach `/auth` directly stay inside our chrome.

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
};

const signInRoute = new Hono<{ Bindings: Bindings }>();

// Page-scoped CSS for the split shell. Mirrors
// `design-references/auth.html` <style> verbatim (tokens come from
// theme.css). Class prefixes (`auth-`, `brandside`, `formside`, etc.) match
// the design source so the visual review can diff them directly.
const authPageStyles = `
  html, body { height: 100%; }
  body { background: var(--paper); }

  .auth {
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    min-height: 100vh;
  }

  /* ---- left brand panel ---- */
  .brandside {
    position: relative;
    background: var(--ink);
    color: var(--paper);
    padding: 40px 48px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .brandside .bars { position: absolute; inset: 0; pointer-events: none; }
  .brandside .bars i {
    position: absolute;
    height: 6px;
    background: var(--red);
    border-radius: 99px;
  }
  .brandside .top {
    display: flex;
    align-items: center;
    gap: 11px;
    position: relative;
    z-index: 2;
  }
  .brandside .oc-word { color: var(--paper); }
  .brandside .mid {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    position: relative;
    z-index: 2;
    max-width: 420px;
  }
  .brandside h1 {
    color: var(--paper);
    font-family: var(--display);
    font-size: clamp(30px, 4vw, 46px);
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .brandside .mk { color: var(--paper); position: relative; }
  .brandside .mk::after {
    content: "";
    position: absolute;
    left: -4px;
    right: -4px;
    bottom: -0.02em;
    height: 0.13em;
    background: var(--red);
    border-radius: 99px;
  }
  .brandside p {
    color: color-mix(in srgb, var(--paper) 72%, transparent);
    font-size: 17px;
    margin-top: 20px;
    line-height: 1.55;
  }
  .mini-canvas {
    margin-top: 34px;
    background: var(--surface);
    border-radius: 14px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    width: 320px;
  }
  .mini-canvas .ph {
    height: 70px;
    background: linear-gradient(135deg, #E9837A, #E84D4A 60%, #C5332F);
  }
  .mini-canvas .bd { padding: 14px 16px 18px; }
  .mini-canvas .h {
    font-family: var(--display);
    font-weight: 700;
    font-size: 17px;
    color: var(--ink);
  }
  .mini-canvas .l {
    height: 7px;
    border-radius: 4px;
    background: var(--surface-3);
    margin-top: 8px;
  }
  .mini-canvas .cta {
    display: inline-block;
    margin-top: 12px;
    padding: 7px 14px;
    border-radius: 99px;
    background: var(--red);
    color: #fff;
    font-size: 11px;
    font-weight: 650;
  }
  .brandside .quote {
    position: relative;
    z-index: 2;
    font-size: 13.5px;
    color: color-mix(in srgb, var(--paper) 60%, transparent);
  }

  /* ---- right form pane ---- */
  .formside {
    display: flex;
    flex-direction: column;
    padding: 24px 28px;
    background: var(--paper);
  }
  .formside .tn {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    align-items: center;
  }
  .formwrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .formcard { width: 100%; max-width: 384px; }
  .formcard h2 {
    font-family: var(--display);
    font-size: 28px;
    letter-spacing: -0.02em;
    color: var(--ink);
  }
  .formcard .lead {
    color: var(--ink-2);
    margin: 8px 0 24px;
    font-size: 15px;
  }

  /* ---- segmented Sign in / Create account toggle ---- */
  .seg {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    margin-bottom: 24px;
  }
  .seg button {
    flex: 1;
    font-family: var(--sans);
    font-size: 14px;
    font-weight: 650;
    padding: 9px 0;
    border: none;
    background: transparent;
    color: var(--ink-2);
    border-radius: var(--r-pill);
    cursor: pointer;
    transition: background 0.14s, color 0.14s;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }

  /* ---- Clerk widget host — wraps the mounted SignIn/SignUp DOM ---- */
  .oc-clerk-host {
    width: 100%;
    min-height: 320px;
    display: flex;
    flex-direction: column;
  }

  /* ---- Clerk appearance hooks (named in clerkAppearance below) ---- */
  .oc-clerk-root { width: 100%; }
  .oc-clerk-card {
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0;
  }
  .oc-clerk-header,
  .oc-clerk-header-title,
  .oc-clerk-header-subtitle {
    /* Title + lead are rendered by us above the Clerk widget — hide the
       widget's own header so we don't double-stack. */
    display: none;
  }
  .oc-clerk-social-buttons {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .oc-clerk-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
    color: var(--ink-3);
    font-size: 12.5px;
    text-transform: none;
  }
  .oc-clerk-divider-line {
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .oc-clerk-divider-text {
    color: var(--ink-3);
    font-size: 12.5px;
    font-family: var(--sans);
  }
  .oc-clerk-field { margin-bottom: 14px; }
  .oc-clerk-field-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .oc-clerk-link {
    color: var(--red-ink);
    font-weight: 600;
    font-size: 12.5px;
  }
  .oc-clerk-link:hover { text-decoration: underline; }
  .oc-clerk-footer {
    text-align: center;
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 16px;
    line-height: 1.5;
  }
  .oc-clerk-footer a {
    color: var(--ink-2);
    border-bottom: 1px solid var(--line-2);
  }
  /* Clerk's social button block — let our .btn class drive the visual, but
     override widths so social buttons stretch full width. */
  .oc-clerk-social-button { width: 100%; justify-content: center; }
  /* Form button block already gets .btn .btn-primary via appearance; make
     it full width like the design. */
  .oc-clerk-submit { width: 100%; margin-top: 6px; }

  /* While Clerk loads, show a low-key placeholder so the pane isn't empty. */
  .oc-clerk-pending {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 280px;
    color: var(--ink-3);
    font-size: 13.5px;
  }

  @media (max-width: 880px) {
    .auth { grid-template-columns: 1fr; }
    .brandside { display: none; }
  }
`;

// Clerk `appearance` map: keys are Clerk element identifiers, values are
// the Open Canvas component classes that should style them. Inline `style`
// is kept empty — every visual tweak lives in components.css /
// authPageStyles so review-time diffs read in one place.
//
// Doc reference: clerk-js Appearance.elements record. Each key listed below
// is documented as a stable Clerk element identifier; unknown keys are
// ignored silently by clerk-js, so adding new ones in the future is safe.
const clerkAppearanceJson = JSON.stringify({
  variables: {
    colorPrimary: '#E84D4A',
    colorDanger: '#E84D4A',
    colorText: '#1A1917',
    colorTextSecondary: '#5B564E',
    colorBackground: '#FBFAF8',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#1A1917',
    fontFamily:
      '"Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontFamilyButtons:
      '"Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    borderRadius: '12px',
  },
  elements: {
    rootBox: 'oc-clerk-root',
    card: 'oc-clerk-card',
    header: 'oc-clerk-header',
    headerTitle: 'oc-clerk-header-title',
    headerSubtitle: 'oc-clerk-header-subtitle',
    socialButtons: 'oc-clerk-social-buttons',
    socialButtonsBlockButton: 'btn btn-outline oc-clerk-social-button',
    socialButtonsBlockButtonText: 'oc-clerk-social-button-text',
    dividerRow: 'oc-clerk-divider',
    dividerLine: 'oc-clerk-divider-line',
    dividerText: 'oc-clerk-divider-text',
    formField: 'oc-clerk-field',
    formFieldRow: 'oc-clerk-field-row',
    formFieldLabel: 'lbl',
    formFieldInput: 'field',
    formButtonPrimary: 'btn btn-primary btn-lg oc-clerk-submit',
    footer: 'oc-clerk-footer',
    footerAction: 'oc-clerk-footer-action',
    footerActionLink: 'oc-clerk-link',
    formFieldAction: 'oc-clerk-link',
    identityPreviewEditButton: 'oc-clerk-link',
  },
});

function Page({ publishableKey, theme }: { publishableKey: string; theme?: Theme | undefined }) {
  // Bootstraps clerk-js from the Clerk CDN derived from the publishable
  // key (same pattern used in `src/routes/dashboard/index.tsx` and
  // `src/editor/route.tsx`). Once loaded, mounts SignIn into the right
  // pane. Tab toggle flips between mountSignIn and mountSignUp, calling
  // unmount before re-mount so the widget DOM is rebuilt cleanly.
  const clerkBootstrapScript = raw(
    `<script>(function(){
  var pk=${JSON.stringify(publishableKey)};
  var appearance=${clerkAppearanceJson};
  var raw=atob(pk.replace(/^pk_(test|live)_/,""));
  if(raw.endsWith("$"))raw=raw.slice(0,-1);
  var s=document.createElement("script");
  s.src="https://"+raw+"/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";
  s.crossOrigin="anonymous";
  s.async=true;
  s.setAttribute("data-clerk-publishable-key",pk);
  s.onload=function(){
    if(!window.Clerk)return;
    window.Clerk.load().then(function(){
      var host=document.getElementById("oc-clerk-host");
      if(!host)return;
      var pending=document.getElementById("oc-clerk-pending");
      if(pending)pending.remove();
      var mode="signin";
      var redirectUrl=new URLSearchParams(window.location.search).get("redirect_url")||"/dashboard";
      function mount(){
        host.innerHTML="";
        var opts={appearance:appearance,redirectUrl:redirectUrl,afterSignInUrl:redirectUrl,afterSignUpUrl:redirectUrl};
        if(mode==="signup"){window.Clerk.mountSignUp(host,opts);}
        else{window.Clerk.mountSignIn(host,opts);}
      }
      mount();
      var tabSi=document.getElementById("tab-signin");
      var tabSu=document.getElementById("tab-signup");
      var title=document.getElementById("auth-title");
      var lead=document.getElementById("auth-lead");
      function setMode(next){
        if(next===mode)return;
        mode=next;
        tabSi.classList.toggle("on",mode==="signin");
        tabSu.classList.toggle("on",mode==="signup");
        title.textContent=mode==="signup"?"Create your account":"Welcome back";
        lead.textContent=mode==="signup"?"It's free to start — no credit card needed.":"Sign in to pick up where you left off.";
        mount();
      }
      tabSi.addEventListener("click",function(){setMode("signin");});
      tabSu.addEventListener("click",function(){setMode("signup");});
    });
  };
  document.head.appendChild(s);
})();</script>`,
  );

  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#FBFAF8" />
        <meta name="color-scheme" content="light dark" />
        <title>Open Canvas — Sign in</title>
        <script>{raw(themeBootScript)}</script>
        {raw(themeFontHeadHtml)}
        <style>{raw(themeCss + '\n' + componentsCss + '\n' + authPageStyles)}</style>
      </head>
      <body>
        <div class="auth">
          {/* ---- brand side (forced dark regardless of global theme) ---- */}
          <div class="brandside" data-theme="dark">
            <div class="bars">
              <i style="width:150px; top:90px; right:-40px;" />
              <i style="width:120px; bottom:120px; left:-30px;" />
            </div>
            <div class="top">
              <span class="oc-logo" style="color:var(--paper)">
                <OcLogo size={28} />
                <span class="oc-word">Open&nbsp;Canvas</span>
              </span>
            </div>
            <div class="mid">
              <h1>
                Make something you're <span class="mk">proud of</span>.
              </h1>
              <p>
                Build your website by dragging things where you want them — with a friendly
                assistant ready to help.
              </p>
              <div class="mini-canvas" aria-hidden="true">
                <div class="ph" />
                <div class="bd">
                  <div class="h">Bloom &amp; Co.</div>
                  <div class="l" style="width:90%" />
                  <div class="l" style="width:70%" />
                  <span class="cta">Order flowers</span>
                </div>
              </div>
            </div>
            <div class="quote">
              &ldquo;I had my shop online by lunchtime.&rdquo; — Real small-business owner,
              probably
            </div>
          </div>

          {/* ---- form side ---- */}
          <div class="formside">
            <div class="tn">
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
            </div>
            <div class="formwrap">
              <div class="formcard">
                <h2 id="auth-title">Welcome back</h2>
                <p class="lead" id="auth-lead">
                  Sign in to pick up where you left off.
                </p>

                <div class="seg" role="tablist" aria-label="Sign in or create an account">
                  <button class="on" id="tab-signin" type="button" role="tab" aria-selected="true">
                    Sign in
                  </button>
                  <button
                    id="tab-signup"
                    type="button"
                    role="tab"
                    aria-selected="false"
                  >
                    Create account
                  </button>
                </div>

                <div class="oc-clerk-host" id="oc-clerk-host">
                  <div class="oc-clerk-pending" id="oc-clerk-pending">
                    Loading sign-in&hellip;
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <script>{raw(themeToggleScript)}</script>
        {clerkBootstrapScript}
      </body>
    </html>
  );
}

signInRoute.get('/', (c) => {
  const { publishableKey } = resolveClerkKeys(c.env);
  return c.html(<Page publishableKey={publishableKey} theme={readThemeCookie(c)} />);
});

export default signInRoute;
