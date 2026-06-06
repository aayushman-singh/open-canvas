// src/dashboard-client/profile.ts
//
// ADR 0021 — profile page client. Migrated from the inline `profileScript`
// in `src/routes/dashboard/profile.tsx`. Same DOM contract
// (`#profile-form` / `#save-feedback` / `#save-btn`); same PATCH
// `/api/profile` endpoint; preserved error / saved feedback states.
//
// Exported as `mountProfile(): void` so the dashboard dispatcher
// (`src/dashboard-client/index.ts`) can call into it from the bundle
// entry's switch on `__opencanvasDashboardBoot.route`.

interface ProfilePayload {
  displayName: string;
  bio: string;
  timezone: string;
}

interface ProfileFormElement extends HTMLFormElement {
  displayName: HTMLInputElement;
  bio: HTMLTextAreaElement;
  timezone: HTMLSelectElement;
}

export function mountProfile(): void {
  const form = document.getElementById('profile-form') as ProfileFormElement | null;
  const feedback = document.getElementById('save-feedback');
  const saveBtn = document.getElementById('save-btn') as HTMLButtonElement | null;
  if (!form || !feedback || !saveBtn) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    feedback.className = 'save-feedback';
    feedback.textContent = '';

    const data: ProfilePayload = {
      displayName: form.displayName.value.trim(),
      bio: form.bio.value.trim(),
      timezone: form.timezone.value,
    };

    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) =>
        response.json().then((body: { error?: string }) => ({ ok: response.ok, body })),
      )
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.body.error ?? 'Save failed');
        }
        feedback.textContent = 'Saved';
        feedback.className = 'save-feedback visible';
        saveBtn.textContent = 'Save changes';
        saveBtn.disabled = false;
        setTimeout(() => {
          feedback.className = 'save-feedback';
        }, 2500);
      })
      .catch((error: unknown) => {
        feedback.textContent = error instanceof Error ? error.message : 'Save failed';
        feedback.className = 'save-feedback visible error';
        saveBtn.textContent = 'Save changes';
        saveBtn.disabled = false;
      });
  });
}
