// src/dashboard-client/site-settings.ts
//
// ADR 0021 — site settings page client. Migrated from the inline
// `clientScript(siteId)` block (six IIFEs) in
// `src/routes/dashboard/site-settings.tsx`. DOM contract preserved
// (`form.pw`, `button[data-action="disable"]`, `.err`, `.ok`,
// `form.collab-form`, `ul.collab-list`, `.role-select`, `.remove-btn`,
// `.resend-btn`, `[data-collab-id]`, `[data-asset-picker="favicon"]`,
// `[data-picker-modal]`, `[data-picker-grid]`, `[data-picker-empty]`,
// `[data-picker-status]`, `[data-picker-close]`, `[data-picker-upload]`,
// `[data-picker-thumb]`, `[data-picker-meta]`, `[data-picker-choose]`,
// `[data-picker-clear]`, `[data-favicon-status]`, `[data-favicon-err]`,
// `input[data-config-key]`, `[data-toggle-state]`, `[data-theme-state]`,
// `[data-delete-trigger]`, `[data-delete-confirm-modal]`,
// `[data-delete-confirm-input]`, `[data-delete-confirm]`,
// `[data-delete-cancel]`, `[data-delete-confirm-error]`).
// API contract preserved (PUT `/api/sites/:siteId/password`,
// DELETE `/api/sites/:siteId/password`, POST `/api/sites/:siteId/collaborators`,
// DELETE / PATCH / POST resend on `/api/sites/:siteId/collaborators/:id`,
// PATCH `/api/canvas/sites/:siteId/config` (serialized through the
// shared queueConfigPatch chain), GET + POST `/api/owner/assets`,
// GET `/api/canvas/sites/:siteId/assets/:id`, DELETE `/api/sites/:siteId`).
//
// Per-request `siteId` flows in through the boot blob
// (`window.__opencanvasDashboardBoot.siteId`) — same pattern as
// `domains.ts` / `version-timeline.ts` / `site-addons.ts`. Mount throws
// loud if the key is missing rather than silently no-op'ing.
//
// CRITICAL — the shared config PATCH chain (a single Promise.resolve()
// seed shared across the favicon picker, the checkbox toggles, and the
// visitorTheme radios) must stay a single closure inside
// `mountSiteSettings` so that rapid changes across controls serialize
// correctly. The server's /config handler is read-modify-write, so two
// concurrent PATCHes load the same prior state, each apply their own
// diff, and the second write silently overwrites the first. Queueing
// here keeps each control's effect.
//
// Exported as `mountSiteSettings(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

// The dashboard shell (`src/ui/opencanvas-modal-script.ts`) registers
// `window.__opencanvasModal` with `confirm` + `alert` methods before
// this bundle runs. We declare the matching shape so TypeScript's
// `Window` augmentation stays internally consistent across the
// dashboard-client TS project (also declared in
// `settings.ts` / `domains.ts` / `version-timeline.ts`).

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
  if (!boot || boot.route !== 'site-settings') {
    throw new Error(
      '[dashboard-client/site-settings] boot blob missing or wrong route — expected { route: "site-settings", siteId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/site-settings] boot blob missing siteId — site-settings client cannot wire DOM',
    );
  }
  return boot.siteId;
}

interface AssetListItem {
  id: string;
  alt?: string;
  kind?: string;
  mediaType?: string;
}

interface AssetListResponse {
  assets?: AssetListItem[];
}

interface AssetUploadResponse {
  id?: string;
  error?: string;
}

interface CollabActionResponse {
  error?: string;
}

interface DeleteSiteResponse {
  error?: string;
}

// Shared config PATCH chain — exposed as the `queueConfigPatch` closure
// passed into every IIFE-equivalent below. Same Promise.resolve() seed
// the original inline IIFE used. Failures inside one queued patch are
// caught so the chain stays live for subsequent patches.
type SaveCallback = (response: Response) => void;
type FailedCallback = (message: string) => void;

