import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import sites from './routes/api/sites';
import { importRouter } from './routes/api/import';
import ownerApi from './routes/api/owner-app';
import canvasEditor from './editor/route';
import { handlePublicRequest, type PublicEnv } from './routes/public';
import versionRoute from './version/route';
import customDomainRouter from './custom-domain/route';
import ogRoute from './og-image/route';
import { scheduled } from './scheduled';
import formsRouter from './forms/route';
import formsInboxRoute from './routes/dashboard/forms-inbox';
import unlockRoute from './password/unlock-route';
import passwordAdminRoute from './password/admin-route';
import siteSettingsRoute from './routes/dashboard/site-settings';
import themeRoute from './themes/route';
import searchRouter from './search/route';
import a11yRoute from './a11y/route';
import a11yReportRoute from './routes/dashboard/a11y-report';
import pageSettingsRoute from './routes/dashboard/page-settings';
import sitemapRouter from './seo/sitemap/route';
import apexSeoRouter from './seo/apex';
import fontsRouter from './fonts/route';
import chatPanelRoute from './routes/dashboard/chat-panel';
import addonShopRoute from './routes/dashboard/addon-shop';
import siteAddonsRoute from './routes/dashboard/site-addons';
import addonsApi from './routes/api/addons';
import profileRoute from './routes/dashboard/profile';
import accountSettingsRoute from './routes/dashboard/settings';
import { domainsRoute } from './routes/dashboard/domains';
import versionTimelineRoute from './routes/dashboard/version-timeline';
import profileApi from './routes/api/profile';
// Admin-only mounts for the section library + custom template subsystems.
// The owner-facing routes for these subsystems live inside ownerApi and reach
// both /api/* and /__api/*; admin tooling stays on /api/* only.
import { librarySectionsAdmin } from './routes/api/library-sections';
import { customTemplatesAdmin } from './routes/api/custom-templates';
import { editTokenAuth } from './auth/middleware';
import editTokenRefreshRoute from './auth/refresh-route';
import signOutRoute from './auth/sign-out-route';
import signInRoute from './auth/sign-in-route';
import onSiteEditRoute from './routes/api/on-site-edit';
import collaboratorsApi from './routes/api/collaborators';
import inviteRedirectRoute from './auth/invite-redirect-route';
import socketRoute from './live/socket-route';

const app = new Hono<PublicEnv>();

// Public host router runs FIRST. If the request host belongs to a Published
// Site (a subdomain under the configured apex, minus the app host itself),
// serve the snapshot here. Otherwise return null and let the app-host mounts
// (landing, dashboard, /api/*) handle the request as usual.
app.use('*', async (c, next) => {
  const handled = await handlePublicRequest(c);
  if (handled) return handled;
  await next();
});

app.route('/__live', socketRoute);

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/sign-out', signOutRoute);

// Open Canvas-branded sign-in / create-account surface (MIGRATION.md §5g).
// `requireAuth()` still bounces unauthenticated owners to the Clerk Account
// Portal for back-compat (locked by review-smoke); `/auth` is a separate
// entry point that keeps owners inside our chrome by mounting Clerk's
// `<SignIn>` widget client-side. See src/auth/sign-in-route.tsx.
app.route('/auth', signInRoute);

// Stable invite landing page (#7): collaborator emails point at the main
// domain instead of a specific subdomain, so renames don't break links.
// Looks up the current subdomain at click time and 302s to the published
// subdomain's /__accept-invite handler with the same token.
app.route('/__invite', inviteRedirectRoute);

// Apex SEO surface — /sitemap.xml, /robots.txt, /og-card.png for the
// marketing landing page. Each handler checks `isApexHost(env, host)` and
// calls `next()` for subdomain / custom-domain requests so the per-site
// `sitemapRouter` below can serve them. Mounted BEFORE `sitemapRouter` so
// apex requests land here first; mounted BEFORE `landing` to keep all SEO
// surface in one place.
app.route('/', apexSeoRouter);

// The favicon route lives inside `landing` next to the rest of the brand
// surface (see src/landing/index.tsx).
app.route('/', landing);

