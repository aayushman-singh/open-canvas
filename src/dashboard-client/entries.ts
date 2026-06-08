// src/dashboard-client/entries.ts
//
// ADR 0021 — entries dashboard page client. Migrated from the three
// inline `<script>` blocks in `src/routes/dashboard/entries.tsx`
// (listClientScript + two formClientScript emissions). DOM contract
// preserved (`form#entry-form`, `ul.entries-list` related hooks
// `[data-new-collection]`, `[data-delete-entry]`, `[data-entry-id]`,
// `[data-entry-title]`, `input[name="*"]`, `[data-folder-input]`,
// `[data-form-msg]`); API contract preserved (POST
// `/api/sites/:siteId/entries`, PATCH `/api/sites/:siteId/entries/:id`,
// DELETE `/api/sites/:siteId/entries/:id`, POST
// `/api/sites/:siteId/collections`).
//
// Per-request `siteId` flows in through the boot blob
// (`window.__opencanvasDashboardBoot.siteId`) — same pattern as
// `domains.ts` / `version-timeline.ts` / `site-addons.ts` /
// `site-settings.ts`. Mount throws loud if the key is missing rather
// than silently no-op'ing.
//
// The entries route renders three different surfaces under the same
// `/dashboard/sites/:siteId/entries[/...]` URL family:
//   1. The list view (GET /entries)            — wireListIfPresent
//   2. The new-entry form (GET /entries/new)   — wireNewFormIfPresent
//   3. The edit-entry form (GET /entries/:id)  — wireEditFormIfPresent
// Each `wire*` helper early-returns when its DOM hooks are absent so
// the same mount can drive any of the three surfaces. The form-mode
// branch (new vs edit) is carried on the form's `data-mode` attribute
// — both new and edit reuse the same handler chain.
//
// Exported as `mountEntries(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

interface OpencanvasModalConfirmOpts {
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}

// `__opencanvasModal` is the shell-registered modal helper. The other
// dashboard mount modules (`domains.ts`, `version-timeline.ts`,
// `site-settings.ts`, etc.) all declare the same `confirm` + `alert`
// shape — we redeclare that identical shape here so TS's cross-file
// interface merging accepts the augmentation without conflict.
// Entries needs the `prompt` method too (for the "+ New collection"
// wizard), but adding `prompt` to the merged interface would diverge
// from the other modules and trip TS2717. We access `prompt` through
// a narrow local-cast at the call site instead.
interface OpencanvasModalGlobal {
  confirm(msg: string, opts?: OpencanvasModalConfirmOpts): Promise<boolean>;
  alert(msg: string, title?: string): Promise<void>;
}

interface OpencanvasModalGlobalWithPrompt extends OpencanvasModalGlobal {
  prompt(msg: string, defaultValue?: string, title?: string): Promise<string | null>;
}

declare global {
  interface Window {
    __opencanvasModal: OpencanvasModalGlobal;
  }
}

function readSiteId(): string {
  const boot = window.__opencanvasDashboardBoot;
  if (!boot || boot.route !== 'entries') {
    throw new Error(
      '[dashboard-client/entries] boot blob missing or wrong route — expected { route: "entries", siteId }',
    );
  }
  if (typeof boot.siteId !== 'string' || boot.siteId.length === 0) {
    throw new Error(
      '[dashboard-client/entries] boot blob missing siteId — entries client cannot wire DOM',
    );
  }
  return boot.siteId;
}

interface CollectionCreateResponse {
  redirectTo?: string;
  error?: string;
}

interface EntrySaveResponse {
  error?: string;
}

interface EntryDeleteResponse {
  error?: string;
}