function makeQueueConfigPatch(
  siteId: string,
): (body: Record<string, unknown>, onSaved: SaveCallback, onFailed: FailedCallback) => Promise<void> {
  let configPatchChain: Promise<void> = Promise.resolve();
  function queueConfigPatch(
    body: Record<string, unknown>,
    onSaved: SaveCallback,
    onFailed: FailedCallback,
  ): Promise<void> {
    const run = configPatchChain.then(async () => {
      try {
        const response = await fetch(
          '/api/canvas/sites/' + encodeURIComponent(siteId) + '/config',
          {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) {
          const bodyText = (await response.text()).trim();
          onFailed('Could not save: ' + (bodyText || response.statusText));
          return;
        }
        onSaved(response);
      } catch (e: unknown) {
        const msg = e instanceof Error && e.message ? e.message : String(e);
        onFailed('Network error: ' + msg);
      }
    });
    configPatchChain = run.catch((error: unknown) => {
      console.error('[site-settings] config patch queue failed', { error });
    });
    return run;
  }
  return queueConfigPatch;
}

// -------- (2) Password set/disable form ----------------------------------

function wirePasswordForm(siteId: string): void {
  const form = document.querySelector<HTMLFormElement>('form.pw');
  const disableBtn = document.querySelector<HTMLButtonElement>(
    'button[data-action="disable"]',
  );
  const err = document.querySelector<HTMLElement>('.err');
  const ok = document.querySelector<HTMLElement>('.ok');
  function clearStatus(): void {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg: string): void {
    clearStatus();
    if (err) err.textContent = msg;
  }
  function showOk(msg: string): void {
    clearStatus();
    if (ok) ok.textContent = msg;
  }
  async function responseDetail(response: Response): Promise<string> {
    const bodyText = (await response.text()).trim();
    return bodyText || response.statusText;
  }
  if (form) {
    form.addEventListener('submit', (event) => {
      void (async (): Promise<void> => {
        event.preventDefault();
        const input = form.querySelector<HTMLInputElement>('input[name="password"]');
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
        const password = input && input.value ? input.value : '';
        if (password.length < 4) {
          showError('Password must be at least 4 characters');
          return;
        }
        clearStatus();
        if (button) button.disabled = true;
        try {
          const response = await fetch(
            '/api/sites/' + encodeURIComponent(siteId) + '/password',
            {
              method: 'PUT',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
              },
              body: JSON.stringify({ password }),
            },
          );
          if (!response.ok) {
            const detail = await responseDetail(response);
            showError(detail);
            if (button) button.disabled = false;
            return;
          }
          showOk('Password updated.');
          setTimeout(() => location.reload(), 600);
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          showError('Network error: ' + msg);
          if (button) button.disabled = false;
        }
      })();
    });
  }
  if (disableBtn) {
    disableBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
        const confirmed = await window.__opencanvasModal.confirm(
          'Disable password protection? Visitors will be able to view this site without a password.',
          { title: 'Disable protection' },
        );
        if (!confirmed) return;
        disableBtn.disabled = true;
        try {
          const response = await fetch(
            '/api/sites/' + encodeURIComponent(siteId) + '/password',
            {
              method: 'DELETE',
              headers: { accept: 'application/json' },
            },
          );
          if (!response.ok) {
            const detail = await responseDetail(response);
            showError('Could not disable: ' + detail);
            disableBtn.disabled = false;
            return;
          }
          showOk('Password protection disabled.');
          setTimeout(() => location.reload(), 600);
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          showError('Network error: ' + msg);
          disableBtn.disabled = false;
        }
      })();
    });
  }
}

// -------- (3) Collaborators (invite + role-change + remove/resend) -------

