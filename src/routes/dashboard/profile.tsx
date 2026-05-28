import { Hono } from 'hono';
import { raw } from 'hono/html';
import { eq, sql, count } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { clerkAuth } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { upsertCustomerFromClerk } from '../../auth/customer-upsert';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { Button } from '../../ui';

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

const profileStyles = `
  .profile-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 32px;
    align-items: start;
  }
  .profile-sidebar {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 28px 24px;
    text-align: center;
  }
  .profile-avatar {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid var(--line);
    margin-bottom: 16px;
  }
  .profile-avatar--fallback {
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: rgba(125,211,252,0.12);
    color: var(--accent);
    font-size: 36px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
    border: 3px solid var(--line);
  }
  .profile-sidebar h2 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
  }
  .profile-sidebar .profile-email {
    font-size: 13px;
    color: var(--faint);
    margin: 0 0 16px;
    word-break: break-all;
  }
  .profile-stat-row {
    display: flex;
    justify-content: center;
    gap: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    margin-top: 4px;
  }
  .profile-stat {
    text-align: center;
  }
  .profile-stat .val {
    font-size: 22px;
    font-weight: 700;
    color: var(--text);
    display: block;
  }
  .profile-stat .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }
  .profile-joined {
    font-size: 12px;
    color: var(--faint);
    margin-top: 14px;
  }

  .profile-main {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 28px 32px;
  }
  .profile-main h2 {
    margin: 0 0 24px;
    font-size: 20px;
    font-weight: 600;
  }
  .form-group {
    margin-bottom: 20px;
  }
  .form-group label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .form-group input,
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s;
  }
  .form-group input:focus,
  .form-group textarea:focus,
  .form-group select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(125,211,252,0.12);
  }
  .form-group textarea {
    resize: vertical;
    min-height: 80px;
  }
  .form-group .hint {
    font-size: 12px;
    color: var(--faint);
    margin-top: 4px;
  }
  .form-group input[readonly] {
    color: var(--faint);
    cursor: not-allowed;
    background: rgba(255,255,255,0.02);
  }
  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .form-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }
  .save-feedback {
    font-size: 13px;
    color: #4ade80;
    margin-left: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }
  .save-feedback.visible { opacity: 1; }
  .save-feedback.error { color: #ef4444; }
  .sign-out-row {
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .sign-out-row p {
    margin: 0;
    font-size: 13px;
    color: var(--faint);
  }
  .btn-signout {
    padding: 8px 18px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    background: rgba(239,68,68,0.10);
    color: #ef4444;
    border: 1px solid rgba(239,68,68,0.22);
    cursor: pointer;
    font-family: inherit;
    text-decoration: none;
  }
  .btn-signout:hover {
    background: rgba(239,68,68,0.18);
  }

  @media (max-width: 768px) {
    .profile-layout {
      grid-template-columns: 1fr;
    }
    .form-row {
      grid-template-columns: 1fr;
    }
  }
`;

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
  const user = c.get('user');
  if (!user) {
    throw new Error('profile page reached without a resolved user');
  }

  const database = db(c.env);
  const { email: primaryEmail } = await upsertCustomerFromClerk(database, user);

  const rows = await database
    .select({
      id: customer.id,
      email: customer.email,
      displayName: customer.displayName,
      bio: customer.bio,
      timezone: customer.timezone,
      createdAt: customer.createdAt,
    })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);

  const profile = rows[0]!;

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
      title="rev01 — profile"
      crumbs={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Profile' },
      ]}
      activePath="/dashboard/profile"
      pageStyles={profileStyles}
      userMeta={{ avatarUrl, displayName: displayName || undefined, email: primaryEmail }}
    >
      <div class="profile-layout">
        <aside class="profile-sidebar">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" class="profile-avatar" width="96" height="96" />
          ) : (
            <div class="profile-avatar--fallback">{initial}</div>
          )}
          <h2>{displayName || primaryEmail.split('@')[0]}</h2>
          <p class="profile-email">{primaryEmail}</p>
          <div class="profile-stat-row">
            <div class="profile-stat">
              <span class="val">{String(siteCount)}</span>
              <span class="label">Sites</span>
            </div>
            <div class="profile-stat">
              <span class="val">Free</span>
              <span class="label">Plan</span>
            </div>
          </div>
          <p class="profile-joined">Joined {formatFullDate(profile.createdAt)}</p>
        </aside>

        <div class="profile-main">
          <h2>Edit profile</h2>
          <form id="profile-form">
            <div class="form-row">
              <div class="form-group">
                <label for="displayName">Display name</label>
                <input
                  type="text"
                  id="displayName"
                  name="displayName"
                  value={displayName}
                  maxlength={100}
                  placeholder="How you want to be known"
                />
              </div>
              <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" value={primaryEmail} readonly />
                <p class="hint">Managed by Clerk — change in account settings</p>
              </div>
            </div>

            <div class="form-group">
              <label for="bio">Bio</label>
              <textarea id="bio" name="bio" maxlength={500} placeholder="What you do, who you build for...">{profile.bio ?? ''}</textarea>
              <p class="hint">Shown on shared projects. Max 500 characters.</p>
            </div>

            <div class="form-group">
              <label for="timezone">Timezone</label>
              <select id="timezone" name="timezone">
                {TIMEZONES.map((tz) => (
                  <option value={tz} selected={tz === (profile.timezone ?? 'UTC')}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div class="form-actions">
              <Button variant="primary" id="save-btn" type="submit">Save changes</Button>
              <span id="save-feedback" class="save-feedback"></span>
            </div>
          </form>

          <div class="sign-out-row">
            <p>Sign out of your account on this device.</p>
            <a href="/sign-out" class="btn-signout">Sign out</a>
          </div>
        </div>
      </div>
      {profileScript}
    </DashboardShell>,
  );
});

export default profileRoute;
