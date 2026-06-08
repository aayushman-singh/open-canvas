// src/dashboard-client/version-timeline.ts
//
// ADR 0021 — version-timeline page client. Migrated from the inline
// IIFE in `src/routes/dashboard/version-timeline.tsx`. DOM contract
// preserved (`[data-timeline-preview]`, `[data-timeline-list]`,
// `[data-timeline-entry]`, `[data-timeline-label]`,
// `[data-timeline-action="preview" | "restore"]`, `[data-timeline-form]`);
// API contract preserved (POST `/api/sites/:siteId/snapshots`, GET
// `/api/sites/:siteId/snapshots/:id/preview`, POST
// `/api/sites/:siteId/snapshots/:id/restore`).
//
// Per-request `siteId` is read off the boot blob
// (`window.__opencanvasDashboardBoot.siteId`) — same pattern as the
// domains mount module. Mount fails loud if the key is missing rather
// than silently no-op'ing.
//
// Exported as `mountVersionTimeline(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.
//
// `window.__opencanvasModal` is registered by the dashboard shell
// (`src/routes/dashboard/shell.tsx` → `opencanvasModalScript`), so it
// is guaranteed to be present by the time this deferred bundle runs.
// Calls into the global are unconditional — if it is missing at runtime
// the resulting TypeError is the loud-failure mode we want, matching the
// original inline script's posture.

// The dashboard shell (`src/ui/opencanvas-modal-script.ts`) registers
// `window.__opencanvasModal` with `confirm` + `alert` methods (plus
// `prompt`, which neither dashboard mount needs). `domains.ts` already
// augments `Window.__opencanvasModal` with the matching shape for the
// dashboard-client TS project; we redeclare the identical shape here
// so TS interface-merging accepts the cross-file augmentation.

interface OpencanvasModalConfirmOpts {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface OpencanvasModalGlobal {
  confirm(msg: string, opts?: OpencanvasModalConfirmOpts): Promise<boolean>;
  alert(msg: string, title?: string): Promise<void>;
}

declare global {
  interface Window {
    __opencanvasModal: OpencanvasModalGlobal;
  }
}

function readSiteId(): string {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot || boot.route !== 'version-timeline') {
    throw new Error(
      '[dashboard-client/version-timeline] boot blob missing or wrong route — expected { route: "version-timeline", siteId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/version-timeline] boot blob missing siteId — version-timeline client cannot wire DOM',
    );
  }
  return boot.siteId;
}

interface PreviewResponse {
  html: string;
}

export function mountVersionTimeline(): void {
  const siteId = readSiteId();
  const apiBase = `/api/sites/${siteId}/snapshots`;

  const preview = document.querySelector<HTMLElement>('[data-timeline-preview]');
  const list = document.querySelector<HTMLElement>('[data-timeline-list]');

  function setActive(id: string): void {
    if (!list) return;
    list.querySelectorAll<HTMLElement>('[data-timeline-entry]').forEach((el) => {
      el.classList.toggle('is-active', el.getAttribute('data-timeline-entry') === id);
    });
  }

  async function doPreview(id: string): Promise<void> {
    if (!preview) return;
    preview.innerHTML = '<h2>Preview</h2><p class="empty-preview">Loading…</p>';
    const res = await fetch(apiBase + '/' + encodeURIComponent(id) + '/preview', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      const errP = document.createElement('p');
      errP.className = 'empty-preview';
      errP.textContent = 'Preview failed: ' + body;
      preview.innerHTML = '<h2>Preview</h2>';
      preview.appendChild(errP);
      return;
    }
    const data = (await res.json()) as PreviewResponse;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.setAttribute(
      'srcdoc',
      '<!doctype html><html><body>' + data.html + '</body></html>',
    );
    preview.innerHTML = '<h2>Preview</h2>';
    preview.appendChild(frame);
    setActive(id);
  }

  async function doRestore(id: string, label: string): Promise<void> {
    if (
      !(await window.__opencanvasModal.confirm(
        'Restore "' +
          label +
          '"? This overwrites your current edits. A safety snapshot of your current state will be saved automatically.',
        { title: 'Restore version' },
      ))
    ) {
      return;
    }
    const res = await fetch(apiBase + '/' + encodeURIComponent(id) + '/restore', {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text();
      window.__opencanvasModal.alert('Restore failed: ' + body, 'Error');
      return;
    }
    window.location.reload();
  }

  async function doManualCapture(form: HTMLFormElement): Promise<void> {
    const label = String(new FormData(form).get('label') ?? '').trim();
    if (label.length === 0) {
      window.__opencanvasModal.alert('Label is required.', 'Missing label');
      return;
    }
    const res = await fetch(apiBase, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const body = await res.text();
      window.__opencanvasModal.alert('Capture failed: ' + body, 'Error');
      return;
    }
    window.location.reload();
  }

  if (list) {
    list.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const actionTarget = target.closest<HTMLElement>('[data-timeline-action]');
      if (!actionTarget) return;
      const action = actionTarget.getAttribute('data-timeline-action');
      if (!action) return;
      const entry = actionTarget.closest<HTMLElement>('[data-timeline-entry]');
      if (!entry) return;
      const id = entry.getAttribute('data-timeline-entry') ?? '';
      const label = entry.getAttribute('data-timeline-label') ?? '';
      if (action === 'preview') doPreview(id);
      if (action === 'restore') doRestore(id, label);
    });
  }

  const form = document.querySelector<HTMLFormElement>('[data-timeline-form]');
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      doManualCapture(form);
    });
  }
}
