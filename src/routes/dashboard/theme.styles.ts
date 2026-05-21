export const styles = `
:root {
  --bg-deep: #0a0e1a;
  --bg-panel: oklch(0.2 0.04 245 / 0.8);
  --bg-panel-strong: oklch(0.22 0.04 245 / 0.95);
  --fg: oklch(0.96 0.02 240);
  --fg-mute: oklch(0.7 0.04 240);
  --fg-faint: oklch(0.55 0.03 240);
  --accent: oklch(0.78 0.15 200);
  --accent-soft: oklch(0.78 0.15 200 / 0.18);
  --accent-glow: oklch(0.78 0.18 200 / 0.4);
  --hairline: oklch(0.6 0.02 240 / 0.15);
  --hairline-strong: oklch(0.6 0.02 240 / 0.28);
  --grid: oklch(0.4 0.02 240 / 0.08);
  --radius: 8px;
  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
  --ok: oklch(0.82 0.18 145);
  --warn: oklch(0.82 0.18 70);
  --err: oklch(0.82 0.18 25);
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg-deep);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
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
  mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0.55), transparent 75%);
  z-index: 0;
}

main {
  position: relative;
  z-index: 1;
  max-width: 1480px;
  margin: 0 auto;
  padding: clamp(1.25rem, 4vh, 2.5rem) clamp(1rem, 3vw, 2rem) 4rem;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-mute);
  border-bottom: 1px solid var(--hairline);
  margin-bottom: clamp(1rem, 3vh, 1.6rem);
}

.topbar .crumbs { color: var(--fg-faint); letter-spacing: 0.06em; text-transform: uppercase; }
.topbar .crumbs .sep { color: var(--fg-faint); margin: 0 0.4rem; }
.topbar .crumbs .here { color: var(--accent); }
.topbar nav { margin-left: auto; display: inline-flex; gap: 1.1rem; }
.topbar nav a {
  color: var(--fg-mute);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
}
.topbar nav a.active { color: var(--accent); border-bottom-color: var(--accent); }
.topbar nav a:hover { color: var(--fg); }

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.25rem;
  margin-bottom: clamp(1rem, 3vh, 1.6rem);
}

.head h1 {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: clamp(1.4rem, 3.5vw, 2.1rem);
  margin: 0;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.head h1 .accent { color: var(--accent); }
.head .sub {
  margin: 0.45rem 0 0;
  color: var(--fg-mute);
  font-size: 13.5px;
  max-width: 60ch;
}

.head .saved {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.35rem 0.7rem;
  border: 1px solid oklch(0.82 0.18 145 / 0.4);
  border-radius: 999px;
  background: oklch(0.82 0.18 145 / 0.12);
  color: var(--ok);
}

.studio {
  display: grid;
  grid-template-columns: minmax(320px, 380px) 1fr;
  gap: 1.1rem;
  align-items: stretch;
}
@media (max-width: 980px) {
  .studio { grid-template-columns: 1fr; }
}

.panel {
  background: var(--bg-panel);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  padding: 1rem 1.1rem 1.1rem;
  position: relative;
}
.panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.5;
  border-radius: var(--radius) var(--radius) 0 0;
}
.panel h2 {
  margin: 0 0 0.85rem;
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

form.studio-form {
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

.field { display: flex; flex-direction: column; gap: 0.4rem; }

.field > label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.seed {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 0.55rem;
  align-items: stretch;
}
.seed input[type='color'] {
  width: 100%;
  height: 100%;
  min-height: 38px;
  padding: 0;
  border: 1px solid var(--hairline-strong);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.seed input[type='color']::-webkit-color-swatch-wrapper { padding: 2px; }
.seed input[type='color']::-webkit-color-swatch { border-radius: 3px; border: none; }

.seed input[type='text'] {
  background: oklch(0.12 0.03 245 / 0.65);
  border: 1px solid var(--hairline-strong);
  border-radius: 4px;
  padding: 0.5rem 0.65rem;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: 13px;
  outline: none;
  text-transform: lowercase;
  letter-spacing: 0.04em;
}
.seed input[type='text']:focus {
  border-color: var(--accent);
  background: oklch(0.13 0.03 245 / 0.85);
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  background: oklch(0.12 0.03 245 / 0.55);
  padding: 4px;
  border: 1px solid var(--hairline-strong);
  border-radius: 5px;
}
.segmented input { position: absolute; opacity: 0; pointer-events: none; }
.segmented label {
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.4rem 0.6rem;
  color: var(--fg-mute);
  border-radius: 3px;
  border: 1px solid transparent;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
.segmented label:hover { color: var(--fg); }
.segmented input:checked + label {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: oklch(0.78 0.15 200 / 0.45);
}
.segmented input:focus-visible + label {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

button.save {
  appearance: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.65rem 0.85rem;
  border-radius: 4px;
  border: 1px solid oklch(0.78 0.15 200 / 0.5);
  background: var(--accent-soft);
  color: var(--accent);
  margin-top: 0.4rem;
  transition: background 160ms ease, color 160ms ease;
}
button.save:hover { background: oklch(0.78 0.15 200 / 0.35); color: var(--fg); }
button.save:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.preview .preview-frame {
  background: var(--t-bg-deep, var(--bg-deep));
  border: 1px solid var(--t-hairline, var(--hairline-strong));
  border-radius: var(--t-radius-px, 8px);
  padding: clamp(1rem, 2.5vw, 1.6rem);
  color: var(--t-fg, var(--fg));
  font-family: var(--t-font-body, var(--font-sans));
  min-height: 280px;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  position: relative;
  overflow: hidden;
}

.preview .preview-frame::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 0% 0%, var(--t-accent-glow, transparent), transparent 60%),
    linear-gradient(135deg, transparent 60%, var(--t-bg-panel, transparent));
  opacity: 0.7;
  z-index: 0;
}

.preview .preview-frame > * { position: relative; z-index: 1; }

.preview .preview-eyebrow {
  font-family: var(--t-font-body, var(--font-mono));
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--t-accent, var(--accent));
}

.preview h3 {
  font-family: var(--t-font-heading, var(--font-mono));
  font-weight: 600;
  font-size: clamp(1.3rem, 2.4vw, 1.8rem);
  margin: 0;
  letter-spacing: -0.02em;
  color: var(--t-fg, var(--fg));
}

.preview p {
  margin: 0;
  color: var(--t-fg-mute, var(--fg-mute));
  line-height: 1.55;
  font-size: 14px;
  max-width: 60ch;
}

.preview .preview-actions { display: inline-flex; gap: 0.55rem; flex-wrap: wrap; }
.preview .preview-actions a {
  font-family: var(--t-font-body, var(--font-mono));
  font-size: 12.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.55rem 0.85rem;
  border-radius: var(--t-radius-px, 4px);
  text-decoration: none;
  transition: filter 140ms ease;
}
.preview .preview-actions a.primary {
  background: var(--t-accent, var(--accent));
  color: var(--t-bg-deep, #fff);
  border: 1px solid var(--t-accent, var(--accent));
}
.preview .preview-actions a.ghost {
  color: var(--t-fg, var(--fg));
  border: 1px solid var(--t-hairline, var(--hairline-strong));
  background: transparent;
}
.preview .preview-actions a:hover { filter: brightness(1.1); }

.preview .preview-media {
  margin-top: auto;
  aspect-ratio: 16 / 7;
  border: 1px solid var(--t-hairline, var(--hairline-strong));
  border-radius: var(--t-radius-px, 4px);
  background:
    repeating-linear-gradient(45deg, var(--t-bg-panel, transparent) 0 10px, transparent 10px 20px),
    var(--t-bg-panel-strong, var(--bg-panel-strong));
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--t-font-body, var(--font-mono));
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--t-fg-mute, var(--fg-faint));
}

.tokens {
  margin-top: 1.1rem;
}
.tokens table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.tokens th, .tokens td {
  text-align: left;
  padding: 0.55rem 0.6rem;
  border-bottom: 1px solid var(--hairline);
  vertical-align: middle;
}
.tokens th {
  font-weight: 500;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
}
.tokens td.swatch-cell { width: 38px; }
.tokens .swatch {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--hairline-strong);
  background-clip: padding-box;
}
.tokens td.name { color: var(--fg); }
.tokens td.value { color: var(--fg-mute); font-size: 11.5px; }

.matrix {
  margin-top: 1.1rem;
  overflow-x: auto;
}
.matrix table {
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: 11.5px;
  min-width: 100%;
}
.matrix th, .matrix td {
  padding: 0.5rem 0.55rem;
  border-bottom: 1px solid var(--hairline);
  border-right: 1px solid var(--hairline);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}
.matrix thead th {
  font-weight: 500;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
  background: oklch(0.16 0.03 245 / 0.5);
}
.matrix th.row-label {
  text-align: left;
  color: var(--fg);
}
.matrix .ratio { font-variant-numeric: tabular-nums; color: var(--fg); }
.matrix .verdict {
  display: inline-block;
  font-size: 9.5px;
  letter-spacing: 0.1em;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  border: 1px solid currentColor;
  margin-right: 0.25rem;
}
.matrix .verdict.pass { color: var(--ok); }
.matrix .verdict.fail { color: var(--err); opacity: 0.75; }

footer {
  margin-top: clamp(2rem, 5vh, 3rem);
  padding-top: 1.2rem;
  border-top: 1px dashed var(--hairline);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--fg-faint);
  display: flex;
  align-items: center;
  gap: 1rem;
}
footer .pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px var(--accent-glow);
}
`;
