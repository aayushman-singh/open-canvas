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
  max-width: 1320px;
  margin: 0 auto;
  padding: clamp(1.5rem, 4vh, 3rem) clamp(1rem, 3vw, 2rem) 4rem;
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
  margin-bottom: clamp(1.25rem, 3vh, 2rem);
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
  gap: 1.5rem;
  margin-bottom: clamp(1.5rem, 4vh, 2.4rem);
}

.head h1 {
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: clamp(1.6rem, 3.5vw, 2.4rem);
  margin: 0;
  letter-spacing: -0.02em;
  color: var(--fg);
}
.head h1 .accent { color: var(--accent); }
.head .sub {
  margin: 0.45rem 0 0;
  color: var(--fg-mute);
  font-size: 14px;
  max-width: 60ch;
}

.head .count {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--fg-faint);
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--hairline-strong);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1.1rem;
}

.card {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  overflow: hidden;
  position: relative;
  transition: border-color 200ms ease, transform 200ms ease;
}
.card:hover { border-color: oklch(0.78 0.15 200 / 0.45); transform: translateY(-1px); }
.card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.5;
}

.thumb {
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  font-family: var(--font-mono);
  font-weight: 500;
  font-size: clamp(1rem, 2vw, 1.4rem);
  color: rgba(255,255,255,0.92);
  letter-spacing: -0.01em;
  text-align: center;
  position: relative;
  overflow: hidden;
}

.thumb::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35));
  pointer-events: none;
}

.thumb .thumb-name { position: relative; z-index: 1; }

.body {
  padding: 0.95rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  flex: 1;
}

.body .row {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.body h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--fg);
}

.badge {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 0.12rem 0.5rem;
  border: 1px solid var(--hairline-strong);
  border-radius: 3px;
  background: var(--accent-soft);
  color: var(--accent);
}

.body .tagline {
  margin: 0;
  font-size: 13.5px;
  color: var(--fg-mute);
  line-height: 1.5;
}

.body form {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px dashed var(--hairline);
  padding-top: 0.85rem;
}

.body label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.body input[type='text'] {
  width: 100%;
  background: oklch(0.12 0.03 245 / 0.65);
  border: 1px solid var(--hairline-strong);
  border-radius: 4px;
  padding: 0.55rem 0.7rem;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: 14px;
  outline: none;
  transition: border-color 160ms ease, background 160ms ease;
}
.body input[type='text']:focus {
  border-color: var(--accent);
  background: oklch(0.13 0.03 245 / 0.85);
}
.body input[type='text']::placeholder { color: var(--fg-faint); }

.body button {
  appearance: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.6rem 0.8rem;
  border-radius: 4px;
  border: 1px solid oklch(0.78 0.15 200 / 0.5);
  background: var(--accent-soft);
  color: var(--accent);
  transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
}
.body button:hover {
  background: oklch(0.78 0.15 200 / 0.35);
  color: var(--fg);
}
.body button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

footer {
  margin-top: clamp(2.5rem, 6vh, 4rem);
  padding-top: 1.5rem;
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

@media (max-width: 720px) {
  .head { flex-direction: column; align-items: flex-start; }
}
`;
