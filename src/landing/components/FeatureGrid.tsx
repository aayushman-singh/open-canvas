// Three feature cards (drag&drop, assistant, publish) matching the
// `.features` block in design-references/landing.html. Visuals live in
// the `.viz` div per card; copy is benefit-first plain language.
export function FeatureGrid() {
  return (
    <section class="features scroll-reveal" id="features" aria-label="Why people love it">
      <div class="wrap">
        <div class="feat-head">
          <span class="eyebrow">Why people love it</span>
          <h2>Everything you need, nothing you don&apos;t.</h2>
        </div>
        <div class="feat-grid">
          <article class="feat">
            <div class="viz v-drag" id="vizDrag" aria-hidden="true">
              <div
                class="blk"
                style="left:24px; top:30px; width:120px; height:24px; background:var(--surface); border:1px solid var(--line);"
              ></div>
              <div
                class="blk"
                style="left:24px; top:66px; width:180px; height:14px; background:var(--surface-3);"
              ></div>
              <div
                class="blk"
                style="left:24px; top:88px; width:140px; height:14px; background:var(--surface-3);"
              ></div>
              <div
                class="blk"
                id="dragBlk"
                style="left:150px; top:108px; width:108px; height:40px; background:var(--red); box-shadow:var(--shadow-red);"
              ></div>
            </div>
            <div class="ft">
              <h3>Drag &amp; drop anything</h3>
              <p>
                Move text, photos, and buttons exactly where you want. If you can use a
                slideshow, you can build a beautiful site.
              </p>
            </div>
          </article>

          <article class="feat">
            <div class="viz v-ai" aria-hidden="true">
              <div class="b" style="left:20px; top:28px;">
                &ldquo;Add a contact form&rdquo;
              </div>
              <div
                class="b"
                style="right:18px; top:74px; background:var(--red); color:#fff; border-color:transparent;"
              >
                ✦ Building it…
              </div>
              <div class="b" style="left:30px; top:118px;">
                &ldquo;Make it cheerful&rdquo;
              </div>
            </div>
            <div class="ft">
              <h3>An assistant that designs with you</h3>
              <p>
                Ask in plain English. It writes copy, swaps layouts, and restyles your whole
                site — you approve every change.
              </p>
            </div>
          </article>

          <article class="feat">
            <div class="viz v-pub" id="vizPub" aria-hidden="true">
              <div
                class="ring"
                style="width:60px;height:60px;left:calc(50% - 30px);top:54px;"
              ></div>
              <div
                class="ring"
                style="width:110px;height:110px;left:calc(50% - 55px);top:29px;opacity:.28;"
              ></div>
              <div
                class="ring"
                style="width:160px;height:160px;left:calc(50% - 80px);top:4px;opacity:.14;"
              ></div>
              <div style="position:absolute;left:50%;top:74px;transform:translateX(-50%);width:24px;height:24px;border-radius:50%;background:var(--ok);display:flex;align-items:center;justify-content:center;color:#fff;">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div
                style="position:absolute;left:50%;bottom:20px;transform:translateX(-50%);"
                class="chip chip-url"
              >
                live.opencanvas.site
              </div>
            </div>
            <div class="ft">
              <h3>Publish to a real address</h3>
              <p>
                One click puts your site online at your own address. Everyone watching sees
                the update instantly — no waiting, no exporting.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
