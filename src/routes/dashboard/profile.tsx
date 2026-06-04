import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, count } from 'drizzle-orm';
import { db } from '../../db/client';
import { site } from '../../db/schema';
import { clerkAuth, getClerkUser } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button, readThemeCookie } from '../../ui';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DEV_PUBLIC_HOST?: string;
  DATABASE_URL: string;
};

const profileRoute = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

profileRoute.use('*', clerkAuth());
profileRoute.use('*', requireAuth());

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

function formatFullDate(d: Date): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// MIGRATION.md §5e — Profile route wears the Open Canvas account skin.
// account.html's Profile pane renders inside a centred 820px column with
// stacked `.card` panels. The profile sidebar (avatar + site count) is
// folded into the same column as the editor card, matching how
// account.html keeps every account-scoped surface inside one narrow page.
const profileStyles = `
  .content { max-width: 820px; padding-bottom: 70px; }
  .content > h1 { font-size: 32px; letter-spacing: -.03em; margin-bottom: 6px; }
  .content > .sub { color: var(--ink-2); margin: 6px 0 24px; font-size: 14.5px; }

  .acc-card { padding: 24px; margin-bottom: 16px; }
  .acc-card h2 {
    font-family: var(--display);
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 4px;
    color: var(--ink);
  }
  .acc-card .ch-sub {
    font-size: 13.5px;
    color: var(--ink-2);
    margin: 0 0 18px;
  }

  .ava-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 22px;
  }
  .ava-big {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, #E9837A, #C5332F);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 24px;
    font-family: var(--display);
    flex-shrink: 0;
    overflow: hidden;
  }
  .ava-big img { width: 100%; height: 100%; object-fit: cover; }
  .ava-meta b { font-size: 15px; font-family: var(--display); color: var(--ink); }
  .ava-meta small { display: block; color: var(--ink-3); font-size: 12.5px; margin-top: 4px; }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
    align-items: start;
  }
  .fieldset {
    display: grid;
    gap: 7px;
    /* Row template: label / control / hint. Reserving the hint row even
       when empty keeps neighbouring fieldsets in the same .grid2 row on
       a shared baseline regardless of whether one column has helper
       text and the other does not. */
    grid-template-rows: auto auto auto;
  }
  .fieldset .hint {
    font-size: 12px;
    color: var(--ink-3);
    margin-top: 2px;
    min-height: 16px;
    line-height: 1.35;
  }
  .fieldset textarea.field {
    min-height: 86px;
    resize: vertical;
    line-height: 1.5;
  }
  .fieldset select.field {
    appearance: none;
    background-image:
      linear-gradient(45deg, transparent 50%, var(--ink-2) 50%),
      linear-gradient(135deg, var(--ink-2) 50%, transparent 50%);
    background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
    background-size: 5px 5px;
    background-repeat: no-repeat;
    padding-right: 36px;
  }
  .field[readonly] {
    background: var(--surface-2);
    color: var(--ink-3);
    cursor: not-allowed;
  }

  .acc-stats {
    display: flex;
    gap: 22px;
    padding-top: 18px;
    margin-top: 6px;
    border-top: 1px solid var(--line);
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .acc-stats b {
    color: var(--ink);
    font-family: var(--display);
    font-weight: 700;
  }

  .save-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 18px;
  }
  .save-feedback {
    font-size: 13px;
    color: var(--ok);
    margin-left: 4px;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .save-feedback.visible { opacity: 1; }
  .save-feedback.error { color: var(--red-ink); }

  @media (max-width: 760px) {
    .grid2 { grid-template-columns: 1fr; }
  }
`;

// Inline form-submit script. DOM hooks (#profile-form / #save-feedback /
// #save-btn) preserved through the restyle — the API contract is the same
// PATCH /api/profile call the previous chrome used.
const profileScript = raw(`<script>
(function() {
  var form = document.getElementById('profile-form');
  var feedback = document.getElementById('save-feedback');
  var saveBtn = document.getElementById('save-btn');

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    feedback.className = 'save-feedback';
    feedback.textContent = '';

    var data = {
      displayName: form.displayName.value.trim(),
      bio: form.bio.value.trim(),
      timezone: form.timezone.value
    };

    fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(function(r) {
      return r.json().then(function(d) { return { ok: r.ok, data: d }; });
    })
    .then(function(result) {
      if (!result.ok) throw new Error(result.data.error || 'Save failed');
      feedback.textContent = 'Saved';
      feedback.className = 'save-feedback visible';
      saveBtn.textContent = 'Save changes';
      saveBtn.disabled = false;
      setTimeout(function() { feedback.className = 'save-feedback'; }, 2500);
    })
    .catch(function(err) {
      feedback.textContent = err.message || 'Save failed';
      feedback.className = 'save-feedback visible error';
      saveBtn.textContent = 'Save changes';
      saveBtn.disabled = false;
    });
  });
})();
</script>`);

