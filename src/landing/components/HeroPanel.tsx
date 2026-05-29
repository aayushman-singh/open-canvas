// Live multiplayer-editing demo, matching design-references/demo.js.
//
// Vignette loop (driven by `demo-script.ts`):
//   reset → Sam selects the button → assistant recolors it → You drop
//   a delivery badge → Publish toast → reset.
//
// The DOM IDs (`canvas`, `artboard`, `abBtn`, `selRing`, `newBadge`,
// `curSam`, `curYou`, `toast`, `asType`, `m1`/`m2`/`opCard`/`m3`) are
// the contract demo-script.ts queries. Names match landing.html so the
// reference demo.js will swap in cleanly if a tighter port is wanted.
//
// The component file name `HeroPanel` is kept (existing import sites
// depend on it). The export is now a single `Demo` block — the old
// per-pane variants (editor/preview/agent) are dead and gone.
export function HeroPanel() {
  return (
    <section class="demo-wrap" id="demo" aria-label="Live multiplayer demo">
      <div class="wrap">
        <div class="demo-window" id="demoWindow">
          <div class="demo-chrome" aria-hidden="true">
            <div class="traffic">
              <i style="background:#E8534E"></i>
              <i style="background:#E9B44C"></i>
              <i style="background:#5BB98C"></i>
            </div>
            <div class="demo-url">
              <span class="lock" aria-hidden="true">🔒</span> bloomandco.opencanvas.site
            </div>
            <div class="presence" aria-label="Currently editing">
              <span class="av" style="background:#E84D4A" title="You">Y</span>
              <span class="av" style="background:#3BA1A1" title="Sam">S</span>
              <span class="av" style="background:#7C6FE0" title="Mia">M</span>
            </div>
          </div>
          <div class="demo-body" id="demoBody">
            {/* left sidebar — mirrors the real editor's #canvas-sidebar:
                tab strip on top, then the Add panel content. The tabs are
                static here (demo); the real editor activates them via
                attachSidebarTabs in canvas-client.ts. */}
            <div class="sidebar" aria-hidden="true">
              <div class="sb-tabs" role="tablist" aria-label="Canvas tools">
                <button type="button" class="sb-tab active" data-sb-tab="add">
                  Add
                </button>
                <button type="button" class="sb-tab" data-sb-tab="sections">
                  Sections
                </button>
                <button type="button" class="sb-tab" data-sb-tab="pages">
                  Pages
                </button>
                <button type="button" class="sb-tab" data-sb-tab="versions">
                  Versions
                </button>
              </div>
              <div class="sb-panel">
                <div class="sb-tools">
                  <div class="tool active" title="Move">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M5 3l4 16 2.5-6.5L18 10z" />
                    </svg>
                    <span class="tool-label">Move</span>
                  </div>
                  <div class="tool" title="Text">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    >
                      <path d="M4 6h16M9 6v13M15 6v13" />
                    </svg>
                    <span class="tool-label">Text</span>
                  </div>
                  <div class="tool" title="Image">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="3" y="4" width="18" height="16" rx="2" />
                      <circle cx="9" cy="10" r="2" />
                      <path d="M21 16l-5-5L5 20" stroke-linecap="round" />
                    </svg>
                    <span class="tool-label">Image</span>
                  </div>
                  <div class="tool" title="Button">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="3" y="8" width="18" height="8" rx="4" />
                    </svg>
                    <span class="tool-label">Button</span>
                  </div>
                  <div class="tool" title="Shapes">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <circle cx="8" cy="8" r="4" />
                      <rect x="12" y="12" width="8" height="8" rx="1.5" />
                    </svg>
                    <span class="tool-label">Shape</span>
                  </div>
                </div>
              </div>
            </div>

            {/* canvas (artboard + cursors) */}
            <div class="canvas" id="canvas" aria-hidden="true">
              <div class="artboard" id="artboard">
                <div class="ab-photo">
                  <span class="ph-tag">photo · storefront.jpg</span>
                </div>
                <div class="ab-pad">
                  <span class="ab-eyebrow">Fresh, local, daily</span>
                  <h2 class="ab-h" id="abHeading">Bloom &amp; Co.</h2>
                  <p class="ab-p">
                    Hand-tied bouquets and seasonal stems, delivered across town the same day.
                  </p>
                  <span class="ab-btn" id="abBtn">Order flowers</span>
                </div>
              </div>
              <div class="sel-ring" id="selRing">
                <span class="tag">Sam</span>
              </div>
              <div class="new-badge" id="newBadge">★ Same-day delivery</div>

              {/* peer cursors */}
              <div class="cursor" id="curSam" style="transform:translate(60px,300px)">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#3BA1A1">
                  <path d="M5 2l14 8-6 1.5L10 19z" />
                </svg>
                <span class="label" style="background:#3BA1A1">Sam</span>
              </div>
              <div class="cursor" id="curYou" style="transform:translate(360px,80px)">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="#E84D4A">
                  <path d="M5 2l14 8-6 1.5L10 19z" />
                </svg>
                <span class="label" style="background:#E84D4A">You</span>
              </div>
            </div>

            {/* assistant */}
            <div class="assistant">
              <div class="as-head">
                <span class="spark" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l1.8 5.5L19 9l-4.4 3.2L16 18l-4-3.4L8 18l1.4-5.8L5 9l5.2-1.5z" />
                  </svg>
                </span>
                <span class="t">
                  Assistant
                  <small>here to help</small>
                </span>
              </div>
              <div class="as-feed" id="asFeed">
                <div class="msg user" id="m1">
                  Make the button match our brand red
                </div>
                <div class="msg bot" id="m2">
                  On it — here&apos;s a preview of that change:
                </div>
                <div class="op-card" id="opCard">
                  <div class="ol">Update button</div>
                  <div class="od">Fill → Brand Red · white text</div>
                  <div class="oa">
                    <button type="button" class="acc">✓ Accept</button>
                    <button type="button" class="dis">Discard</button>
                  </div>
                </div>
                <div class="msg bot" id="m3">
                  Done! Want me to add a delivery badge too?
                </div>
              </div>
              <div class="as-input">
                <div class="box">
                  <span id="asType">
                    <span class="typed"></span>
                  </span>
                  <span class="caret" aria-hidden="true"></span>
                </div>
              </div>
            </div>

            <div class="toast" id="toast" role="status" aria-live="polite">
              <span class="tick" aria-hidden="true">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
              Published — your visitors see it now
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
