// src/dashboard-client/site-addons.ts
//
// ADR 0021 — per-site add-ons page client. Migrated from the inline
// `clientScript(siteId)` IIFE in `src/routes/dashboard/site-addons.tsx`.
// DOM contract preserved (`[data-addon-form]`, `[name="enabled"]`,
// `[data-config-key]`, `[data-save]`, `.addon-msg`, `.field-hint`);
// API contract preserved (PUT `/api/addons/sites/:siteId/:addonId`).
//
// Per-request `siteId` is read off the boot blob
// (`window.__opencanvasDashboardBoot.siteId`) — same pattern as the
// domains + version-timeline mount modules. Mount fails loud if the key
// is missing rather than silently no-op'ing.
//
// Exported as `mountSiteAddons(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.
//
// Validation posture matches the original inline script exactly: the
// server only validates patterns when `enabled` is true (addons.ts:205),
// so the client mirrors that — disabling an add-on with stale config
// still saves so the Owner can clear bad values later.

function readSiteId(): string {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot || boot.route !== 'site-addons') {
    throw new Error(
      '[dashboard-client/site-addons] boot blob missing or wrong route — expected { route: "site-addons", siteId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/site-addons] boot blob missing siteId — site-addons client cannot wire DOM',
    );
  }
  return boot.siteId;
}

interface SaveResponseBody {
  error?: string;
  field?: string;
  hint?: string;
}

function wireAddonForm(form: HTMLFormElement, siteId: string): void {
  const addonId = form.getAttribute('data-addon-form');
  const msgEl = form.querySelector<HTMLElement>('.addon-msg');
  const saveBtn = form.querySelector<HTMLButtonElement>('[data-save]');
  if (!saveBtn) return;

  saveBtn.addEventListener('click', (event: MouseEvent) => {
    // Save is type="button" so the form's submit event never fires and
    // the browser never auto-validates. We resolve the form via
    // closest('form') from the click target (more robust than the
    // closure's form ref — survives any future DOM reshuffle) and run
    // reportValidity() ourselves before the PUT. reportValidity returns
    // true when every field passes its pattern/required check, false
    // otherwise — and in the false branch it also pops the browser's
    // native tooltip on the offending input.
    const target = event.currentTarget;
    let formEl: HTMLFormElement = form;
    if (target instanceof HTMLElement) {
      const resolved = target.closest('form');
      if (resolved instanceof HTMLFormElement) formEl = resolved;
    }

    const enabledEl = formEl.querySelector<HTMLInputElement>('[name="enabled"]');
    const enabled = enabledEl ? enabledEl.checked : false;
    const config: Record<string, string> = {};
    formEl.querySelectorAll<HTMLInputElement>('[data-config-key]').forEach((input) => {
      const key = input.getAttribute('data-config-key');
      if (key) config[key] = input.value.trim();
    });

    // Server only validates patterns when enabled (addons.ts:205) — we
    // mirror that so disabling an addon with stale config in its inputs
    // still works (the Owner can clear bad values later).
    if (enabled) {
      if (!formEl.reportValidity()) {
        if (msgEl) {
          msgEl.textContent = 'Fix the highlighted field before saving.';
          msgEl.className = 'addon-msg msg-err';
        }
        return;
      }
      // Belt-and-suspenders manual pass for required + pattern. Catches
      // empty values (HTML5 pattern treats empty as valid unless the
      // input also carries required, which configFields don't) and
      // surfaces the field's patternHint inline.
      const inputs = formEl.querySelectorAll<HTMLInputElement>('[data-config-key]');
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i]!;
        const pattern = input.getAttribute('pattern');
        if (!pattern) continue;
        const value = input.value.trim();
        if (value.length === 0 || !new RegExp('^(?:' + pattern + ')$').test(value)) {
          const parent = input.parentNode;
          const hintBlock = parent ? parent.querySelector<HTMLElement>('.field-hint') : null;
          const hint = hintBlock
            ? (hintBlock.textContent ?? 'Value does not match required format')
            : 'Value does not match required format';
          if (msgEl) {
            msgEl.textContent = hint;
            msgEl.className = 'addon-msg msg-err';
          }
          input.focus();
          return;
        }
      }
    }

    saveBtn.disabled = true;
    const prev = saveBtn.textContent;
    saveBtn.textContent = 'Saving...';
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.className = 'addon-msg';
    }

    fetch('/api/addons/sites/' + siteId + '/' + addonId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, config }),
    })
      .then((r) => r.json().then((d: SaveResponseBody) => ({ ok: r.ok, data: d })))
      .then((result) => {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (!result.ok) {
          // Server returns { error, field?, hint? } on validation rejection.
          // Surface the hint both in the toast AND inline (replace the
          // static field-hint text) and focus the offending input so the
          // Owner can fix without scrolling back through the form.
          const serverError = result.data && result.data.error ? result.data.error : 'Save failed';
          const serverHint = result.data && result.data.hint ? result.data.hint : null;
          const serverField = result.data && result.data.field ? result.data.field : null;
          if (serverField) {
            const fieldInput = formEl.querySelector<HTMLInputElement>(
              '[data-config-key="' + serverField + '"]',
            );
            if (fieldInput) {
              fieldInput.focus();
              if (serverHint && fieldInput.parentNode) {
                const parent = fieldInput.parentNode;
                const inlineHint = parent.querySelector<HTMLElement>('.field-hint');
                if (inlineHint) {
                  inlineHint.textContent = serverHint;
                  inlineHint.className = 'field-hint field-hint-err';
                }
              }
            }
          }
          throw new Error(serverHint || serverError);
        }
        if (msgEl) {
          msgEl.textContent = 'Saved. Changes are live on your published site.';
          msgEl.className = 'addon-msg msg-ok';
        }
      })
      .catch((err: unknown) => {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (msgEl) {
          const message = err instanceof Error ? err.message : String(err);
          msgEl.textContent = message;
          msgEl.className = 'addon-msg msg-err';
        }
      });
  });
}

export function mountSiteAddons(): void {
  const siteId = readSiteId();
  document
    .querySelectorAll<HTMLFormElement>('[data-addon-form]')
    .forEach((form) => wireAddonForm(form, siteId));
}
