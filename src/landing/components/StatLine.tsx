// Templates row — four thumbnails matching the `.templates` block in
// design-references/landing.html. File name `StatLine` is kept so
// index.tsx imports don't churn, but the rendered surface is the
// template picker rather than the old terminal stat line.
export function StatLine() {
  return (
    <section class="templates scroll-reveal" id="templates" aria-label="Start from a template">
      <div class="wrap">
        <div class="feat-head" style="margin-bottom:0;">
          <span class="eyebrow">Start from a template</span>
          <h2>Pick a starting point, make it yours.</h2>
        </div>
        <div class="tpl-grid">
          <a class="tpl" href="/dashboard">
            <div class="shot" style="background:linear-gradient(150deg,#F4F1EC,#ECE8E1)"></div>
            <div class="cap">
              <b>Local Business</b>
              <span>Café</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot" style="background:linear-gradient(150deg,#FBEDEC,#F6D9D6)"></div>
            <div class="cap">
              <b>Launch Page</b>
              <span>Product</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot" style="background:linear-gradient(150deg,#1A1917,#3A352F)"></div>
            <div class="cap">
              <b>Studio Portfolio</b>
              <span>Creative</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot" style="background:linear-gradient(150deg,#E9EEEA,#D8E5DC)"></div>
            <div class="cap">
              <b>Booking Site</b>
              <span>Services</span>
            </div>
          </a>
        </div>
      </div>
    </section>
  );
}
