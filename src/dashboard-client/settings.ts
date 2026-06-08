// src/dashboard-client/settings.ts
//
// ADR 0021 — account settings page client. Migrated from the pair of
// inline IIFEs (`tabScript` + `planSwitchScript`) in
// `src/routes/dashboard/settings.tsx`. DOM contract preserved
// (`.settings-tab` / `.settings-panel` / `[data-tab]` / `[data-active]`
// for tabs; `#tab-plan .plan-switch-btn[data-plan]` for the plan picker).
// API contract preserved (PATCH `/api/profile` with `{ plan }`).
//
// Neither inline script depended on any per-request data — both reach
// for DOM hooks only — so the boot blob carries no extra keys beyond
// `route: 'settings'`. Same posture as the `profile` mount.
//
// Exported as `mountSettings(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

interface PlanSwitchResponse {
  error?: string;
}

// `window.__opencanvasModal` is registered by the dashboard shell
// (`src/ui/opencanvas-modal-script.ts`) before this bundle runs. We
// merge the shape that other dashboard-client modules already declare
// (see `domains.ts` / `version-timeline.ts`) so TypeScript's global
// `Window` augmentation stays internally consistent — the previous
// inline IIFE relied on the same global at runtime.
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

function wireTabs(): void {
  const tabs = document.querySelectorAll<HTMLElement>('.settings-tab');
  const panels = document.querySelectorAll<HTMLElement>('.settings-panel');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', 'false'));
      panels.forEach((p) => p.setAttribute('data-active', 'false'));
      tab.setAttribute('aria-selected', 'true');
      const targetId = tab.getAttribute('data-tab');
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (target) target.setAttribute('data-active', 'true');
    });
  });
}

function wirePlanSwitch(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    '#tab-plan .plan-switch-btn[data-plan]',
  );
  function alertSwitchFailure(err: unknown): unknown {
    const message =
      err instanceof Error && err.message ? err.message : 'Could not switch plan.';
    const modal = window.__opencanvasModal;
    if (!modal || typeof modal.alert !== 'function') {
      console.error('[plan-switch] modal helper unavailable', { message, error: err });
      throw new Error('plan switch modal helper unavailable');
    }
    return modal.alert(message, 'Switch plan');
  }
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const plan = btn.getAttribute('data-plan');
      if (!plan) return;
      const label = btn.textContent ?? '';
      buttons.forEach((b) => {
        b.disabled = true;
      });
      btn.textContent = 'Switching…';
      fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
        .then((r) =>
          r.json().then((d: PlanSwitchResponse) => ({ ok: r.ok, data: d })),
        )
        .then((result) => {
          if (!result.ok) throw new Error(result.data.error || 'Switch failed');
          window.location.reload();
        })
        .catch((err: unknown) => {
          buttons.forEach((b) => {
            b.disabled = false;
          });
          btn.textContent = label;
          alertSwitchFailure(err);
        });
    });
  });
}

export function mountSettings(): void {
  wireTabs();
  wirePlanSwitch();
}