// kebab-case slug helper. Lifted verbatim from the inline `formClientScript`
// IIFE so a regression that swaps it for a different normaliser shows up
// in the smoke (which greps for `function kebab` on the mount source).
function kebab(value: string): string {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Same shape rule the server enforces, mirrored on the client so the
// Owner gets immediate feedback before the round trip. Returns `null`
// when the value is acceptable, or a human-readable error string
// otherwise. Empty input is treated as "ungrouped" and is valid here
// — the submit handler then serialises `''` → `null` before posting.
function validateFolder(value: string): string | null {
  if (value.length === 0) return null;
  if (value.length > 64) return 'Folder must be 64 characters or fewer.';
  if (value.indexOf('/') >= 0 || value.indexOf('\\') >= 0) {
    return 'Folder must not contain "/" or "\\".';
  }
  return null;
}

// `slugify` is the collection-wizard variant — stricter than the
// `kebab` form helper above because the slug becomes a routing key
// (`/dashboard/sites/:siteId/entries?collection=<slug>`). Lifted from
// the inline `listClientScript` IIFE.
function slugify(value: string): string {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function wireNewCollectionButton(siteId: string): void {
  const button = document.querySelector<HTMLButtonElement>('[data-new-collection]');
  if (!button) return;
  button.addEventListener('click', async () => {
    // `prompt` is registered by the shell but not exposed on the merged
    // `OpencanvasModalGlobal` Window interface (the other dashboard
    // mounts don't need it and adding it there would trip TS2717). Cast
    // locally so the call stays typed without polluting the shared
    // global. Loud failure if the shell didn't register prompt: the
    // resulting TypeError surfaces as a runtime error in the wizard
    // click handler, matching the all-or-nothing failure posture.
    const modal = window.__opencanvasModal as OpencanvasModalGlobalWithPrompt;
    const raw = await modal.prompt(
      'Pick a slug for this collection (e.g. "blog", "case-studies"). One word, lowercase.',
      '',
      'New collection',
    );
    if (raw === null) return;
    const slug = slugify(raw);
    if (slug.length === 0) {
      await window.__opencanvasModal.alert(
        'Slug must contain at least one lowercase letter or digit.',
        'New collection',
      );
      return;
    }
    try {
      const response = await fetch(
        '/api/sites/' + encodeURIComponent(siteId) + '/collections',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ slug }),
        },
      );
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as CollectionCreateResponse;
          if (body && typeof body.error === 'string') detail = body.error;
        } catch {
          /* not JSON — fall back to statusText */
        }
        await window.__opencanvasModal.alert(
          'Could not create collection: ' + detail,
          'New collection',
        );
        return;
      }
      let redirect: string =
        '/dashboard/sites/' +
        encodeURIComponent(siteId) +
        '/entries?collection=' +
        encodeURIComponent(slug);
      try {
        const data = (await response.json()) as CollectionCreateResponse;
        if (data && typeof data.redirectTo === 'string') redirect = data.redirectTo;
      } catch {
        /* not JSON — keep the derived default redirect */
      }
      window.location.href = redirect;
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : String(e);
      await window.__opencanvasModal.alert(
        'Network error: ' + msg,
        'New collection',
      );
    }
  });
}

function wireDeleteEntryButtons(siteId: string): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-delete-entry]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-entry');
      const title = btn.getAttribute('data-entry-title') || 'this entry';
      if (!id) return;
      const ok = await window.__opencanvasModal.confirm(
        'Delete "' + title + '"? This cannot be undone.',
        { title: 'Delete entry', confirmLabel: 'Delete', danger: true },
      );
      if (!ok) return;
      try {
        const response = await fetch(
          '/api/sites/' +
            encodeURIComponent(siteId) +
            '/entries/' +
            encodeURIComponent(id),
          { method: 'DELETE' },
        );
        if (!response.ok && response.status !== 204) {
          let detail = response.statusText;
          try {
            const body = (await response.json()) as EntryDeleteResponse;
            if (body && typeof body.error === 'string') detail = body.error;
          } catch {
            /* not JSON — fall back to statusText */
          }
          await window.__opencanvasModal.alert(
            'Delete failed: ' + detail,
            'Delete entry',
          );
          return;
        }
        const row = btn.closest('[data-entry-id]');
        if (row && row.parentNode) row.parentNode.removeChild(row);
      } catch (e: unknown) {
        const msg = e instanceof Error && e.message ? e.message : String(e);
        await window.__opencanvasModal.alert(
          'Network error: ' + msg,
          'Delete entry',
        );
      }
    });
  });
}

function wireListIfPresent(siteId: string): void {
  // The list view is identified by either the "+ New collection" button
  // (empty-state and non-empty list both render it) or any per-row
  // delete affordance. Each `wire*` early-returns on missing hooks, so
  // calling both is safe even when only one is present.
  wireNewCollectionButton(siteId);
  wireDeleteEntryButtons(siteId);
}

// HTML form-element named-property accessors. `form.<input-name>` returns
// the matching control by name. TypeScript's stock `HTMLFormElement` does
// not type the named-property accessors (and `HTMLFormElement.title`
// collides with the global `Element.title: string` getter so the form
// element can't simply be widened in-place). We thread the named
// accessors through a structurally-typed view of the form for the
// payload read path. The DOM contract is identical to the legacy inline
// IIFE: `form.title.value`, `form.slug.value`, etc.
interface EntryFormNamedFields {
  collectionSlug: HTMLInputElement;
  title: HTMLInputElement;
  slug: HTMLInputElement;
  excerpt: HTMLTextAreaElement;
  body: HTMLTextAreaElement;
  publishedDate: HTMLInputElement;
  author: HTMLInputElement;
  category: HTMLInputElement;
  tags: HTMLInputElement;
  status: HTMLSelectElement;
  folder?: HTMLInputElement;
}