function wireCollaborators(siteId: string): void {
  const collabForm = document.querySelector<HTMLFormElement>('form.collab-form');
  const collabErr = document.querySelector<HTMLElement>('p.collab-err');
  const collabOk = document.querySelector<HTMLElement>('p.collab-ok');
  const collabList = document.querySelector<HTMLElement>('ul.collab-list');

  function clearCollabStatus(): void {
    if (collabErr) collabErr.textContent = '';
    if (collabOk) collabOk.textContent = '';
  }
  async function responseDetail(response: Response): Promise<string> {
    const bodyText = (await response.text()).trim();
    if (!bodyText) return response.statusText;
    try {
      const json = JSON.parse(bodyText) as CollabActionResponse;
      if (json && typeof json.error === 'string') return json.error;
    } catch {
      // not JSON — fall through and return raw body
    }
    return bodyText;
  }

  if (collabForm) {
    collabForm.addEventListener('submit', (event) => {
      void (async (): Promise<void> => {
        event.preventDefault();
        const emailInput = collabForm.querySelector<HTMLInputElement>(
          'input[name="email"]',
        );
        const roleSelect = collabForm.querySelector<HTMLSelectElement>(
          'select[name="role"]',
        );
        const submitBtn = collabForm.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        const email = emailInput ? emailInput.value.trim() : '';
        const role = roleSelect ? roleSelect.value : 'editor';
        if (!email) return;
        clearCollabStatus();
        if (submitBtn) submitBtn.disabled = true;
        try {
          const response = await fetch(
            '/api/sites/' + encodeURIComponent(siteId) + '/collaborators',
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
              },
              body: JSON.stringify({ email, role }),
            },
          );
          if (!response.ok) {
            const detail = await responseDetail(response);
            if (collabErr) collabErr.textContent = detail;
            if (submitBtn) submitBtn.disabled = false;
            return;
          }
          if (collabOk) collabOk.textContent = 'Invitation sent to ' + email;
          if (emailInput) emailInput.value = '';
          setTimeout(() => location.reload(), 1200);
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          if (collabErr) collabErr.textContent = 'Network error: ' + msg;
          if (submitBtn) submitBtn.disabled = false;
        }
      })();
    });
  }

  if (collabList) {
    collabList.addEventListener('click', (event) => {
      void (async (): Promise<void> => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const removeBtn = target.closest('button.remove-btn');
        const resendBtn = target.closest('button.resend-btn');
        if (removeBtn instanceof HTMLButtonElement) {
          const item = removeBtn.closest('.collab-item');
          const collabId =
            removeBtn.getAttribute('data-remove-collab') ||
            (item ? item.getAttribute('data-collab-id') : null);
          if (!collabId) return;
          const confirmed = await window.__opencanvasModal.confirm(
            'Remove this collaborator?',
            { title: 'Remove collaborator', confirmLabel: 'Remove', danger: true },
          );
          if (!confirmed) return;
          removeBtn.disabled = true;
          clearCollabStatus();
          try {
            const response = await fetch(
              '/api/sites/' +
                encodeURIComponent(siteId) +
                '/collaborators/' +
                encodeURIComponent(collabId),
              {
                method: 'DELETE',
                headers: { accept: 'application/json' },
              },
            );
            if (!response.ok) {
              const detail = await responseDetail(response);
              if (collabErr) collabErr.textContent = detail;
              removeBtn.disabled = false;
              return;
            }
            if (item) item.remove();
          } catch (e: unknown) {
            const msg = e instanceof Error && e.message ? e.message : String(e);
            if (collabErr) collabErr.textContent = 'Network error: ' + msg;
            removeBtn.disabled = false;
          }
          return;
        }
        if (resendBtn instanceof HTMLButtonElement) {
          const collabId = resendBtn.getAttribute('data-resend-collab');
          if (!collabId) return;
          resendBtn.disabled = true;
          clearCollabStatus();
          try {
            const response = await fetch(
              '/api/sites/' +
                encodeURIComponent(siteId) +
                '/collaborators/' +
                encodeURIComponent(collabId) +
                '/resend',
              {
                method: 'POST',
                headers: { accept: 'application/json' },
              },
            );
            if (!response.ok) {
              const detail = await responseDetail(response);
              if (collabErr) collabErr.textContent = detail;
              resendBtn.disabled = false;
              return;
            }
            if (collabOk) collabOk.textContent = 'Invitation resent.';
          } catch (e: unknown) {
            const msg = e instanceof Error && e.message ? e.message : String(e);
            if (collabErr) collabErr.textContent = 'Network error: ' + msg;
          } finally {
            resendBtn.disabled = false;
          }
          return;
        }
      })();
    });

    // Role change — fires PATCH on each change. On failure, revert to the
    // previously persisted value (stashed in data-prev-role) so the dropdown
    // doesn't visually claim a state the server didn't accept.
    collabList.addEventListener('change', (event) => {
      void (async (): Promise<void> => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (!target.classList.contains('role-select')) return;
        const collabId = target.getAttribute('data-role-collab');
        if (!collabId) return;
        const newRole = target.value;
        const prevRole = target.getAttribute('data-prev-role') || 'editor';
        if (newRole === prevRole) return;
        target.disabled = true;
        clearCollabStatus();
        try {
          const response = await fetch(
            '/api/sites/' +
              encodeURIComponent(siteId) +
              '/collaborators/' +
              encodeURIComponent(collabId),
            {
              method: 'PATCH',
              headers: {
                'content-type': 'application/json',
                accept: 'application/json',
              },
              body: JSON.stringify({ role: newRole }),
            },
          );
          if (!response.ok) {
            const detail = await responseDetail(response);
            if (collabErr) collabErr.textContent = detail;
            target.value = prevRole;
            return;
          }
          target.setAttribute('data-prev-role', newRole);
          if (collabOk) collabOk.textContent = 'Role updated.';
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          if (collabErr) collabErr.textContent = 'Network error: ' + msg;
          target.value = prevRole;
        } finally {
          target.disabled = false;
        }
      })();
    });
  }
}

