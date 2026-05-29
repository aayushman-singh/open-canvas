// Social-proof row — small businesses / studios / side-projects.
// Matches the `.proof` section in design-references/landing.html.
//
// File name `Tagline` is preserved so index.tsx imports don't churn,
// but the rendered surface is now the social-proof strip rather than
// the old rev01 product tagline.
export function Tagline() {
  return (
    <section class="proof scroll-reveal" aria-label="Trusted by">
      <div class="wrap">
        <p>Trusted by small shops, studios, and side-projects everywhere</p>
        <div class="logos" aria-hidden="true">
          <b>Bloom&nbsp;&amp;&nbsp;Co</b>
          <b>Northside&nbsp;Yoga</b>
          <b>Pixel&nbsp;Pretzel</b>
          <b>Harbor&nbsp;Coffee</b>
          <b>Maple&nbsp;Dental</b>
          <b>The&nbsp;Book&nbsp;Nook</b>
        </div>
      </div>
    </section>
  );
}