app.route('/dashboard/templates', templatesRoute);
app.route('/dashboard', canvasEditor);
app.route('/dashboard', dashboard);
// The shared owner-rooted API surface: mounted on /api/* for the dashboard
// (Clerk-session auth) and on /__api/* for the on-site editor (edit-token
// auth) below. See src/routes/api/owner-app.ts for the route list and the
// drift-prevention rationale.
app.route('/api', ownerApi);
app.route('/api/sites', sites);
app.route('/api/import', importRouter);
// Admin-only mounts (NOT in ownerApi — editor never hits these).
app.route('/api/admin/library', librarySectionsAdmin);
app.route('/api/admin/custom-templates', customTemplatesAdmin);
app.route('/api', collaboratorsApi);
app.route('/api/sites/:siteId/snapshots', versionRoute);
app.route('/api/sites/:siteId/domains', customDomainRouter);
app.route('/og', ogRoute);
app.route('/api/forms', formsRouter);
app.route('/dashboard', formsInboxRoute);
app.route('/dashboard', siteSettingsRoute);
app.route('/api/sites', themeRoute);
app.route('/api/sites/:siteId/password', passwordAdminRoute);
// Visitor-facing unlock POST. Lives at the public-host path `/__opencanvas/unlock`;
// public.ts's handlePublicRequest explicitly returns null for `/__opencanvas/*` so
// the request falls through here. The handler reads the request Host to scope
// the cookie to the right site.
app.route('/__opencanvas/unlock', unlockRoute);
// Visitor-facing form submissions. The public-host router lets this path fall
// through only after the password gate has passed.
app.route('/__opencanvas/forms', formsRouter);
app.route('/api/sites', a11yRoute);
app.route('/dashboard', a11yReportRoute);
app.route('/dashboard', pageSettingsRoute);
// Site search — visitor-facing endpoint on the public-host path. public.ts
// lets this path fall through only after the password gate has passed. The
// handler reads the request Host to resolve site id.
app.route('/__opencanvas/search', searchRouter);
// Sitemap.xml + robots.txt on public-host root paths. public.ts must fall
// through (return null) for `/sitemap.xml` and `/robots.txt` — see the
// fallthrough block in handlePublicRequest.
app.route('/', sitemapRouter);
// Custom fonts: public `GET /fonts/:contentHash` + Owner-scoped
// `/api/sites/:siteId/fonts` verbs. Router is root-mounted so both paths
// reach their handlers.
app.route('/', fontsRouter);
app.route('/dashboard', chatPanelRoute);
// Addon system — see docs/adr/0009-addon-entitlement-model.md.
app.route('/dashboard', addonShopRoute);
app.route('/dashboard', siteAddonsRoute);
app.route('/api/addons', addonsApi);
app.route('/dashboard', profileRoute);
app.route('/dashboard', accountSettingsRoute);
app.route('/dashboard', domainsRoute);
app.route('/dashboard', versionTimelineRoute);
app.route('/api/profile', profileApi);
// On-site editor auth popup — app-host endpoint that sets the edit token
// cookie scoped to the configured apex so subdomain editors can read it.
app.route('/api/on-site-edit', onSiteEditRoute);

// On-site editor API proxy — same ownerApi handlers as /api/* but gated by
// edit-token auth instead of the dashboard's Clerk session. The public host
// router (public.ts) returns null for /__api/* paths so they fall through
// here. editTokenAuth() validates the edit-token cookie (name derived from
// `cookieName.edit(env)` per ADR 0017) and populates the same auth context
// variables that clerkAuth()+requireAuth() would, so each
// inner sub-app's built-in clerkAuth() short-circuits (auth already set).
app.use('/__api/*', editTokenAuth());
// /__api/edit-token must be mounted BEFORE the ownerApi catch-all because
// the refresh route reads the verified edit-token payload set by the
// editTokenAuth middleware above and does its own re-sign, while ownerApi's
// inner sub-apps would happily 404 on the unknown /__api/edit-token path.
// The auth gate has already run by the time either mount is reached.
app.route('/__api/edit-token', editTokenRefreshRoute);
app.route('/__api', ownerApi);

export { SiteRoom } from './live/site-room';
// Forms rate-limiter DurableObject. Binding lives in wrangler.toml.
export { FormRateLimiter } from './live/form-rate-limiter';
// ADR 0043 Phase D — per-Customer SSE pub-sub hub.
export { NotificationOwnerRoom } from './notifications/owner-room';
// Named export so tests can use Hono's `.request(...)` helper directly.
// (The default export is the Worker module-object Cloudflare expects:
// `{ fetch, scheduled }`. That shape does NOT expose `.request`.)
export { app };

// Worker default export carries both the request handler and the cron
// `scheduled` handler. See src/scheduled.ts for the cron dispatcher.
export default {
  fetch: app.fetch.bind(app),
  scheduled,
};
