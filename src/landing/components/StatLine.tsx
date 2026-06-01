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
            <div class="shot tpl-cafe" style="background:linear-gradient(150deg,#F4F1EC,#ECE8E1)" aria-hidden="true">
              <div class="tn-photo">
                <span class="tn-photo-tag">storefront</span>
              </div>
              <div class="tn-meta">
                <div class="tn-eyebrow"></div>
                <div class="tn-h"></div>
                <div class="tn-h tn-h-short"></div>
                <div class="tn-btn">Book a visit</div>
              </div>
            </div>
            <div class="cap">
              <b>Local Business</b>
              <span>Café</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot tpl-launch" style="background:linear-gradient(150deg,#FBEDEC,#F6D9D6)" aria-hidden="true">
              <div class="tn-launch-col">
                <div class="tn-eyebrow tn-eyebrow-pink"></div>
                <div class="tn-h tn-h-wide"></div>
                <div class="tn-h tn-h-wide tn-h-short"></div>
                <div class="tn-input">
                  <span class="tn-input-ph"></span>
                  <span class="tn-input-btn">Join</span>
                </div>
                <div class="tn-avatars">
                  <i></i>
                  <i></i>
                  <i></i>
                  <span class="tn-avatars-cap"></span>
                </div>
              </div>
            </div>
            <div class="cap">
              <b>Launch Page</b>
              <span>Product</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot tpl-studio" style="background:linear-gradient(150deg,#1A1917,#3A352F)" aria-hidden="true">
              <div class="tn-mosaic">
                <span class="tn-tile tn-tile-1"></span>
                <span class="tn-tile tn-tile-2"></span>
                <span class="tn-tile tn-tile-3"></span>
                <span class="tn-tile tn-tile-4"></span>
                <span class="tn-tile tn-tile-5"></span>
                <span class="tn-tile tn-tile-6"></span>
              </div>
            </div>
            <div class="cap">
              <b>Studio Portfolio</b>
              <span>Creative</span>
            </div>
          </a>
          <a class="tpl" href="/dashboard">
            <div class="shot tpl-booking" style="background:linear-gradient(150deg,#E9EEEA,#D8E5DC)" aria-hidden="true">
              <div class="tn-week">
                <span></span>
                <span></span>
                <span class="on"></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div class="tn-slots">
                <div class="tn-slot"><span class="tn-slot-time"></span><span class="tn-slot-pill on">Book</span></div>
                <div class="tn-slot"><span class="tn-slot-time"></span><span class="tn-slot-pill">Full</span></div>
                <div class="tn-slot"><span class="tn-slot-time"></span><span class="tn-slot-pill">Book</span></div>
              </div>
            </div>
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
