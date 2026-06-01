// src/themes/panel.tsx
//
// Theme panel that sits in the editor sidebar. Pure JSX (Hono JSX). The panel
// renders three control groups (colour, typography, surface) against either
// the active built-in preset (read-only) or the Owner's `customStyleKit`
// (editable). The "Edit colours" button promotes the active built-in into the
// custom slot so the Owner can start from a familiar base. A "Reset to
// built-in" button flips `styleKit` back to a chosen built-in and clears
// `customStyleKit` from the wire payload.
//
// Why pure JSX, no client framework: the editor surface is composed via
// Hono's `c.html(<...>)` pattern. The panel ships an inline client script
// (`themePanelClientScript`) that wires the form to the route in
// `src/themes/route.ts`. There is no React / Solid / etc.
//
// What the panel does NOT do:
//   - Render the canvas preview itself. The wrapping editor mounts the
//     panel next to its existing preview frame; the preview re-fetches the
//     site state after the PUT lands. The editor surface is owned by a
//     different file and we don't touch it.
//   - Custom font uploads (`src/fonts/` owns that surface); here we surface
//     a fixed list of safe system / popular Google font stacks.

import { raw } from 'hono/html';

import type {
  ActionVariant,
  MotionPreset,
  StyleKit,
  StyleKitPreset,
  SurfaceVariant,
} from '../canvas/schema.js';
import { BUILT_IN_STYLE_KITS } from '../canvas/schema.js';

import { checkKitContrast, type ContrastWarning } from './contrast-guard.js';

// --------------------------------------------------------------------------
// Curated type-pair list — seven safe stacks the Owner can switch between
// without uploading custom font files. Custom font uploads are handled by
// `src/fonts/`.
// --------------------------------------------------------------------------

export interface TypePairChoice {
  id: string;
  label: string;
  display: string;
  body: string;
}

export const TYPE_PAIRS: ReadonlyArray<TypePairChoice> = [
  {
    id: 'system',
    label: 'System (clean default)',
    display: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  },
  {
    id: 'inter',
    label: 'Inter / Inter',
    display: "'Inter', system-ui, -apple-system, sans-serif",
    body: "'Inter', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'inter-tight',
    label: 'Inter Tight (SaaS)',
    display: "'Inter Tight', system-ui, -apple-system, sans-serif",
    body: "'Inter Tight', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'serif-editorial',
    label: 'Playfair + Inter (editorial)',
    display: "'Playfair Display', 'Times New Roman', serif",
    body: "'Inter', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'spectral',
    label: 'Spectral + Inter',
    display: "'Spectral', 'Times New Roman', serif",
    body: "'Inter', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'manrope',
    label: 'Manrope + Inter (organic)',
    display: "'Manrope', system-ui, -apple-system, sans-serif",
    body: "'Inter', system-ui, -apple-system, sans-serif",
  },
  {
    id: 'monospaced',
    label: 'JetBrains Mono / Inter (technical)',
    display: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    body: "'Inter', system-ui, -apple-system, sans-serif",
  },
];

// --------------------------------------------------------------------------
// Surface treatment presets — radius scale + shadow strength. Owners pick
// one; the panel writes the corresponding token values into the kit. This
// is the "Surface treatment" control mentioned in the plan; it is not a
// per-SurfaceVariant editor (out of POC scope).
// --------------------------------------------------------------------------

export interface SurfaceTreatmentChoice {
  id: string;
  label: string;
  radius: string;
  borderWidth: string;
  shadow: string;
}