function wireEntryFormIfPresent(siteId: string): void {
  const formElement = document.querySelector<HTMLFormElement>('form#entry-form');
  if (!formElement) return;
  // Cast through `unknown` because HTMLFormElement's built-in `title`
  // accessor (string) is structurally incompatible with the named-input
  // accessor (HTMLInputElement) on the form. The legacy inline IIFE
  // read `form.title.value` the same way — this view preserves that
  // contract for the payload assembly without losing the underlying
  // form element's `addEventListener` / `getAttribute` / `querySelector`
  // methods.
  const form = formElement as unknown as HTMLFormElement & EntryFormNamedFields;
  const msg = form.querySelector<HTMLElement>('[data-form-msg]');
  const titleInput = form.querySelector<HTMLInputElement>('input[name="title"]');
  const slugInput = form.querySelector<HTMLInputElement>('input[name="slug"]');

  // Auto-suggest the slug from the title until the user touches the slug
  // field. Once they type into the slug, we stop auto-syncing — their
  // value wins, even if they later edit the title. Edit-mode entries
  // arrive with a populated slug, so they start in the "touched" state.
  let slugTouched =
    (slugInput && slugInput.value.length > 0) ||
    form.getAttribute('data-mode') === 'edit';
  if (slugInput) {
    slugInput.addEventListener('input', () => {
      slugTouched = true;
    });
  }
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      if (!slugTouched && slugInput) slugInput.value = kebab(titleInput.value);
    });
  }

  function showMsg(text: string, kind: 'ok' | 'err' | ''): void {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'msg ' + kind;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMsg('Saving…', 'ok');
    const mode = form.getAttribute('data-mode');
    const entryId = form.getAttribute('data-entry-id') || '';
    const tagsRaw = form.tags.value.trim();
    const folderRaw = form.folder ? form.folder.value.trim() : '';
    const folderError = validateFolder(folderRaw);
    if (folderError) {
      showMsg(folderError, 'err');
      return;
    }
    const payload = {
      collectionSlug: form.collectionSlug.value,
      title: form.title.value.trim(),
      slug: kebab(form.slug.value.trim()),
      excerpt: form.excerpt.value,
      body: form.body.value,
      publishedDate: form.publishedDate.value,
      author: form.author.value.trim(),
      category: form.category.value.trim(),
      tags:
        tagsRaw.length > 0
          ? tagsRaw
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      status: form.status.value,
      // Empty input means "ungrouped" — serialise to null so the API
      // never sees an empty-string folder. Server rejects '' loudly; we
      // filter here so the round trip succeeds for the natural
      // empty-input case.
      folder: folderRaw.length > 0 ? folderRaw : null,
    };
    if (payload.title.length === 0) {
      showMsg('Title is required.', 'err');
      return;
    }
    if (payload.slug.length === 0) {
      showMsg('Slug is required.', 'err');
      return;
    }
    if (payload.publishedDate.length === 0) {
      showMsg('Published date is required.', 'err');
      return;
    }

    const url =
      mode === 'edit'
        ? '/api/sites/' +
          encodeURIComponent(siteId) +
          '/entries/' +
          encodeURIComponent(entryId)
        : '/api/sites/' + encodeURIComponent(siteId) + '/entries';
    const method = mode === 'edit' ? 'PATCH' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = (await response.json()) as EntrySaveResponse;
          if (body && typeof body.error === 'string') detail = body.error;
        } catch {
          /* not JSON — fall back to statusText */
        }
        showMsg('Save failed: ' + detail, 'err');
        return;
      }
      // On success, return to the list filtered to this collection.
      const collection = encodeURIComponent(payload.collectionSlug);
      window.location.href =
        '/dashboard/sites/' +
        encodeURIComponent(siteId) +
        '/entries?collection=' +
        collection;
    } catch (e: unknown) {
      const errMsg = e instanceof Error && e.message ? e.message : String(e);
      showMsg('Network error: ' + errMsg, 'err');
    }
  });
}

// The new-entry and edit-entry surfaces share a single `<form id="entry-form">`
// element; the form's `data-mode` attribute carries the create-vs-update
// branch. `wireEntryFormIfPresent` handles both, so the two named helpers
// below are thin shims that exist so the brief's "internal helpers
// wireListIfPresent / wireNewFormIfPresent / wireEditFormIfPresent" contract
// reads literally in this file.
function wireNewFormIfPresent(siteId: string): void {
  wireEntryFormIfPresent(siteId);
}

function wireEditFormIfPresent(_siteId: string): void {
  // Edit mode is wired by the same wireEntryFormIfPresent the new form
  // calls — `wireNewFormIfPresent` already covered it. The second
  // invocation here would double-bind the submit handler, so this
  // shim is intentionally a no-op. Kept as a named export for parity
  // with the brief.
  void _siteId;
}

export function mountEntries(): void {
  const siteId = readSiteId();
  wireListIfPresent(siteId);
  wireNewFormIfPresent(siteId);
  wireEditFormIfPresent(siteId);
}
