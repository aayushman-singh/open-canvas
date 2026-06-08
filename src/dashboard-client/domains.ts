// src/dashboard-client/domains.ts
//
// ADR 0021 — custom-domains page client. Migrated from the inline
// `clientScript(siteId)` IIFE in `src/routes/dashboard/domains.tsx`.
// DOM contract preserved (`form.add-domain`, `.form-error`,
// `.drow[data-domain-id]`, `[data-action="delete"]`); API contract
// preserved (POST `/api/sites/:siteId/domains`, DELETE
// `/api/sites/:siteId/domains/:hostname`).
//
// Per-request `siteId` is read off the boot blob
// (`window.__opencanvasDashboardBoot.siteId`) — the first dashboard
// migration to carry a per-route key on the boot blob. Mount fails loud
// if the key is missing rather than silently no-op'ing.
//
// Exported as `mountDomains(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.
//
// `window.__opencanvasModal` is registered by the dashboard shell
// (`src/routes/dashboard/shell.tsx` → `opencanvasModalScript`), so it
// is guaranteed to be present by the time this deferred bundle runs.
// The narrow ambient declaration below describes the subset we touch.

interface OpencanvasModalConfirmOpts {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface OpencanvasModalGlobal {
  confirm(msg: string, opts?: OpencanvasModalConfirmOpts): Promise<boolean>;
  // `alert` is part of the shared dashboard modal global registered by
  // `src/ui/opencanvas-modal-script.ts`. The domains client does not
  // call it, but `version-timeline.ts` merges the same `Window` shape
  // and requires the methods on the ambient match — so the declaration
  // lists every method the shell actually exposes.
  alert(msg: string, title?: string): Promise<void>;
}

declare global {
  interface Window {
    __opencanvasModal: OpencanvasModalGlobal;
  }
}

function readSiteId(): string {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot || boot.route !== 'domains') {
    throw new Error(
      '[dashboard-client/domains] boot blob missing or wrong route — expected { route: "domains", siteId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/domains] boot blob missing siteId — domains client cannot wire DOM',
    );
  }
  return boot.siteId;
}

function wireAddDomainForm(siteId: string, showError: (msg: string) => void): void {
  const form = document.querySelector<HTMLFormElement>('form.add-domain');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = form.querySelector<HTMLInputElement>('input[name="hostname"]');
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const hostname = (input && input.value ? input.value : '').trim();
    void (async (): Promise<void> => {
    if (!hostname) {
      showError('Hostname is required');
      return;
    }
    showError('');
    if (button) button.disabled = true;
    try {
      const response = await fetch(
        '/api/sites/' + encodeURIComponent(siteId) + '/domains',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ hostname }),
        },
      );
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as { error?: string };
          if (body && body.error) detail = body.error;
        } catch {
          /* noop — server returned non-JSON; fall back to statusText */
        }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      location.reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showError('Network error: ' + msg);
      if (button) button.disabled = false;
    }
    })();
  });
}

function wireRemoveDomainButtons(
  siteId: string,
  showError: (msg: string) => void,
): void {
  const rows = document.querySelectorAll<HTMLElement>('.drow[data-domain-id]');
  rows.forEach((card) => {
    const removeBtn = card.querySelector<HTMLButtonElement>(
      'button[data-action="delete"]',
    );
    if (!removeBtn) return;
    removeBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
      const hostname = card.getAttribute('data-hostname');
      if (!hostname) return;
      const ok = await window.__opencanvasModal.confirm(
        'Remove ' + hostname + '? This cannot be undone.',
        { title: 'Remove domain', confirmLabel: 'Remove', danger: true },
      );
      if (!ok) return;
      removeBtn.disabled = true;
      try {
        const response = await fetch(
          '/api/sites/' +
            encodeURIComponent(siteId) +
            '/domains/' +
            encodeURIComponent(hostname),
          { method: 'DELETE', headers: { accept: 'application/json' } },
        );
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = (await response.json()) as { error?: string };
            if (body && body.error) detail = body.error;
          } catch {
            /* noop — server returned non-JSON; fall back to statusText */
          }
          showError('Could not remove: ' + detail);
          removeBtn.disabled = false;
          return;
        }
        location.reload();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showError('Network error: ' + msg);
        removeBtn.disabled = false;
      }
      })();
    });
  });
}

export function mountDomains(): void {
  const siteId = readSiteId();
  const errorEl = document.querySelector<HTMLElement>('.form-error');
  const showError = (msg: string): void => {
    if (errorEl) errorEl.textContent = msg;
  };

  wireAddDomainForm(siteId, showError);
  wireRemoveDomainButtons(siteId, showError);
}
