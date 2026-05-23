// src/themes/panel.tsx
//
// Wave 2 #10 — Theme panel that sits in the editor sidebar. Pure JSX (Hono
// JSX). The panel renders three control groups (colour, typography, surface)
// against either the active built-in preset (read-only) or the Owner's
// `customStyleKit` (editable). The "Edit colours" button promotes the active
// built-in into the custom slot so the Owner can start from a familiar base.
// A "Reset to built-in" button flips `styleKit` back to a chosen built-in
// and clears `customStyleKit` from the wire payload.
//
// Why pure JSX, no client framework: the editor surface is composed via
// Hono's `c.html(<...>)` pattern. The panel ships an inline client script
// (`themePanelClientScript`) that wires the form to the route in
// `src/themes/route.ts`. There is no React / Solid / etc.
//
// What the panel does NOT do:
//   - Render the canvas preview itself. The wrapping editor mounts the
//     panel next to its existing preview frame; the preview re-fetches the
//     site state after the PUT lands. This is per the plan — the editor
//     surface is owned by a different file and we don't touch it.
//   - Custom fonts. Wave 5 #12 handles those; here we surface a fixed list
//     of safe system / popular Google font stacks.

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
// Curated type-pair list. Phase 0's plan says "hardcoded list of safe system
// stack + Inter + Spectral" pending #12; this expands that to seven pairs
// the Owner can switch between without uploading custom files.
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
// Panel CSS. Scoped under `[data-rev01-theme-panel]` to keep the editor
// chrome's namespace clean. Consumed via a `<style>` block emitted by the
// panel's container so this file stays self-contained.
// --------------------------------------------------------------------------

