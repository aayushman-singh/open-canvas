// Landing-page chrome CSS, sandwiched between Open Canvas tokens
// (`themeCss`) and shared component primitives (`componentsCss`).
//
// MIGRATION.md §5a:
//   • all dark-on-dark `oklch(...)` literals have been deleted —
//     every surface, border, and text colour resolves through the
//     Open Canvas token layer (`var(--paper)/var(--surface)/var(--ink)/
//     var(--line)/var(--red)/...`). Grep for `oklch(` in this file —
//     it should return zero hits.
//   • the layout matches design-references/landing.html: sticky
//     translucent nav, centred hero with `.marker` headline, live
//     multiplayer demo in a rounded browser frame, social-proof row,
//     three feature cards, four template thumbnails, dark CTA card,
//     footer with column links.
//
// The visitor-facing canvas (`src/canvas/*`) is untouched — this file
// styles ONLY the landing chrome.
export const styles = `
/* ============ document base ============ */

html, body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.6;
  font-weight: 420;
}

a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--red); outline-offset: 3px; border-radius: 4px; }

/* ============ sticky nav ============ */

.nav {
  position: sticky;
  top: 0;
  z-index: 60;
  background: color-mix(in srgb, var(--paper) 86%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}

.nav .wrap {
  display: flex;
  align-items: center;
  gap: 20px;
  height: 66px;
}

.nav-links {
  display: flex;
  gap: 4px;
  margin-left: 14px;
}

.nav-links a {
  padding: 8px 14px;
  border-radius: var(--r-pill);
  font-size: 14.5px;
  font-weight: 600;
  color: var(--ink-2);
  transition: background .14s ease, color .14s ease;
}

.nav-links a:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.nav .right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ============ hero ============ */

.hero {
  padding: 64px 0 30px;
  text-align: center;
}

.hero .wrap { max-width: 880px; }

.hero h1 {
  font-family: var(--display);
  font-size: clamp(40px, 6.4vw, 76px);
  letter-spacing: -0.035em;
  line-height: 1.02;
  margin: 22px 0 0;
}

.hero .sub {
  font-size: clamp(18px, 2.2vw, 21px);
  color: var(--ink-2);
  max-width: 56ch;
  margin: 24px auto 0;
  line-height: 1.55;
}

.hero-cta {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 30px;
  flex-wrap: wrap;
}

.hero-note {
  margin-top: 16px;
  font-size: 13.5px;
  color: var(--ink-3);
}

/* ============ live demo window ============ */

.demo-wrap {
  padding: 24px 0 40px;
}

.demo-wrap .wrap { max-width: 1120px; }

.demo-window {
  position: relative;
  border-radius: var(--r-lg);
  background: var(--surface);
  border: 1px solid var(--line-2);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.demo-chrome {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
}

.traffic { display: flex; gap: 7px; }
.traffic i {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  display: block;
}

.demo-url {
  margin: 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink-2);
}

.demo-url .lock { color: var(--ink-3); }

.presence {
  display: flex;
  align-items: center;
}

.presence .av {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--surface);
  margin-left: -8px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.demo-body {
  display: grid;
  grid-template-columns: 180px 1fr 268px;
  height: 460px;
  position: relative;
}

/* left sidebar — visual analogue of the real editor's #canvas-sidebar.
   Tabs row at top mirrors .rev01-sidebar-tabs (Add / Sections / Pages /
   Versions); the tool buttons below mirror the Add panel grid. Kept
   narrower than the real 360px sidebar because the demo width is
   constrained, but the structural layout is the same so the demo reads
   like the actual editor. */
.sidebar {
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  overflow: hidden;
}

.sidebar .sb-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 10px 0;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.sidebar .sb-tab {
  appearance: none;
  flex: 1;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 11.5px;
  line-height: 1;
  padding: 9px 0;
  position: relative;
  transition: color .14s;
}

.sidebar .sb-tab:hover { color: var(--ink-2); }

.sidebar .sb-tab.active {
  color: var(--ink);
}

.sidebar .sb-tab.active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 3px;
  background: var(--red);
  border-radius: 999px;
}

.sidebar .sb-panel {
  padding: 14px 12px 18px;
  overflow-y: auto;
}

.sidebar .sb-tools {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.sidebar .tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 56px;
  border-radius: var(--r-xs);
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--ink-2);
  cursor: pointer;
  transition: background .14s ease, color .14s ease, border-color .14s ease;
}

.sidebar .tool:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.sidebar .tool.active {
  background: var(--red-soft);
  color: var(--red-ink);
  border-color: var(--red-line);
}

.sidebar .tool-label {
  font-family: var(--sans);
  font-size: 10.5px;
  font-weight: 650;
}

/* canvas */
.canvas {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, var(--line-2) 1px, transparent 0) 0 0 / 22px 22px,
    var(--surface-2);
}

.artboard {
  position: absolute;
  left: 50%;
  top: 28px;
  transform: translateX(-50%);
  width: min(78%, 460px);
  background: var(--surface);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
  border: 1px solid var(--line);
}

.ab-photo {
  height: 130px;
  background: linear-gradient(135deg, #E9837A, #E84D4A 60%, #C5332F);
  position: relative;
}

.ab-photo .ph-tag {
  position: absolute;
  left: 12px;
  bottom: 10px;
  font-family: var(--mono);
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.85);
}

.ab-pad { padding: 18px 20px 22px; }

.ab-eyebrow {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--red-ink);
}

.ab-h {
  font-family: var(--display);
  font-weight: 700;
  font-size: 26px;
  letter-spacing: -0.02em;
  margin: 8px 0 0;
  color: var(--ink);
  transition: font-size .5s ease, color .5s ease;
}

.ab-p {
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 8px;
  line-height: 1.5;
}

.ab-btn {
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border-radius: var(--r-pill);
  font-weight: 650;
  font-size: 13px;
  background: var(--surface-3);
  color: var(--ink-2);
  transition: background .6s ease, color .6s ease, box-shadow .6s ease;
}

.ab-btn.brandified {
  background: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}

/* selection ring + badge drop */
.sel-ring {
  position: absolute;
  border: 2px solid var(--red);
  border-radius: 8px;
  opacity: 0;
  transition: opacity .25s ease, all .35s ease;
  pointer-events: none;
}

.sel-ring .tag {
  position: absolute;
  top: -22px;
  left: -2px;
  background: var(--red);
  color: #fff;
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

.new-badge {
  position: absolute;
  padding: 5px 11px;
  border-radius: var(--r-pill);
  background: var(--red);
  color: #fff;
  font-size: 11.5px;
  font-weight: 700;
  box-shadow: var(--shadow-red);
  opacity: 0;
  transform: scale(0.8);
  transition: opacity .3s ease, transform .3s ease;
}

/* assistant */
.assistant {
  border-left: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
}

.as-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 9px;
}

.as-head .spark {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: var(--red-soft);
  color: var(--red-ink);
  display: flex;
  align-items: center;
  justify-content: center;
}

.as-head .t {
  font-weight: 700;
  font-size: 14px;
}

.as-head .t small {
  display: block;
  font-weight: 500;
  font-size: 11px;
  color: var(--ink-3);
}

.as-feed {
  flex: 1;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.msg {
  max-width: 90%;
  font-size: 12.5px;
  line-height: 1.45;
  padding: 10px 12px;
  border-radius: 13px;
}

.msg.user {
  align-self: flex-end;
  background: var(--ink);
  color: var(--paper);
  border-bottom-right-radius: 4px;
}

.msg.bot {
  align-self: flex-start;
  background: var(--surface-2);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}

.op-card {
  align-self: flex-start;
  width: 92%;
  border: 1px solid var(--red-line);
  background: var(--red-tint);
  border-radius: 12px;
  padding: 11px 12px;
}

.op-card .ol {
  font-size: 11px;
  color: var(--red-ink);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.op-card .od {
  font-size: 12.5px;
  color: var(--ink);
  margin-top: 4px;
}

.op-card .oa {
  display: flex;
  gap: 7px;
  margin-top: 10px;
}

.op-card .oa button {
  font-family: var(--sans);
  font-size: 11.5px;
  font-weight: 650;
  padding: 6px 12px;
  border-radius: var(--r-pill);
  border: none;
  cursor: pointer;
}

.op-card .oa .acc {
  background: var(--red);
  color: #fff;
}

.op-card .oa .dis {
  background: var(--surface);
  color: var(--ink-2);
  border: 1px solid var(--line-2);
}

.as-input {
  padding: 12px 14px;
  border-top: 1px solid var(--line);
}

.as-input .box {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-pill);
  padding: 9px 14px;
}

.as-input .box span {
  font-size: 12.5px;
  color: var(--ink-3);
  flex: 1;
}

.as-input .box .typed { color: var(--ink); }

.as-input .box .caret {
  width: 2px;
  height: 15px;
  background: var(--red);
  animation: blink 1s steps(1) infinite;
}

/* multiplayer cursors */
.cursor {
  position: absolute;
  z-index: 30;
  pointer-events: none;
  transition: transform 1.1s cubic-bezier(.5, .05, .2, 1);
  will-change: transform;
}

.cursor svg {
  display: block;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
}

.cursor .label {
  position: absolute;
  left: 16px;
  top: 16px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

/* published toast */
.toast {
  position: absolute;
  left: 50%;
  bottom: 20px;
  transform: translate(-50%, 20px);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 18px;
  border-radius: var(--r-pill);
  background: var(--ink);
  color: var(--paper);
  font-weight: 650;
  font-size: 13.5px;
  box-shadow: var(--shadow-lg);
  opacity: 0;
  transition: opacity .35s ease, transform .35s ease;
}

.toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.toast .tick {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--ok);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* ============ social proof ============ */

.proof {
  padding: 18px 0 50px;
  text-align: center;
}

.proof p {
  font-size: 13px;
  color: var(--ink-3);
  letter-spacing: 0.02em;
  margin-bottom: 18px;
}

.proof .logos {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px 40px;
  opacity: 0.75;
}

.proof .logos b {
  font-family: var(--display);
  font-weight: 700;
  font-size: 19px;
  color: var(--ink-2);
  letter-spacing: -0.01em;
}

/* ============ features ============ */

.features {
  padding: 56px 0;
}

.features .wrap { max-width: 1120px; }

.feat-head {
  max-width: 640px;
  margin-bottom: 44px;
}

.feat-head h2 {
  font-family: var(--display);
  font-size: clamp(28px, 4vw, 42px);
  letter-spacing: -0.03em;
  margin-top: 16px;
}

.feat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}

.feat {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
  padding: 0;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.feat .viz {
  height: 168px;
  border-bottom: 1px solid var(--line);
  position: relative;
  overflow: hidden;
  background: var(--surface-2);
}

.feat .ft { padding: 22px; }

.feat h3 {
  font-family: var(--display);
  font-size: 20px;
  letter-spacing: -0.02em;
}

.feat p {
  font-size: 14.5px;
  color: var(--ink-2);
  margin-top: 8px;
  line-height: 1.5;
}

/* viz: drag */
.v-drag .blk {
  position: absolute;
  border-radius: 9px;
}

/* viz: assistant chips */
.v-ai .b {
  position: absolute;
  padding: 7px 12px;
  border-radius: var(--r-pill);
  font-size: 12px;
  font-weight: 600;
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}

/* viz: publish */
.v-pub .ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid var(--red);
  opacity: 0.5;
}

/* ============ templates ============ */

.templates {
  padding: 40px 0 56px;
}

.templates .wrap { max-width: 1120px; }

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 36px;
}

.tpl {
  border: 1px solid var(--line);
  border-radius: var(--r);
  overflow: hidden;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transition: transform .16s ease, box-shadow .2s ease;
}

.tpl:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow);
}

.tpl .shot { height: 138px; }

.tpl .cap {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tpl .cap b {
  font-size: 14px;
  font-weight: 650;
  white-space: nowrap;
}

.tpl .cap span {
  font-size: 11.5px;
  color: var(--ink-3);
}

/* ============ big CTA ============ */

.cta { padding: 30px 0 80px; }

.cta .wrap { max-width: 1120px; }

.cta-card {
  position: relative;
  border-radius: var(--r-xl);
  overflow: hidden;
  padding: 64px 40px;
  text-align: center;
  background: var(--ink);
  color: var(--paper);
}

.cta-card h2 {
  font-family: var(--display);
  color: var(--paper);
  font-size: clamp(30px, 4.6vw, 50px);
  letter-spacing: -0.03em;
}

.cta-card p {
  color: color-mix(in srgb, var(--paper) 72%, transparent);
  font-size: 18px;
  margin: 18px auto 0;
  max-width: 50ch;
}

.cta-card .hero-cta {
  margin-top: 30px;
}

.cta-bars {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.cta-bars i {
  position: absolute;
  height: 5px;
  background: var(--red);
  border-radius: 99px;
}

/* ============ footer ============ */

footer.site {
  border-top: 1px solid var(--line);
  padding: 44px 0;
}

footer.site .wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  align-items: flex-start;
  justify-content: space-between;
}

footer.site .fcol {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

footer.site .fcol b { font-size: 13px; }

footer.site .fcol a {
  font-size: 13.5px;
  color: var(--ink-2);
}

footer.site .fcol a:hover {
  color: var(--ink);
}

footer.site .legal {
  width: 100%;
  border-top: 1px dashed var(--line);
  padding-top: 18px;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12.5px;
  color: var(--ink-3);
}

/* ============ auth-state visibility ============ */

/* Header + hero/footer CTAs render the signed-out variant by default so the
   page stays publicly cacheable. The landing page boots clerk-js, calls
   Clerk.load(), and if a session resolves, stamps data-signed-in on <html>;
   the rules below swap which variant is visible. .auth-state-wrap is set to
   display:contents so the <span> wrapper participates in the parent's flex
   layout without introducing its own box. */
.auth-state-wrap { display: contents; }
.auth-signed-in { display: none; }
html[data-signed-in] .auth-signed-out { display: none; }
html[data-signed-in] .auth-signed-in.auth-state-wrap { display: contents; }

/* ============ scroll reveal ============ */

.scroll-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity .7s cubic-bezier(0.2, 0, 0, 1),
    transform .7s cubic-bezier(0.2, 0, 0, 1);
}

.scroll-reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* ============ reduced motion ============ */

@media (prefers-reduced-motion: reduce) {
  .cursor,
  .ab-btn,
  .ab-h,
  .sel-ring,
  .new-badge,
  .toast,
  .scroll-reveal {
    transition: none !important;
    animation: none !important;
  }
  .scroll-reveal {
    opacity: 1 !important;
    transform: none !important;
  }
  .as-input .box .caret {
    animation: none !important;
  }
}

/* ============ responsive ============ */

@media (max-width: 900px) {
  .feat-grid { grid-template-columns: 1fr; }
  .tpl-grid { grid-template-columns: repeat(2, 1fr); }
  .nav-links { display: none; }
  .demo-body { grid-template-columns: 48px 1fr; }
  .assistant { display: none; }
}

@media (max-width: 720px) {
  .nav .wrap { gap: 10px; }
  .hero-cta { flex-direction: column; align-items: stretch; }
}
`;