// -------- (4) Favicon picker modal ---------------------------------------

function wireFaviconPicker(
  siteId: string,
  queueConfigPatch: ReturnType<typeof makeQueueConfigPatch>,
): void {
  function assetUrl(id: string): string {
    return (
      '/api/canvas/sites/' +
      encodeURIComponent(siteId) +
      '/assets/' +
      encodeURIComponent(id)
    );
  }
  const picker = document.querySelector<HTMLElement>(
    '[data-asset-picker="favicon"]',
  );
  if (!picker) return;
  const modal = document.querySelector<HTMLElement>('[data-picker-modal]');
  const modalGrid = document.querySelector<HTMLElement>('[data-picker-grid]');
  const modalEmpty = document.querySelector<HTMLElement>('[data-picker-empty]');
  const modalStatus = document.querySelector<HTMLElement>('[data-picker-status]');
  const modalClose = document.querySelector<HTMLElement>('[data-picker-close]');
  const modalUpload = document.querySelector<HTMLInputElement>(
    '[data-picker-upload]',
  );
  const okMsg = document.querySelector<HTMLElement>('[data-favicon-status]');
  const errMsg = document.querySelector<HTMLElement>('[data-favicon-err]');
  function setStatus(msg: string, isError: boolean): void {
    if (!modalStatus) return;
    modalStatus.textContent = msg || '';
    modalStatus.classList.toggle('error', !!isError);
  }
  function showOk(msg: string): void {
    if (okMsg) okMsg.textContent = msg;
    if (errMsg) errMsg.textContent = '';
  }
  function showErr(msg: string): void {
    if (errMsg) errMsg.textContent = msg;
    if (okMsg) okMsg.textContent = '';
  }
  async function loadAssets(): Promise<void> {
    setStatus('Loading…', false);
    try {
      const r = await fetch('/api/owner/assets', {
        headers: { accept: 'application/json' },
      });
      if (!r.ok) {
        setStatus('Could not load assets (' + r.status + ')', true);
        return;
      }
      const body = (await r.json()) as AssetListResponse;
      const assets = Array.isArray(body.assets) ? body.assets : [];
      const images = assets.filter(
        (a) =>
          a.kind === 'image' ||
          (typeof a.mediaType === 'string' && a.mediaType.startsWith('image/')),
      );
      if (!modalGrid || !modalEmpty) return;
      modalGrid.innerHTML = '';
      if (images.length === 0) {
        modalEmpty.hidden = false;
        setStatus('', false);
        return;
      }
      modalEmpty.hidden = true;
      for (const a of images) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'picker-tile';
        tile.style.backgroundImage = 'url(' + assetUrl(a.id) + ')';
        tile.title = a.alt || a.id;
        tile.addEventListener('click', () => {
          void commit(a.id);
        });
        modalGrid.appendChild(tile);
      }
      setStatus(
        images.length +
          ' image' +
          (images.length === 1 ? '' : 's') +
          ' available',
        false,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : String(e);
      setStatus('Network error: ' + msg, true);
    }
  }
  async function commit(assetIdOrNull: string | null): Promise<void> {
    showOk('Saving…');
    await queueConfigPatch(
      { faviconAssetId: assetIdOrNull },
      () => {
        const thumb = picker!.querySelector<HTMLElement>('[data-picker-thumb]');
        const meta = picker!.querySelector<HTMLElement>('[data-picker-meta]');
        const clearBtn = picker!.querySelector<HTMLElement>('[data-picker-clear]');
        const chooseBtn = picker!.querySelector<HTMLElement>('[data-picker-choose]');
        picker!.setAttribute('data-asset-id', assetIdOrNull || '');
        if (thumb) {
          if (assetIdOrNull) {
            thumb.style.backgroundImage = 'url(' + assetUrl(assetIdOrNull) + ')';
            thumb.setAttribute('data-has-image', 'true');
            thumb.textContent = '';
          } else {
            thumb.style.backgroundImage = '';
            thumb.setAttribute('data-has-image', 'false');
            thumb.textContent = 'none';
          }
        }
        if (meta) {
          meta.textContent = assetIdOrNull
            ? 'Set — emitted as <link rel="icon"> on every page.'
            : 'Not set — browsers will show the default tab icon.';
        }
        if (clearBtn) clearBtn.hidden = !assetIdOrNull;
        if (chooseBtn)
          chooseBtn.textContent = assetIdOrNull ? 'Change' : 'Choose image';
        showOk('Saved.');
        if (modal) modal.removeAttribute('data-open');
      },
      showErr,
    );
  }
  const chooseBtn = picker.querySelector<HTMLElement>('[data-picker-choose]');
  const clearBtn = picker.querySelector<HTMLElement>('[data-picker-clear]');
  if (chooseBtn)
    chooseBtn.addEventListener('click', () => {
      if (modal) modal.setAttribute('data-open', 'true');
      void loadAssets();
    });
  if (clearBtn)
    clearBtn.addEventListener('click', () => {
      void commit(null);
    });
  if (modalClose)
    modalClose.addEventListener('click', () => {
      if (modal) modal.removeAttribute('data-open');
    });
  if (modal)
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.removeAttribute('data-open');
    });
  document.addEventListener('keydown', (ev) => {
    if (
      ev.key === 'Escape' &&
      modal &&
      modal.getAttribute('data-open') === 'true'
    ) {
      modal.removeAttribute('data-open');
    }
  });
  if (modalUpload) {
    modalUpload.addEventListener('change', () => {
      void (async (): Promise<void> => {
        const file = modalUpload.files && modalUpload.files[0];
        if (!file) return;
        setStatus('Uploading ' + file.name + '…', false);
        const fd = new FormData();
        fd.append('file', file);
        try {
          const r = await fetch('/api/owner/assets', { method: 'POST', body: fd });
          if (!r.ok) {
            let detail = r.statusText;
            try {
              const b = (await r.json()) as AssetUploadResponse;
              if (b && b.error) detail = b.error;
            } catch {
              /* noop */
            }
            setStatus('Upload failed: ' + detail, true);
            modalUpload.value = '';
            return;
          }
          const body = (await r.json()) as AssetUploadResponse;
          modalUpload.value = '';
          if (body && body.id) await commit(body.id);
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          setStatus('Network error: ' + msg, true);
          modalUpload.value = '';
        }
      })();
    });
  }
}