export const SURFACE_TREATMENTS: ReadonlyArray<SurfaceTreatmentChoice> = [
  {
    id: 'sharp',
    label: 'Sharp (no radius, hard shadow)',
    radius: '0px',
    borderWidth: '2px',
    shadow: '6px 6px 0 rgba(0, 0, 0, 0.85)',
  },
  {
    id: 'crisp',
    label: 'Crisp (small radius, soft shadow)',
    radius: '8px',
    borderWidth: '1px',
    shadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
  },
  {
    id: 'soft',
    label: 'Soft (medium radius, soft shadow)',
    radius: '12px',
    borderWidth: '1px',
    shadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  {
    id: 'rounded',
    label: 'Rounded (large radius, lifted shadow)',
    radius: '20px',
    borderWidth: '1px',
    shadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  },
  {
    id: 'flat',
    label: 'Flat (medium radius, no shadow)',
    radius: '12px',
    borderWidth: '1px',
    shadow: 'none',
  },
];

// --------------------------------------------------------------------------
// Panel CSS. Scoped under `[data-opencanvas-theme-panel]` to keep the editor
// chrome's namespace clean. Consumed via a `<style>` block emitted by the
// panel's container so this file stays self-contained.
// --------------------------------------------------------------------------

export const THEME_PANEL_STYLES: string = `
  [data-opencanvas-theme-panel] {
    display: grid;
    gap: 16px;
    padding: 16px;
    color: var(--text, #e8efff);
    background: var(--panel, #11203f);
    border: 1px solid var(--line, rgba(255,255,255,0.08));
    border-radius: 10px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  [data-opencanvas-theme-panel] h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  [data-opencanvas-theme-panel] h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted, #8da3c8);
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-row {
    display: grid;
    gap: 8px;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  [data-opencanvas-theme-panel] label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted, #8da3c8);
  }
  [data-opencanvas-theme-panel] input[type="color"] {
    width: 100%;
    height: 32px;
    padding: 0;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
    background: transparent;
  }
  [data-opencanvas-theme-panel] input[type="text"],
  [data-opencanvas-theme-panel] select {
    padding: 8px 10px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
    background: var(--bg, #0b1530);
    color: var(--text, #e8efff);
    font-size: 13px;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  [data-opencanvas-theme-panel] button {
    padding: 9px 14px;
    border-radius: 6px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    background: var(--accent, #5b8def);
    color: var(--accentText, #0b1530);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  [data-opencanvas-theme-panel] button[data-variant="ghost"] {
    background: transparent;
    color: var(--text, #e8efff);
  }
  [data-opencanvas-theme-panel] button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-warnings {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 8px;
    background: rgba(248, 113, 113, 0.08);
    color: #fca5a5;
    font-size: 12px;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-warnings strong {
    color: #fee2e2;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-status {
    font-size: 12px;
    color: var(--muted, #8da3c8);
    min-height: 16px;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-preview {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
  }
  [data-opencanvas-theme-panel] .opencanvas-theme-preview .swatch {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.18);
  }
`;

// --------------------------------------------------------------------------
// Render — the panel's JSX. Pure projection of a `ThemePanelProps`.
// --------------------------------------------------------------------------

export interface ThemePanelProps {
  /** Site id — interpolated into the form's submit URL. */
  siteId: string;
  /** Current `styleKit` selector value from `EditableSite`. */
  activeStyleKit: StyleKit;
  /**
   * The kit currently in effect on the canvas. Either a built-in preset (when
   * `activeStyleKit !== 'custom'`) or the Owner's custom kit. The panel reads
   * from this for initial form values.
   */
  activePreset: StyleKitPreset;
}

/**
 * Render the theme panel. The caller mounts this inside the editor sidebar.
 * `THEME_PANEL_STYLES` must be emitted somewhere on the page (usually in a
 * `<style>` block alongside other editor chrome).
 */
export function ThemePanel(props: ThemePanelProps) {
  const warnings = checkKitContrast(props.activePreset);
  const editing = props.activeStyleKit === 'custom';
  return (
    <section data-opencanvas-theme-panel data-active-kit={props.activeStyleKit}>
      <h2>Theme</h2>
      <p class="opencanvas-theme-status" data-opencanvas-theme-status>
        {editing
          ? 'Editing a custom theme. Save to apply, or reset to a built-in kit.'
          : `Built-in kit: ${props.activeStyleKit}. Edit colours to author a custom theme.`}
      </p>

      <ResetGroup activeStyleKit={props.activeStyleKit} />

      <form
        class="opencanvas-theme-form"
        data-opencanvas-theme-form
        method="post"
        action={`/api/sites/${escapeAttribute(props.siteId)}/custom-theme`}
      >
        <ColorGroup preset={props.activePreset} />
        <TypePairGroup preset={props.activePreset} />
        <SurfaceTreatmentGroup preset={props.activePreset} />

        {warnings.length > 0 ? <WarningsPanel warnings={warnings} /> : null}

        <div class="opencanvas-theme-actions">
          <button type="submit">Save custom theme</button>
          <button type="button" data-variant="ghost" data-opencanvas-theme-promote>
            Start from this kit
          </button>
        </div>
      </form>

      {/* Dark variant authoring. Sibling block (NOT inside the existing
          custom-theme form) so the byte-for-byte logic above is preserved.
          The dark sub-form has its own state, its own client script, and its
          own submit handler that posts to the same /custom-theme endpoint
          with the dark partial merged onto the active custom kit. Renders
          ONLY when the Owner is editing a custom theme — for a built-in kit,
          dark variants come from the sibling built-in-darks table and are
          not Owner-editable. */}
      {editing ? <DarkVariantSection siteId={props.siteId} preset={props.activePreset} /> : null}

      {/* Custom fonts section. ADDITIVE seam: lives in its own subtree
          outside the custom-theme form (Save/Reset/Promote flow stays
          byte-for-byte unchanged) and outside the DarkVariantSection
          (independent state + client script). Always rendered — Owners can
          upload + manage fonts whether or not they are editing a custom
          theme. Assigning a font to display/body/mono only takes effect
          inside a custom theme; the section surfaces that constraint to
          the Owner via the empty-state label. */}
      <CustomFontsSection siteId={props.siteId} editing={editing} />
      {/* end custom fonts section */}

      <script type="module">
        {raw(themePanelClientScript(props.siteId, props.activePreset))}
      </script>
    </section>
  );
}

// --------------------------------------------------------------------------
// Sub-components.
// --------------------------------------------------------------------------

function ColorGroup({ preset }: { preset: StyleKitPreset }) {
  return (
    <div class="opencanvas-theme-row">
      <h3>Colour</h3>
      <div class="opencanvas-theme-grid">
        <ColorField name="bg" label="Background" value={preset.bg} />
        <ColorField name="panel" label="Panel" value={preset.panel} />
        <ColorField name="text" label="Text" value={preset.text} />
        <ColorField name="muted" label="Muted text" value={preset.muted} />
        <ColorField name="accent" label="Accent" value={preset.accent} />
        <ColorField name="accentText" label="Accent text" value={preset.accentText} />
      </div>
    </div>
  );
}

function ColorField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  // Hex value displayed in the text input + a native colour picker mirror. The
  // client script keeps the two in sync.
  return (
    <label>
      <span>{label}</span>
      <input
        type="color"
        name={`${name}_picker`}
        value={normaliseHexForPicker(value)}
        data-opencanvas-theme-picker={name}
      />
      <input
        type="text"
        name={name}
        value={value}
        data-opencanvas-theme-hex={name}
        inputmode="text"
        autocomplete="off"
        spellcheck={false}
      />
    </label>
  );
}

