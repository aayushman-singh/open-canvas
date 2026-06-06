// src/editor-client/inspector-icon-picker.ts
//
// Visual grid picker for InspectorSpec `kind: 'icon'` fields. One tile per
// entry in the icon registry (src/canvas/icons.ts) plus a "None" tile that
// clears the field. Used by both ActionElement.iconKind and the iconKind
// on ShapeElement variant 'icon'.
//
// The free-text input it replaces required owners to memorise the slug list
// from the placeholder and offered no visual preview — the deployed render
// would show an arrow, the inspector would show the string "arrow-up-right".
// The grid renders the same `<svg>` markup the canvas paints, so what you
// pick is what you ship.

import type { EditorContext } from './editor-context.js';
import type { IconField } from '../canvas/elements/inspector-spec.js';
import type { CanvasElement } from '../canvas/schema.js';
import { field } from './dom-builders.js';

type ElementRecord = Record<string, unknown> & { id: string };

export function renderIconField(ctx: EditorContext, f: IconField, element: CanvasElement): void {
  if (!ctx.inspector) return;
  const elementByPath = element as unknown as ElementRecord;

  // Conditional rendering: skip the field entirely when the element's
  // discriminator doesn't match (Shape's iconKind only matters when
  // variant === 'icon'). Matches the schema's "ignored otherwise" semantics
  // without forcing the spec to add a separate conditional kind.
  if (f.showWhen !== undefined) {
    const current = elementByPath[f.showWhen.path];
    if (current !== f.showWhen.equals) return;
  }

  const iconNames = Object.keys(ctx.ICON_SVG_MAP).sort();

  const grid = document.createElement('div');
  grid.className = 'icon-picker';
  // Inline styles instead of a stylesheet rule so the picker carries its own
  // chrome — the editor's CSS is canvas-styles.ts and adding a one-off
  // selector there bloats the file every editor surface ships.
  grid.style.cssText =
    'display:grid;grid-template-columns:repeat(7, 1fr);gap:6px;' +
    'padding:6px;background:var(--opencanvas-bg-panel-strong,#f4f1ec);' +
    'border:1px solid var(--opencanvas-hairline,#dcd6cb);border-radius:8px;';

  function paint(): void {
    const currentValue = elementByPath[f.path];
    for (let i = 0; i < grid.children.length; i++) {
      const child = grid.children[i];
      if (!(child instanceof HTMLButtonElement)) continue;
      const slug = child.getAttribute('data-icon-slug');
      const isActive =
        (slug === null && (currentValue === undefined || currentValue === '')) ||
        slug === currentValue;
      child.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      child.style.background = isActive
        ? 'var(--opencanvas-accent,#d83a52)'
        : 'var(--opencanvas-bg-panel,#fff)';
      child.style.color = isActive ? '#fff' : 'var(--opencanvas-fg,#1a1917)';
      child.style.borderColor = isActive
        ? 'var(--opencanvas-accent,#d83a52)'
        : 'var(--opencanvas-hairline,#dcd6cb)';
    }
  }

  function makeTile(slug: string | null, innerSvg: string, title: string): HTMLButtonElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.title = title;
    tile.setAttribute('aria-label', title);
    if (slug !== null) tile.setAttribute('data-icon-slug', slug);
    tile.style.cssText =
      'appearance:none;cursor:pointer;aspect-ratio:1/1;display:flex;' +
      'align-items:center;justify-content:center;border:1.5px solid transparent;' +
      'border-radius:6px;padding:4px;transition:background-color .12s,border-color .12s,color .12s;';
    tile.innerHTML = innerSvg;
    tile.addEventListener('click', () => {
      if (slug === null) {
        // "None" click. Both consumers need state-consistent removal:
        //   - Shape with variant='icon': iconKind is required while variant
        //     stays 'icon'. Flip variant to 'rect' and drop iconKind together
        //     so the saved state doesn't violate the icon-requires-iconKind
        //     contract. The showWhen guard will hide the picker after the
        //     next inspector render.
        //   - Action with empty label: removing the icon would leave the
        //     button with nothing visible. Refuse and surface a status so the
        //     Owner adds a label before going icon-less.
        if (element.type === 'shape') {
          elementByPath.variant = 'rect';
          delete elementByPath.iconKind;
          paint();
          ctx.rebuildElement(element.id);
          ctx.renderInspector();
          ctx.scheduleSave();
          return;
        }
        if (element.type === 'action') {
          const label = (element as { label?: { text?: unknown }[] }).label;
          const concat = Array.isArray(label)
            ? label
                .map((r) => (r && typeof r.text === 'string' ? r.text : ''))
                .join('')
            : '';
          if (concat.length === 0) {
            ctx.setStatus('Add a label first — an icon-less action needs visible text.', 'error');
            return;
          }
        }
        delete elementByPath[f.path];
      } else {
        elementByPath[f.path] = slug;
      }
      paint();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    return tile;
  }

  // "None" tile: SVG of a circle-with-slash so the action reads visually
  // even at the same 24×24 footprint as the other tiles.
  const noneSvg =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><line x1="5" y1="5" x2="19" y2="19"/></svg>';
  grid.appendChild(makeTile(null, noneSvg, 'No icon'));

  for (let i = 0; i < iconNames.length; i++) {
    const slug = iconNames[i];
    if (slug === undefined) continue;
    const innerSvg = ctx.ICON_SVG_MAP[slug];
    if (innerSvg === undefined) continue;
    grid.appendChild(makeTile(slug, innerSvg, slug));
  }

  paint();
  ctx.inspector.appendChild(field(f.label, grid));
}
