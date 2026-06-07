// src/dashboard-client/addon-shop.ts
//
// ADR 0021 — add-on shop page client. Migrated from the inline
// `clientScript()` IIFE in `src/routes/dashboard/addon-shop.tsx`. DOM
// contract preserved (`[data-acquire]`, `[data-addon-config]`,
// `[data-site-select]`, `[data-addon-enable]`, `[data-config-key]`,
// `[data-save]`, `#addon-state`); API contract preserved (POST
// `/api/addons/:id/acquire`, PUT `/api/addons/sites/:siteId/:addonId`).
//
// State seed (`stateByAddon[addonId][siteId] = { enabled, config }`)
// still ships as a JSON `<script type="application/json" id="addon-state">`
// element on the page — no boot-blob data is needed.
//
// Exported as `mountAddonShop(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

interface SiteAddonState {
  enabled: boolean;
  config: Record<string, string>;
}

type StateByAddon = Record<string, Record<string, SiteAddonState>>;

function parseState(): StateByAddon {
  const stateNode = document.getElementById('addon-state');
  if (!stateNode) return {};
  try {
    const parsed: unknown = JSON.parse(stateNode.textContent ?? '{}');
    if (parsed && typeof parsed === 'object') {
      return parsed as StateByAddon;
    }
    return {};
  } catch {
    return {};
  }
}

function loadSite(
  form: HTMLElement,
  addonId: string,
  siteId: string,
  stateByAddon: StateByAddon,
): void {
  const stateForAddon = stateByAddon[addonId] ?? {};
  const s: SiteAddonState = stateForAddon[siteId] ?? { enabled: false, config: {} };

  const toggle = form.querySelector<HTMLInputElement>('[data-addon-enable]');
  if (toggle) toggle.checked = Boolean(s.enabled);

  const inputs = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    '[data-config-key]',
  );
  inputs.forEach((input) => {
    const key = input.getAttribute('data-config-key');
    if (!key) return;
    const value = s.config && s.config[key] !== undefined ? s.config[key] : '';
    input.value = value;
  });

  const msg = form.querySelector<HTMLElement>('.addon-msg');
  if (msg) {
    msg.textContent = '';
    msg.className = 'addon-msg';
  }
}

function wireAcquireFlow(): void {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest<HTMLButtonElement>('[data-acquire]');
    if (!btn) return;

    const addonId = btn.getAttribute('data-acquire');
    if (!addonId) return;

    btn.disabled = true;
    const prev = btn.textContent ?? '';
    btn.textContent = 'Acquiring...';

    fetch(`/api/addons/${addonId}/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then((response) =>
        response.json().then((body: { error?: string }) => ({ ok: response.ok, body })),
      )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.body.error ?? 'Failed');
        }
        location.reload();
      })
      .catch(() => {
        btn.textContent = `${prev} — retry`;
        btn.disabled = false;
      });
  });
}

function wireConfigForm(
  form: HTMLElement,
  addonId: string,
  stateByAddon: StateByAddon,
): void {
  const siteSelect = form.querySelector<HTMLSelectElement>('[data-site-select]');
  const saveBtn = form.querySelector<HTMLButtonElement>('[data-save]');
  const msg = form.querySelector<HTMLElement>('.addon-msg');
  if (!siteSelect || !saveBtn) return;

  // Prime the form with the first site's state.
  loadSite(form, addonId, siteSelect.value, stateByAddon);

  siteSelect.addEventListener('change', () => {
    loadSite(form, addonId, siteSelect.value, stateByAddon);
  });

  saveBtn.addEventListener('click', () => {
    const siteId = siteSelect.value;
    const enabledEl = form.querySelector<HTMLInputElement>('[data-addon-enable]');
    const enabled = enabledEl ? enabledEl.checked : false;

    const config: Record<string, string> = {};
    const configInputs = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '[data-config-key]',
    );
    configInputs.forEach((input) => {
      const key = input.getAttribute('data-config-key');
      if (!key) return;
      config[key] = input.value.trim();
    });

    // Client-side pattern validation (mirrors addons.ts server-side check).
    // When the toggle is enabled, every input carrying a [pattern] attribute
    // must match before we PUT to /api/addons/...; we surface the field's
    // .field-hint as the error message so the failure is self-explanatory.
    if (enabled) {
      for (let i = 0; i < configInputs.length; i++) {
        const input = configInputs[i];
        if (!input) continue;
        const pattern = input.getAttribute('pattern');
        if (!pattern) continue;
        const value = input.value.trim();
        if (value.length === 0 || !new RegExp(`^(?:${pattern})$`).test(value)) {
          if (msg) {
            const parent = input.parentNode instanceof Element ? input.parentNode : null;
            const hintBlock = parent
              ? parent.querySelector<HTMLElement>('.field-hint')
              : null;
            const hint = hintBlock
              ? hintBlock.textContent ?? 'Value does not match required format'
              : 'Value does not match required format';
            msg.textContent = hint;
            msg.className = 'addon-msg addon-msg-err';
          }
          input.focus();
          return;
        }
      }
    }

    saveBtn.disabled = true;
    const prev = saveBtn.textContent ?? '';
    saveBtn.textContent = 'Saving...';
    if (msg) {
      msg.textContent = '';
      msg.className = 'addon-msg';
    }

    fetch(`/api/addons/sites/${siteId}/${addonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, config }),
    })
      .then((response) =>
        response.json().then((body: { error?: string }) => ({ ok: response.ok, body })),
      )
      .then((result) => {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (!result.ok) {
          throw new Error(result.body.error ?? 'Save failed');
        }
        if (msg) {
          msg.textContent = 'Saved. Live on your published site.';
          msg.className = 'addon-msg addon-msg-ok';
        }
        // Refresh the in-memory state so the user's next site-switch
        // reflects what they just saved instead of resetting to the
        // server-rendered baseline.
        if (!stateByAddon[addonId]) stateByAddon[addonId] = {};
        stateByAddon[addonId][siteId] = { enabled, config };
      })
      .catch((err: unknown) => {
        saveBtn.disabled = false;
        saveBtn.textContent = prev;
        if (msg) {
          msg.textContent = err instanceof Error ? err.message : 'Save failed';
          msg.className = 'addon-msg addon-msg-err';
        }
      });
  });
}

export function mountAddonShop(): void {
  // -- Acquire flow (unowned addons) --------------------------------------
  wireAcquireFlow();

  // -- Per-site config form (owned addons) --------------------------------
  // Embedded state shape:
  //   stateByAddon[addonId][siteId] = { enabled: bool, config: { key: value } }
  // The site selector switches the form to whichever site's saved state.
  const stateNode = document.getElementById('addon-state');
  if (!stateNode) return;
  const stateByAddon = parseState();

  const forms = document.querySelectorAll<HTMLElement>('[data-addon-config]');
  forms.forEach((form) => {
    const addonId = form.getAttribute('data-addon-config');
    if (!addonId) return;
    wireConfigForm(form, addonId, stateByAddon);
  });
}
