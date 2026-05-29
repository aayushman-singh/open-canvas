import { Button } from '../../ui';

// Centred Open Canvas hero (eyebrow + Bricolage headline with `.marker` +
// sub + dual CTA + note). Copy is benefit-first and plain — per
// MIGRATION.md §5a and design-references/landing.html.
export function Hero() {
  return (
    <section class="hero" aria-label="Build your website, together">
      <div class="wrap">
        <span class="eyebrow" style="white-space:normal">
          The site builder for the rest of us
        </span>
        <h1>
          Build your website,
          <br />
          <span class="marker">together</span>.
        </h1>
        <p class="sub">
          Drag things where you want them. Ask the built-in assistant for a hand. Hit publish
          and it&apos;s live — no code, no plugins, no headaches.
        </p>
        <div class="hero-cta">
          <Button variant="primary" size="lg" href="/dashboard">
            Start building — it&apos;s free
          </Button>
          <Button variant="secondary" size="lg" href="#demo">
            See how it works
          </Button>
        </div>
        <p class="hero-note">No credit card · Your first site publishes in minutes</p>
      </div>
    </section>
  );
}