export const THEME_PANEL_STYLES: string = `
  [data-rev01-theme-panel] {
    display: grid;
    gap: 16px;
    padding: 16px;
    color: var(--text, #e8efff);
    background: var(--panel, #11203f);
    border: 1px solid var(--line, rgba(255,255,255,0.08));
    border-radius: 10px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  [data-rev01-theme-panel] h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  [data-rev01-theme-panel] h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted, #8da3c8);
  }
  [data-rev01-theme-panel] .rev01-theme-row {
    display: grid;
    gap: 8px;
  }
  [data-rev01-theme-panel] .rev01-theme-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  [data-rev01-theme-panel] label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted, #8da3c8);
  }
  [data-rev01-theme-panel] input[type="color"] {
    width: 100%;
    height: 32px;
    padding: 0;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
    background: transparent;
  }
  [data-rev01-theme-panel] input[type="text"],
  [data-rev01-theme-panel] select {
    padding: 8px 10px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
    background: var(--bg, #0b1530);
    color: var(--text, #e8efff);
    font-size: 13px;
  }
  [data-rev01-theme-panel] .rev01-theme-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  [data-rev01-theme-panel] button {
    padding: 9px 14px;
    border-radius: 6px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    background: var(--accent, #5b8def);
    color: var(--accentText, #0b1530);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  [data-rev01-theme-panel] button[data-variant="ghost"] {
    background: transparent;
    color: var(--text, #e8efff);
  }
  [data-rev01-theme-panel] button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
  [data-rev01-theme-panel] .rev01-theme-warnings {
    display: grid;
    gap: 8px;
    padding: 12px;
    border: 1px solid rgba(248, 113, 113, 0.4);
    border-radius: 8px;
    background: rgba(248, 113, 113, 0.08);
    color: #fca5a5;
    font-size: 12px;
  }
  [data-rev01-theme-panel] .rev01-theme-warnings strong {
    color: #fee2e2;
  }
  [data-rev01-theme-panel] .rev01-theme-status {
    font-size: 12px;
    color: var(--muted, #8da3c8);
    min-height: 16px;
  }
  [data-rev01-theme-panel] .rev01-theme-preview {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--line, rgba(255,255,255,0.12));
    border-radius: 6px;
  }
  [data-rev01-theme-panel] .rev01-theme-preview .swatch {
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
  /** Current `styleKit` selector value from `CanvasSiteState`. */
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
    <section data-rev01-theme-panel data-active-kit={props.activeStyleKit}>
      <h2>Theme</h2>
      <p class="rev01-theme-status" data-rev01-theme-status>
        {editing
          ? 'Editing a custom theme. Save to apply, or reset to a built-in kit.'
          : `Built-in kit: ${props.activeStyleKit}. Edit colours to author a custom theme.`}
      </p>

      <ResetGroup activeStyleKit={props.activeStyleKit} />

      <form
        class="rev01-theme-form"
        data-rev01-theme-form
        method="post"
        action={`/api/sites/${escapeAttribute(props.siteId)}/custom-theme`}
      >
        <ColorGroup preset={props.activePreset} />
        <TypePairGroup preset={props.activePreset} />
        <SurfaceTreatmentGroup preset={props.activePreset} />

        {warnings.length > 0 ? <WarningsPanel warnings={warnings} /> : null}

        <div class="rev01-theme-actions">
          <button type="submit">Save custom theme</button>
          <button type="button" data-variant="ghost" data-rev01-theme-promote>
            Start from this kit
          </button>
        </div>
      </form>

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
    <div class="rev01-theme-row">
      <h3>Colour</h3>
      <div class="rev01-theme-grid">
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
        data-rev01-theme-picker={name}
      />
      <input
        type="text"
        name={name}
        value={value}
        data-rev01-theme-hex={name}
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
    <div class="rev01-theme-row">
      <h3>Typography</h3>
      <label>
        <span>Display + body pair</span>
        <select name="typePairId" data-rev01-theme-type-pair>
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
    <div class="rev01-theme-row">
      <h3>Surface</h3>
      <label>
        <span>Treatment</span>
        <select name="surfaceTreatmentId" data-rev01-theme-surface>
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
    <div class="rev01-theme-row">
      <h3>Reset</h3>
      <label>
        <span>Pick a built-in kit</span>
        <select data-rev01-theme-reset-target>
          {BUILT_IN_STYLE_KITS.map((kit) => (
            <option value={kit} selected={kit === activeStyleKit}>
              {kit}
            </option>
          ))}
        </select>
      </label>
      <div class="rev01-theme-actions">
        <button type="button" data-variant="ghost" data-rev01-theme-reset>
          Reset to built-in
        </button>
      </div>
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: ContrastWarning[] }) {
  return (
    <div class="rev01-theme-warnings" role="status" aria-live="polite">
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
  const root = document.querySelector('[data-rev01-theme-panel]');
  if (!root) return;
  const form = root.querySelector('[data-rev01-theme-form]');
  const status = root.querySelector('[data-rev01-theme-status]');
  function setStatus(msg) { if (status) status.textContent = msg; }
  // Mirror colour picker ↔ hex text input. Either side updates the other.
  root.querySelectorAll('[data-rev01-theme-picker]').forEach((picker) => {
    const name = picker.getAttribute('data-rev01-theme-picker');
    if (!name) return;
    const hex = root.querySelector('[data-rev01-theme-hex="' + name + '"]');
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
      const hex = root.querySelector('[data-rev01-theme-hex="' + name + '"]');
      if (hex) kit[name] = hex.value.trim();
    });
    const typePairSel = root.querySelector('[data-rev01-theme-type-pair]');
    if (typePairSel) {
      const choice = STATE.typePairs.find((p) => p.id === typePairSel.value);
      if (choice) {
        kit.fontFamilyDisplay = choice.display;
        kit.fontFamilyBody = choice.body;
      }
    }
    const surfaceSel = root.querySelector('[data-rev01-theme-surface]');
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
  const promote = root.querySelector('[data-rev01-theme-promote]');
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
  const reset = root.querySelector('[data-rev01-theme-reset]');
  if (reset) {
    reset.addEventListener('click', async () => {
      const target = root.querySelector('[data-rev01-theme-reset-target]');
      const builtIn = target ? target.value : 'charcoal';
      if (!confirm('Reset to built-in kit "' + builtIn + '"? Your custom theme will be discarded.')) return;
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
// Pure helpers re-exported so the route + smoke can share them.
// --------------------------------------------------------------------------

export {
  findActiveTypePairId,
  findActiveSurfaceTreatmentId,
};

// Type re-exports so consumers of the panel don't have to import from schema
// directly when wiring it up.
export type { ActionVariant, MotionPreset, SurfaceVariant };