// -------- (5) Site-config controls (checkboxes + visitorTheme radios) ----

interface RadioGroup {
  key: string;
  inputs: HTMLInputElement[];
  savedValue: string;
  stateEl: HTMLElement | null;
}

function wireConfigControls(
  queueConfigPatch: ReturnType<typeof makeQueueConfigPatch>,
): void {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[data-config-key]',
  );
  // Group radios by name so the "saved value" / revert is shared across
  // the group rather than per-input.
  const radioGroups = new Map<string, RadioGroup>();
  inputs.forEach((cb) => {
    const key = cb.getAttribute('data-config-key');
    if (!key) return;
    if (cb.type === 'radio') {
      const groupName = cb.name || key;
      let group = radioGroups.get(groupName);
      if (!group) {
        group = { key, inputs: [], savedValue: '', stateEl: null };
        radioGroups.set(groupName, group);
      }
      group.inputs.push(cb);
      if (cb.checked) group.savedValue = cb.value;
      if (!group.stateEl) {
        const head = cb.closest('.set-head');
        group.stateEl = head
          ? head.querySelector<HTMLElement>('[data-theme-state]')
          : null;
      }
      return;
    }
    // Checkbox path (unchanged behaviour for the boolean controls).
    const inverted = cb.getAttribute('data-invert') === 'true';
    const toggleRow = cb.closest('.toggle-row');
    const stateEl = toggleRow
      ? toggleRow.querySelector<HTMLElement>('[data-toggle-state]')
      : null;
    const stateOn = cb.getAttribute('data-on-label') ?? 'On';
    const stateOff = cb.getAttribute('data-off-label') ?? 'Off';
    function apiValueFromChecked(checked: boolean): boolean {
      return inverted ? !checked : checked;
    }
    function checkedFromApiValue(value: boolean): boolean {
      return inverted ? !value : value;
    }
    function renderSavedState(apiValue: boolean): void {
      if (stateEl)
        stateEl.textContent = checkedFromApiValue(apiValue) ? stateOn : stateOff;
    }
    let savedApiValue = apiValueFromChecked(cb.checked);
    let nextQueueId = 0;
    let latestQueueId = 0;
    cb.addEventListener('change', () => {
      const apiValue = apiValueFromChecked(cb.checked);
      const queueId = nextQueueId + 1;
      nextQueueId = queueId;
      latestQueueId = queueId;
      void queueConfigPatch(
        { [key]: apiValue },
        () => {
          savedApiValue = apiValue;
          if (latestQueueId === queueId) renderSavedState(apiValue);
        },
        (message) => {
          if (latestQueueId === queueId) {
            cb.checked = checkedFromApiValue(savedApiValue);
            renderSavedState(savedApiValue);
          }
          alert(message);
        },
      );
    });
  });
  // Wire each radio group's change handler once. Only the newly-selected
  // radio fires 'change'; on failure, restore the previously-saved value
  // and re-check the corresponding radio.
  radioGroups.forEach((group) => {
    function renderSavedStateRadio(value: string): void {
      if (!group.stateEl) return;
      group.stateEl.textContent =
        value === 'dark'
          ? 'Dark theme, no toggle.'
          : value === 'toggleable'
            ? 'Toggleable by visitors, defaults to their OS preference.'
            : 'Light theme, no toggle.';
    }
    let nextQueueId = 0;
    let latestQueueId = 0;
    group.inputs.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const apiValue = radio.value;
        const queueId = nextQueueId + 1;
        nextQueueId = queueId;
        latestQueueId = queueId;
        void queueConfigPatch(
          { [group.key]: apiValue },
          () => {
            group.savedValue = apiValue;
            if (latestQueueId === queueId) renderSavedStateRadio(apiValue);
          },
          (message) => {
            if (latestQueueId === queueId) {
              group.inputs.forEach((r) => {
                r.checked = r.value === group.savedValue;
              });
              renderSavedStateRadio(group.savedValue);
            }
            alert(message);
          },
        );
      });
    });
  });
}

