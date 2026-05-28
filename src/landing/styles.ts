export const styles = `
:root {
  --bg-deep: #0a0e1a;
  --bg-panel: oklch(0.2 0.04 245 / 0.8);
  --bg-panel-strong: oklch(0.22 0.04 245 / 0.95);
  --bg-titlebar: oklch(0.16 0.03 245 / 0.92);
  --fg: oklch(0.96 0.02 240);
  --fg-mute: oklch(0.7 0.04 240);
  --fg-faint: oklch(0.55 0.03 240);
  --accent: oklch(0.78 0.15 200);
  --accent-soft: oklch(0.78 0.15 200 / 0.18);
  --accent-glow: oklch(0.78 0.18 200 / 0.4);
  --warn: oklch(0.85 0.18 70);
  --warn-soft: oklch(0.85 0.18 70 / 0.18);
  --ok: oklch(0.82 0.18 145);
  --grid: oklch(0.4 0.02 240 / 0.08);
  --hairline: oklch(0.6 0.02 240 / 0.15);
  --hairline-strong: oklch(0.6 0.02 240 / 0.28);
  --radius: 8px;
  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;

  /* map to UI primitive tokens */
  --bg: var(--bg-deep);
  --panel: var(--bg-panel);
  --text: var(--fg);
  --muted: var(--fg-mute);
  --faint: var(--fg-faint);
  --line: var(--hairline);
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg-deep);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body {
  min-height: 100vh;
  background:
    radial-gradient(ellipse at 18% -10%, oklch(0.32 0.1 220 / 0.22), transparent 55%),
    radial-gradient(ellipse at 88% 110%, oklch(0.28 0.12 280 / 0.18), transparent 60%),
    linear-gradient(180deg, #0a0e1a 0%, #060912 100%);
  background-attachment: fixed;
  position: relative;
  overflow-x: hidden;
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.55), transparent 75%);
  z-index: 0;
}

a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid oklch(0.78 0.15 200 / 0.35);
  padding-bottom: 1px;
  transition: border-color 160ms ease;
}

a:hover {
  border-bottom-color: var(--accent);
}

a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}

/* ============ navigation bar ============ */

.statusbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 1.1rem;
  padding: 0.7rem 1.25rem;
  height: 48px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--fg-mute);
  background: oklch(0.1 0.03 245 / 0.85);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--hairline);
}

.statusbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.statusbar .brand-name {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: -0.02em;
  color: var(--fg);
}

.statusbar .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow:
    0 0 0 3px oklch(0.82 0.18 145 / 0.18),
    0 0 10px oklch(0.82 0.18 145 / 0.55);
  animation: pulse 1.4s ease-in-out infinite;
}

.statusbar .spacer {
  flex: 1;
}

.statusbar .nav {
  display: inline-flex;
  align-items: center;
  gap: 1.2rem;
}

.statusbar .nav a {
  color: var(--fg-mute);
  border-bottom: none;
  font-size: 13px;
  letter-spacing: 0.02em;
}

.statusbar .nav a:hover {
  color: var(--fg);
}

/* ============ shell ============ */

main {
  position: relative;
  z-index: 1;
  max-width: 1320px;
  margin: 0 auto;
  padding: clamp(1.5rem, 4vh, 3rem) clamp(1rem, 3vw, 2rem) 4rem;
}

section {
  margin-bottom: clamp(2rem, 5vh, 4rem);
}

/* ============ panel (window-chrome frame) ============ */

.panel {
  background: var(--bg-panel);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  box-shadow:
    inset 0 1px 0 oklch(0.95 0.02 220 / 0.06),
    0 30px 70px -22px rgba(0, 0, 0, 0.7),
    0 0 0 1px oklch(0.78 0.15 200 / 0.04);
  overflow: hidden;
}

.panel .titlebar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.75rem;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--fg-faint);
  background: var(--bg-titlebar);
  border-bottom: 1px solid var(--hairline);
}

.panel .titlebar .glyphs {
  display: inline-flex;
  gap: 6px;
}

.panel .titlebar .glyph {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: oklch(0.45 0.04 245);
}

.panel .titlebar .glyph.close {
  background: oklch(0.6 0.18 25);
}
.panel .titlebar .glyph.min {
  background: oklch(0.78 0.14 80);
}
.panel .titlebar .glyph.max {
  background: oklch(0.72 0.15 150);
}

.panel .titlebar .path {
  color: var(--fg-mute);
}

.panel .titlebar .path .accent {
  color: var(--accent);
}

.panel .titlebar .right {
  margin-left: auto;
  color: var(--fg-faint);
}

/* ============ hero — 3 panels ============ */

.hero {
  margin-top: 1rem;
}

.hero-grid {
  display: grid;
  grid-template-columns: 1.05fr 1.15fr 0.95fr;
  min-height: 480px;
}

.hero-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--hairline);
}

.hero-panel:last-child {
  border-right: none;
}

.hero-panel .heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--fg-faint);
  background: oklch(0.13 0.03 245 / 0.75);
  border-bottom: 1px solid var(--hairline);
}

.hero-panel .heading .kind {
  color: var(--accent);
}

.hero-panel .body {
  flex: 1;
  padding: 0.85rem 1rem 1rem;
  font-size: 13px;
  overflow: hidden;
}

/* editor */

.editor-layout {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 0.75rem;
  height: 100%;
}

.editor-tree {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-mute);
  border-right: 1px dashed var(--hairline);
  padding-right: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.editor-tree .row {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.2rem;
  border-radius: 3px;
}

.editor-tree .row.active {
  background: var(--accent-soft);
  color: var(--fg);
}

.editor-tree .row .icon {
  color: var(--fg-faint);
}

.editor-tree .row.active .icon {
  color: var(--accent);
}

.editor-doc {
  font-family: var(--font-sans);
  color: var(--fg);
  font-size: 13.5px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow: hidden;
}

.editor-doc .demo-heading {
  margin: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: -0.01em;
}

.editor-doc p {
  margin: 0;
  color: var(--fg-mute);
}

.editor-doc .agent-line {
  position: relative;
  color: var(--fg);
}

.cursor-token {
  display: inline-block;
  vertical-align: -0.12em;
  margin: 0 1px;
}

.cursor-token .bar {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  background: var(--accent);
  vertical-align: -0.12em;
  animation: blink 1s steps(1) infinite;
}

.cursor-token.agent .bar {
  background: var(--warn);
  animation-delay: 0.5s;
}

.cursor-token .chip {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.02em;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid oklch(0.78 0.15 200 / 0.4);
  border-radius: 3px;
  vertical-align: middle;
  white-space: nowrap;
}

.cursor-token.agent .chip {
  color: var(--warn);
  background: var(--warn-soft);
  border-color: oklch(0.85 0.18 70 / 0.4);
}

/* preview */

.preview-frame {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, oklch(0.97 0.01 80) 0%, oklch(0.93 0.02 80) 100%);
  color: oklch(0.2 0.03 60);
  border-radius: 4px;
  border: 1px solid var(--hairline);
  overflow: hidden;
  font-family: var(--font-sans);
}

.preview-frame .pheader {
  padding: 0.85rem 1rem 0.4rem;
  border-bottom: 1px solid oklch(0.8 0.02 80);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.preview-frame .brand {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.02em;
  color: oklch(0.3 0.06 40);
}

.preview-frame .pnav {
  display: inline-flex;
  gap: 0.6rem;
  font-size: 10.5px;
  font-family: var(--font-mono);
  color: oklch(0.4 0.04 60);
}

.preview-frame .pbody {
  flex: 1;
  padding: 0.9rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.preview-frame .phero {
  font-family: 'IBM Plex Sans', serif;
  font-size: 22px;
  line-height: 1.1;
  font-weight: 600;
  color: oklch(0.2 0.05 40);
  letter-spacing: -0.01em;
}

.preview-frame .pcopy {
  font-size: 12.5px;
  color: oklch(0.35 0.03 60);
  line-height: 1.5;
}

.preview-frame .pcard {
  margin-top: 0.4rem;
  padding: 0.6rem 0.7rem;
  background: oklch(0.99 0.005 80);
  border: 1px solid oklch(0.85 0.03 70);
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 11.5px;
  color: oklch(0.3 0.04 60);
}

.preview-frame .pcard .price {
  margin-left: auto;
  font-family: var(--font-mono);
  font-weight: 600;
  color: oklch(0.4 0.1 40);
}

.preview-frame .swatch {
  width: 22px;
  height: 22px;
  border-radius: 3px;
  background: linear-gradient(135deg, oklch(0.4 0.08 40), oklch(0.55 0.12 50));
  flex-shrink: 0;
}

/* agent log */

.agent-feed {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg);
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  height: 100%;
  overflow: hidden;
}

.agent-feed .row {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}

.agent-feed .ts {
  color: var(--accent);
  flex-shrink: 0;
}

.agent-feed .op {
  color: var(--fg-mute);
  word-break: break-word;
}

.agent-feed .op .add {
  color: var(--ok);
}

.agent-feed .op .edit {
  color: var(--warn);
}

.agent-feed .op .ref {
  color: var(--fg);
}

.agent-feed .row.now .ts {
  color: var(--fg);
  background: var(--accent-soft);
  padding: 1px 5px;
  border-radius: 3px;
}

/* hero footer status strip */

.hero-foot {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--fg-faint);
  background: oklch(0.13 0.03 245 / 0.75);
  border-top: 1px solid var(--hairline);
}

.hero-foot .ok {
  color: var(--ok);
}

.hero-foot .sep {
  color: var(--fg-faint);
}

.hero-foot .right {
  margin-left: auto;
  color: var(--fg-mute);
}

/* ============ tagline ============ */

.tagline {
  margin-top: clamp(2rem, 5vh, 3.5rem);
  padding: 0 0.25rem;
}

.tagline .eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent);
}

.tagline h1 {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: clamp(2rem, 4.5vw, 3.4rem);
  line-height: 1.05;
  letter-spacing: -0.025em;
  margin: 0.7rem 0 0;
  color: var(--fg);
  max-width: 24ch;
}

.tagline h1 .accent {
  color: var(--accent);
}

.tagline p {
  margin: 1rem 0 0;
  font-size: clamp(1rem, 1.4vw, 1.15rem);
  color: var(--fg-mute);
  max-width: 56ch;
}

.tagline-cta {
  display: flex;
  gap: 12px;
  margin-top: 1.5rem;
  flex-wrap: wrap;
}

/* ============ feature grid ============ */

.features {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: clamp(2rem, 5vh, 3rem);
}

.feature {
  padding: 1.2rem 1.2rem 1.3rem;
  background: var(--bg-panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  position: relative;
  overflow: hidden;
}

.feature::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.5;
}

.feature .num {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.2em;
  color: var(--accent);
}

.feature h2 {
  margin: 0;
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 16.5px;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--fg);
}

.feature p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--fg-mute);
}

/* ============ stat line ============ */

.statline {
  margin-top: clamp(2rem, 5vh, 3rem);
  padding: 0.85rem 1.1rem;
  background: oklch(0.13 0.03 245 / 0.85);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--fg-mute);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1.4rem;
}

.statline .lead {
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.statline .lead .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}

.statline .stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
}

.statline .stat .k {
  color: var(--fg-faint);
  text-transform: uppercase;
}

.statline .stat .v {
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}

.statline .stat .v.tick {
  color: var(--accent);
}

/* ============ footer ============ */

footer {
  margin-top: clamp(2.5rem, 6vh, 4rem);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-faint);
}

.footer-cta {
  text-align: center;
  padding: 3rem 1rem;
  margin-bottom: 2rem;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--bg-panel);
}

.footer-heading {
  font-family: var(--font-sans);
  font-size: clamp(1.4rem, 3vw, 2rem);
  font-weight: 600;
  color: var(--fg);
  margin: 0 0 0.5rem;
  letter-spacing: -0.02em;
}

.footer-sub {
  color: var(--fg-mute);
  font-size: 14px;
  margin: 0 0 1.2rem;
  font-family: var(--font-sans);
}

.footer-links {
  padding-top: 1.5rem;
  border-top: 1px dashed var(--hairline);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.4rem;
}

footer .badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.55rem;
  border: 1px solid var(--hairline-strong);
  border-radius: 999px;
  background: oklch(0.78 0.15 200 / 0.06);
  color: var(--accent);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

footer .badge .pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent-glow);
}

footer .when {
  margin-left: auto;
  color: var(--fg-faint);
}

/* ============ animations ============ */

@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.8;
  }
}

@media (prefers-reduced-motion: reduce) {
  .statusbar .dot,
  .cursor-token .bar {
    animation: none;
  }
  .demo-el,
  .demo-canvas {
    transition: none !important;
  }
  .demo-log-enter {
    animation: none !important;
  }
  .scroll-reveal {
    opacity: 1 !important;
    transform: none !important;
    transition: none !important;
  }
}

/* ============ demo canvas ============ */

.demo-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  border-radius: 4px;
  transition: background-color 0.8s cubic-bezier(0.2, 0, 0, 1);
}

.demo-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  transition: background-image 0.8s ease;
}

.demo-canvas[data-kit="orange-editorial"]::before {
  background-image:
    linear-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 0, 0, 0.04) 1px, transparent 1px);
}

.demo-canvas[data-kit="charcoal"] { background: #0c0c0d; }
.demo-canvas[data-kit="orange-editorial"] { background: #fff7ef; }
.demo-canvas[data-kit="blue-saas"] { background: #0b1530; }
.demo-canvas[data-kit="green-organic"] { background: #0f1a14; }

.demo-el {
  position: absolute;
  opacity: 0;
  transform: translateY(8px);
  pointer-events: none;
  z-index: 1;
  white-space: nowrap;
  transition:
    opacity 0.5s cubic-bezier(0.2, 0, 0, 1),
    transform 0.5s cubic-bezier(0.2, 0, 0, 1),
    background-color 0.8s ease,
    color 0.8s ease,
    border-color 0.8s ease,
    box-shadow 0.8s ease,
    border-radius 0.8s ease,
    border-width 0.8s ease,
    font-family 0.3s ease;
}

.demo-el.in {
  opacity: 1;
  transform: translateY(0);
}

.demo-shape-circle { transform: scale(0.5); }
.demo-shape-circle.in { transform: scale(1); }

/* nav bar */
.demo-nav-bar {
  z-index: 2;
  transform: translateY(-8px);
  border-bottom-style: solid;
  border-bottom-width: 1px;
}
.demo-nav-bar.in { transform: translateY(0); }
.demo-canvas[data-kit="charcoal"] .demo-nav-bar { background: #1f2024; border-bottom-color: rgba(255, 255, 255, 0.14); }
.demo-canvas[data-kit="orange-editorial"] .demo-nav-bar { background: #fbe9d2; border-bottom-color: rgba(34, 22, 16, 0.35); border-bottom-width: 2px; }
.demo-canvas[data-kit="blue-saas"] .demo-nav-bar { background: #15295a; border-bottom-color: rgba(91, 141, 239, 0.32); }
.demo-canvas[data-kit="green-organic"] .demo-nav-bar { background: #1a3128; border-bottom-color: rgba(126, 193, 142, 0.32); }

/* text heading */
.demo-text-heading { font-weight: 700; }
.demo-canvas[data-kit="charcoal"] .demo-text-heading { color: #f6f6f6; font-family: 'IBM Plex Sans', system-ui, sans-serif; }
.demo-canvas[data-kit="orange-editorial"] .demo-text-heading { color: #221610; font-family: Georgia, 'Times New Roman', serif; }
.demo-canvas[data-kit="blue-saas"] .demo-text-heading { color: #e8efff; font-family: 'IBM Plex Sans', system-ui, sans-serif; }
.demo-canvas[data-kit="green-organic"] .demo-text-heading { color: #e7f3ea; font-family: 'IBM Plex Sans', system-ui, sans-serif; }

/* text body */
.demo-canvas[data-kit="charcoal"] .demo-text-body { color: #9a9aa3; }
.demo-canvas[data-kit="orange-editorial"] .demo-text-body { color: #7a5b48; }
.demo-canvas[data-kit="blue-saas"] .demo-text-body { color: #8da3c8; }
.demo-canvas[data-kit="green-organic"] .demo-text-body { color: #9bb4a4; }

/* btn solid */
.demo-btn-solid { font-weight: 600; text-align: center; }
.demo-canvas[data-kit="charcoal"] .demo-btn-solid { background: #d9dde4; color: #0c0c0d; border-radius: 8px; }
.demo-canvas[data-kit="orange-editorial"] .demo-btn-solid { background: #d6541b; color: #fff7ef; border-radius: 0; }
.demo-canvas[data-kit="blue-saas"] .demo-btn-solid { background: #5b8def; color: #0b1530; border-radius: 10px; }
.demo-canvas[data-kit="green-organic"] .demo-btn-solid { background: #7ec18e; color: #0f1a14; border-radius: 999px; }

/* btn ghost */
.demo-btn-ghost { background: transparent; text-align: center; }
.demo-canvas[data-kit="charcoal"] .demo-btn-ghost { color: #f6f6f6; }
.demo-canvas[data-kit="orange-editorial"] .demo-btn-ghost { color: #d6541b; }
.demo-canvas[data-kit="blue-saas"] .demo-btn-ghost { color: #8da3c8; }
.demo-canvas[data-kit="green-organic"] .demo-btn-ghost { color: #9bb4a4; }

/* btn pill */
.demo-btn-pill { font-weight: 600; text-align: center; border-radius: 999px; }
.demo-canvas[data-kit="charcoal"] .demo-btn-pill { background: #d9dde4; color: #0c0c0d; }
.demo-canvas[data-kit="orange-editorial"] .demo-btn-pill { background: #221610; color: #fff7ef; }
.demo-canvas[data-kit="blue-saas"] .demo-btn-pill { background: #5b8def; color: #0b1530; }
.demo-canvas[data-kit="green-organic"] .demo-btn-pill { background: #7ec18e; color: #0f1a14; }

/* btn outline */
.demo-btn-outline { background: transparent; text-align: center; border-style: solid; }
.demo-canvas[data-kit="charcoal"] .demo-btn-outline { color: #f6f6f6; border-color: #d9dde4; border-width: 1px; border-radius: 8px; }
.demo-canvas[data-kit="orange-editorial"] .demo-btn-outline { color: #221610; border-color: #221610; border-width: 2px; border-radius: 0; }
.demo-canvas[data-kit="blue-saas"] .demo-btn-outline { color: #e8efff; border-color: #5b8def; border-width: 1px; border-radius: 10px; }
.demo-canvas[data-kit="green-organic"] .demo-btn-outline { color: #e7f3ea; border-color: #7ec18e; border-width: 1px; border-radius: 999px; }

/* shape circle */
.demo-shape-circle { border-radius: 50%; }
.demo-canvas[data-kit="charcoal"] .demo-shape-circle { background: #d9dde4; border: 1px solid #9a9aa3; }
.demo-canvas[data-kit="orange-editorial"] .demo-shape-circle { background: #d6541b; border: 2px solid #221610; }
.demo-canvas[data-kit="blue-saas"] .demo-shape-circle { background: #5b8def; border: 1px solid #8da3c8; }
.demo-canvas[data-kit="green-organic"] .demo-shape-circle { background: #7ec18e; border: 1px solid #9bb4a4; }

/* card / container — borders bumped so cards read against the dark canvas at small scale */
.demo-canvas[data-kit="charcoal"] .demo-card { background: #1c1d22; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6); }
.demo-canvas[data-kit="orange-editorial"] .demo-card { background: #fff; border: 2px solid #221610; border-radius: 0; box-shadow: 6px 6px 0 #d6541b; }
.demo-canvas[data-kit="blue-saas"] .demo-card { background: #15295a; border: 1px solid rgba(91, 141, 239, 0.35); border-radius: 16px; box-shadow: 0 8px 22px rgba(8, 16, 36, 0.7); }
.demo-canvas[data-kit="green-organic"] .demo-card { background: #1a3128; border: 1px solid rgba(126, 193, 142, 0.35); border-radius: 28px; box-shadow: 0 8px 22px rgba(8, 18, 12, 0.7); }

/* demo agent log feed */
#demo-feed {
  justify-content: flex-end;
}

.demo-log-enter {
  animation: demo-log-in 0.3s cubic-bezier(0.2, 0, 0, 1) forwards;
}

@keyframes demo-log-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ============ scroll reveal ============ */

.scroll-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 0.7s cubic-bezier(0.2, 0, 0, 1),
    transform 0.7s cubic-bezier(0.2, 0, 0, 1);
}

.scroll-reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}

.features.scroll-reveal .feature {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.5s cubic-bezier(0.2, 0, 0, 1),
    transform 0.5s cubic-bezier(0.2, 0, 0, 1);
}

.features.scroll-reveal.revealed .feature { opacity: 1; transform: translateY(0); }
.features.scroll-reveal.revealed .feature:nth-child(1) { transition-delay: 0s; }
.features.scroll-reveal.revealed .feature:nth-child(2) { transition-delay: 0.12s; }
.features.scroll-reveal.revealed .feature:nth-child(3) { transition-delay: 0.24s; }

/* ============ responsive ============ */

@media (max-width: 1100px) {
  .hero-grid {
    grid-template-columns: 1fr 1fr;
  }
  .hero-panel:nth-child(3) {
    grid-column: 1 / -1;
    border-right: none;
    border-top: 1px solid var(--hairline);
  }
  .hero-panel:nth-child(2) {
    border-right: none;
  }
  .features {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .hero-grid {
    grid-template-columns: 1fr;
  }
  .hero-panel {
    border-right: none;
    border-bottom: 1px solid var(--hairline);
  }
  .hero-panel:last-child {
    border-bottom: none;
  }
  .features {
    grid-template-columns: 1fr;
  }
  .statusbar {
    gap: 0.6rem;
    padding: 0.45rem 0.8rem;
  }
  .statusbar .nav a:not(.rev01-ui-btn) {
    display: none;
  }
  .tagline-cta {
    flex-direction: column;
    align-items: flex-start;
  }
  .tagline h1 {
    font-size: clamp(1.7rem, 8vw, 2.4rem);
  }
}
`;
