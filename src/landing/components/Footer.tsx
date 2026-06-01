import { Button, OcLogo } from '../../ui';

// Dark CTA card with red edge-bars + column-link footer, matching
// `.cta` and `footer.site` in design-references/landing.html.
//
// Returns a fragment containing both the closing CTA section and the
// site footer — they sit together in the page structure.
export function Footer() {
  return (
    <>
      <section class="cta scroll-reveal" aria-label="Ready when you are">
        <div class="wrap">
          <div class="cta-card">
            <div class="cta-bars" aria-hidden="true">
              <i style="width:140px; top:40px; right:-30px;"></i>
              <i style="width:120px; bottom:50px; left:-24px;"></i>
            </div>
            <span
              class="eyebrow"
              style="color:var(--red); background-image:linear-gradient(var(--red),var(--red));"
            >
              Ready when you are
            </span>
            <h2>
              Your site is waiting
              <br />
              to be built.
            </h2>
            <p>
              Join thousands of small businesses making something they&apos;re proud of —
              without hiring a developer.
            </p>
            <div class="hero-cta">
              <span class="auth-state-wrap auth-signed-out">
                <Button variant="primary" size="lg" href="/auth">
                  Start building — it&apos;s free
                </Button>
              </span>
              <span class="auth-state-wrap auth-signed-in">
                <Button variant="primary" size="lg" href="/dashboard">
                  Open your dashboard
                </Button>
              </span>
            </div>
          </div>
        </div>
      </section>

      <footer class="site" aria-label="Site footer">
        <div class="wrap">
          <div class="fcol" style="max-width:260px;">
            <a
              href="/"
              class="oc-logo"
              style="color:var(--ink); margin-bottom:4px;"
              aria-label="Open Canvas — home"
            >
              <OcLogo size={24} />
              <span class="oc-word" style="font-size:14px;">
                Open&nbsp;Canvas
              </span>
            </a>
            <span class="muted" style="font-size:13.5px;">
              The friendly site builder with an assistant at your cursor.
            </span>
          </div>
          <div class="fcol">
            <b>Product</b>
            <a href="#features">Features</a>
            <a href="#templates">Templates</a>
            <a href="/dashboard">Dashboard</a>
          </div>
          <div class="fcol">
            <b>Project</b>
            <a href="https://github.com/aayushman-singh/open-canvas" rel="noopener">
              GitHub
            </a>
            <a href="https://github.com/aayushman-singh/open-canvas/tree/main/docs" rel="noopener">
              Docs
            </a>
            <span>License: MIT</span>
          </div>
          <div class="fcol">
            <b>Support</b>
            <a href="https://github.com/aayushman-singh/open-canvas/issues" rel="noopener">
              Issues
            </a>
            <a href="https://github.com/aayushman-singh/open-canvas/discussions" rel="noopener">
              Discussions
            </a>
          </div>
          <div class="legal">
            <span>© 2026 Open Canvas. Made for the people building the web.</span>
            <span>Privacy · Terms</span>
          </div>
        </div>
      </footer>
    </>
  );
}
