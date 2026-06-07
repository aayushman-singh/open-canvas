// src/editor-client/inspector-action-href.ts
//
// ADR 0058 Phase 2q.e — purpose-built editor for the ActionHref DU.
// canvas-client.ts:4655-4735 carries the inline twin; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// One renderer:
//   - renderActionHrefField: walks the action-href InspectorSpec field into
//     a discriminator <select> (External URL | Page link) plus a value
//     container that re-renders on every discriminator switch. The
//     external branch validates the URL against ctx.isAllowedHref()
//     equivalent (imported from ./href-utils.js) and surfaces a
//     ctx.setStatus error tone on rejection without mutating the DU. The
//     page branch enumerates state.pages and writes
//     { type: 'page', pageId } on selection. Action elements clear
//     element.behavior when href is rewritten — the spec carries that
//     discriminator-shape constraint, so the renderer enforces it here.
//
// The spec carries the labels + path; this function owns knowledge of the
// DU shape (external | page), the URL allowlist (isAllowedHref), and the
// page-source registry (state.pages). When the discriminator changes, the
// value field is rebuilt and the entire DU at element[f.path] is replaced
// with a fresh shape — same behaviour the legacy buildActionInspector had.

import type {
  DomContext,
  PersistContext,
  RenderContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import type { ActionHrefField } from '../canvas/elements/inspector-spec.js';
import type { ActionElement, ActionHref } from '../canvas/elements/action.js';
import { field } from './dom-builders.js';
import { isAllowedHref } from './href-utils.js';

// ADR 0064 — the renderer reads five named clusters: the inspector DOM
// mount (DomContext), the loaded site for page enumeration (StateContext),
// the per-element re-render verb (RenderContext), the save debounce
// (PersistContext), and the status line (StatusEmitterContext).
export type InspectorActionHrefContext = DomContext &
  StateContext &
  RenderContext &
  PersistContext &
  StatusEmitterContext;

export function renderActionHrefField(
  ctx: InspectorActionHrefContext,
  f: ActionHrefField,
  element: ActionElement,
): void {
  if (!ctx.inspector) return;
  const inspector = ctx.inspector;
  const hrefTypeSelect = document.createElement('select');
  const optExternal = document.createElement('option');
  optExternal.value = 'external';
  optExternal.textContent = 'External URL';
  hrefTypeSelect.appendChild(optExternal);
  const optPage = document.createElement('option');
  optPage.value = 'page';
  optPage.textContent = 'Page link';
  hrefTypeSelect.appendChild(optPage);
  // Index-by-path mirrors the inline twin's `element[f.path]` shape; the
  // ActionHref DU lives at the named path the spec carries (today: "href").
  const elementByPath = element as unknown as Record<string, ActionHref | undefined>;
  const currentHref = elementByPath[f.path];
  hrefTypeSelect.value = currentHref && currentHref.type ? currentHref.type : 'external';

  const hrefValueContainer = document.createElement('div');

  function setActionHref(nextHref: ActionHref): void {
    elementByPath[f.path] = nextHref;
    if (element.type === 'action' && f.path === 'href') {
      // The Action discriminator is presence-vs-absence of href/behavior;
      // rewriting href erases any prior behavior so the runtime validator
      // doesn't see both fields populated at once.
      delete (element as { behavior?: unknown }).behavior;
    }
  }

  function renderHrefValue(): void {
    hrefValueContainer.replaceChildren();
    const href = elementByPath[f.path];
    if (hrefTypeSelect.value === 'external') {
      const urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.value = href && href.type === 'external' ? href.url : '';
      urlInput.placeholder = 'https://...';
      urlInput.addEventListener('change', function () {
        if (urlInput.value.length === 0) {
          ctx.setStatus('URL can not be empty', 'error');
          return;
        }
        if (!isAllowedHref(urlInput.value)) {
          ctx.setStatus('URL not allowed', 'error');
          return;
        }
        setActionHref({ type: 'external', url: urlInput.value });
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      hrefValueContainer.appendChild(urlInput);
      return;
    }
    // page branch
    const pageSelect = document.createElement('select');
    const pages = ctx.state ? ctx.state.pages : [];
    for (let pi = 0; pi < pages.length; pi++) {
      const p = pages[pi]!;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.title + ' (/' + p.slug + ')';
      pageSelect.appendChild(opt);
    }
    if (href && href.type === 'page') {
      pageSelect.value = href.pageId;
    }
    pageSelect.addEventListener('change', function () {
      setActionHref({ type: 'page', pageId: pageSelect.value });
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    hrefValueContainer.appendChild(pageSelect);
  }

  hrefTypeSelect.addEventListener('change', function () {
    if (hrefTypeSelect.value === 'external') {
      setActionHref({ type: 'external', url: '' });
    } else {
      const pages = ctx.state ? ctx.state.pages : [];
      setActionHref({ type: 'page', pageId: pages[0] ? pages[0].id : '' });
    }
    renderHrefValue();
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });

  inspector.appendChild(field(f.discriminatorLabel, hrefTypeSelect));
  renderHrefValue();
  inspector.appendChild(field(f.valueLabel, hrefValueContainer));
}