function TypePairGroup({ preset }: { preset: StyleKitPreset }) {
  const activePairId = findActiveTypePairId(preset);
  return (
    <div class="opencanvas-theme-row">
      <h3>Typography</h3>
      <label>
        <span>Display + body pair</span>
        <select name="typePairId" data-opencanvas-theme-type-pair>
          {TYPE_PAIRS.map((pair) => (
            <option value={pair.id} selected={pair.id === activePairId}>
              {pair.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SurfaceTreatmentGroup({ preset }: { preset: StyleKitPreset }) {
  const activeId = findActiveSurfaceTreatmentId(preset);
  return (
    <div class="opencanvas-theme-row">
      <h3>Surface</h3>
      <label>
        <span>Treatment</span>
        <select name="surfaceTreatmentId" data-opencanvas-theme-surface>
          {SURFACE_TREATMENTS.map((s) => (
            <option value={s.id} selected={s.id === activeId}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ResetGroup({ activeStyleKit }: { activeStyleKit: StyleKit }) {
  return (
    <div class="opencanvas-theme-row">
      <h3>Reset</h3>
      <label>
        <span>Pick a built-in kit</span>
        <select data-opencanvas-theme-reset-target>
          {BUILT_IN_STYLE_KITS.map((kit) => (
            <option value={kit} selected={kit === activeStyleKit}>
              {kit}
            </option>
          ))}
        </select>
      </label>
      <div class="opencanvas-theme-actions">
        <button type="button" data-variant="ghost" data-opencanvas-theme-reset>
          Reset to built-in
        </button>
      </div>
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: ContrastWarning[] }) {
  return (
    <div class="opencanvas-theme-warnings" role="status" aria-live="polite">
      <h3>Contrast warnings</h3>
      {warnings.map((w) => (
        <p>
          <strong>{warningHeadline(w)}.</strong> Measured {w.ratio.toFixed(2)}:1, need{' '}
          {w.threshold.toFixed(1)}:1 (foreground {w.pair.foreground}, background {w.pair.background}
          ).
        </p>
      ))}
    </div>
  );
}

function warningHeadline(w: ContrastWarning): string {
  switch (w.kind) {
    case 'bg-text':
      return 'Body text against the page background is hard to read';
    case 'accent-accent-text':
      return 'Accent text against the accent colour is hard to read';
  }
}

// --------------------------------------------------------------------------
// Helpers — used by both the JSX side and the client script (via the
// serialised choice tables).
// --------------------------------------------------------------------------

function findActiveTypePairId(preset: StyleKitPreset): string {
  for (const pair of TYPE_PAIRS) {
    if (pair.display === preset.fontFamilyDisplay && pair.body === preset.fontFamilyBody) {
      return pair.id;
    }
  }
  // No exact match — surface the system stack as "the safe default" rather
  // than pretending the kit matches the first entry. The picker still keeps
  // its current value if the Owner saves without touching it.
  return TYPE_PAIRS[0]?.id ?? 'system';
}

function findActiveSurfaceTreatmentId(preset: StyleKitPreset): string {
  for (const s of SURFACE_TREATMENTS) {
    if (s.radius === preset.radius && s.shadow === preset.shadow) {
      return s.id;
    }
  }
  return SURFACE_TREATMENTS[1]?.id ?? 'crisp';
}

/** Convert any 3- or 6-character hex to the 7-char "#rrggbb" the native picker wants. */
function normaliseHexForPicker(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  // Native colour picker requires a 7-char value; anything else maps to a
  // visible neutral fallback so the picker doesn't silently zero-out. The
  // text input still shows the original value so the Owner sees the drift.
  return '#000000';
}

const ATTR_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ATTR_ESCAPES[ch] ?? ch);
}

// --------------------------------------------------------------------------
// Client script — wires the form to the route and keeps the colour picker
// + text input in sync. Built as a string so it can be dropped into a
// `<script type="module">` inside the JSX.
// --------------------------------------------------------------------------

function themePanelClientScript(siteId: string, preset: StyleKitPreset): string {
  // The picker → text-input sync logic + the "Start from this kit" + "Reset"
  // + form submit handlers all live here. The preset itself is serialised so
  // the script has the full base to project against when the user changes a
  // single field. The format is JSON; the script never `eval`s it.
  const payload = {
    siteId,
    preset,
    typePairs: TYPE_PAIRS,
    surfaceTreatments: SURFACE_TREATMENTS,
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return String.raw`
(() => {
  const STATE = JSON.parse(${JSON.stringify(json)});
  const root = document.querySelector('[data-opencanvas-theme-panel]');
  if (!root) return;
  const form = root.querySelector('[data-opencanvas-theme-form]');
  const status = root.querySelector('[data-opencanvas-theme-status]');
  function setStatus(msg) { if (status) status.textContent = msg; }
  // Mirror colour picker ↔ hex text input. Either side updates the other.
  root.querySelectorAll('[data-opencanvas-theme-picker]').forEach((picker) => {
    const name = picker.getAttribute('data-opencanvas-theme-picker');
    if (!name) return;
    const hex = root.querySelector('[data-opencanvas-theme-hex="' + name + '"]');
    if (!hex) return;
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input', () => {
      const v = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) picker.value = v;
    });
  });
  // Build the kit payload sent to PUT /api/sites/:id/custom-theme.
  function gatherKit() {
    const kit = JSON.parse(JSON.stringify(STATE.preset));
    ['bg', 'panel', 'text', 'muted', 'accent', 'accentText'].forEach((name) => {
      const hex = root.querySelector('[data-opencanvas-theme-hex="' + name + '"]');
      if (hex) kit[name] = hex.value.trim();
    });
    const typePairSel = root.querySelector('[data-opencanvas-theme-type-pair]');
    if (typePairSel) {
      const choice = STATE.typePairs.find((p) => p.id === typePairSel.value);
      if (choice) {
        kit.fontFamilyDisplay = choice.display;
        kit.fontFamilyBody = choice.body;
      }
    }
    const surfaceSel = root.querySelector('[data-opencanvas-theme-surface]');
    if (surfaceSel) {
      const choice = STATE.surfaceTreatments.find((s) => s.id === surfaceSel.value);
      if (choice) {
        kit.radius = choice.radius;
        kit.borderWidth = choice.borderWidth;
        kit.shadow = choice.shadow;
      }
    }
    return kit;
  }
  // Save → PUT /api/sites/:id/custom-theme with the gathered kit.
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('Saving custom theme…');
      const kit = gatherKit();
      try {
        const response = await fetch(
          '/api/sites/' + encodeURIComponent(STATE.siteId) + '/custom-theme',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ customStyleKit: kit }),
          },
        );
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
          setStatus('Save failed: ' + detail);
          return;
        }
        setStatus('Custom theme saved. Reloading…');
        location.reload();
      } catch (err) {
        setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
      }
    });
  }
  // "Start from this kit" — flips selector to 'custom' with the current
  // built-in preset as the seed, then saves. Useful so the Owner doesn't
  // have to author every token from scratch.
  const promote = root.querySelector('[data-opencanvas-theme-promote]');
  if (promote) {
    promote.addEventListener('click', async () => {
      setStatus('Promoting current kit to a custom theme…');
      const kit = gatherKit();
      try {
        const response = await fetch(
          '/api/sites/' + encodeURIComponent(STATE.siteId) + '/custom-theme',
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ customStyleKit: kit }),
          },
        );
        if (!response.ok) { setStatus('Promote failed: ' + response.statusText); return; }
        location.reload();
      } catch (err) {
        setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
      }
    });
  }
  // Reset → DELETE the custom-theme + flip styleKit to the chosen built-in.
  const reset = root.querySelector('[data-opencanvas-theme-reset]');
  if (reset) {
    reset.addEventListener('click', async () => {
      const target = root.querySelector('[data-opencanvas-theme-reset-target]');
      const builtIn = target ? target.value : 'charcoal';
      if (!await window.__opencanvasModal.confirm('Reset to built-in kit "' + builtIn + '"? Your custom theme will be discarded.', { title: 'Reset theme' })) return;
      setStatus('Resetting to ' + builtIn + '…');
      try {
        const response = await fetch(
          '/api/sites/' + encodeURIComponent(STATE.siteId) + '/custom-theme',
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ styleKit: builtIn }),
          },
        );
        if (!response.ok) { setStatus('Reset failed: ' + response.statusText); return; }
        location.reload();
      } catch (err) {
        setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
      }
    });
  }
})();
`;
}

// --------------------------------------------------------------------------
// Dark variant authoring. ADDITIVE: lives in its own subtree outside the
// custom-theme form so the existing Save / Reset / Promote flow stays
// byte-for-byte unchanged. The dark sub-form gathers the same six colour
// tokens the light form gathers, posts a follow-up PUT with the merged kit
// (light tokens unchanged + a `dark` partial), and lets the route's
// validator catch any drift. Renders only when the Owner is editing a
// custom theme.
// --------------------------------------------------------------------------

const DARK_COLOR_TOKENS: ReadonlyArray<{ name: keyof Omit<StyleKitPreset, 'dark'>; label: string }> = [
  { name: 'bg', label: 'Background' },
  { name: 'panel', label: 'Panel' },
  { name: 'text', label: 'Text' },
  { name: 'muted', label: 'Muted text' },
  { name: 'accent', label: 'Accent' },
  { name: 'accentText', label: 'Accent text' },
];

function DarkVariantSection({ siteId, preset }: { siteId: string; preset: StyleKitPreset }) {
  const dark = preset.dark ?? {};
  return (
    <section data-opencanvas-dark-variant class="opencanvas-theme-row">
      <h3>Dark variant</h3>
      <p class="opencanvas-theme-status">
        Optional overrides applied when the visitor's mode is dark. Empty fields fall
        through to the light value.
      </p>
      <div class="opencanvas-theme-grid">
        {DARK_COLOR_TOKENS.map((tok) => (
          <DarkColorField
            name={String(tok.name)}
            label={tok.label}
            value={
              typeof dark[tok.name] === 'string' ? (dark[tok.name] as string) : ''
            }
          />
        ))}
      </div>
      <div class="opencanvas-theme-actions">
        <button type="button" data-opencanvas-dark-save>
          Save dark variant
        </button>
        <button type="button" data-variant="ghost" data-opencanvas-dark-clear>
          Clear dark variant
        </button>
      </div>
      <p class="opencanvas-theme-status" data-opencanvas-dark-status></p>
      <script type="module">{raw(darkVariantClientScript(siteId, preset))}</script>
    </section>
  );
}

function DarkColorField({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value: string;
}) {
  // Mirrors `ColorField` but with empty-string as a valid "no override" value.
  // The picker mirror is wired by the dark-variant client script (independent
  // from the light form's client script — no shared selectors).
  return (
    <label>
      <span>{label}</span>
      <input
        type="color"
        name={`dark_${name}_picker`}
        value={value.length > 0 ? normaliseHexForPicker(value) : '#000000'}
        data-opencanvas-dark-picker={name}
      />
      <input
        type="text"
        name={`dark_${name}`}
        value={value}
        placeholder="(inherit from light)"
        data-opencanvas-dark-hex={name}
        inputmode="text"
        autocomplete="off"
        spellcheck={false}
      />
    </label>
  );
}

function darkVariantClientScript(siteId: string, preset: StyleKitPreset): string {
  // Same shape as the light form's client script: serialise the kit so the
  // submit handler has the full base to project against. The script POSTs a
  // PUT with the kit unchanged except for the `dark` partial built from the
  // dark inputs. Empty inputs are omitted from the partial (the resolver
  // treats absent keys as "inherit from light" by design).
  const payload = { siteId, preset };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return String.raw`
(() => {
  const STATE = JSON.parse(${JSON.stringify(json)});
  const root = document.querySelector('[data-opencanvas-dark-variant]');
  if (!root) return;
  const status = root.querySelector('[data-opencanvas-dark-status]');
  function setStatus(msg) { if (status) status.textContent = msg; }
  // Picker ↔ hex sync, independent from the light form's wiring.
  root.querySelectorAll('[data-opencanvas-dark-picker]').forEach((picker) => {
    const name = picker.getAttribute('data-opencanvas-dark-picker');
    if (!name) return;
    const hex = root.querySelector('[data-opencanvas-dark-hex="' + name + '"]');
    if (!hex) return;
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input', () => {
      const v = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) picker.value = v;
    });
  });
  function buildDarkPartial() {
    const dark = {};
    const TOKENS = ['bg', 'panel', 'text', 'muted', 'accent', 'accentText'];
    for (const name of TOKENS) {
      const hex = root.querySelector('[data-opencanvas-dark-hex="' + name + '"]');
      if (!hex) continue;
      const v = hex.value.trim();
      if (v.length > 0) dark[name] = v;
    }
    return dark;
  }
  async function putKit(nextKit) {
    setStatus('Saving dark variant…');
    try {
      const response = await fetch(
        '/api/sites/' + encodeURIComponent(STATE.siteId) + '/custom-theme',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ customStyleKit: nextKit }),
        },
      );
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        setStatus('Save failed: ' + detail);
        return;
      }
      setStatus('Dark variant saved. Reloading…');
      location.reload();
    } catch (err) {
      setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
    }
  }
  const saveBtn = root.querySelector('[data-opencanvas-dark-save]');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const nextKit = JSON.parse(JSON.stringify(STATE.preset));
      const dark = buildDarkPartial();
      if (Object.keys(dark).length === 0) {
        delete nextKit.dark;
      } else {
        nextKit.dark = dark;
      }
      putKit(nextKit);
    });
  }
  const clearBtn = root.querySelector('[data-opencanvas-dark-clear]');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!await window.__opencanvasModal.confirm('Clear the dark variant? Visitors in dark mode will see the light kit.', { title: 'Clear dark variant' })) return;
      const nextKit = JSON.parse(JSON.stringify(STATE.preset));
      delete nextKit.dark;
      putKit(nextKit);
    });
  }
})();
`;
}

// --------------------------------------------------------------------------
// Pure helpers re-exported so the route + smoke can share them.
// --------------------------------------------------------------------------

export {
  findActiveTypePairId,
  findActiveSurfaceTreatmentId,
};

// Type re-exports so consumers of the panel don't have to import from schema
// directly when wiring it up.
export type { ActionVariant, MotionPreset, SurfaceVariant };

// --------------------------------------------------------------------------
// Custom fonts section. ADDITIVE: lives in its own subtree so the existing
// custom-theme + dark-variant flows stay byte-for-byte unchanged. The section
// renders:
//   - A file picker + name / weight / style inputs for WOFF2 upload, posted
//     to POST /api/sites/:siteId/fonts (owned by `src/fonts/`).
//   - A list of the site's current fonts (fetched on mount via GET .../fonts)
//     with per-row "Assign as display" / "Assign as body" / "Assign as mono"
//     buttons that rewrite the active custom kit's font tokens via the
//     existing PUT /api/sites/:siteId/custom-theme endpoint.
//   - A delete button per row that DELETEs the font.
// The client script lives below as a string so the section is self-contained.
// --------------------------------------------------------------------------

function CustomFontsSection({ siteId, editing }: { siteId: string; editing: boolean }) {
  return (
    <section data-opencanvas-custom-fonts class="opencanvas-theme-row">
      <h3>Custom fonts</h3>
      <p class="opencanvas-theme-status">
        {editing
          ? 'Upload a WOFF2 file and assign it as the display, body, or mono font for this custom theme.'
          : 'Upload fonts here; assigning one to display / body / mono is enabled once you start a custom theme.'}
      </p>
      <form
        data-opencanvas-fonts-form
        method="post"
        action={`/api/sites/${escapeAttribute(siteId)}/fonts`}
        enctype="multipart/form-data"
      >
        <label>
          <span>Font name</span>
          <input
            type="text"
            name="name"
            data-opencanvas-font-name
            placeholder="Display"
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        <label>
          <span>Family classification</span>
          <select name="family" data-opencanvas-font-family>
            <option value="sans-serif">sans-serif</option>
            <option value="serif">serif</option>
            <option value="mono">mono</option>
            <option value="display">display</option>
          </select>
        </label>
        <div class="opencanvas-theme-grid">
          <label>
            <span>Weight</span>
            <input
              type="text"
              name="weight"
              data-opencanvas-font-weight
              value="400"
              inputmode="numeric"
              autocomplete="off"
            />
          </label>
          <label>
            <span>Style</span>
            <select name="style" data-opencanvas-font-style>
              <option value="normal" selected>
                normal
              </option>
              <option value="italic">italic</option>
            </select>
          </label>
        </div>
        <label>
          <span>WOFF2 file</span>
          <input type="file" name="file" accept=".woff2,font/woff2" data-opencanvas-font-file />
        </label>
        <div class="opencanvas-theme-actions">
          <button type="submit" data-opencanvas-font-upload>
            Upload font
          </button>
        </div>
      </form>
      <p class="opencanvas-theme-status" data-opencanvas-font-status></p>
      <div data-opencanvas-font-list></div>
      <script type="module">{raw(customFontsClientScript(siteId, editing))}</script>
    </section>
  );
}

function customFontsClientScript(siteId: string, editing: boolean): string {
  // The script handles: list-on-mount, upload (multipart POST), per-row
  // assign (rewrites the active custom kit's font tokens via the existing
  // PUT /custom-theme endpoint with a `font:<contentHash>` token), and
  // delete. The kit fetch + merge runs inside the assign handler so we
  // always operate on the freshest custom kit (the Owner may have changed
  // colours between mounting the section and clicking assign).
  const payload = { siteId, editing };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return String.raw`
(() => {
  const STATE = JSON.parse(${JSON.stringify(json)});
  const root = document.querySelector('[data-opencanvas-custom-fonts]');
  if (!root) return;
  const listEl = root.querySelector('[data-opencanvas-font-list]');
  const status = root.querySelector('[data-opencanvas-font-status]');
  const form = root.querySelector('[data-opencanvas-fonts-form]');
  function setStatus(msg) { if (status) status.textContent = msg; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  async function fetchFonts() {
    try {
      const response = await fetch('/api/sites/' + encodeURIComponent(STATE.siteId) + '/fonts', {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) { setStatus('Failed to load fonts: ' + response.statusText); return; }
      const body = await response.json();
      renderList(body.fonts || []);
    } catch (err) {
      setStatus('Network error loading fonts: ' + (err && err.message ? err.message : String(err)));
    }
  }

  function renderList(fonts) {
    if (!listEl) return;
    if (fonts.length === 0) {
      listEl.innerHTML = '<p class="opencanvas-theme-status">No custom fonts uploaded yet.</p>';
      return;
    }
    const rows = fonts.map((font) => {
      const meta = escapeHtml(font.name) + ' · ' + escapeHtml(font.family) +
        ' · w' + String(font.weight) + ' · ' + escapeHtml(font.style);
      const assignButtons = STATE.editing
        ? '<div class="opencanvas-theme-actions">' +
          '<button type="button" data-variant="ghost" data-opencanvas-font-assign="display" data-opencanvas-font-hash="' + escapeAttr(font.contentHash) + '">Display</button>' +
          '<button type="button" data-variant="ghost" data-opencanvas-font-assign="body" data-opencanvas-font-hash="' + escapeAttr(font.contentHash) + '">Body</button>' +
          '<button type="button" data-variant="ghost" data-opencanvas-font-assign="mono" data-opencanvas-font-hash="' + escapeAttr(font.contentHash) + '">Mono</button>' +
          '<button type="button" data-variant="ghost" data-opencanvas-font-delete="' + escapeAttr(font.id) + '">Delete</button>' +
          '</div>'
        : '<div class="opencanvas-theme-actions">' +
          '<button type="button" data-variant="ghost" data-opencanvas-font-delete="' + escapeAttr(font.id) + '">Delete</button>' +
          '</div>';
      return '<div class="opencanvas-theme-row"><strong>' + meta + '</strong>' + assignButtons + '</div>';
    }).join('');
    listEl.innerHTML = rows;
  }

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(form);
      setStatus('Uploading font…');
      try {
        const response = await fetch('/api/sites/' + encodeURIComponent(STATE.siteId) + '/fonts', {
          method: 'POST',
          body: fd,
        });
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json();
            if (body && body.error) detail = body.error;
          } catch (_) { /* noop */ }
          setStatus('Upload failed: ' + detail);
          return;
        }
        setStatus('Font uploaded. Reloading list…');
        await fetchFonts();
      } catch (err) {
        setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
      }
    });
  }

  if (listEl) {
    listEl.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const assignSlot = target.getAttribute('data-opencanvas-font-assign');
      const assignHash = target.getAttribute('data-opencanvas-font-hash');
      if (assignSlot && assignHash) {
        if (!STATE.editing) {
          setStatus('Start a custom theme first to assign a font.');
          return;
        }
        setStatus('Assigning font to ' + assignSlot + '…');
        try {
          // Fetch the current site state so we operate on the freshest
          // custom kit. The route requires the full kit on PUT — partial
          // updates are not supported.
          const stateResponse = await fetch('/api/sites/' + encodeURIComponent(STATE.siteId), {
            headers: { accept: 'application/json' },
          });
          if (!stateResponse.ok) {
            setStatus('Could not load current theme: ' + stateResponse.statusText);
            return;
          }
          const stateBody = await stateResponse.json();
          const kit = stateBody && stateBody.editableState && stateBody.editableState.customStyleKit;
          if (!kit) {
            setStatus('No custom theme to assign font to. Click "Start from this kit" first.');
            return;
          }
          const token = 'font:' + assignHash;
          if (assignSlot === 'display') kit.fontFamilyDisplay = token;
          else if (assignSlot === 'body') kit.fontFamilyBody = token;
          else if (assignSlot === 'mono') kit.fontFamilyMono = token;
          const put = await fetch('/api/sites/' + encodeURIComponent(STATE.siteId) + '/custom-theme', {
            method: 'PUT',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ customStyleKit: kit }),
          });
          if (!put.ok) {
            let detail = put.statusText;
            try { const body = await put.json(); if (body && body.error) detail = body.error; } catch (_) {}
            setStatus('Assign failed: ' + detail);
            return;
          }
          setStatus('Font assigned to ' + assignSlot + '. Reloading…');
          location.reload();
        } catch (err) {
          setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
        }
        return;
      }

      const deleteId = target.getAttribute('data-opencanvas-font-delete');
      if (deleteId) {
        if (!await window.__opencanvasModal.confirm('Delete this font? Any token that references it will stop rendering.', { title: 'Delete font', confirmLabel: 'Delete', danger: true })) return;
        setStatus('Deleting font…');
        try {
          const response = await fetch('/api/sites/' + encodeURIComponent(STATE.siteId) + '/fonts/' + encodeURIComponent(deleteId), {
            method: 'DELETE',
          });
          if (!response.ok) {
            setStatus('Delete failed: ' + response.statusText);
            return;
          }
          setStatus('Font deleted.');
          await fetchFonts();
        } catch (err) {
          setStatus('Network error: ' + (err && err.message ? err.message : String(err)));
        }
      }
    });
  }

  fetchFonts();
})();
`;
}