// -------- (6) Delete-site typed-confirmation modal -----------------------

function wireDeleteSiteModal(siteId: string): void {
  const trigger = document.querySelector<HTMLElement>('[data-delete-trigger]');
  const modal = document.querySelector<HTMLElement>(
    '[data-delete-confirm-modal]',
  );
  if (!trigger || !modal) return;
  const siteName = modal.getAttribute('data-site-name') || '';
  const input = modal.querySelector<HTMLInputElement>(
    '[data-delete-confirm-input]',
  );
  const confirmBtn = modal.querySelector<HTMLButtonElement>(
    '[data-delete-confirm]',
  );
  const cancelBtn = modal.querySelector<HTMLElement>('[data-delete-cancel]');
  const errEl = modal.querySelector<HTMLElement>('[data-delete-confirm-error]');
  function reset(): void {
    if (input) input.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (errEl) errEl.textContent = '';
  }
  function close(): void {
    modal!.removeAttribute('data-open');
    reset();
  }
  trigger.addEventListener('click', () => {
    reset();
    modal.setAttribute('data-open', 'true');
    if (input) setTimeout(() => input.focus(), 60);
  });
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal.getAttribute('data-open') === 'true') close();
  });
  if (input && confirmBtn) {
    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value.trim() !== siteName;
    });
  }
  if (confirmBtn)
    confirmBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
        if (input && input.value.trim() !== siteName) return;
        confirmBtn.disabled = true;
        if (errEl) errEl.textContent = '';
        try {
          const r = await fetch('/api/sites/' + encodeURIComponent(siteId), {
            method: 'DELETE',
            headers: { accept: 'application/json' },
          });
          if (r.ok) {
            window.location.href = '/dashboard';
            return;
          }
          let msg = 'Delete failed (' + r.status + ').';
          try {
            const b = (await r.json()) as DeleteSiteResponse;
            if (b && typeof b.error === 'string') msg = 'Delete failed: ' + b.error;
          } catch {
            /* noop */
          }
          if (errEl) errEl.textContent = msg;
          confirmBtn.disabled = false;
        } catch (e: unknown) {
          const msg = e instanceof Error && e.message ? e.message : String(e);
          if (errEl) errEl.textContent = 'Network error: ' + msg;
          confirmBtn.disabled = false;
        }
      })();
    });
}

export function mountSiteSettings(): void {
  const siteId = readSiteId();
  const queueConfigPatch = makeQueueConfigPatch(siteId);
  wirePasswordForm(siteId);
  wireCollaborators(siteId);
  wireFaviconPicker(siteId, queueConfigPatch);
  wireConfigControls(queueConfigPatch);
  wireDeleteSiteModal(siteId);
}
