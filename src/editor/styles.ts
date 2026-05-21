export const editorStyles = `
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
  --ok: oklch(0.82 0.18 145);
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
  max-width: 1240px;
  margin: 0 auto;
  padding: clamp(1rem, 2.5vh, 1.5rem) clamp(1rem, 3vw, 2rem) 4rem;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.55rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-mute);
  background: oklch(0.13 0.03 245 / 0.75);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  margin-bottom: 1rem;
}

.topbar .crumbs { color: var(--fg-faint); letter-spacing: 0.05em; text-transform: uppercase; }
.topbar .crumbs .sep { margin: 0 0.4rem; }
.topbar .crumbs .here { color: var(--accent); }

.topbar .status {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.topbar .status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-faint);
  box-shadow: none;
  transition: background 200ms ease, box-shadow 200ms ease;
}

.topbar .status.connected .dot {
  background: var(--ok);
  box-shadow: 0 0 0 3px oklch(0.82 0.18 145 / 0.18), 0 0 10px oklch(0.82 0.18 145 / 0.55);
  animation: pulse 1.4s ease-in-out infinite;
}

.topbar .status.connecting .dot {
  background: var(--warn);
  box-shadow: 0 0 0 3px oklch(0.85 0.18 70 / 0.18);
  animation: pulse 0.9s ease-in-out infinite;
}

.topbar .avatars {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: -2px;
}

.topbar .avatars .avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-left: -6px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-deep);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--bg-deep);
  position: relative;
  cursor: default;
  text-transform: uppercase;
}

.topbar .avatars .avatar:first-child {
  margin-left: 0.5rem;
}

.topbar .avatars .avatar.me {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  box-shadow: 0 0 12px var(--accent-glow);
}

.topbar .avatars .avatar .tip {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 3px 7px;
  border-radius: 3px;
  background: oklch(0.16 0.03 245 / 0.95);
  border: 1px solid var(--hairline-strong);
  color: var(--fg);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 10;
}

.topbar .avatars .avatar:hover .tip {
  opacity: 1;
}

.topbar .back {
  color: var(--fg-mute);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 1px;
  transition: color 120ms ease, border-color 120ms ease;
}
.topbar .back:hover { color: var(--accent); border-bottom-color: var(--accent); }

.editor-shell {
  background: var(--bg-panel);
  border: 1px solid var(--hairline-strong);
  border-radius: var(--radius);
  box-shadow:
    inset 0 1px 0 oklch(0.95 0.02 220 / 0.06),
    0 30px 70px -22px rgba(0,0,0,0.7);
  overflow: hidden;
}

.editor-shell .titlebar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--fg-faint);
  background: var(--bg-titlebar);
  border-bottom: 1px solid var(--hairline);
}

.editor-shell .titlebar .glyphs { display: inline-flex; gap: 6px; }
.editor-shell .titlebar .glyph {
  width: 10px; height: 10px; border-radius: 50%;
  background: oklch(0.45 0.04 245);
}
.editor-shell .titlebar .glyph.close { background: oklch(0.6 0.18 25); }
.editor-shell .titlebar .glyph.min { background: oklch(0.78 0.14 80); }
.editor-shell .titlebar .glyph.max { background: oklch(0.72 0.15 150); }
.editor-shell .titlebar .path .accent { color: var(--accent); }
.editor-shell .titlebar .right { margin-left: auto; color: var(--fg-faint); }

.editor-body {
  padding: clamp(1rem, 3vh, 2rem) clamp(1rem, 4vw, 3rem) 4rem;
  background:
    linear-gradient(180deg, oklch(0.13 0.03 245 / 0.4) 0%, transparent 18%),
    transparent;
  min-height: 540px;
}

#editor {
  font-family: var(--font-sans);
  color: var(--fg);
  line-height: 1.6;
  outline: none;
}

#editor .ProseMirror {
  outline: none;
  min-height: 480px;
}

/* rev01 vocabulary — every node + mark in src/document/schema.ts gets a
 * visual treatment so authors can tell sections, columns, media frames,
 * action rows, and divider variants apart inside the editor. Visualisation
 * only — the rendered output is the renderer's responsibility. */

#editor section[data-kind] {
  position: relative;
  margin: 0 0 1.4rem;
  padding: 0.95rem 1rem 0.85rem;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: oklch(0.16 0.03 245 / 0.35);
}
#editor section[data-kind]::before {
  content: attr(data-kind);
  position: absolute;
  top: -0.55rem;
  left: 0.75rem;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--bg-panel-strong);
  padding: 0 0.4rem;
  border: 1px solid var(--hairline);
  border-radius: 3px;
}
#editor section[data-padding='sm'] { padding: 0.6rem 0.8rem; }
#editor section[data-padding='lg'] { padding: 1.4rem 1.2rem 1.2rem; }
#editor section[data-kind='hero'] {
  background: linear-gradient(180deg, oklch(0.18 0.05 220 / 0.55), oklch(0.13 0.03 245 / 0.35));
}
#editor section[data-kind='cta'] { border-color: var(--accent-glow); }
#editor section[data-kind='footer'] { opacity: 0.85; }
#editor section:last-child { margin-bottom: 0; }

#editor h1, #editor h2, #editor h3, #editor h4, #editor h5, #editor h6 {
  font-family: var(--font-sans);
  font-weight: 600;
  letter-spacing: -0.015em;
  margin: 0.6rem 0;
  color: var(--fg);
}
#editor h1 { font-size: 2.1rem; line-height: 1.15; }
#editor h2 { font-size: 1.55rem; line-height: 1.2; }
#editor h3 { font-size: 1.2rem; line-height: 1.3; }
#editor h4 { font-size: 1.05rem; line-height: 1.35; }
#editor h5, #editor h6 { font-size: 0.95rem; line-height: 1.4; color: var(--fg-mute); }
#editor [data-align='start']  { text-align: left; }
#editor [data-align='center'] { text-align: center; }
#editor [data-align='end']    { text-align: right; }

#editor p {
  margin: 0.45rem 0;
  color: var(--fg-mute);
}

#editor strong { color: var(--fg); font-weight: 600; }
#editor em { color: var(--fg); font-style: italic; }
#editor u { text-decoration-color: var(--accent); text-underline-offset: 2px; }
#editor code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.05em 0.35em;
  background: oklch(0.13 0.03 245 / 0.7);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  color: var(--accent);
}

#editor a {
  color: var(--accent);
  border-bottom: 1px solid oklch(0.78 0.15 200 / 0.4);
  text-decoration: none;
}

/* Lists — data-list-style picks the marker. */
#editor ul[data-list-style], #editor ol[data-list-style] {
  padding-left: 1.4rem;
  margin: 0.55rem 0;
  list-style: none;
}
#editor li { margin: 0.2rem 0; color: var(--fg-mute); position: relative; }
#editor ul[data-list-style='bullet'] li::before {
  content: '•';
  position: absolute;
  left: -1rem;
  color: var(--accent);
}
#editor ol[data-list-style='numbered'] {
  list-style: decimal;
  list-style-position: outside;
}
#editor ol[data-list-style='numbered'] li::marker { color: var(--accent); font-family: var(--font-mono); }
#editor ul[data-list-style='check'] li::before {
  content: '✓';
  position: absolute;
  left: -1rem;
  color: var(--ok);
  font-weight: 600;
}

/* Media — placeholder frames so authors see the slot without a real asset. */
#editor figure[data-media-type] {
  margin: 0.9rem 0;
  padding: 0.6rem 0.75rem;
  border: 1px dashed var(--hairline-strong);
  border-radius: var(--radius);
  background: oklch(0.13 0.03 245 / 0.55);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-faint);
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
#editor figure[data-media-type]::before {
  content: attr(data-media-type);
  text-transform: uppercase;
  color: var(--accent);
  background: var(--bg-panel-strong);
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  font-size: 9.5px;
  letter-spacing: 0.12em;
}
#editor figure[data-media-type]::after {
  content: attr(data-src);
  color: var(--fg-mute);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 32ch;
}

/* Actions row — horizontal layout of action atoms. */
#editor div[data-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.75rem 0;
}
#editor div[data-actions][data-align='center'] { justify-content: center; }
#editor div[data-actions][data-align='end']    { justify-content: flex-end; }
#editor a[data-action] {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.85rem;
  border-radius: 4px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  border: 1px solid var(--hairline-strong);
  color: var(--fg);
  background: oklch(0.16 0.03 245 / 0.7);
}
#editor a[data-action][data-variant='primary'] {
  background: var(--accent);
  color: var(--bg-deep);
  border-color: var(--accent);
}
#editor a[data-action][data-variant='secondary'] {
  background: transparent;
  color: var(--accent);
  border-color: var(--accent-glow);
}
#editor a[data-action][data-variant='ghost'] {
  background: transparent;
  color: var(--fg-mute);
  border-color: transparent;
}
#editor a[data-action].ProseMirror-selectednode {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Columns — flex layout with gap variants. */
#editor div[data-columns] {
  display: flex;
  gap: 0.85rem;
  margin: 0.85rem 0;
}
#editor div[data-columns][data-gap='sm'] { gap: 0.45rem; }
#editor div[data-columns][data-gap='lg'] { gap: 1.4rem; }
#editor div[data-column] {
  flex: 1 1 0;
  padding: 0.55rem 0.7rem;
  border: 1px dashed var(--hairline);
  border-radius: var(--radius);
  background: oklch(0.13 0.03 245 / 0.35);
}
#editor div[data-column][data-width='1/2']  { flex-basis: 50%; }
#editor div[data-column][data-width='1/3']  { flex-basis: 33.33%; }
#editor div[data-column][data-width='2/3']  { flex-basis: 66.66%; }
#editor div[data-column][data-width='1/4']  { flex-basis: 25%; }
#editor div[data-column][data-width='3/4']  { flex-basis: 75%; }
#editor div[data-column][data-width='auto'] { flex: 0 1 auto; }

/* Dividers — three visual variants. */
#editor hr[data-divider] {
  border: none;
  margin: 1.1rem 0;
  height: 1px;
  background: var(--hairline-strong);
}
#editor hr[data-divider='line']  { background: var(--hairline-strong); }
#editor hr[data-divider='dot']   {
  background: none;
  border-top: 2px dotted var(--hairline-strong);
  height: 0;
}
#editor hr[data-divider='space'] {
  background: none;
  height: 1.4rem;
}

/* Selected atoms (media, action, divider). */
#editor .ProseMirror-selectednode {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Highlight + color marks. */
#editor mark[data-highlight] {
  padding: 0 0.15em;
  border-radius: 2px;
}
#editor span[data-color] {
  /* inline color set by attribute style */
}

/* CollaborationCaret remote-cursor decorations */
.collaboration-caret__caret {
  border-left: 2px solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

.collaboration-caret__label {
  position: absolute;
  top: -1.45em;
  left: -1px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 3px 3px 3px 0;
  user-select: none;
  white-space: nowrap;
  font-weight: 500;
  color: var(--bg-deep);
}

.statusline {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.45rem 0.85rem;
  margin-top: 1rem;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-faint);
  background: oklch(0.13 0.03 245 / 0.6);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
}

.statusline .k { color: var(--fg-faint); letter-spacing: 0.05em; text-transform: uppercase; }
.statusline .v { color: var(--fg); font-variant-numeric: tabular-nums; }
.statusline .sep { color: var(--fg-faint); }

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.8; }
}

@media (prefers-reduced-motion: reduce) {
  .topbar .status .dot { animation: none; }
}
`;