profileRoute.get('/profile', async (c) => {
  const user = await getClerkUser(c);
  if (!user) {
    throw new Error('profile page reached without a resolved user');
  }
  // clerkAuth() middleware already loaded the customer row.
  const profile = c.get('customer');
  if (!profile) {
    throw new Error('profile page reached without a resolved customer');
  }

  const database = db(c.env);
  const primaryEmail = profile.email;

  const siteCountRows = await database
    .select({ count: count() })
    .from(site)
    .where(eq(site.customerId, profile.id));
  const siteCount = siteCountRows[0]?.count ?? 0;

  const avatarUrl = user.imageUrl;
  const displayName = profile.displayName ?? user.firstName ?? '';
  const initial = (displayName || primaryEmail || '?').charAt(0).toUpperCase();

  return c.html(
    <DashboardShell
      title="Open Canvas — profile"
      crumbs={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Profile' },
      ]}
      activePath="/dashboard/profile"
      pageStyles={profileStyles}
      userMeta={{ avatarUrl, displayName: displayName || undefined, email: primaryEmail }}
      theme={readThemeCookie(c)}
    >
      <h1>Account</h1>
      <p class="sub">Manage how you appear to collaborators and how Open Canvas treats this account.</p>

      <section class="card acc-card">
        <h2>Your profile</h2>
        <p class="ch-sub">This is how you appear to collaborators and on shared projects.</p>

        <div class="ava-row">
          <div class="ava-big">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" width="64" height="64" />
            ) : (
              initial
            )}
          </div>
          <div class="ava-meta">
            <b>{displayName || primaryEmail.split('@')[0]}</b>
            <small>{primaryEmail}</small>
          </div>
        </div>

        <form id="profile-form">
          <div class="grid2">
            <div class="fieldset">
              <label class="lbl" for="displayName">Display name</label>
              <input
                class="field"
                type="text"
                id="displayName"
                name="displayName"
                value={displayName}
                maxlength={100}
                placeholder="How you want to be known"
              />
              <span class="hint" aria-hidden="true"></span>
            </div>
            <div class="fieldset">
              <label class="lbl" for="email">Email</label>
              <input class="field" type="email" id="email" value={primaryEmail} readonly />
              <span class="hint">Managed by Clerk — change in account settings.</span>
            </div>
          </div>

          <div class="fieldset" style="margin-bottom:16px">
            <label class="lbl" for="bio">Bio</label>
            <textarea
              class="field"
              id="bio"
              name="bio"
              maxlength={500}
              placeholder="What you do, who you build for…"
            >{profile.bio ?? ''}</textarea>
            <span class="hint">Shown on shared projects. Max 500 characters.</span>
          </div>

          <div class="grid2">
            <div class="fieldset">
              <label class="lbl" for="timezone">Timezone</label>
              <select class="field" id="timezone" name="timezone">
                {TIMEZONES.map((tz) => (
                  <option value={tz} selected={tz === (profile.timezone ?? 'UTC')}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <span class="hint" aria-hidden="true"></span>
            </div>
            <div class="fieldset">
              <label class="lbl" for="joined">Joined</label>
              <input class="field" type="text" id="joined" value={formatFullDate(profile.createdAt)} readonly />
              <span class="hint" aria-hidden="true"></span>
            </div>
          </div>

          <div class="acc-stats">
            <div><b>{String(siteCount)}</b> {siteCount === 1 ? 'site' : 'sites'} on this account</div>
          </div>

          <div class="save-row">
            <Button variant="primary" id="save-btn" type="submit">Save changes</Button>
            <span id="save-feedback" class="save-feedback"></span>
          </div>
        </form>
      </section>

      <section class="card acc-card">
        <h2>Sign out</h2>
        <p class="ch-sub">Sign out of Open Canvas on this device.</p>
        <a href="/sign-out" class="btn btn-outline">Sign out</a>
      </section>

      {profileScript}
    </DashboardShell>,
  );
});

export default profileRoute;
